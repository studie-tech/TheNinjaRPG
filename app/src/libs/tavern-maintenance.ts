import { sql } from "drizzle-orm";
import { conversation, conversationComment, userData } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import type { DrizzleClient } from "@/server/db";

export const GLOBAL_TAVERN_CLEANUP_QUERY = sql`
  DELETE a FROM ${conversationComment} a
  INNER JOIN ${conversation} b ON a.conversationId = b.id
  WHERE b.isPublic AND b.title = 'Global'
    AND a.createdAt < CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR
`;

export const TAVERN_ACTIVITY_DECAY_QUERY = sql`
  UPDATE ${userData} SET tavernMessages = FLOOR(tavernMessages * 0.95)
`;

type DailyTimer = {
  isNewDay: boolean;
  prevTime: Date;
};

/**
 * Runs the tavern work that should retain its original once-per-day cadence.
 * If either statement fails, restore the marker so the next cleaner run retries it.
 */
export async function runDailyTavernMaintenance(
  client: DrizzleClient,
  timer: DailyTimer,
  restoreDailyTimer: typeof updateGameSetting = updateGameSetting,
) {
  if (!timer.isNewDay) return;

  try {
    await client.execute(GLOBAL_TAVERN_CLEANUP_QUERY);
    await client.execute(TAVERN_ACTIVITY_DECAY_QUERY);
  } catch (cause) {
    await restoreDailyTimer(client, "cleaner-daily", 0, timer.prevTime);
    throw cause;
  }
}
