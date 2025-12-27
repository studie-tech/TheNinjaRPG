import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { baseServerResponse, errorResponse } from "../trpc";
import { sql, eq, and, isNotNull, gte } from "drizzle-orm";
import { userData, conceptImage, userLikes } from "@/drizzle/schema";
import { fetchUser } from "@/routers/profile";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  conceptArtFilterSchema,
  conceptArtPromptSchema,
  conceptVideoPromptSchema,
} from "@/validators/art";
import { getTimeFrameinSeconds } from "@/validators/art";
import {
  SmileyEmotions,
  COST_CONCEPT_IMAGE,
  COST_CONCEPT_VIDEO,
} from "@/drizzle/constants";
import type { inferRouterOutputs } from "@trpc/server";
import type { DrizzleClient } from "../../db";
import {
  fastTxt2imgReplicate,
  startVideoGeneration,
  getVideoGenerationStatus,
  uploadCompletedVideo,
} from "@/libs/replicate";

export const CONCEPT_PROMPT = `, trending on ArtStation, trending on CGSociety, Intricate, High Detail, Sharp focus, dramatic`;

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
      const hasLike = result?.likes.find((like) => like.type === input.type);
      await ctx.drizzle
        .update(conceptImage)
        .set({
          ...(input.type === "like"
            ? { n_likes: result.n_likes + (hasLike ? -1 : 1) }
            : {}),
          ...(input.type === "love"
            ? { n_loves: result.n_loves + (hasLike ? -1 : 1) }
            : {}),
          ...(input.type === "laugh"
            ? { n_laugh: result.n_laugh + (hasLike ? -1 : 1) }
            : {}),
        })
        .where(eq(conceptImage.id, input.imageId));
      if (hasLike) {
        await ctx.drizzle
          .delete(userLikes)
          .where(
            and(
              eq(userLikes.userId, ctx.userId),
              eq(userLikes.imageId, input.imageId),
              eq(userLikes.type, input.type),
            ),
          );
      } else {
        await ctx.drizzle.insert(userLikes).values({
          userId: ctx.userId,
          imageId: input.imageId,
          type: input.type,
        });
      }
      return { success: true, message: "Emotion toggled" };
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const result = await fetchImage(ctx.drizzle, input.id, ctx.userId);
      // Guard
      if (!result) return errorResponse("Image not found");
      if (result.userId !== ctx.userId) return errorResponse("Not authorized");
      // Mutate
      await ctx.drizzle.delete(conceptImage).where(eq(conceptImage.id, input.id));
      return { success: true, message: "Image deleted" };
    }),
  create: protectedProcedure
    .input(conceptArtPromptSchema)
    .output(baseServerResponse.extend({ imageId: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_CONCEPT_IMAGE) {
        return errorResponse("Not enough reputation points");
      }
      // Generate
      const prompt = `${input.prompt}, ${CONCEPT_PROMPT}`;
      const avatar = await fastTxt2imgReplicate({
        prompt,
        aspect_ratio: "9:16",
        disable_safety_checker: false,
        output_quality: 95,
        mega_pixels: "1",
      });
      const imageUrl = avatar.data?.ufsUrl;
      if (!imageUrl) return errorResponse("Failed to create image");
      // Mutate
      const imageId = nanoid();
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints}- ${COST_CONCEPT_IMAGE}`,
          })
          .where(eq(userData.userId, ctx.userId)),
        ctx.drizzle.insert(conceptImage).values({
          id: imageId,
          userId: ctx.userId,
          prompt: input.prompt,
          seed: input.seed,
          status: "success",
          image: imageUrl,
          mediaType: "image",
          done: true,
        }),
      ]);
      return { success: true, message: "Image created", imageId };
    }),
  createVideo: protectedProcedure
    .input(conceptVideoPromptSchema)
    .output(baseServerResponse.extend({ videoId: z.string().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.reputationPoints < COST_CONCEPT_VIDEO) {
        return errorResponse(
          `Not enough reputation points. Video generation costs ${COST_CONCEPT_VIDEO} reputation points.`,
        );
      }
      // Deduct reputation points immediately to prevent spam
      // Use WHERE clause to ensure user still has enough points (prevents race condition)
      const deductResult = await ctx.drizzle
        .update(userData)
        .set({
          reputationPoints: sql`${userData.reputationPoints} - ${COST_CONCEPT_VIDEO}`,
        })
        .where(
          and(
            eq(userData.userId, ctx.userId),
            gte(userData.reputationPoints, COST_CONCEPT_VIDEO),
          ),
        );
      // Check if deduction actually happened (rowsAffected > 0)
      if (deductResult.rowsAffected === 0) {
        return errorResponse(
          `Not enough reputation points. Video generation costs ${COST_CONCEPT_VIDEO} reputation points.`,
        );
      }
      try {
        // If user provided a start_image, use it as thumbnail; otherwise generate one
        let thumbnailUrl: string | undefined;
        if (input.start_image) {
          thumbnailUrl = input.start_image;
        } else {
          const thumbnailPrompt = `${input.prompt}, ${CONCEPT_PROMPT}`;
          const thumbnailResult = await fastTxt2imgReplicate({
            prompt: thumbnailPrompt,
            aspect_ratio: "9:16",
            disable_safety_checker: false,
            output_quality: 95,
            mega_pixels: "1",
          });
          thumbnailUrl = thumbnailResult.data?.ufsUrl;
        }
        // Start the video generation job (returns immediately)
        const videoPrompt = `${input.prompt}, ${CONCEPT_PROMPT}`;
        const prediction = await startVideoGeneration({
          prompt: videoPrompt,
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
        await ctx.drizzle.insert(conceptImage).values({
          id: videoId,
          userId: ctx.userId,
          prompt: input.prompt,
          negative_prompt: input.negative_prompt,
          seed: input.seed,
          status: "processing",
          image: thumbnailUrl, // Thumbnail for listing page
          replicateId: prediction.id,
          mediaType: "video",
          done: false,
        });
        return { success: true, message: "Video generation started", videoId };
      } catch (error) {
        // Restore reputation points on failure
        await ctx.drizzle
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints} + ${COST_CONCEPT_VIDEO}`,
          })
          .where(eq(userData.userId, ctx.userId));
        const message =
          error instanceof Error ? error.message : "Failed to create video";
        return errorResponse(message);
      }
    }),
  checkVideoStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query the concept image
      const record = await ctx.drizzle.query.conceptImage.findFirst({
        where: eq(conceptImage.id, input.id),
      });
      // Guard
      if (!record) return errorResponse("Video not found");
      if (record.userId !== ctx.userId) return errorResponse("Not authorized");
      if (record.mediaType !== "video") return errorResponse("Not a video");
      // If already done, return the video URL
      if (record.done && record.video) {
        return {
          success: true,
          message: "Video ready",
          status: "succeeded",
          videoUrl: record.video,
        };
      }
      // If status is "uploading", the video is being uploaded - just wait
      if (record.status === "uploading") {
        return {
          success: true,
          message: "Uploading video...",
          status: "uploading",
          progress: 95,
        };
      }
      // If no replicateId, something went wrong
      if (!record.replicateId) {
        return errorResponse("No prediction ID found");
      }
      // Check status with Replicate
      const prediction = await getVideoGenerationStatus(record.replicateId);
      // Handle different statuses
      if (prediction.status === "succeeded" && prediction.output) {
        // Get the output URL (could be string or array)
        const outputUrl = Array.isArray(prediction.output)
          ? prediction.output[0]
          : prediction.output;
        if (typeof outputUrl === "string") {
          // Mark as uploading FIRST to prevent duplicate uploads
          await ctx.drizzle
            .update(conceptImage)
            .set({ status: "uploading" })
            .where(
              and(eq(conceptImage.id, input.id), eq(conceptImage.status, "processing")),
            );
          // Upload to UploadThing (this can be slow)
          const uploadedVideoUrl = await uploadCompletedVideo(outputUrl);
          if (uploadedVideoUrl) {
            // Update database with video URL
            await ctx.drizzle
              .update(conceptImage)
              .set({ video: uploadedVideoUrl, status: "success", done: true })
              .where(eq(conceptImage.id, input.id));
            return {
              success: true,
              message: "Video ready",
              status: "succeeded",
              videoUrl: uploadedVideoUrl,
            };
          }
        }
        return errorResponse("Failed to process video output");
      } else if (prediction.status === "failed" || prediction.status === "canceled") {
        await ctx.drizzle
          .update(conceptImage)
          .set({ status: prediction.status, done: true })
          .where(eq(conceptImage.id, input.id));
        const errorMessage =
          typeof prediction.error === "string"
            ? prediction.error
            : "Video generation failed";
        return {
          success: false,
          message: errorMessage,
          status: prediction.status,
        };
      }
      // Still processing
      // Calculate progress from logs if available
      let progress = 0;
      if (prediction.logs) {
        // Try to parse progress from logs (varies by model)
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
      };
    }),
  getAll: publicProcedure
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .merge(conceptArtFilterSchema),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const userSearch = ctx?.userId ?? "none";
      const secondsBack = getTimeFrameinSeconds(input.time_frame);
      const results = await ctx.drizzle.query.conceptImage.findMany({
        extras: {
          sumReaction:
            sql<number>`${conceptImage.n_likes} + ${conceptImage.n_loves} + ${conceptImage.n_laugh}`.as(
              "total_reaction",
            ),
        },
        where: and(
          ...[
            input.only_own
              ? eq(conceptImage.userId, userSearch)
              : isNotNull(conceptImage.userId),
            secondsBack
              ? sql`createdAt > DATE_SUB(NOW(), INTERVAL ${secondsBack} SECOND)`
              : undefined,
          ],
        ),
        offset: skip,
        limit: input.limit,
        with: {
          user: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              level: true,
              rank: true,
              isOutlaw: true,
              role: true,
              federalStatus: true,
            },
          },
          likes: {
            where: (userLikes) => eq(userLikes.userId, userSearch),
          },
        },
        orderBy: (image, { desc }) => [
          ...(input.sort === "Most Liked" ? [desc(sql`total_reaction`)] : []),
          ...(input.sort === "Most Recent" ? [desc(sql`createdAt`)] : []),
        ],
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const image = await fetchImage(ctx.drizzle, input.id, ctx.userId ?? "");
      return image || null;
    }),
});

export const fetchImage = async (
  client: DrizzleClient,
  imageId: string,
  userId: string,
) => {
  const result = await client.query.conceptImage.findFirst({
    where: eq(conceptImage.id, imageId),
    with: {
      user: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          role: true,
          federalStatus: true,
        },
      },
      likes: {
        where: (userLikes) => eq(userLikes.userId, userId),
      },
    },
  });
  return result;
};

type RouterOutput = inferRouterOutputs<typeof conceptartRouter>;
export type ImageWithRelations = RouterOutput["get"];
