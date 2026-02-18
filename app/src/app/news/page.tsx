import { currentUser } from "@clerk/nextjs/server";
import { IMG_BUILDING_NEWS } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import { fetchForumPageData, readNews } from "@/libs/forum";
import { drizzleDB } from "@/server/db";

// Force dynamic rendering to avoid static generation errors with headers
export const dynamic = "force-dynamic";

export default async function News() {
  // Session information
  const user = await currentUser();
  // Initial data from server for speed
  const { initialThreads, userData, canPost } = await fetchForumPageData(
    drizzleDB,
    "News",
    user?.id ?? null,
  );

  // Switch off news notifications
  if (userData && userData.unreadNews > 0) {
    await readNews(drizzleDB, userData.userId);
  }

  // Show board
  return (
    <FancyForumThreads
      board_name="News"
      canPost={canPost}
      image={IMG_BUILDING_NEWS}
      initialData={initialThreads}
    />
  );
}
