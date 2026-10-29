/**
 * Database access for avatar; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, gt, gte, isNotNull, lte, sql } from "drizzle-orm";
import { COST_GENERATE_AVATAR } from "@/drizzle/constants";
import { historicalAvatar, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Fetches the avatar with the specified ID from the database.
 *
 * @param client - The DrizzleClient instance used to query the database.
 * @param id - The ID of the avatar to fetch.
 * @returns A promise that resolves to the fetched avatar.
 */
export const fetchAvatar = async (client: DrizzleClient, id: number) => {
  return await client.query.historicalAvatar.findFirst({
    where: eq(historicalAvatar.id, id),
  });
};

/**
 * Set the active avatar and debit its shared cost in one balance-guarded statement.
 * The caller checks rowsAffected before reporting a successful purchase.
 */
export const updateUserDataForCreateAvatar = (
  client: Pick<DrizzleClient, "update">,
  userPatch: { avatar: string; avatarLight: null | string },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      ...userPatch,
      reputationPoints: sql`${userData.reputationPoints} - ${COST_GENERATE_AVATAR}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, COST_GENERATE_AVATAR),
      ),
    );

/** Build the `historicalAvatar` insert for `createAvatar`. */
export const insertHistoricalAvatarForCreateAvatar = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  userPatch: { avatar: string; avatarLight: null | string },
) =>
  client.insert(historicalAvatar).values({
    userId: ctx.userId,
    ...userPatch,
    status: "success",
    done: true,
  });

/** Build the `historicalAvatar` listing for `getHistoricalAvatars`, including predicates on `userId`, `done`, `avatar`. */
export const listHistoricalAvatarForGetHistoricalAvatars = (
  client: Pick<DrizzleClient, "query">,
  relationId: string,
  cursor: undefined | null | number,
  limit: number,
) =>
  client.query.historicalAvatar.findMany({
    where: and(
      eq(historicalAvatar.userId, relationId),
      eq(historicalAvatar.done, true),
      isNotNull(historicalAvatar.avatar),
      cursor != null ? lte(historicalAvatar.id, cursor) : undefined,
    ),
    limit: limit + 1,
    orderBy: [desc(historicalAvatar.id)],
  });

/** Build the `historicalAvatar` update for `updateAvatar`, setting `avatarLight`, using predicates on `id`. */
export const updateHistoricalAvatarForUpdateAvatar = (
  client: Pick<DrizzleClient, "update">,
  thumbnailUrl: null | string,
  input: { avatar: number },
) =>
  client
    .update(historicalAvatar)
    .set({ avatarLight: thumbnailUrl })
    .where(eq(historicalAvatar.id, input.avatar));

/** Build the avatar and light-avatar update for one user. */
export const updateUserAvatar = (
  client: Pick<DrizzleClient, "update">,
  data: Pick<import("@/drizzle/schema").UserData, "avatar" | "avatarLight">,
  userId: string,
) => client.update(userData).set(data).where(eq(userData.userId, userId));

/** Build the `historicalAvatar` deletion for `deleteAvatar`, using predicates on `id`. */
export const deleteHistoricalAvatarForDeleteAvatar = (
  client: Pick<DrizzleClient, "delete">,
  input: { avatar: number },
) => client.delete(historicalAvatar).where(eq(historicalAvatar.id, input.avatar));

/** Build the `historicalAvatar` lookup, using predicates on `avatar`. */
export const findHistoricalAvatarByImage = (
  client: Pick<DrizzleClient, "query">,
  input: { image: string },
) =>
  client.query.historicalAvatar.findFirst({
    where: eq(historicalAvatar.avatar, input.image),
  });

/** Build the `historicalAvatar` selection for `avatarMiddleware`, using predicates on `userId`, `avatar`, `createdAt`. */
export const selectHistoricalAvatarForAvatarMiddleware = (
  client: Pick<DrizzleClient, "select">,
  user: { userId: string },
) =>
  client
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(historicalAvatar)
    .where(
      and(
        eq(historicalAvatar.userId, user.userId),
        isNotNull(historicalAvatar.avatar),
        gt(historicalAvatar.createdAt, sql`NOW() - INTERVAL 1 DAY`),
      ),
    );

/** Build the `historicalAvatar` insert for `uploadHistoricalAvatar`. */
export const insertHistoricalAvatarForUploadHistoricalAvatar = (
  client: Pick<DrizzleClient, "insert">,
  fileUrl: string,
  thumbnailUrl: null | string,
  userId: string,
) =>
  client.insert(historicalAvatar).values({
    replicateId: null,
    avatar: fileUrl,
    avatarLight: thumbnailUrl,
    status: "succeeded",
    userId: userId,
    done: true,
  });

/** Build the `historicalAvatar` listing for `createImg`, using predicates on `status`, `done`, `createdAt`. */
export const listHistoricalAvatarForCreateImg = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.historicalAvatar.findMany({
    where: and(
      eq(historicalAvatar.status, "content-success"),
      eq(historicalAvatar.done, true),
      gte(historicalAvatar.createdAt, sql`NOW() - INTERVAL 1 DAY`),
    ),
  });

/** Build the `historicalAvatar` insert for `createImg`. */
export const insertHistoricalAvatarForCreateImg = (
  client: Pick<DrizzleClient, "insert">,
  resultUrls: string[],
  input: { relationId: string },
) =>
  client.insert(historicalAvatar).values(
    resultUrls.map((url) => ({
      avatar: url,
      userId: input.relationId,
      status: "content-success",
      done: true,
    })),
  );
