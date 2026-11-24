import { auth } from "@clerk/nextjs/server";
import { IMG_BUILDING_ARCHIVE } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import { fetchForumPageData } from "@/libs/forum";
import { drizzleDB } from "@/server/db";

/** Render the historybuilding screen independently of its route adapter. */
export async function HistoryBuildingScreen() {
  // Session information
  const { userId } = await auth();
  // Initial data from server for speed
  const { initialThreads, canPost } = await fetchForumPageData(
    drizzleDB,
    "History",
    userId,
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
