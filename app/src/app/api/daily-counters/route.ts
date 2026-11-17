import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  dailyCountersPendingWhere,
  updateUserDataForDailyCounters,
} from "@/queries/profile";
import { drizzleDB } from "@/server/db";
import { updateUserDataCandidates } from "@/server/utils/cleaner";
import { authenticateCronRequest } from "@/server/utils/cron";
import { periodStart } from "@/utils/time";

const ENDPOINT_NAME = "daily-counters";

/** Reset daily activity counters and grant the daily prestige increment under the cron timer. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-counters", async () => {
    // Players are reset in primary-key batches, each guarded by its own reset day, so a
    // retry after a partial failure finishes the rest without a second prestige grant.
    const dayStart = periodStart("daily", new Date());
    await updateUserDataCandidates(
      drizzleDB,
      dailyCountersPendingWhere(dayStart),
      (batch) => updateUserDataForDailyCounters(drizzleDB, dayStart, batch),
    );

    return Response.json(`OK`);
  });
}
