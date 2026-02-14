import { currentUser } from "@clerk/nextjs/server";
import { IMG_BUILDING_GLOBALANBU } from "@/drizzle/constants";
import FancyForumThreads from "@/layout/FancyForumThreads";
import QuestPicker from "@/layout/QuestPicker";
import RaidBrowser from "@/layout/RaidBrowser";
import { getInfiniteThreads } from "@/routers/forum";
import { fetchUser } from "@/routers/profile";
import { drizzleDB } from "@/server/db";
import { canCreateNews } from "@/utils/permissions";

// Force dynamic rendering to avoid static generation errors with headers
export const dynamic = "force-dynamic";

export default async function GlobalAnbuHQ() {
  // Session information
  const user = await currentUser();
  // Initial data from server for speed
  const [initialNews, userData] = await Promise.all([
    getInfiniteThreads({
      client: drizzleDB,
      boardName: "ANBU HQ",
      limit: 10,
    }),
    ...(user ? [fetchUser(drizzleDB, user.id).catch(() => null)] : []),
  ]);

  // Can post news?
  const canPost = userData && canCreateNews(userData.role);

  // Show board
  return (
    <>
      <FancyForumThreads
        board_name="ANBU HQ"
        canPost={canPost}
        defaultBackHref="/village"
        image={IMG_BUILDING_GLOBALANBU}
        initialData={initialNews}
      />
      {userData && (
        <>
          <RaidBrowser
            title="Raids"
            subtitle="Global ANBU HQ"
            initialBreak={true}
            viewOnly={true}
          />
          <QuestPicker
            questType="story"
            title="Story Missions"
            subtitle="Global Anbu HQ"
            introduction="Story missions are special assignments that advance the game's narrative. They can only be started here at the Global Anbu HQ."
            initialBreak={true}
          />
        </>
      )}
    </>
  );
}
