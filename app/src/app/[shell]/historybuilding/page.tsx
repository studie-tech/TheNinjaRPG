import { currentUser } from "@clerk/nextjs/server";
import { IMG_BUILDING_ARCHIVE } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import { fetchForumPageData } from "@/libs/forum";
import { drizzleDB } from "@/server/db";

// Force dynamic rendering to avoid static generation errors with headers
export const dynamic = "force-dynamic";

export default async function HistoryBuilding() {
  // Session information
  const user = await currentUser();
  // Initial data from server for speed
  const { initialThreads, canPost } = await fetchForumPageData(
    drizzleDB,
    "History",
    user?.id ?? null,
  );

  // Show board
  return (
    <FancyForumThreads
      board_name="History"
      canPost={canPost}
      defaultBackHref="/village"
      image={IMG_BUILDING_ARCHIVE}
      initialData={initialThreads}
    />
  );
}
