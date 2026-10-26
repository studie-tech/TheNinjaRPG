import { cookies } from "next/headers";
import { handleEndpointError, lockWithDailyTimer } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

import { enqueueUserDataJob, processUserDataJobs } from "@/server/utils/userDataJobs";

const ENDPOINT_NAME = "daily-counters";

/** Reset daily activity counters and grant the daily prestige increment under the cron timer. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // The day ID and committed cursor make a partial grant safe to resume.
    await enqueueUserDataJob(drizzleDB, {
      id: `daily-counters:${new Date().toISOString().slice(0, 10)}`,
      kind: "DAILY_COUNTERS",
    });
    await processUserDataJobs(drizzleDB);

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
