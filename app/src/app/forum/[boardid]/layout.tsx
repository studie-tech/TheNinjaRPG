import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { forumBoard } from "@/drizzle/schema";
import { buildMetadata, noindexMetadata } from "@/libs/seo";
import { drizzleDB } from "@/server/db";

export async function generateMetadata(props: {
  params: Promise<{ boardid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const board = await drizzleDB.query.forumBoard.findFirst({
    columns: { name: true, summary: true, nThreads: true },
    where: eq(forumBoard.id, params.boardid),
  });
  if (!board) return noindexMetadata("Board Not Found");
  return buildMetadata({
    title: `${board.name} Forum`,
    description: `${board.summary} Browse ${board.nThreads} discussions in the ${board.name} board on the TheNinja-RPG community forums.`,
    path: `/forum/${params.boardid}`,
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
