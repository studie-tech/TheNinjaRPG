import type { Metadata } from "next";
import { getPageForumContext } from "@/app/[shell]/forum/pageData";
import { buildMetadata, noindexMetadata } from "@/libs/seo";

/** Generate board metadata using guest read permissions so private names and summaries stay unindexed. */
export async function generateMetadata(props: {
  params: Promise<{ boardid: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const board = (await getPageForumContext(null)).boards.find(
    (b) => b.id === params.boardid && b.permissions.read,
  );
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
