import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { getPageForumContext } from "@/app/[shell]/forum/pageData";
import { FORUM_BOARD_THREADS_PER_PAGE } from "@/drizzle/constants";
import { forumNavigationContext, getInfiniteThreads } from "@/libs/forum";
import { drizzleDB } from "@/server/db";
import Board from "./board";

/**
 * Resolves the first page of threads and the navigation context server-side and hands
 * them to the client queries as seed data. Same helpers the getThreads and getContext
 * procedures call, so the payloads cannot drift.
 */
export default async function BoardPage(props: {
  params: Promise<{ boardid: string }>;
}) {
  const [params, session] = await Promise.all([props.params, auth()]);
  const context = await getPageForumContext(session.userId);
  const initialThreads = await getInfiniteThreads({
    client: drizzleDB,
    context,
    boardId: params.boardid,
    limit: FORUM_BOARD_THREADS_PER_PAGE,
    cursor: 0,
    highlightPinned: true,
  });
  if (!initialThreads.board) notFound();
  return (
    <Board
      boardId={params.boardid}
      initialThreads={initialThreads}
      initialContext={forumNavigationContext(context)}
      renderedFor={session.userId ?? null}
      fetchedAt={Date.now()}
    />
  );
}
