import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { village, userData } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithHourlyTimer, handleEndpointError } from "@/libs/gamesettings";
import {
  KAGE_CHALLENGE_LOSE_PRESTIGE_MIN,
  KAGE_CHALLENGE_LOSE_PRESTIGE_PERCENTAGE,
  KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS,
} from "@/drizzle/constants";
import { cookies } from "next/headers";
import { calculateDailyLockedTime } from "@/utils/kage";
import { fetchActiveWars } from "@/server/api/routers/war";

const ENDPOINT_NAME = "hourly-kage-prestige";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();

    // Single query to fetch villages with closed challenges and their kage user data
    const [kages, activeWars] = await Promise.all([
      drizzleDB
        .select({
          villageId: village.id,
          userId: userData.userId,
          villagePrestige: userData.villagePrestige,
        })
        .from(village)
        .innerJoin(userData, eq(userData.userId, village.kageId))
        .where(and(eq(village.openForChallenges, false), eq(userData.isAi, false))),
      fetchActiveWars(drizzleDB),
    ]);

    const kageIds = kages.map((k) => k.userId);

    if (kageIds.length > 0) {
      // Calculate daily locked time for all kages in bulk
      const lockedTimeRecord = await calculateDailyLockedTime(drizzleDB, kageIds);

      // Fetch all active wars to check for war status
      const activeVillageWars = activeWars.filter((w) => w.type === "VILLAGE_WAR");

      const updatePromises: Promise<unknown>[] = [];
      const maxDailySeconds = KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS * 60 * 60;

      // Apply logic for each kage
      for (const kage of kages) {
        const dailyLockedTimeSeconds = lockedTimeRecord?.[kage.userId] ?? 0;

        // Check if this village is involved in an active village war
        const isVillageAtWar = activeVillageWars.some(
          (w) =>
            w.attackerVillageId === kage.villageId ||
            w.defenderVillageId === kage.villageId,
        );

        if (dailyLockedTimeSeconds >= maxDailySeconds || isVillageAtWar) {
          // Auto-unlock challenges due to daily limit or active war
          updatePromises.push(
            drizzleDB
              .update(village)
              .set({
                openForChallenges: true,
                openForChallengesAt: now,
              })
              .where(eq(village.id, kage.villageId)),
          );

          continue; // Skip prestige penalty for this kage
        }

        // Apply prestige penalty
        const prestigeLoss = Math.max(
          Math.floor(kage.villagePrestige * KAGE_CHALLENGE_LOSE_PRESTIGE_PERCENTAGE),
          KAGE_CHALLENGE_LOSE_PRESTIGE_MIN,
        );

        updatePromises.push(
          drizzleDB
            .update(userData)
            .set({
              villagePrestige: sql`${userData.villagePrestige} - ${prestigeLoss}`,
            })
            .where(eq(userData.userId, kage.userId)),
        );
      }

      // Execute all updates in parallel
      await Promise.all(updatePromises);
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${kageIds.length} kages`,
    });
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
