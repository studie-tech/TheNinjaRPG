import { z } from "zod";
import { COST_GENERATE_AVATAR, ContentTypes } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  createThumbnail,
  fastTxt2imgReplicate,
  getAvatarPrompt,
} from "@/libs/replicate";
import {
  deleteHistoricalAvatarForDeleteAvatar,
  fetchAvatar,
  insertHistoricalAvatarForCreateAvatar,
  listHistoricalAvatarForGetHistoricalAvatars,
  updateHistoricalAvatarForUpdateAvatar,
  updateUserAvatar,
  updateUserDataForCreateAvatar,
} from "@/queries/avatar";
import { fetchUser, findUserById } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";
import { mediaHistoryQuerySchema } from "@/validators/mediaHistory";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const avatarRouter = createTRPCRouter({
  createAvatar: protectedProcedure
    .meta({ mcp: { description: "Generate a new AI avatar" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Fetch user directly with a query that returns null if not found
      // This handles the case where the user was just created and the record
      // may not be immediately available due to database replication lag
      const user = await findUserById(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) {
        return errorResponse("User not found. Please try again in a moment.");
      }
      // The conditional debit remains authoritative if another request spends points.
      if (user.reputationPoints < COST_GENERATE_AVATAR) {
        return errorResponse("Not enough reputation points");
      }
      if (user.isBanned) return errorResponse("You are banned");
      // Create avatar
      const { avatarUrl, thumbnailUrl } = await createUserAvatar(
        ctx.drizzle,
        user,
        true,
      );
      if (!avatarUrl) return errorResponse("Failed to create avatar");
      const userPatch = { avatar: avatarUrl, avatarLight: thumbnailUrl || null };

      // Mutate
      const [result] = await Promise.all([
        updateUserDataForCreateAvatar(ctx.drizzle, userPatch, ctx),
        insertHistoricalAvatarForCreateAvatar(ctx.drizzle, ctx, userPatch),
      ]);
      if (result.rowsAffected === 1) {
        return {
          success: true,
          message: "Avatar created",
          userPatch,
          userDelta: { reputationPoints: -COST_GENERATE_AVATAR },
        };
      } else {
        return errorResponse("Failed to upload avatar");
      }
    }),
  getHistoricalAvatars: protectedProcedure
    .meta({ mcp: { description: "Get user's historical avatars" } })
    .input(mediaHistoryQuerySchema)
    .query(async ({ ctx, input }) => {
      const relationId = input.relationId ?? ctx.userId;
      const limit = input.limit ?? 50;
      const { cursor } = input;
      const avatars = await listHistoricalAvatarForGetHistoricalAvatars(
        ctx.drizzle,
        relationId,
        cursor,
        limit,
      );
      let nextCursor: number | undefined;
      if (avatars.length > limit) {
        const nextItem = avatars.pop();
        nextCursor = nextItem?.id;
      }
      return {
        data: avatars,
        nextCursor,
      };
    }),
  updateAvatar: protectedProcedure
    .meta({ mcp: { description: "Set active avatar from history" } })
    .input(z.object({ avatar: z.number(), type: z.enum(ContentTypes) }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, avatar] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchAvatar(ctx.drizzle, input.avatar),
      ]);
      // Guard
      if (!avatar) return errorResponse("Avatar not found");
      if (
        (avatar.userId !== ctx.userId && avatar.status !== "content-success") ||
        (!canChangeContent(user.role) && avatar.status === "content-success")
      ) {
        return errorResponse("Not yours");
      }
      if (user.isBanned) return errorResponse("You are banned");
      // If no thumbnail, we need to generate one and save it for future usage
      let thumbnailUrl = avatar.avatarLight;
      if (!thumbnailUrl && avatar.avatar) {
        thumbnailUrl = await createThumbnail(avatar.avatar);
        await updateHistoricalAvatarForUpdateAvatar(ctx.drizzle, thumbnailUrl, input);
      }
      const data =
        input.type === "user"
          ? { avatar: avatar.avatar, avatarLight: thumbnailUrl }
          : undefined;
      if (
        data &&
        (user.avatar !== data.avatar || user.avatarLight !== data.avatarLight)
      ) {
        const result = await updateUserAvatar(ctx.drizzle, data, ctx.userId);
        if (result.rowsAffected === 0) {
          return errorResponse("Could not update avatar. Please try again");
        }
      }
      return {
        success: true,
        message: "Avatar updated",
        url: avatar.avatar,
        userPatch: data,
      };
    }),
  deleteAvatar: protectedProcedure
    .meta({ mcp: { description: "Delete an avatar from history" } })
    .input(z.object({ avatar: z.number() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [avatar, user] = await Promise.all([
        fetchAvatar(ctx.drizzle, input.avatar),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!avatar) {
        return errorResponse("Avatar not found");
      }
      if (
        (avatar.userId !== ctx.userId && avatar.status !== "content-success") ||
        (!canChangeContent(user.role) && avatar.status === "content-success")
      ) {
        return errorResponse("Not your avatar");
      }
      // Mutation
      await deleteHistoricalAvatarForDeleteAvatar(ctx.drizzle, input);
      return { success: true, message: "Avatar deleted" };
    }),
});

/**
 * Create a user avatar
 * @param client - The DrizzleClient instance used to query the database.
 * @param user - The user to create the avatar for.
 * @returns The avatar URL and thumbnail URL.
 */
export const createUserAvatar = async (
  client: DrizzleClient,
  user: UserData,
  disable_safety_checker = false,
) => {
  // Create avatar
  const prompt = await getAvatarPrompt(client, user);
  const avatar = await fastTxt2imgReplicate({
    prompt,
    disable_safety_checker,
    aspect_ratio: "1:1",
  });
  const avatarUrl = avatar.data?.ufsUrl;
  // Create thumbnail
  const thumbnailUrl = await createThumbnail(avatarUrl);
  return { avatarUrl, thumbnailUrl };
};
