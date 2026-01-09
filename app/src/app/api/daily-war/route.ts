import { drizzleDB } from "@/server/db";
import {
  war,
  village,
  villageStructure,
  quest,
  questHistory,
  userData,
} from "@/drizzle/schema";
import { eq, gt, lt, and, isNotNull, isNull, inArray } from "drizzle-orm";
import {
  WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_4,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_10,
  WAR_DAILY_HEALTH_DRAIN,
} from "@/drizzle/constants";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { handleWarEnd } from "@/libs/war";
import { fetchActiveWars } from "@/server/api/routers/war";
import { getGameSetting, updateGameSetting } from "@/libs/gamesettings";
import { lockWithHourlyTimer, handleEndpointError } from "@/libs/gamesettings";
import { availableQuestLetterRanks } from "@/libs/train";
import { cookies } from "next/headers";

const ENDPOINT_NAME = "hourly-war";
const DAILY_DECAY_TIMER = "daily-war-decay";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check hourly timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();

    // Check if daily decay should run (separate from hourly tasks)
    const dailyDecayTimer = await getGameSetting(drizzleDB, DAILY_DECAY_TIMER);
    const isNewDay = now.getUTCDate() !== dailyDecayTimer.time.getUTCDate();
    const shouldRunDailyDecay = isNewDay;

    let activeWars = await fetchActiveWars(drizzleDB);
    // Filter to VILLAGE_WAR and WAR_RAID for decay (include Outlaws/Factions)
    const decayWars = activeWars.filter((war) =>
      ["VILLAGE_WAR", "WAR_RAID"].includes(war.type),
    );

    // =============================================
    // DAILY TASK: Token decay and war health drain
    // =============================================
    if (shouldRunDailyDecay && decayWars.length > 0) {
      for (const activeWar of decayWars) {
        if (!activeWar.attackerVillage || !activeWar.defenderVillage) {
          console.error("War found with missing village data:", activeWar.id);
          continue;
        }

        const { startedAt, lastTokenReductionAt } = activeWar;

        // Calculate time since last reduction
        const hoursSinceLastReduction = lastTokenReductionAt
          ? (now.getTime() - lastTokenReductionAt.getTime()) / (1000 * 60 * 60)
          : WAR_TOKEN_REDUCTION_INTERVAL_HOURS;

        // Only process if enough time has passed
        if (hoursSinceLastReduction < WAR_TOKEN_REDUCTION_INTERVAL_HOURS) {
          continue;
        }

        // Calculate number of reductions to apply
        const reductionsToApply = Math.floor(
          hoursSinceLastReduction / WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
        );

        // Calculate war duration in days
        const warDuration = Math.floor(
          (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Calculate decay percentage based on war duration
        // Day 1-3: 3%, Day 4-9: 6%, Day 10+: 10%
        let decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_BASE;
        if (warDuration >= 10) {
          decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_10;
        } else if (warDuration >= 4) {
          decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_4;
        }

        // Calculate token reduction as percentage of current tokens
        // Apply multiple reductions if needed (but percentage is recalculated each time)
        for (let i = 0; i < reductionsToApply; i++) {
          const attackerReduction = Math.floor(
            activeWar.attackerVillage.tokens * (decayPercent / 100),
          );
          const defenderReduction = Math.floor(
            activeWar.defenderVillage.tokens * (decayPercent / 100),
          );

          activeWar.attackerVillage.tokens -= attackerReduction;
          activeWar.defenderVillage.tokens -= defenderReduction;
        }

        // Ensure tokens don't go negative
        activeWar.attackerVillage.tokens = Math.max(
          0,
          activeWar.attackerVillage.tokens,
        );
        activeWar.defenderVillage.tokens = Math.max(
          0,
          activeWar.defenderVillage.tokens,
        );

        // Calculate war health drain (applied to both sides each reduction interval)
        const totalHealthDrain = WAR_DAILY_HEALTH_DRAIN * reductionsToApply;

        // Handle war end - check tokens OR war health reaching 0
        // We need to check current war health minus the drain we're about to apply
        const attackerHealthAfterDrain = activeWar.attackerWarHealth - totalHealthDrain;
        const defenderHealthAfterDrain = activeWar.defenderWarHealth - totalHealthDrain;

        if (
          activeWar.attackerVillage.tokens <= 0 ||
          activeWar.defenderVillage.tokens <= 0 ||
          attackerHealthAfterDrain <= 0 ||
          defenderHealthAfterDrain <= 0
        ) {
          // Apply the health drain before ending war so handleWarEnd sees accurate values
          await drizzleDB
            .update(war)
            .set({
              attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
              defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
            })
            .where(eq(war.id, activeWar.id));

          // Refetch the war to get updated health values
          const updatedWars = await fetchActiveWars(drizzleDB);
          const updatedWar = updatedWars.find((w) => w.id === activeWar.id);
          if (updatedWar) {
            await handleWarEnd(updatedWar);
          }
          continue;
        }

        // Update token counts, war health drain, and last reduction time
        await Promise.all([
          drizzleDB
            .update(village)
            .set({ tokens: activeWar.attackerVillage.tokens })
            .where(eq(village.id, activeWar.attackerVillage.id)),
          drizzleDB
            .update(village)
            .set({ tokens: activeWar.defenderVillage.tokens })
            .where(eq(village.id, activeWar.defenderVillage.id)),
          drizzleDB
            .update(war)
            .set({
              lastTokenReductionAt: now,
              attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
              defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
            })
            .where(eq(war.id, activeWar.id)),
        ]);
      }

      // Update daily decay timer
      await updateGameSetting(drizzleDB, DAILY_DECAY_TIMER, 0, now);
    }

    // =============================================
    // HOURLY TASK: Assign war quests to users in active wars
    // =============================================
    if (activeWars.length > 0) {
      await assignWarQuests(activeWars);
    }

    // Clear expired temporary structure bonuses
    await clearExpiredStructureBonuses(now);

    return new Response("War hourly update completed", { status: 200 });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}

/**
 * Clear expired temporary structure level bonuses from war victories
 */
async function clearExpiredStructureBonuses(now: Date) {
  await drizzleDB
    .update(villageStructure)
    .set({
      temporaryLevelBonus: 0,
      temporaryLevelBonusExpiresAt: null,
    })
    .where(
      and(
        gt(villageStructure.temporaryLevelBonus, 0),
        lt(villageStructure.temporaryLevelBonusExpiresAt, now),
      ),
    );
}

/**
 * Assign war quests to users in active wars who don't have one already
 */
async function assignWarQuests(
  activeWars: Awaited<ReturnType<typeof fetchActiveWars>>,
) {
  // Get all village IDs involved in active wars
  const villageIds = [
    ...new Set(
      activeWars.flatMap((w) => [
        w.attackerVillageId,
        w.defenderVillageId,
        ...w.warAllies.map((a) => a.villageId),
      ]),
    ),
  ];

  if (villageIds.length === 0) return;

  // Fetch war quests and users without active war quests in parallel
  const [warQuests, usersWithoutWarQuest] = await Promise.all([
    drizzleDB.query.quest.findMany({
      where: and(
        eq(quest.questType, "war"),
        isNotNull(quest.content),
        eq(quest.hidden, false),
      ),
    }),
    // Get users in war villages who don't have an active war quest
    drizzleDB
      .select({
        userId: userData.userId,
        rank: userData.rank,
        level: userData.level,
        villageId: userData.villageId,
      })
      .from(userData)
      .leftJoin(
        questHistory,
        and(
          eq(questHistory.userId, userData.userId),
          eq(questHistory.questType, "war"),
          eq(questHistory.completed, 0),
          isNull(questHistory.endAt),
        ),
      )
      .where(
        and(
          inArray(userData.villageId, villageIds),
          eq(userData.isAi, false),
          isNull(questHistory.id), // No active war quest
        ),
      ),
  ]);

  if (warQuests.length === 0 || usersWithoutWarQuest.length === 0) return;

  // For each user, find an applicable war quest and assign it
  const questAssignments: {
    id: string;
    userId: string;
    questId: string;
    questType: "war";
  }[] = [];

  for (const user of usersWithoutWarQuest) {
    const questRanks = availableQuestLetterRanks(user.rank);

    // Find an applicable quest for this user
    const applicableQuest = [...warQuests]
      .sort(() => Math.random() - 0.5)
      .find(
        (q) =>
          questRanks.includes(q.questRank) &&
          (!q.requiredVillage || q.requiredVillage === user.villageId) &&
          q.requiredLevel <= user.level &&
          q.maxLevel >= user.level,
      );

    if (applicableQuest) {
      questAssignments.push({
        id: nanoid(),
        userId: user.userId,
        questId: applicableQuest.id,
        questType: "war",
      });
    }
  }

  // Bulk insert all quest assignments
  if (questAssignments.length > 0) {
    await drizzleDB
      .insert(questHistory)
      .values(questAssignments)
      .onDuplicateKeyUpdate({
        set: { completed: 0, endAt: null, startedAt: new Date() },
      });
  }
}
