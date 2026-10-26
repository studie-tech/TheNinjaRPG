import * as Sentry from "@sentry/nextjs";
import { asc, desc, eq, sql } from "drizzle-orm";
import { forumBoard, forumPost, forumThread, userData } from "@/drizzle/schema";
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
  if (!boardId && !boardName) return { board: null, threads: [], nextCursor: null };
  const currentCursor = cursor ? cursor : 0;
  const skip = currentCursor * limit;
  const [board, threads] = await Promise.all([
    fetchBoard(client, boardId, boardName),
    client.query.forumThread.findMany({
      offset: skip,
      limit: limit,
      where: eq(
        forumThread.boardId,
        boardId ||
          client
            .select({ id: forumBoard.id })
            .from(forumBoard)
            .where(eq(forumBoard.name, boardName ?? "")),
      ),
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
    }),
  ]);
  if (!board) return { board: null, threads: [], nextCursor: null };
  const nextCursor = threads.length < limit ? null : currentCursor + 1;
  return { board, threads, nextCursor };
};
export type InfiniteThreads = ReturnType<typeof getInfiniteThreads>;

export const fetchBoard = async (
  client: DrizzleClient,
  boardId?: string,
  boardName?: string,
) => {
  if (!boardId && !boardName) return null;
  const entry = await client.query.forumBoard.findFirst({
    where: boardId
      ? eq(forumBoard.id, boardId ?? "")
      : eq(forumBoard.name, boardName ?? ""),
  });
  return entry ?? null;
};

export const readNews = async (
  client: DrizzleClient,
  userId: string,
  readThrough = new Date(),
) => {
  await client
    .update(userData)
    .set({
      unreadNews: 0,
      newsReadAt: sql`GREATEST(${userData.newsReadAt}, ${readThrough})`,
    })
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
    ? client.query.userData
        .findFirst({
          where: eq(userData.userId, userId),
          columns: { userId: true, role: true, unreadNews: true },
        })
        .catch((error) => {
          if (error.message?.includes("not found")) {
            return null;
          }
          console.error("Failed to fetch user:", error);
          Sentry.captureException(error, {
            tags: { source: "forum-fetch-user" },
          });
          return null;
        })
    : Promise.resolve(null);

  const [initialThreads, userRow] = await Promise.all([
    initialThreadsPromise,
    userDataPromise,
  ]);
  const pageUser = userRow ?? null;
  const canPost = pageUser && canCreateNews(pageUser.role);
  return { initialThreads, userData: pageUser, canPost };
};
