import { hasRequiredRank } from "@/libs/train";
import { eq, and, gte, asc } from "drizzle-orm";
import { actionLog } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import {
  KAGE_PRESTIGE_REQUIREMENT,
  KAGE_RANK_REQUIREMENT,
  KAGE_MIN_DAYS_IN_VILLAGE,
  KAGE_ELDER_MIN_DAYS,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import type { UserWithRelations } from "@/server/api/routers/profile";

/**
 * Calculate the total time (in seconds) that kage challenges have been locked for a user today.
 * This function processes action logs to track when challenges were opened and closed.
 *
 * @param client - The Drizzle client used to make the query.
 * @param userId - The ID of the user to calculate locked time for.
 * @returns Promise<number> - The total locked time in seconds for today.
 */
export async function calculateDailyLockedTime(client: DrizzleClient, userId: string): Promise<number> {
  // Get the start of today (UTC)
  const now = new Date();
  const startOfDay = new Date(Date.UTC(
    now.getUTCFullYear(), 
    now.getUTCMonth(), 
    now.getUTCDate()
  ));

  // Get all kage challenge toggle logs for this user today
  const toggleLogs = await client
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

/**
 * Gets the number of days a user has been in their village.
 * @param user - The user data.
 * @returns The number of days the user has been in their village.
 */
const getDaysInVillage = (user: UserData) => {
  try {
    if (!user.joinedVillageAt) return 0;
    const joinDate = new Date(user.joinedVillageAt);
    return Math.floor((new Date().getTime() - joinDate.getTime()) / (1000 * 3600 * 24));
  } catch {
    return 0;
  }
};

/**
 * Checks if a user can challenge the Kage.
 * @param user - The user data.
 * @returns True if the user can challenge the Kage, false otherwise.
 */
export const canChallengeKage = (user: UserData) => {
  const daysInVillage = getDaysInVillage(user);
  if (
    user.villagePrestige >= KAGE_PRESTIGE_REQUIREMENT &&
    hasRequiredRank(user.rank, KAGE_RANK_REQUIREMENT) &&
    daysInVillage >= KAGE_MIN_DAYS_IN_VILLAGE
  ) {
    return true;
  }
  return false;
};

/**
 * Checks if a user can be an elder.
 * @param user - The user data.
 * @returns True if the user can be an elder, false otherwise.
 */
export const canBeElder = (user: UserData) => {
  const daysInVillage = getDaysInVillage(user);
  return daysInVillage >= KAGE_ELDER_MIN_DAYS;
};

/**
 * Checks if a user is the Kage of their village.
 * @param user - The user object.
 * @returns True if the user is the Kage of their village, false otherwise.
 */
export const isKage = (user: NonNullable<UserWithRelations>) => {
  return Boolean(user?.village && user.userId === user.village?.kageId);
};
