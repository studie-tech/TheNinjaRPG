/**
 * Database access for conceptart; authorization and transaction scopes stay in callers.
 */

import { eq } from "drizzle-orm";
import { conceptImage } from "@/drizzle/schema";
import { indexableConceptArt } from "@/libs/conceptart";
import { userCardColumns } from "@/queries/userColumns";
import type { DrizzleClient } from "@/server/db";

/** Load an image with its author and viewer-specific reactions; a missing image yields undefined. */
export const fetchImage = async (
  client: DrizzleClient,
  imageId: string,
  userId: string,
) => {
  const result = await client.query.conceptImage.findFirst({
    where: eq(conceptImage.id, imageId),
    with: {
      user: {
        columns: userCardColumns,
      },
      likes: {
        where: (userLikes) => eq(userLikes.userId, userId),
      },
    },
  });
  return result;
};

import { and, gt, gte, sql } from "drizzle-orm";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import { userData, userLikes } from "@/drizzle/schema";

/** Build the `conceptImage` reaction counter change for `toggleEmotion`, using predicates on `id`. */
export const updateConceptImageForToggleEmotion = (
  client: Pick<DrizzleClient, "update">,
  input: { type: "like" | "love" | "laugh"; imageId: string },
  delta: number,
) => {
  return client
    .update(conceptImage)
    .set({
      ...(input.type === "like"
        ? { n_likes: sql`${conceptImage.n_likes} + ${delta}` }
        : {}),
      ...(input.type === "love"
        ? { n_loves: sql`${conceptImage.n_loves} + ${delta}` }
        : {}),
      ...(input.type === "laugh"
        ? { n_laugh: sql`${conceptImage.n_laugh} + ${delta}` }
        : {}),
    })
    .where(eq(conceptImage.id, input.imageId));
};

/** Build the `userLikes` deletion for `toggleEmotion`, using predicates on `userId`, `imageId`, `type`. */
export const deleteUserLikesForToggleEmotion = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  input: { imageId: string; type: "like" | "love" | "laugh" },
) =>
  client
    .delete(userLikes)
    .where(
      and(
        eq(userLikes.userId, ctx.userId),
        eq(userLikes.imageId, input.imageId),
        eq(userLikes.type, input.type),
      ),
    );

/** Build the `userLikes` insert for `toggleEmotion`. */
export const insertUserLikesForToggleEmotion = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { imageId: string; type: "like" | "love" | "laugh" },
) =>
  client.insert(userLikes).values({
    userId: ctx.userId,
    imageId: input.imageId,
    type: input.type,
  });

/** Build the `conceptImage` deletion for `delete`, using predicates on `id`. */
export const deleteConceptImageForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(conceptImage).where(eq(conceptImage.id, input.id));

/**
 * Build the `userData` update for `create`, setting `reputationPoints`, using
 * predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForCreate = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} - ${COST_CONCEPT_IMAGE}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, COST_CONCEPT_IMAGE),
      ),
    );

/** Build the `conceptImage` insert for `create`. */
export const insertConceptImageForCreate = (
  client: Pick<DrizzleClient, "insert">,
  imageId: string,
  ctx: { userId: string },
  input: { prompt: string; seed: number },
  imageUrl: string,
) =>
  client.insert(conceptImage).values({
    id: imageId,
    userId: ctx.userId,
    prompt: input.prompt,
    seed: input.seed,
    status: "success",
    image: imageUrl,
    mediaType: "image",
    done: true,
  });

