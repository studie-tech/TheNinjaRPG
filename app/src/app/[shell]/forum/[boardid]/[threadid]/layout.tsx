import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { forumBoard, forumThread } from "@/drizzle/schema";
import { buildMetadata, noindexMetadata } from "@/libs/seo";
import { drizzleDB } from "@/server/db";

export async function generateMetadata(props: {
  params: Promise<{ boardid: string; threadid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  // forumThread has no board relation, so both are fetched in one parallel round-trip.
  const [thread, boardRow] = await Promise.all([
    drizzleDB.query.forumThread.findFirst({
      columns: { title: true, nPosts: true, boardId: true },
      where: eq(forumThread.id, params.threadid),
    }),
    drizzleDB.query.forumBoard.findFirst({
      columns: { name: true },
      where: eq(forumBoard.id, params.boardid),
    }),
  ]);
  if (!thread) return noindexMetadata("Thread Not Found");
  const board = boardRow?.name;
  return buildMetadata({
    title: thread.title,
    description: `${thread.title} - a discussion with ${thread.nPosts} ${
      thread.nPosts === 1 ? "post" : "posts"
    }${board ? ` in the ${board} board` : ""} on the TheNinja-RPG community forums.`,
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
