import { eq, or, isNotNull, and, sql, gte, lte } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { availableQuestLetterRanks } from "@/libs/train";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { upsertQuestEntries } from "@/routers/quests";
import { cookies } from "next/headers";
import type { UserRank } from "@/drizzle/constants";

const ENDPOINT_NAME = "daily-quest";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Reset all current dailies
    const [dailies, villages, userRankPerVillage] = await Promise.all([
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
          minLevel: sql`min(${userData.level})`.mapWith(Number),
          count: sql`count(${userData.userId})`.mapWith(Number),
        })
        .from(userData)
        .where(eq(userData.isAi, false))
        .groupBy(userData.rank, userData.villageId),
      drizzleDB
        .update(questHistory)
        .set({ completed: 0, endAt: new Date() })
        .where(and(eq(questHistory.questType, "daily"), eq(questHistory.completed, 0))),
    ]);

    // Book-keeping to do upsert afterwards more efficiently
    const memory: {
      questId: string;
      combos: { rank: UserRank; villageId: string }[];
    }[] = [];

    // For each user rank, get a random daily quest
    for (const config of userRankPerVillage) {
      const { rank, villageId, minLevel } = config;
      const village = villages?.find((v) => v.id === villageId);
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
              q.requiredLevel <= minLevel &&
              q.maxLevel >= minLevel,
          );
        if (newDaily) {
          if (!memory.find((m) => m.questId === newDaily.id)) {
            memory.push({
              questId: newDaily.id,
              combos: [{ rank, villageId: village.id }],
            });
          } else {
            memory
              .find((m) => m.questId === newDaily.id)
              ?.combos.push({ rank, villageId: village.id });
          }
        }
      }
    }

    // Do upsertions for each quest
    for (const m of memory) {
      const newDaily = dailies.find((q) => q.id === m.questId);
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
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
