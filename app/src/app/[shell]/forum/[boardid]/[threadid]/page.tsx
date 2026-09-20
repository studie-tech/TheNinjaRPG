import { notFound } from "next/navigation";
import { FORUM_THREAD_POSTS_PER_PAGE } from "@/drizzle/constants";
import { fetchForumThreadPage } from "@/routers/comments";
import { drizzleDB } from "@/server/db";
import Thread from "./thread";

/**
 * The thread body is rendered client-side, so this server component resolves the first
 * page up front and hands it to the client query as seed data. It is the same helper the
 * getForumComments procedure calls, so the two payloads cannot drift apart.
 */
export default async function ThreadPage(props: {
  params: Promise<{ threadid: string }>;
}) {
  const params = await props.params;
  const initialPage = await fetchForumThreadPage(drizzleDB, {
    thread_id: params.threadid,
    limit: FORUM_THREAD_POSTS_PER_PAGE,
    cursor: 0,
  });
  // Matches /username/<name>: an unknown thread answers 404 rather than rendering a
  // "not found" body under HTTP 200, which Google indexes as a soft 404.
  if (!initialPage.thread) notFound();
  return <Thread threadId={params.threadid} initialPage={initialPage} />;
}
