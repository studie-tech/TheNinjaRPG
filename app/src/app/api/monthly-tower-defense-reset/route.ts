import { lockWithMonthlyTimer, runClaimedCron } from "@/libs/gamesettings";
import { deleteTowerDefenseRunForGET } from "@/queries/towerDefense";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "monthly-tower-defense-reset";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer - only run once per month
  const timerCheck = await lockWithMonthlyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/monthly-tower-defense-reset", async () => {
    // Delete all completed tower defense runs (reset leaderboard)
    const result = await deleteTowerDefenseRunForGET(drizzleDB);

    return Response.json(
      `OK - Tower defense leaderboard reset. Deleted ${result.rowsAffected} completed runs.`,
    );
  });
}
