import * as Sentry from "@sentry/nextjs";
import { asc, desc, eq } from "drizzle-orm";
import { forumBoard, forumPost, forumThread, userData } from "@/drizzle/schema";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { canCreateNews } from "@/utils/permissions";

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
  boardId?: string,
  boardName?: string,
) => {
  if (!boardId && !boardName) {
    throw new Error("No specific board requested");
  }
  const entry = await client.query.forumBoard.findFirst({
    where: boardId
      ? eq(forumBoard.id, boardId ?? "")
      : eq(forumBoard.name, boardName ?? ""),
  });
  if (!entry) throw new Error(`Board not found: ${boardId} ${boardName}`);
  return entry;
};

export const readNews = async (client: DrizzleClient, userId: string) => {
  await client
    .update(userData)
    .set({ unreadNews: 0 })
    .where(eq(userData.userId, userId));
};

export const fetchForumPageData = async (
  client: DrizzleClient,
  boardName: string,
  userId: string | null,
) => {
  const initialThreadsPromise = getInfiniteThreads({
    client,
    boardName,
    limit: 10,
  });

  const userDataPromise = userId
    ? fetchUser(client, userId).catch((error) => {
        // Check if it's an expected "not found" error
        if (error.message?.includes("not found")) {
          return null;
        }
        // For unexpected errors, log to Sentry for monitoring
        console.error("Failed to fetch user:", error);
        Sentry.captureException(error, {
          tags: { source: "forum-fetch-user" },
        });
        return null;
      })
    : Promise.resolve(null);

  const [initialThreads, userData] = await Promise.all([
    initialThreadsPromise,
    userDataPromise,
  ]);
  const canPost = userData && canCreateNews(userData.role);
  return { initialThreads, userData, canPost };
};
