import { lockWithMinuteTimer, runClaimedCron } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { deliverDueTimedPushes } from "@/server/utils/push/timed";

const TIMER = "push-timers";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, TIMER);
  return runClaimedCron(timer, "/api/push-timers", async () => {
    return Response.json(await deliverDueTimedPushes(drizzleDB));
  });
}
