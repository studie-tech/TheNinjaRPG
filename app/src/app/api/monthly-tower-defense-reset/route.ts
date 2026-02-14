import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { towerDefenseRun } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithMonthlyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "monthly-tower-defense-reset";

export async function GET() {
  // Disable cache for this server action
  await cookies();

  // Check timer - only run once per month
  const timerCheck = await lockWithMonthlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewMonth && timerCheck.response) return timerCheck.response;

  try {
    // Delete all completed tower defense runs (reset leaderboard)
    const result = await drizzleDB
      .delete(towerDefenseRun)
      .where(eq(towerDefenseRun.status, "COMPLETED"));

    return Response.json(
      `OK - Tower defense leaderboard reset. Deleted ${result.rowsAffected} completed runs.`,
    );
  } catch (cause) {
    // Rollback timer on error
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
