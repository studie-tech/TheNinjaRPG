import { auth } from "@clerk/nextjs/server";
import { IMG_BUILDING_GLOBALANBU } from "@/drizzle/constants";
import { FancyForumThreads } from "@/layout/FancyForumThreads";
import QuestPicker from "@/layout/QuestPicker";
import RaidBrowser from "@/layout/RaidBrowser";
import { fetchForumPageData } from "@/libs/forum";
import { drizzleDB } from "@/server/db";

/** Render the globalanbuhq screen independently of its route adapter. */
export async function GlobalAnbuHQScreen() {
  // Session information
  const { userId } = await auth();
  // Initial data from server for speed
  const { initialThreads, userData, canPost } = await fetchForumPageData(
    drizzleDB,
    "ANBU HQ",
    userId,
  );

  // Show board
  return (
    <>
      <FancyForumThreads
        board_name="ANBU HQ"
        canPost={canPost}
        defaultBackHref="/village"
        image={IMG_BUILDING_GLOBALANBU}
        initialData={initialThreads}
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
