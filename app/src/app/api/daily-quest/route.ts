import { eq, inArray, isNull, isNotNull, and, or, sql } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { UserRanks, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { availableQuestLetterRanks } from "@/libs/train";
import { sleep } from "@/utils/time";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { upsertQuestEntries } from "@/routers/quests";
import { cookies } from "next/headers";

const ENDPOINT_NAME = "daily-quest";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  // Query
  const villages = await drizzleDB.query.village.findMany({
    with: { structures: true },
  });

  try {
    // Reset all current dailies
    await drizzleDB
      .update(questHistory)
      .set({ completed: 0, endAt: new Date() })
      .where(and(eq(questHistory.questType, "daily"), eq(questHistory.completed, 0)));

    // For each user rank, get a random daily quest
    for (const rank of UserRanks) {
      const ranks = availableQuestLetterRanks(rank);
      if (ranks.length > 0) {
        for (const village of villages) {
          const requiredVillage =
            village.type === "OUTLAW" ? VILLAGE_SYNDICATE_ID : (village.id ?? "");
          const newDaily = await drizzleDB.query.quest.findFirst({
            where: and(
              eq(quest.questType, "daily"),
              isNotNull(quest.content),
              inArray(quest.questRank, ranks),
              or(
                isNull(quest.requiredVillage),
                eq(quest.requiredVillage, requiredVillage),
              ),
            ),
            orderBy: sql`RAND()`,
          });
          if (newDaily) {
            await upsertQuestEntries(
              drizzleDB,
              newDaily,
              and(eq(userData.rank, rank), eq(userData.villageId, village.id)),
            );
          }
        }
      }
      // Await a bit to avoid too many open connections
      await sleep(500);
    }
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
