import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import {
  WAR_DAILY_HEALTH_DRAIN,
  WAR_DAILY_TOKEN_DECAY_PERCENT_BASE,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5,
  WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8,
  WAR_MAX_DURATION_DAYS,
  WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
} from "@/drizzle/constants";
import { village, villageStructure, war } from "@/drizzle/schema";
import {
  getGameSetting,
  handleEndpointError,
  lockWithHourlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { handleWarEnd } from "@/libs/war";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { fetchActiveWars } from "@/server/api/routers/war";
import { drizzleDB } from "@/server/db";

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
    const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const prevUTC = Date.UTC(
      dailyDecayTimer.time.getUTCFullYear(),
      dailyDecayTimer.time.getUTCMonth(),
      dailyDecayTimer.time.getUTCDate(),
    );
    const shouldRunDailyDecay = nowUTC !== prevUTC;

    // =============================================
    // DAILY TASK: Token decay and war health drain
    // =============================================
    if (shouldRunDailyDecay) {
      // fetchActiveWars is expensive (loads village structures); only fetch when needed
      const activeWars = await fetchActiveWars(drizzleDB);
      // Filter to VILLAGE_WAR and WAR_RAID for decay (include Outlaws/Factions)
      const decayWars = activeWars.filter((w) =>
        ["VILLAGE_WAR", "WAR_RAID"].includes(w.type),
      );

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

        // Check if war has exceeded max duration (14 days) - auto-resolve
        if (warDuration >= WAR_MAX_DURATION_DAYS) {
          await handleWarEnd(activeWar);
          continue;
        }

        // Calculate decay percentage based on war duration
        // Day 1-4: 3%, Day 5-7: 6%, Day 8+: 10%
        let decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_BASE;
        if (warDuration >= 8) {
          decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_8;
        } else if (warDuration >= 5) {
          decayPercent = WAR_DAILY_TOKEN_DECAY_PERCENT_DAY_5;
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
          const result = await drizzleDB
            .update(war)
            .set({
              attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
              defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
            })
            .where(and(eq(war.id, activeWar.id), isNull(war.endedAt)));

          // Only proceed if the war update actually modified a row (guarded update)
          if (result.rowsAffected > 0) {
            // Update token counts
            await Promise.all([
              drizzleDB
                .update(village)
                .set({ tokens: activeWar.attackerVillage.tokens })
                .where(eq(village.id, activeWar.attackerVillage.id)),
              drizzleDB
                .update(village)
                .set({ tokens: activeWar.defenderVillage.tokens })
                .where(eq(village.id, activeWar.defenderVillage.id)),
            ]);

            // Build updated war object with drained health values to avoid an extra DB roundtrip
            const warWithDrain: FetchActiveWarsReturnType = {
              ...activeWar,
              attackerWarHealth: Math.max(
                activeWar.attackerWarHealth - totalHealthDrain,
                0,
              ),
              defenderWarHealth: Math.max(
                activeWar.defenderWarHealth - totalHealthDrain,
                0,
              ),
            };
            await handleWarEnd(warWithDrain);
          }
          continue;
        }

        // Update token counts, war health drain, and last reduction time
        const result = await drizzleDB
          .update(war)
          .set({
            lastTokenReductionAt: now,
            attackerWarHealth: sql`GREATEST(attackerWarHealth - ${totalHealthDrain}, 0)`,
            defenderWarHealth: sql`GREATEST(defenderWarHealth - ${totalHealthDrain}, 0)`,
          })
          .where(and(eq(war.id, activeWar.id), isNull(war.endedAt)));

        if (result.rowsAffected > 0) {
          await Promise.all([
            drizzleDB
              .update(village)
              .set({ tokens: activeWar.attackerVillage.tokens })
              .where(eq(village.id, activeWar.attackerVillage.id)),
            drizzleDB
              .update(village)
              .set({ tokens: activeWar.defenderVillage.tokens })
              .where(eq(village.id, activeWar.defenderVillage.id)),
          ]);
        }
      }

      // Update daily decay timer
      await updateGameSetting(drizzleDB, DAILY_DECAY_TIMER, 0, now);
    }

    // Clear expired temporary structure bonuses
    await clearExpiredStructureBonuses(now);

    return new Response("War hourly update completed", { status: 200 });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}

/**
 * Clear expired temporary structure level bonuses from war victories/defeats
 * Handles both positive bonuses (winner) and negative bonuses (loser penalties)
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
        isNotNull(villageStructure.temporaryLevelBonusExpiresAt),
        lt(villageStructure.temporaryLevelBonusExpiresAt, now),
      ),
    );
}
