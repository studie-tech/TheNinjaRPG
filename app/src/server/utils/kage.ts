import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { actionLog } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/**
 * Calculate the total time (in seconds) that kage challenges have been locked for a user today.
 * This function processes action logs to track when challenges were opened and closed.
 *
 * @param client - The Drizzle client used to make the query.
 * @param userId - The ID of the user to calculate locked time for.
 * @returns Promise<number> - The total locked time in seconds for today.
 */
export async function calculateDailyLockedTime(
  client: DrizzleClient,
  userId: string,
): Promise<number>;

export async function calculateDailyLockedTime(
  client: DrizzleClient,
  userIds: string[],
): Promise<Record<string, number>>;

export async function calculateDailyLockedTime(
  client: DrizzleClient,
  userOrUsers: string | string[],
): Promise<number | Record<string, number>> {
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  // Normalize input to array for unified processing
  const userIds: string[] = Array.isArray(userOrUsers) ? userOrUsers : [userOrUsers];

  // Early exit when no ids
  if (userIds.length === 0) return Array.isArray(userOrUsers) ? {} : 0;

  // Fetch logs for all requested users in a single query
  const toggleLogs = await client
    .select({
      userId: actionLog.userId,
      relatedMsg: actionLog.relatedMsg,
      createdAt: actionLog.createdAt,
    })
    .from(actionLog)
    .where(
      and(
        inArray(actionLog.userId, userIds),
        eq(actionLog.tableName, "kageChallengeToggle"),
        gte(actionLog.createdAt, startOfDay),
      ),
    )
    .orderBy(asc(actionLog.userId), asc(actionLog.createdAt));

  // Build locked time map
  const lockedTimeMap = new Map<string, { total: number; lastClose: Date | null }>();

  for (const log of toggleLogs) {
    if (!log.userId) continue;
    const entry = lockedTimeMap.get(log.userId) || { total: 0, lastClose: null };

    if (log.relatedMsg === "Toggle: CLOSE") {
      entry.lastClose = log.createdAt;
    } else if (log.relatedMsg === "Toggle: OPEN" && entry.lastClose) {
      entry.total += Math.floor(
        (log.createdAt.getTime() - entry.lastClose.getTime()) / 1000,
      );
      entry.lastClose = null;
    }

    lockedTimeMap.set(log.userId, entry);
  }

  // Finalize durations for currently closed challenges
  for (const [userId, data] of lockedTimeMap.entries()) {
    if (data.lastClose) {
      data.total += Math.floor((now.getTime() - data.lastClose.getTime()) / 1000);
      data.lastClose = null;
      lockedTimeMap.set(userId, data);
    }
  }

  // Produce result for multiple users
  if (Array.isArray(userOrUsers)) {
    const record: Record<string, number> = {};
    for (const id of userIds) {
      record[id] = lockedTimeMap.get(id)?.total ?? 0;
    }
    return record;
  }

  // Single user path
  return lockedTimeMap.get(userOrUsers)?.total ?? 0;
}
