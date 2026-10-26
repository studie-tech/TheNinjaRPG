import { handleEndpointError, lockWithMinuteTimer } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { processUserDataJobs } from "@/server/utils/userDataJobs";

export const maxDuration = 60;

/** Resume committed cursors even when the request that enqueued them was interrupted. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, "user-data-jobs");
  if (!timer.isNewMinute && timer.response) return timer.response;
  try {
    await processUserDataJobs(drizzleDB);
    return Response.json({ success: true });
  } catch (error) {
    await timer.release();
    return handleEndpointError(error, { endpoint: "user-data-jobs" });
  }
}
