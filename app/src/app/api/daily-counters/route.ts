import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import { updateUserDataForGET } from "@/queries/profile";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-counters";

/** Reset daily activity counters and grant the daily prestige increment under the cron timer. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-counters", async () => {
    // For all users, increment villagePrestige by 1
    await updateUserDataForGET(drizzleDB);

    return Response.json(`OK`);
  });
}
