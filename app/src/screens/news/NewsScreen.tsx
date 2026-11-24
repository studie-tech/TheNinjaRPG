import { auth } from "@clerk/nextjs/server";
import { IMG_BUILDING_NEWS } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import { fetchForumPageData } from "@/libs/forum";
import { MarkNewsRead } from "@/screens/news/MarkNewsRead";
import { drizzleDB } from "@/server/db";

/** Render the news screen independently of its route adapter. */
export async function NewsScreen() {
  // Session information
  const { userId } = await auth();
  // Initial data from server for speed
  const { initialThreads, canPost } = await fetchForumPageData(
    drizzleDB,
    "News",
    userId,
  );

  // Show board; the client marks the news read so the cached News badge clears with it
  return (
    <>
      <MarkNewsRead />
      <FancyForumThreads
        board_name="News"
        canPost={canPost}
        image={IMG_BUILDING_NEWS}
        initialData={initialThreads}
      />
    </>
  );
}
