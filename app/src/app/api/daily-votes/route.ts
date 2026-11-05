import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import { updateUserVoteForGET } from "@/queries/profile";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-votes";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  // Perform work
  return runClaimedCron(timerCheck, "/api/daily-votes", async () => {
    await updateUserVoteForGET(drizzleDB);
    return Response.json(`OK`);
  });
}
