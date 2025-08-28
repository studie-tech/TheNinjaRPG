import { drizzleDB } from "@/server/db";
import { war, village, villageStructure } from "@/drizzle/schema";
import { eq, sql, inArray, and } from "drizzle-orm";
import {
  WAR_TOKEN_REDUCTION_INTERVAL_HOURS,
  WAR_TOKEN_REDUCTION_MULTIPLIER_AFTER_3_DAYS,
  WAR_TOKEN_REDUCTION_MULTIPLIER_AFTER_7_DAYS,
  WAR_DAILY_STRUCTURE_HP_DRAIN,
} from "@/drizzle/constants";
import { handleWarEnd } from "@/libs/war";
import { fetchActiveWars } from "@/server/api/routers/war";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { cookies } from "next/headers";

const ENDPOINT_NAME = "daily-war";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();

    let activeWars = await fetchActiveWars(drizzleDB);
    activeWars = activeWars.filter((w) => ["VILLAGE_WAR", "WAR_RAID"].includes(w.type));

    if (!activeWars || activeWars.length === 0) {
      return new Response("No active wars found", { status: 200 });
    }

    for (const activeWar of activeWars) {
      if (!activeWar.attackerVillage || !activeWar.defenderVillage) {
        console.error("War found with missing village data:", activeWar.id);
        continue;
      }

      const { startedAt, dailyTokenReduction, lastTokenReductionAt } = activeWar;

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

      // Calculate token reduction based on war duration
      let tokenReduction = dailyTokenReduction;
      if (warDuration >= 7) {
        tokenReduction = Math.floor(
          dailyTokenReduction * WAR_TOKEN_REDUCTION_MULTIPLIER_AFTER_7_DAYS,
        );
      } else if (warDuration >= 3) {
        tokenReduction = Math.floor(
          dailyTokenReduction * WAR_TOKEN_REDUCTION_MULTIPLIER_AFTER_3_DAYS,
        );
      }

      // Apply multiple reductions if needed
      const totalReduction = tokenReduction * reductionsToApply;

      // Reduce village tokens in-place
      activeWar.attackerVillage.tokens -= totalReduction;
      activeWar.defenderVillage.tokens -= totalReduction;
      activeWar.attackerVillage.tokens = Math.max(0, activeWar.attackerVillage.tokens);
      activeWar.defenderVillage.tokens = Math.max(0, activeWar.defenderVillage.tokens);

      // Handle war end
      if (
        activeWar.attackerVillage.tokens <= 0 ||
        activeWar.defenderVillage.tokens <= 0
      ) {
        await handleWarEnd(activeWar);
        continue;
      }

      // Update token counts and last reduction time
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
            dailyTokenReduction: tokenReduction,
            lastTokenReductionAt: now,
          })
          .where(eq(war.id, activeWar.id)),
        ...(["VILLAGE_WAR", "WAR_RAID"].includes(activeWar.type)
          ? [
              drizzleDB
                .update(villageStructure)
                .set({ curSp: sql`curSp - ${WAR_DAILY_STRUCTURE_HP_DRAIN}` })
                .where(
                  and(
                    inArray(villageStructure.villageId, [
                      activeWar.attackerVillageId,
                      activeWar.defenderVillageId,
                    ]),
                    eq(villageStructure.route, activeWar.targetStructureRoute),
                  ),
                ),
            ]
          : []),
      ]);
    }
    return new Response("War daily update completed", { status: 200 });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