/**
 * Build the `userData` update for `createVideo`, setting `reputationPoints`, using
 * predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForCreateVideo = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
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

/** Build the `conceptImage` insert for `createVideo`. */
export const insertConceptImageForCreateVideo = (
  client: Pick<DrizzleClient, "insert">,
  videoId: string,
  ctx: { userId: string },
  input: { prompt: string; negative_prompt: undefined | string; seed: number },
  thumbnailUrl: undefined | string,
  prediction: { id: string },
) =>
  client.insert(conceptImage).values({
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

/** Build the `userData` update for `createVideo`, setting `reputationPoints`, using predicates on `userId`. */
export const updateUserDataForCreateVideo2 = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} + ${COST_CONCEPT_VIDEO}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `conceptImage` lookup for `checkVideoStatusRead`, using predicates on `id`. */
export const findConceptImageForCheckVideoStatusRead = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.conceptImage.findFirst({
    where: eq(conceptImage.id, input.id),
  });

/** Build the `conceptImage` update for `finalizeVideoUpload`, setting `status` and `done`, using predicates on `id`. */
export const updateConceptImageForFinalizeVideoUpload = (
  client: Pick<DrizzleClient, "update">,
  prediction: { status: "failed" | "canceled" },
  input: { id: string },
) =>
  client
    .update(conceptImage)
    .set({ status: prediction.status, done: true })
    .where(eq(conceptImage.id, input.id));

/** Build the `conceptImage` update for `finalizeVideoUpload`, setting `status`, using predicates on `id` and `status`. */
export const updateConceptImageForFinalizeVideoUpload2 = (
  client: Pick<DrizzleClient, "update">,
  input: { id: string },
) =>
  client
    .update(conceptImage)
    .set({ status: "uploading" })
    .where(and(eq(conceptImage.id, input.id), eq(conceptImage.status, "processing")));

/** Build the `conceptImage` update for `finalizeVideoUpload`, using predicates on `id`. */
export const updateConceptImageForFinalizeVideoUpload3 = (
  client: Pick<DrizzleClient, "update">,
  uploadedVideoUrl: string,
  input: { id: string },
) =>
  client
    .update(conceptImage)
    .set({ video: uploadedVideoUrl, status: "success", done: true })
    .where(eq(conceptImage.id, input.id));

/** Build the `conceptImage` update for `finalizeVideoUpload`, setting `status`, using predicates on `id`. */
export const updateConceptImageForFinalizeVideoUpload4 = (
  client: Pick<DrizzleClient, "update">,
  input: { id: string },
) =>
  client
    .update(conceptImage)
    .set({ status: "processing" })
    .where(eq(conceptImage.id, input.id));

/** Build the `conceptImage` listing for `getAll`, using predicates on `userId`. */
export const listConceptImageForGetAll = (
  client: Pick<DrizzleClient, "query">,
  input: {
    only_own: false | true;
    limit: number;
    sort: import("@/validators/art").SortOption;
  },
  userSearch: string,
  secondsBack: null | number,
  skip: number,
) =>
  client.query.conceptImage.findMany({
    extras: {
      sumReaction:
        sql<number>`${conceptImage.n_likes} + ${conceptImage.n_loves} + ${conceptImage.n_laugh}`.as(
          "total_reaction",
        ),
    },
    where: and(
      ...[
        input.only_own ? eq(conceptImage.userId, userSearch) : undefined,
        secondsBack
          ? gt(
              conceptImage.createdAt,
              sql`DATE_SUB(NOW(), INTERVAL ${secondsBack} SECOND)`,
            )
          : undefined,
      ],
    ),
    offset: skip,
    limit: input.limit,
    with: {
      user: {
        columns: userCardColumns,
      },
      likes: {
        where: (userLikes) => eq(userLikes.userId, userSearch),
      },
    },
    orderBy: (image, { desc }) => [
      ...(input.sort === "Most Liked" ? [desc(sql`total_reaction`)] : []),
      ...(input.sort === "Most Recent" ? [desc(image.createdAt)] : []),
    ],
  });

/** Build the completed, visible concept-image lookup for social previews, retaining the empty-ID fallback. */
export const findIndexableConceptImage = (
  client: Pick<DrizzleClient, "query">,
  imageid: string,
) =>
  client.query.conceptImage.findFirst({
    where: and(eq(conceptImage.id, imageid || ""), indexableConceptArt),
  });

/**
 * Build the indexable concept-image prompt and author-name lookup shared by metadata
 * and the server-rendered preview.
 */
export const findIndexableConceptImageMetadata = (
  client: Pick<DrizzleClient, "query">,
  id: string,
) =>
  client.query.conceptImage.findFirst({
    columns: { prompt: true },
    with: { user: { columns: { username: true } } },
    where: and(eq(conceptImage.id, id), indexableConceptArt),
  });
