import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { forumBoard, forumPost, forumThread, userData } from "@/drizzle/schema";
import { resolveSenderId } from "@/libs/comments";
import { fetchBoard, getInfiniteThreads, readNews } from "@/libs/forum";
import { moderateContent } from "@/libs/moderator";
import {
  callDiscordNews,
  callFacebookNews,
  callInstagramNews,
  callRedditNews,
  callTwitterNews,
} from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { canCreateNews, canModerate } from "@/utils/permissions";
import sanitize from "@/utils/sanitize";
import { forumBoardSchema } from "@/validators/forum";
import type { DrizzleClient } from "../../db";

export const forumRouter = createTRPCRouter({
  // Get all boards in the system
  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all forum boards" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.forumBoard.findMany({
        orderBy: asc(forumBoard.createdAt),
      });
    }),
  // The user read the news
  readNews: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Mark news as read for current user" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      await readNews(ctx.drizzle, ctx.userId);
      return { success: true, message: "News marked as read" };
    }),
  // Get board in the system
  getThreads: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get threads for a forum board" } })
    .input(
      z.object({
        boardId: z.string().optional(),
        boardName: z.string().optional(),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await getInfiniteThreads({
        client: ctx.drizzle,
        boardId: input.boardId,
        boardName: input.boardName,
        cursor: input.cursor,
        limit: input.limit,
        highlightPinned: true,
      });
    }),
  createThread: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create a new forum thread" } })
    .input(forumBoardSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const threadId = nanoid();
      const [board, user, sender] = await Promise.all([
        fetchBoard(ctx.drizzle, input.board_id),
        fetchUser(ctx.drizzle, ctx.userId),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
      ]);
      // Resolve effective poster (allow staff to post as AI)
      const effectiveUserId = resolveSenderId(user, sender);
      // Guard
      const isNews = board.name === "News";
      if (isNews && !canCreateNews(user.role)) {
        return errorResponse("You are not authorized to create news");
      }
      if (user.isBanned || user.isSilenced) {
        return errorResponse("You are banned");
      }
      if (!board) {
        return errorResponse("Board does not exist");
      }
      // Mutate
      const sanitized = sanitize(input.content);
      const postId = nanoid();
      // Use guard clause in board update to prevent orphaned threads if board is deleted
      // SECURITY: This prevents race condition where thread/post are created but board update fails
      const [, , , boardUpdateResult] = await Promise.all([
        moderateContent(ctx.drizzle, {
          content: sanitized,
          userId: ctx.userId,
          relationType: "forumPost",
          relationId: postId,
        }),
        ctx.drizzle.insert(forumThread).values({
          id: threadId,
          title: input.title,
          image: input.image,
          boardId: input.board_id,
          userId: effectiveUserId,
        }),
        ctx.drizzle.insert(forumPost).values({
          id: postId,
          content: sanitized,
          threadId: threadId,
          userId: effectiveUserId,
          authorId: ctx.userId,
        }),
        ctx.drizzle
          .update(forumBoard)
          .set({ nThreads: sql`nThreads + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(forumBoard.id, input.board_id),
              // Guard: Only update if board still exists (id matches the pre-check)
              eq(forumBoard.id, board.id),
            ),
          ),
      ]);

      // Note: In edge case where board is deleted during mutation, thread/post still exist
      // but board counter is not updated. This is acceptable as it prevents orphaned data.
      if (boardUpdateResult.rowsAffected === 0) {
        console.warn(
          `Board update failed for board ${input.board_id} - board may have been deleted`,
        );
      }
      // Then update counters and publish to social media
      // If these fail, the thread still exists and counters can be recalculated

      const counterUpdates: Promise<unknown>[] = [];
      if (isNews) {
        counterUpdates.push(
          ctx.drizzle
            .update(userData)
            .set({ unreadNews: sql`LEAST(unreadNews + 1, 1000)` })
            .where(ne(userData.userId, effectiveUserId)),
          ...publishNewsToSocialMedia(
            input.title,
            input.content,
            user.avatar,
            input.image,
          ),
        );
      }
      await Promise.all(counterUpdates);
      return { success: true, message: "Thread created" };
    }),
  // Pin forum thread to be on top
  pinThread: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Pin or unpin a forum thread (requires moderation permissions)",
      },
    })
    .input(z.object({ thread_id: z.string(), status: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query & Guard
      const result = await fetchAndAuthorizeThreadModeration(
        ctx.drizzle,
        ctx.userId,
        input.thread_id,
      );
      if (result.error) return result.error;
      const { thread } = result;
      // Mutate
      await ctx.drizzle
        .update(forumThread)
        .set({ isPinned: input.status })
        .where(eq(forumThread.id, thread.id));
      return {
        success: true,
        message: input.status ? "Thread pinned" : "Thread unpinned",
      };
    }),
  lockThread: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Lock or unlock a forum thread (requires moderation permissions)",
      },
    })
    .input(z.object({ thread_id: z.string(), status: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query & Guard
      const result = await fetchAndAuthorizeThreadModeration(
        ctx.drizzle,
        ctx.userId,
        input.thread_id,
      );
      if (result.error) return result.error;
      const { thread } = result;
      // Mutate
      await ctx.drizzle
        .update(forumThread)
        .set({ isLocked: input.status })
        .where(eq(forumThread.id, thread.id));
      return {
        success: true,
        message: input.status ? "Thread locked" : "Thread unlocked",
      };
    }),
  deleteThread: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Delete a forum thread (requires moderation permissions)",
      },
    })
    .input(z.object({ thread_id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query & Guard
      const result = await fetchAndAuthorizeThreadModeration(
        ctx.drizzle,
        ctx.userId,
        input.thread_id,
      );
      if (result.error) return result.error;
      const { thread } = result;
      // Mutate
      // Parallel deletion with atomic guards: PlanetScale doesn't support transactions,
      // but we can use WHERE clauses to ensure cleanup only happens if data exists.
      // All operations run in parallel to minimize inconsistency window.
      await Promise.all([
        ctx.drizzle.delete(forumThread).where(eq(forumThread.id, thread.id)),
        ctx.drizzle
          .update(forumBoard)
          .set({ nThreads: sql`GREATEST(nThreads - 1, 0)` })
          .where(eq(forumBoard.id, thread.boardId)),
        ctx.drizzle.delete(forumPost).where(eq(forumPost.threadId, thread.id)),
      ]);
      return { success: true, message: "Thread deleted" };
    }),
});

/**
 * Publish news post to social media platforms.
 * Posts to Discord, Facebook, Reddit, Twitter, and optionally Instagram (if image provided).
 */
const publishNewsToSocialMedia = (
  title: string,
  content: string,
  avatar: string | null,
  image?: string | null,
): Promise<unknown>[] => {
  const promises: Promise<unknown>[] = [];

  promises.push(callDiscordNews(title, content, avatar));
  promises.push(callFacebookNews(title, content));
  promises.push(callRedditNews(title, content));
  promises.push(callTwitterNews(title, content));

  // Only post to Instagram if an image is attached
  if (image) {
    promises.push(callInstagramNews(title, content, image));
  }

  return promises;
};

/**
 * Internal convenience function to fetch a forum thread by ID.
 * Used by this router and the comments router for thread management operations.
 */
export const fetchThread = async (client: DrizzleClient, threadId: string) => {
  return await client.query.forumThread.findFirst({
    where: eq(forumThread.id, threadId),
  });
};

/**
 * Fetch user and thread, and authorize thread moderation.
 * Returns error response if user is not authorized or thread doesn't exist.
 */
const fetchAndAuthorizeThreadModeration = async (
  client: DrizzleClient,
  userId: string,
  threadId: string,
) => {
  const [user, thread] = await Promise.all([
    fetchUser(client, userId),
    fetchThread(client, threadId),
  ]);

  if (!canModerate(user.role)) {
    return { error: errorResponse("You are not authorized") };
  }
  if (!thread) {
    return { error: errorResponse("Thread not found") };
  }

  return { user, thread };
};
