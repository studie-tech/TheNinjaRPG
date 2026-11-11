import { auth } from "@clerk/nextjs/server";
import { IMG_BUILDING_NEWS } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import { fetchForumPageData } from "@/libs/forum";
import { drizzleDB } from "@/server/db";
import { MarkNewsRead } from "./MarkNewsRead";

// Force dynamic rendering to avoid static generation errors with headers
export const dynamic = "force-dynamic";

export default async function News() {
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
