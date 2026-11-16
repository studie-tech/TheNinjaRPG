import type { Metadata } from "next";
import { getPageForumContext, getPageThread } from "@/app/[shell]/forum/pageData";
import { buildMetadata, noindexMetadata } from "@/libs/seo";

/** Expose only published, publicly readable topics and derive the canonical URL from their actual board. */
export async function generateMetadata(props: {
  params: Promise<{ boardid: string; threadid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const [context, thread] = await Promise.all([
    getPageForumContext(null),
    getPageThread(params.threadid),
  ]);
  const board = context.boards.find(
    (b) => b.id === thread?.boardId && b.permissions.read,
  );
  if (!thread || thread.deletedAt || !thread.isApproved || !board)
    return noindexMetadata("Thread Not Found");
  return buildMetadata({
    title: thread.title,
    description: `${thread.title} - a discussion with ${thread.nPosts} ${
      thread.nPosts === 1 ? "post" : "posts"
    }${board ? ` in the ${board.name} board` : ""} on the TheNinja-RPG community forums.`,
    // Built from the thread's own boardId rather than the requested one. Any board id
    // resolves this route, so pairing a real thread with an unrelated board would
    // otherwise mint unlimited URLs that each declare themselves canonical.
    path: `/forum/${thread.boardId}/${params.threadid}`,
    type: "article",
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
