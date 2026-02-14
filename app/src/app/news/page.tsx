import { currentUser } from "@clerk/nextjs/server";
import { IMG_BUILDING_NEWS } from "@/drizzle/constants";
import FancyForumThreads from "@/layout/FancyForumThreads";
import { getInfiniteThreads, readNews } from "@/routers/forum";
import { fetchUser } from "@/routers/profile";
import { drizzleDB } from "@/server/db";
import { canCreateNews } from "@/utils/permissions";

// Force dynamic rendering to avoid static generation errors with headers
export const dynamic = "force-dynamic";

export default async function News() {
  // Session information
  const user = await currentUser();
  // Initial data from server for speed
  const [initialNews, userData] = await Promise.all([
    getInfiniteThreads({
      client: drizzleDB,
      boardName: "News",
      limit: 10,
    }),
    ...(user ? [fetchUser(drizzleDB, user.id).catch(() => null)] : []),
  ]);

  // Can post news?
  const canPost = userData && canCreateNews(userData.role);

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
      initialData={initialNews}
    />
  );
}
