import { asc, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { forumBoard, forumPost, forumThread, userData } from "@/drizzle/schema";
import { resolveSenderId } from "@/libs/comments";
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
    .mutation(async ({ ctx }) => {
      await readNews(ctx.drizzle, ctx.userId);
      return true;
    }),
  // Get board in the system
  getThreads: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get threads for a forum board" } })
    .input(
      z.object({
        board_id: z.string().optional(),
        board_name: z.string().optional(),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await getInfiniteThreads({
        client: ctx.drizzle,
        boardId: input.board_id,
        boardName: input.board_name,
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
      if (isNews) {
        const socialPosts = [
          callDiscordNews(user.username, input.title, input.content, user.avatar),
          callFacebookNews(input.title, input.content),
          callRedditNews(input.title, input.content),
          callTwitterNews(input.title, input.content),
        ];
        // Only post to Instagram if an image is attached
        if (input.image) {
          socialPosts.push(callInstagramNews(input.title, input.content, input.image));
        }
        await Promise.all(socialPosts);
      }
      // Mutate
      const sanitized = sanitize(input.content);
      const postId = nanoid();
      await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
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
          .where(eq(forumBoard.id, input.board_id)),
        ...(isNews
          ? [
              ctx.drizzle
                .update(userData)
                .set({ unreadNews: sql`LEAST(unreadNews + 1, 1000)` }),
            ]
          : []),
      ]);
      return { success: true, message: "Thread created" };
    }),
  // Pin forum thread to be on top
  pinThread: protectedProcedure
    .input(z.object({ thread_id: z.string(), status: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, thread] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchThread(ctx.drizzle, input.thread_id),
      ]);
      // Guard
      if (!canModerate(user.role)) {
        return errorResponse("You are not authorized");
      }
      if (!thread) {
        return errorResponse("Thread not found");
      }
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
    .input(z.object({ thread_id: z.string(), status: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, thread] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchThread(ctx.drizzle, input.thread_id),
      ]);
      // Guard
      if (!canModerate(user.role)) {
        return errorResponse("You are not authorized");
      }
      if (!thread) {
        return errorResponse("Thread not found");
      }
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
    .input(z.object({ thread_id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, thread] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchThread(ctx.drizzle, input.thread_id),
      ]);
      // Guard
      if (!canModerate(user.role)) {
        return errorResponse("You are not authorized");
      }
      if (!thread) {
        return errorResponse("Thread not found");
      }
      // Mutate
      await ctx.drizzle.delete(forumThread).where(eq(forumThread.id, thread.id));
      await ctx.drizzle.delete(forumPost).where(eq(forumPost.threadId, thread.id));
      await ctx.drizzle
        .update(forumBoard)
        .set({ nThreads: sql`nThreads - 1` })
        .where(eq(forumBoard.id, thread.boardId));
      return { success: true, message: "Thread deleted" };
    }),
});

export const getInfiniteThreads = async (props: {
  client: DrizzleClient;
  limit: number;
  highlightPinned?: boolean;
  cursor?: number | null;
  boardId?: string;
  boardName?: string;
}) => {
  const { client, boardId, boardName, cursor, limit, highlightPinned } = props;
  const board = await fetchBoard(client, boardId, boardName);
  if (!board) throw new Error(`Board not found: ${boardId} ${boardName}`);
  const currentCursor = cursor ? cursor : 0;
  const skip = currentCursor * limit;
  const threads = await client.query.forumThread.findMany({
    offset: skip,
    limit: limit,
    where: eq(forumThread.boardId, board.id),
    with: {
      user: {
        columns: { username: true },
      },
      posts: {
        limit: 1,
        orderBy: asc(forumPost.createdAt),
      },
    },
    orderBy: highlightPinned
      ? [desc(forumThread.isPinned), desc(forumThread.createdAt)]
      : desc(forumThread.createdAt),
  });
  const nextCursor = threads.length < limit ? null : currentCursor + 1;
  return { board, threads, nextCursor };
};
export type InfiniteThreads = ReturnType<typeof getInfiniteThreads>;

export const fetchBoard = async (
  client: DrizzleClient,
  threadId?: string,
  threadName?: string,
) => {
  if (!threadId && !threadName) {
    throw new Error("No specific board requested");
  }
  const entry = await client.query.forumBoard.findFirst({
    where: threadId
      ? eq(forumBoard.id, threadId ?? "")
      : eq(forumBoard.name, threadName ?? ""),
  });
  if (!entry) throw new Error(`Board not found: ${threadId} ${threadName}`);
  return entry;
};

export const fetchThread = async (client: DrizzleClient, threadId: string) => {
  return await client.query.forumThread.findFirst({
    where: eq(forumThread.id, threadId),
  });
};

export const readNews = async (client: DrizzleClient, userId: string) => {
  await client
    .update(userData)
    .set({ unreadNews: 0 })
    .where(eq(userData.userId, userId));
};
