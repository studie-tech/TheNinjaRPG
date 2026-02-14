import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { UserRank } from "@/drizzle/constants";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { quest, questHistory, userData } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { availableQuestLetterRanks } from "@/libs/train";
import { upsertQuestEntries } from "@/routers/quests";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "daily-quest";

/**
TO VALIDATE USERS WITH DAILIES RUN: 

SELECT 
    u.userId,
    u.username,
    u.`rank`,
    u.`level`,
    u.villageId
FROM `UserData` u
WHERE u.isAi = 0 AND u.level > 6
AND u.userId NOT IN (
    SELECT qh.userId 
    FROM `QuestHistory` qh 
    WHERE qh.questType = 'daily' 
        AND qh.completed = 0 
        AND qh.endedAt IS NULL
)
ORDER BY u.`rank`, u.`level`;
*/

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Reset all current dailies
    const [dailies, villages, userRankPerVillageLevel] = await Promise.all([
      drizzleDB.query.quest.findMany({
        where: and(
          eq(quest.questType, "daily"),
          isNotNull(quest.content),
          eq(quest.hidden, false),
        ),
      }),
      drizzleDB.query.village.findMany({
        with: { structures: true },
      }),
      drizzleDB
        .select({
          rank: userData.rank,
          villageId: userData.villageId,
          level: userData.level,
          count: sql`count(${userData.userId})`.mapWith(Number),
        })
        .from(userData)
        .where(eq(userData.isAi, false))
        .groupBy(userData.rank, userData.villageId, userData.level),
      drizzleDB
        .update(questHistory)
        .set({ completed: 0, endAt: new Date() })
        .where(and(eq(questHistory.questType, "daily"), eq(questHistory.completed, 0))),
    ]);

    // Book-keeping to do upsert afterwards more efficiently
    const memory: {
      questId: string;
      combos: { rank: UserRank; villageId: string; level: number }[];
    }[] = [];

    // For each user rank+village+level combo, get a random daily quest
    for (const config of userRankPerVillageLevel) {
      const { rank, villageId, level } = config;
      const village = villages?.find(
        (v: (typeof villages)[number]) => v.id === villageId,
      );
      const questRanks = availableQuestLetterRanks(rank);
      if (village && questRanks.length > 0) {
        const requiredVillage =
          village.type === "OUTLAW" ? VILLAGE_SYNDICATE_ID : (village.id ?? "");
        const newDaily = [...dailies]
          .sort(() => Math.random() - 0.5)
          .find(
            (q) =>
              questRanks.includes(q.questRank) &&
              (!q.requiredVillage || q.requiredVillage === requiredVillage) &&
              q.requiredLevel <= level &&
              q.maxLevel >= level,
          );
        if (newDaily) {
          if (!memory.find((m) => m.questId === newDaily.id)) {
            memory.push({
              questId: newDaily.id,
              combos: [{ rank, villageId: village.id, level }],
            });
          } else {
            memory
              .find((m) => m.questId === newDaily.id)
              ?.combos.push({ rank, villageId: village.id, level });
          }
        }
      }
    }

    // Do upsertions for each quest
    for (const m of memory) {
      const newDaily = dailies.find(
        (q: (typeof dailies)[number]) => q.id === m.questId,
      );
      if (newDaily) {
        await upsertQuestEntries(
          drizzleDB,
          newDaily,
          or(
            ...m.combos.map((c) =>
              and(
                eq(userData.rank, c.rank),
                eq(userData.villageId, c.villageId),
                gte(userData.level, newDaily.requiredLevel),
                lte(userData.level, newDaily.maxLevel),
              ),
            ),
          ),
        );
      }
    }

    // Re-enable tutorials for users with active tier quests who have completed all tutorial steps
    // This helps users who previously disabled tutorials get guidance on tier quests
    const usersWithActiveTierQuests = await drizzleDB
      .select({ userId: questHistory.userId })
      .from(questHistory)
      .where(
        and(
          eq(questHistory.questType, "tier"),
          eq(questHistory.completed, 0),
          isNull(questHistory.endAt),
        ),
      );

    if (usersWithActiveTierQuests.length > 0) {
      const userIdsWithTierQuests = usersWithActiveTierQuests.map(
        (u: (typeof usersWithActiveTierQuests)[number]) => u.userId,
      );
      await drizzleDB
        .update(userData)
        .set({ tutorialOn: true })
        .where(
          and(
            inArray(userData.userId, userIdsWithTierQuests),
            eq(userData.tutorialOn, false),
          ),
        );
    }

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
