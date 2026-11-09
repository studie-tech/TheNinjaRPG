import type { inferRouterOutputs } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getCreateConceptArtUserUpdate,
  getCreateVideoUserUpdate,
} from "@/deltas/conceptart";
import {
  COST_CONCEPT_IMAGE,
  COST_CONCEPT_VIDEO,
  SmileyEmotions,
} from "@/drizzle/constants";
import { classifyNsfwPrompt } from "@/libs/moderator";

import {
  fastTxt2imgReplicate,
  getVideoGenerationStatus,
  startVideoGeneration,
  uploadCompletedVideo,
} from "@/libs/replicate";
import {
  deleteConceptImageForDelete,
  deleteUserLikesForToggleEmotion,
  fetchImage,
  findConceptImageForCheckVideoStatusRead,
  insertConceptImageForCreate,
  insertConceptImageForCreateVideo,
  insertUserLikesForToggleEmotion,
  listConceptImageForGetAll,
  updateConceptImageForFinalizeVideoUpload,
  updateConceptImageForFinalizeVideoUpload2,
  updateConceptImageForFinalizeVideoUpload3,
  updateConceptImageForFinalizeVideoUpload4,
  updateConceptImageForToggleEmotion,
  updateUserDataForCreate,
  updateUserDataForCreateVideo,
  updateUserDataForCreateVideo2,
} from "@/queries/conceptart";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { clientErrorMessage, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";
import { logDatabaseFailure } from "@/server/utils/sentry";
import { canDeleteConceptArt, getBanOrSilenceRestriction } from "@/utils/permissions";
import {
  conceptArtFilterSchema,
  conceptArtPromptSchema,
  conceptVideoPromptSchema,
  getTimeFrameinSeconds,
} from "@/validators/art";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const CONCEPT_PROMPT = `trending on ArtStation, trending on CGSociety, Intricate, High Detail, Sharp focus, dramatic`;

export const conceptartRouter = createTRPCRouter({
  toggleEmotion: protectedProcedure
    .input(z.object({ imageId: z.string(), type: z.enum(SmileyEmotions) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const result = await fetchImage(ctx.drizzle, input.imageId, ctx.userId);
      // Guard
      if (!result) return errorResponse("Image not found");
      // Mutate
      const hasLike = result.likes.find((like) => like.type === input.type);
      // Concurrent removals decrement only the reactions this request deletes.
      const delta = hasLike
        ? -(await deleteUserLikesForToggleEmotion(ctx.drizzle, ctx, input)).rowsAffected
        : 1;
      if (delta !== 0) {
        await updateConceptImageForToggleEmotion(ctx.drizzle, input, delta);
      }
      if (!hasLike) {
        await insertUserLikesForToggleEmotion(ctx.drizzle, ctx, input);
      }
      return { success: true, message: "Emotion toggled" };
    }),
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [result, user] = await Promise.all([
        fetchImage(ctx.drizzle, input.id, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!result) return errorResponse("Image not found");
      if (result.userId !== ctx.userId && !canDeleteConceptArt(user.role)) {
        return errorResponse("Not authorized");
      }
      // Mutate
      await deleteConceptImageForDelete(ctx.drizzle, input);
      return { success: true, message: "Image deleted" };
    }),
  create: protectedProcedure
    .input(conceptArtPromptSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      const createRestriction = getBanOrSilenceRestriction(user);
      if (createRestriction) return errorResponse(createRestriction);
      if (user.reputationPoints < COST_CONCEPT_IMAGE) {
        return errorResponse("Not enough reputation points");
      }
      // NSFW Check
      const promptRejection = await rejectNsfwPrompt(input.prompt);
      if (promptRejection) return promptRejection;
      // Generate
      const avatar = await generateConceptThumbnail(
        `${input.prompt}, ${CONCEPT_PROMPT}`,
      );
      const imageUrl = avatar.data?.ufsUrl;
      if (!imageUrl) return errorResponse("Failed to create image");
      // Mutate
      const imageId = nanoid();
      // The charge and image must commit together so a failed insert cannot spend points.
      const saved = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          const debit = await updateUserDataForCreate(tx, ctx);
          if (debit.rowsAffected === 0) return false;
          await insertConceptImageForCreate(tx, imageId, ctx, input, imageUrl);
          return true;
        }),
      );
      if (!saved) {
        return errorResponse("Not enough reputation points");
      }
      return {
        success: true,
        message: "Image created",
        imageId,
        ...getCreateConceptArtUserUpdate({ user }),
      };
    }),
  createVideo: protectedProcedure
    .input(conceptVideoPromptSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      const createRestriction = getBanOrSilenceRestriction(user);
      if (createRestriction) return errorResponse(createRestriction);
      if (user.reputationPoints < COST_CONCEPT_VIDEO) {
        return errorResponse(
          `Not enough reputation points. Video generation costs ${COST_CONCEPT_VIDEO} reputation points.`,
        );
      }
      // NSFW Check (before deducting points)
      const promptRejection = await rejectNsfwPrompt(input.prompt);
      if (promptRejection) return promptRejection;
      // Deduct reputation points immediately to prevent spam
      // Use WHERE clause to ensure user still has enough points (prevents race condition)
      const deductResult = await updateUserDataForCreateVideo(ctx.drizzle, ctx);
      // Check if deduction actually happened (rowsAffected > 0)
      if (deductResult.rowsAffected === 0) {
        return errorResponse(
          `Not enough reputation points. Video generation costs ${COST_CONCEPT_VIDEO} reputation points.`,
        );
      }
      try {
        const styledPrompt = `${input.prompt}, ${CONCEPT_PROMPT}`;
        // If user provided a start_image, use it as thumbnail; otherwise generate one
        let thumbnailUrl: string | undefined;
        if (input.start_image) {
          thumbnailUrl = input.start_image;
        } else {
          const thumbnailResult = await generateConceptThumbnail(styledPrompt);
          thumbnailUrl = thumbnailResult.data?.ufsUrl;
        }
        // Start the video generation job (returns immediately)
        const prediction = await startVideoGeneration({
          prompt: styledPrompt,
          negative_prompt: input.negative_prompt,
          seed: input.seed,
          start_image: thumbnailUrl,
          last_image: input.last_image,
        });
        if (!prediction.id) {
          throw new Error("Failed to start video generation");
        }
        // Create record with processing status and thumbnail
        const videoId = nanoid();
        await insertConceptImageForCreateVideo(
          ctx.drizzle,
          videoId,
          ctx,
          input,
          thumbnailUrl,
          prediction,
        );
        return {
          success: true,
          message: "Video generation started",
          videoId,
          ...getCreateVideoUserUpdate({ user }),
        };
      } catch (error) {
        logDatabaseFailure(error, "Could not create a concept video");
        // Restore reputation points on failure
        await updateUserDataForCreateVideo2(ctx.drizzle, ctx);
        const message =
          error instanceof Error ? clientErrorMessage(error) : "Failed to create video";
        return errorResponse(message);
      }
    }),
  // Read-only query for polling video status - no DB updates or uploads
  checkVideoStatusRead: protectedProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      // Query the concept image
      const record = await findConceptImageForCheckVideoStatusRead(ctx.drizzle, input);
      // Guard
      if (!record) return errorResponse("Video not found");
      if (record.userId !== ctx.userId) return errorResponse("Not authorized");
      if (record.mediaType !== "video") return errorResponse("Not a video");
      // If already done, return the video URL
      if (record.done && record.video) {
        return {
          success: true,
          message: "Video ready",
          status: "succeeded" as const,
          videoUrl: record.video,
          readyToFinalize: false,
        };
      }
      // If status is "uploading", the video is being uploaded - just wait
      if (record.status === "uploading") {
        return {
          success: true,
          message: "Uploading video...",
          status: "uploading" as const,
          progress: 95,
          readyToFinalize: false,
        };
      }
      // If failed or canceled, return that status
      if (record.status === "failed" || record.status === "canceled") {
        return {
          success: false,
          message: `Video generation ${record.status}`,
          status: record.status,
          readyToFinalize: false,
        };
      }
      // If no replicateId, something went wrong
      if (!record.replicateId) {
        return errorResponse("No prediction ID found");
      }
      // Check status with Replicate (read-only)
      const prediction = await getVideoGenerationStatus(record.replicateId);
      // If succeeded, signal that finalize mutation should be called
      if (prediction.status === "succeeded" && prediction.output) {
        return {
          success: true,
          message: "Video ready for upload",
          status: "succeeded" as const,
          progress: 100,
          readyToFinalize: true,
          replicateId: record.replicateId,
        };
      }
      // If failed or canceled from Replicate
      if (prediction.status === "failed" || prediction.status === "canceled") {
        return {
          success: false,
          message: videoFailureMessage(prediction),
          status: prediction.status,
          readyToFinalize: true, // Call mutation to update DB status
          replicateId: record.replicateId,
        };
      }
      // Still processing
      let progress = 0;
      if (prediction.logs) {
        const progressMatch = prediction.logs.match(/(\d+)%/);
        if (progressMatch?.[1]) {
          progress = parseInt(progressMatch[1], 10);
        }
      }
      return {
        success: true,
        message: "Video is being generated...",
        status: prediction.status,
        progress,
        readyToFinalize: false,
      };
    }),
  // Mutation to finalize video upload - performs DB updates and upload
  finalizeVideoUpload: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse.extend({ videoUrl: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const record = await findConceptImageForCheckVideoStatusRead(ctx.drizzle, input);
      // Guard
      if (!record) return errorResponse("Video not found");
      if (record.userId !== ctx.userId) return errorResponse("Not authorized");
      if (record.mediaType !== "video") return errorResponse("Not a video");
      // If already done, return success
      if (record.done && record.video) {
        return {
          success: true,
          message: "Video already finalized",
          videoUrl: record.video,
        };
      }
      // If already uploading, prevent duplicate
      if (record.status === "uploading") {
        return { success: true, message: "Upload already in progress" };
      }
      // If no replicateId, something went wrong
      if (!record.replicateId) {
        return errorResponse("No prediction ID found");
      }
      // Check status with Replicate
      const prediction = await getVideoGenerationStatus(record.replicateId);
      // Handle failed/canceled
      if (prediction.status === "failed" || prediction.status === "canceled") {
        await updateConceptImageForFinalizeVideoUpload(
          ctx.drizzle,
          { status: prediction.status },
          input,
        );
        return errorResponse(videoFailureMessage(prediction));
      }
      // Handle succeeded - perform upload
      if (prediction.status === "succeeded" && prediction.output) {
        const outputUrl = Array.isArray(prediction.output)
          ? prediction.output[0]
          : prediction.output;
        if (typeof outputUrl === "string") {
          // Mark as uploading FIRST to prevent duplicate uploads
          const updateResult = await updateConceptImageForFinalizeVideoUpload2(
            ctx.drizzle,
            input,
          );
          // If no rows affected, another process is already handling this
          if (updateResult.rowsAffected === 0) {
            return { success: true, message: "Upload already in progress" };
          }
          // Upload to UploadThing
          const uploadedVideoUrl = await uploadCompletedVideo(outputUrl);
          if (uploadedVideoUrl) {
            await updateConceptImageForFinalizeVideoUpload3(
              ctx.drizzle,
              uploadedVideoUrl,
              input,
            );
            return {
              success: true,
              message: "Video uploaded",
              videoUrl: uploadedVideoUrl,
            };
          }
          // Upload failed - reset status so it can be retried
          await updateConceptImageForFinalizeVideoUpload4(ctx.drizzle, input);
          return errorResponse("Failed to upload video");
        }
        return errorResponse("Failed to process video output");
      }
      // Not ready yet
      return errorResponse("Video not ready for upload");
    }),
  getAll: publicProcedure
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .extend(conceptArtFilterSchema.shape),
    )
    .query(async ({ ctx, input }) => {
      const { skip, cursorAfter } = offsetPage(input);
      const userSearch = ctx.userId ?? "none";
      const secondsBack = getTimeFrameinSeconds(input.time_frame);
      const results = await listConceptImageForGetAll(
        ctx.drizzle,
        input,
        userSearch,
        secondsBack,
        skip,
      );
      const nextCursor = cursorAfter(results);
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const image = await fetchImage(ctx.drizzle, input.id, ctx.userId ?? "");
    return image || null;
  }),
});

/** Returns the error to send when a prompt is unsafe or cannot be classified. */
const rejectNsfwPrompt = async (prompt: string) => {
  try {
    const nsfwCheck = await classifyNsfwPrompt(prompt);
    return nsfwCheck.isNsfw
      ? errorResponse("Prompt rejected: contains inappropriate content")
      : null;
  } catch {
    return errorResponse("Unable to validate prompt. Please try again later.");
  }
};

/** Generates a concept image in the portrait format used for art and video thumbnails. */
const generateConceptThumbnail = (prompt: string) =>
  fastTxt2imgReplicate({
    prompt,
    aspect_ratio: "9:16",
    disable_safety_checker: false,
    output_quality: 95,
    mega_pixels: "1",
  });

/** Replicate's own failure text, when it sent one. */
const videoFailureMessage = (prediction: { error?: unknown }) =>
  typeof prediction.error === "string" ? prediction.error : "Video generation failed";

type RouterOutput = inferRouterOutputs<typeof conceptartRouter>;
export type ImageWithRelations = RouterOutput["get"];
