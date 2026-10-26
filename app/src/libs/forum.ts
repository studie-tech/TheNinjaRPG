import * as Sentry from "@sentry/nextjs";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  forumBoard,
  forumPost,
  forumThread,
  userData,
  userDataJob,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
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
  const empty = {
    board: null,
    threads: [],
    nextCursor: null,
    newsReadIds: [] as string[],
  };
  if (!boardId && !boardName) return empty;
  const currentCursor = cursor ? cursor : 0;
  const skip = currentCursor * limit;
  // The articles and their acknowledgement IDs must share a SQL snapshot: a
  // publication can commit after this read despite having an older creation time.
  const page = await client.query.forumBoard.findFirst({
    where: boardId ? eq(forumBoard.id, boardId) : eq(forumBoard.name, boardName ?? ""),
    extras: {
      newsReadIds: sql<string[]>`CASE WHEN ${forumBoard.name} = 'News' THEN (
        SELECT COALESCE(JSON_ARRAYAGG(newsJobs.id), JSON_ARRAY())
        FROM ${userDataJob} newsJobs WHERE newsJobs.kind = 'NEWS'
      ) ELSE JSON_ARRAY() END`
        .mapWith((value: string | string[]) => parseJson<string[]>(value))
        .as("newsReadIds"),
    },
    with: {
      threads: {
        offset: skip,
        limit,
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
      },
    },
  });
  if (!page) return empty;
  const { threads, newsReadIds, ...board } = page;
  const nextCursor = threads.length < limit ? null : currentCursor + 1;
  return { board, threads, nextCursor, newsReadIds };
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
  readIds?: string[],
) => {
  let ids = readIds;
  while (true) {
    // A SELECT outside the mutation takes no publication locks. The user and its
    // delivery cursors share one snapshot; the CAS retries if a delivery or read
    // changes it, including a delivery whose unread counter was already capped.
    const [snapshot] = await client
      .select({
        newsReadIds: userData.newsReadIds,
        newsVersion: userData.newsVersion,
        jobs: sql<NewsJobReceipt[]>`(
        SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id', newsJobs.id, 'delivered',
          newsJobs.completedAt IS NOT NULL OR newsJobs.cursor >= ${userData.userId})), JSON_ARRAY())
        FROM ${userDataJob} newsJobs WHERE newsJobs.kind = 'NEWS'
          AND newsJobs.createdAt >= ${userData.createdAt}
          AND (newsJobs.excludedUserId IS NULL OR newsJobs.excludedUserId <> ${userData.userId})
      )`.mapWith((value: string | NewsJobReceipt[]) =>
          parseJson<NewsJobReceipt[]>(value),
        ),
      })
      .from(userData)
      .where(eq(userData.userId, userId));
    if (!snapshot) return;
    // The explicit mark-as-read mutation acknowledges its first committed snapshot;
    // page rendering supplies the snapshot returned with the articles instead.
    ids ??= snapshot.jobs.map(({ id }) => id);
    const acknowledged = new Set([...snapshot.newsReadIds, ...ids]);
    const result = await retryOnDeadlock(() =>
      client
        .update(userData)
        .set({
          unreadNews: Math.min(
            snapshot.jobs.filter((job) => job.delivered && !acknowledged.has(job.id))
              .length,
            1000,
          ),
          // Completed jobs expire in the cleaner; prune their IDs on the next read.
          newsReadIds: snapshot.jobs
            .filter((job) => acknowledged.has(job.id))
            .map(({ id }) => id),
          newsVersion: sql`${userData.newsVersion} + 1`,
        })
        .where(
          and(
            eq(userData.userId, userId),
            eq(userData.newsVersion, snapshot.newsVersion),
          ),
        ),
    );
    if (result.rowsAffected > 0) return;
  }
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

const parseJson = <T>(value: string | T): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : value;

type NewsJobReceipt = { id: string; delivered: number };
