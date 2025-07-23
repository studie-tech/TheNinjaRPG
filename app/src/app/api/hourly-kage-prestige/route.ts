import { NextResponse } from "next/server";
import { eq, and, sql, inArray, gte, asc } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { village, userData, actionLog } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithHourlyTimer, handleEndpointError } from "@/libs/gamesettings";
import { KAGE_CHALLENGE_LOSE_PRESTIGE_MIN, KAGE_CHALLENGE_LOSE_PRESTIGE_PERCENTAGE, KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS } from "@/drizzle/constants";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";

const ENDPOINT_NAME = "hourly-kage-prestige";

/**
 * Calculates the total time challenges have been locked today for a specific user
 * by analyzing actionLog entries for kage challenge toggles
 */
async function calculateDailyLockedTime(userId: string): Promise<number> {
  // Get the start of today (UTC)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Get all kage challenge toggle logs for this user today
  const toggleLogs = await drizzleDB
    .select({
      relatedMsg: actionLog.relatedMsg,
      createdAt: actionLog.createdAt,
    })
    .from(actionLog)
    .where(and(
      eq(actionLog.userId, userId),
      eq(actionLog.tableName, "kageChallengeToggle"),
      gte(actionLog.createdAt, startOfDay)
    ))
    .orderBy(asc(actionLog.createdAt));

  let totalLockedTime = 0;
  let lastCloseTime: Date | null = null;

  // Process toggle logs to calculate total locked time
  for (const log of toggleLogs) {
    if (log.relatedMsg === "Toggle: CLOSE") {
      // Challenge was closed - record the time
      lastCloseTime = log.createdAt;
    } else if (log.relatedMsg === "Toggle: OPEN" && lastCloseTime) {
      // Challenge was opened - calculate the duration it was closed
      const duration = Math.floor((log.createdAt.getTime() - lastCloseTime.getTime()) / 1000);
      totalLockedTime += duration;
      lastCloseTime = null;
    }
  }

  // If challenges are currently closed, add time from last close until now
  if (lastCloseTime) {
    const currentDuration = Math.floor((now.getTime() - lastCloseTime.getTime()) / 1000);
    totalLockedTime += currentDuration;
  }

  return totalLockedTime;
}

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    const now = new Date();

    // Get all kages who have challenges disabled
    const kagesWithClosedChallenges = await drizzleDB.query.village.findMany({
      where: eq(village.openForChallenges, false),
    });
    const kageIds = kagesWithClosedChallenges
      .filter((v) => v.kageId)
      .map((v) => v.kageId);

    if (kageIds.length > 0) {
      // Get all kage user data at once
      const kages = await drizzleDB
        .select({ 
          userId: userData.userId, 
          villagePrestige: userData.villagePrestige,
        })
        .from(userData)
        .where(and(inArray(userData.userId, kageIds), eq(userData.isAi, false)));

      // Calculate and apply prestige loss for each kage
      for (const kage of kages) {
        // Find the village for this kage
        const villageData = kagesWithClosedChallenges.find(v => v.kageId === kage.userId);
        if (!villageData) continue;

        // Calculate daily locked time from actionLog
        const dailyLockedTimeSeconds = await calculateDailyLockedTime(kage.userId);
        
        // Check if we've exceeded the daily limit
        const maxDailySeconds = KAGE_CHALLENGE_MAX_DAILY_LOCKED_HOURS * 60 * 60;
        
        if (dailyLockedTimeSeconds >= maxDailySeconds) {
          // Auto-unlock challenges
          await drizzleDB
            .update(village)
            .set({
              openForChallenges: true,
              openForChallengesAt: now,
            })
            .where(eq(village.id, villageData.id));
          
          console.log(`Auto-unlocked challenges for village ${villageData.id} after kage ${kage.userId} reached daily limit`);
          continue; // Skip prestige penalty for this kage
        }

        // Apply prestige penalty
        const prestigeLoss = Math.max(
          Math.floor(kage.villagePrestige * KAGE_CHALLENGE_LOSE_PRESTIGE_PERCENTAGE),
          KAGE_CHALLENGE_LOSE_PRESTIGE_MIN
        );

        await drizzleDB
          .update(userData)
          .set({
            villagePrestige: sql`${userData.villagePrestige} - ${prestigeLoss}`,
          })
          .where(eq(userData.userId, kage.userId));
      }
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
