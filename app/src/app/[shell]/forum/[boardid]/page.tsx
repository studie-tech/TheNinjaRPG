import { notFound } from "next/navigation";
import { FORUM_BOARD_THREADS_PER_PAGE } from "@/drizzle/constants";
import { getInfiniteThreads } from "@/libs/forum";
import { drizzleDB } from "@/server/db";
import Board from "./board";

/**
 * Resolves the first page of threads server-side and hands it to the client query as
 * seed data. Same helper the getThreads procedure calls, so the payloads cannot drift.
 */
export default async function BoardPage(props: {
  params: Promise<{ boardid: string }>;
}) {
  const params = await props.params;
  const initialThreads = await getInfiniteThreads({
    client: drizzleDB,
    boardId: params.boardid,
    limit: FORUM_BOARD_THREADS_PER_PAGE,
    cursor: 0,
    highlightPinned: true,
  });
  if (!initialThreads.board) notFound();
  return <Board boardId={params.boardid} initialThreads={initialThreads} />;
}
