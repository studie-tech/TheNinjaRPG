import { handleEndpointError, lockWithDailyTimer } from "@/libs/gamesettings";
import { updateUserVoteForGET } from "@/queries/profile";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-votes";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  // Perform work
  try {
    await updateUserVoteForGET(drizzleDB);
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
