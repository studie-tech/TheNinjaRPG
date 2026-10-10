import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ContentTypes } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { historicalAvatar, userData } from "@/drizzle/schema";
import {
  createThumbnail,
  fastTxt2imgReplicate,
  getAvatarPrompt,
} from "@/libs/replicate";
import { fetchUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";
import { userDeltaResponseSchema } from "@/validators/userCache";

export const avatarRouter = createTRPCRouter({
  createAvatar: protectedProcedure
    .meta({ mcp: { description: "Generate a new AI avatar" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Fetch user directly with a query that returns null if not found
      // This handles the case where the user was just created and the record
      // may not be immediately available due to database replication lag
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
      });
      // Guard
      if (!user) {
        return errorResponse("User not found. Please try again in a moment.");
      }
      if (user.reputationPoints < 1) {
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
        ctx.drizzle
          .update(userData)
          .set({
            ...userPatch,
            reputationPoints: sql`${userData.reputationPoints} - 1`,
          })
          .where(
            and(eq(userData.userId, ctx.userId), gt(userData.reputationPoints, 0)),
          ),
        ctx.drizzle.insert(historicalAvatar).values({
          userId: ctx.userId,
          ...userPatch,
          status: "success",
          done: true,
        }),
      ]);
      if (result.rowsAffected === 1) {
        return {
          success: true,
          message: "Avatar created",
          userPatch,
          userDelta: { reputationPoints: -1 },
        };
      } else {
        return errorResponse("Failed to upload avatar");
      }
    }),
  getHistoricalAvatars: protectedProcedure
    .meta({ mcp: { description: "Get user's historical avatars" } })
    .input(
      z.object({
        relationId: z.string().nullish(),
        limit: z.number().min(1).max(100).nullish(),
        cursor: z.number().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const relationId = input.relationId ?? ctx.userId;
      const limit = input.limit ?? 50;
      const { cursor } = input;
      const avatars = await ctx.drizzle.query.historicalAvatar.findMany({
        where: and(
          eq(historicalAvatar.userId, relationId),
          eq(historicalAvatar.done, true),
          isNotNull(historicalAvatar.avatar),
        ),
        offset: cursor ? cursor : 0,
        limit: limit + 1,
        orderBy: [desc(historicalAvatar.id)],
      });
      let nextCursor: typeof cursor | undefined;
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
        await ctx.drizzle
          .update(historicalAvatar)
          .set({ avatarLight: thumbnailUrl })
          .where(eq(historicalAvatar.id, input.avatar));
      }
      const data =
        input.type === "user"
          ? { avatar: avatar.avatar, avatarLight: thumbnailUrl }
          : undefined;
      if (
        data &&
        (user.avatar !== data.avatar || user.avatarLight !== data.avatarLight)
      ) {
        const result = await ctx.drizzle
          .update(userData)
          .set(data)
          .where(eq(userData.userId, ctx.userId));
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
      await ctx.drizzle
        .delete(historicalAvatar)
        .where(eq(historicalAvatar.id, input.avatar));
      return { success: true, message: "Avatar deleted" };
    }),
});

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
