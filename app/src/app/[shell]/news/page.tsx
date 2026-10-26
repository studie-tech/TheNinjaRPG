import { auth } from "@clerk/nextjs/server";
import { IMG_BUILDING_NEWS } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import { fetchForumPageData, readNews } from "@/libs/forum";
import { drizzleDB } from "@/server/db";

// Force dynamic rendering to avoid static generation errors with headers
export const dynamic = "force-dynamic";

export default async function News() {
  // Session information
  const { userId } = await auth();
  // Initial data from server for speed
  const { initialThreads, userData, canPost } = await fetchForumPageData(
    drizzleDB,
    "News",
    userId,
  );

  // Switch off news notifications
  if (userData) {
    await readNews(drizzleDB, userData.userId, initialThreads.newsReadIds);
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
