import { cookies } from "next/headers";
import { handleEndpointError, lockWithDailyTimer } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

import { enqueueUserDataJob, processUserDataJobs } from "@/server/utils/userDataJobs";

const ENDPOINT_NAME = "daily-counters";
export const maxDuration = 300;

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
    const jobId = `daily-counters:${new Date().toISOString().slice(0, 10)}`;
    await enqueueUserDataJob(drizzleDB, {
      id: jobId,
      kind: "DAILY_COUNTERS",
    });
    // Finish daily resets in day order before reporting success. Broadcast backlogs
    // must not postpone the boundary, and an older reset must not run after this one.
    const completed = await processUserDataJobs(drizzleDB, {
      jobKind: "DAILY_COUNTERS",
      budgetMs: 250_000,
    });
    if (!completed) throw new Error("Daily counter reset needs a retry");

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
