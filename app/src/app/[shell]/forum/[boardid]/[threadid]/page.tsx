import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getPageForumContext, getPageThread } from "@/app/[shell]/forum/pageData";
import { FORUM_THREAD_POSTS_PER_PAGE } from "@/drizzle/constants";
import {
  fetchForumThreadPage,
  forumNavigationContext,
  resolveForumPost,
} from "@/libs/forum";
import { drizzleDB } from "@/server/db";
import Thread from "./thread";

/**
 * The thread body is rendered client-side, so this server component resolves the linked
 * page up front and hands it, the linked-post resolution and the navigation context to
 * the client queries as seed data. It is the same helper the getForumComments procedure
 * calls, so the two payloads cannot drift apart.
 */
export default async function ThreadPage(props: {
  params: Promise<{ threadid: string; boardid: string }>;
  searchParams: Promise<{ post?: string }>;
}) {
  const [params, search, session] = await Promise.all([
    props.params,
    props.searchParams,
    auth(),
  ]);
  const context = getPageForumContext(session.userId);
  const linkedPost = search.post
    ? await resolveForumPost(drizzleDB, search.post, context)
    : null;
  if (
    linkedPost &&
    (linkedPost.threadId !== params.threadid || linkedPost.boardId !== params.boardid)
  )
    redirect(
      `/forum/${linkedPost.boardId}/${linkedPost.threadId}?post=${encodeURIComponent(linkedPost.postId)}`,
    );
  const initialCursor = linkedPost?.page ?? 0;
  const initialPage = await fetchForumThreadPage(
    drizzleDB,
    {
      thread_id: params.threadid,
      limit: FORUM_THREAD_POSTS_PER_PAGE,
      cursor: initialCursor,
    },
    { context, thread: getPageThread(params.threadid) },
  );
  // Matches /username/<name>: an unknown thread answers 404 rather than rendering a
  // "not found" body under HTTP 200, which Google indexes as a soft 404.
  if (!initialPage.thread) notFound();
  return (
    <Thread
      threadId={params.threadid}
      initialPage={initialPage}
      initialCursor={initialCursor}
      linkedPost={search.post ? { postId: search.post, target: linkedPost } : null}
      initialContext={forumNavigationContext(await context)}
      fetchedAt={Date.now()}
    />
  );
}
