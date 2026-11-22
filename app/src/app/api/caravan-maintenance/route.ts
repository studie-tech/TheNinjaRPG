import { lockWithMinuteTimer, runClaimedCron } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { maintainCaravans } from "@/server/utils/caravan";
import { authenticateCronRequest } from "@/server/utils/cron";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, "caravan-maintenance");
  return runClaimedCron(timer, "/api/caravan-maintenance", async () => {
    await maintainCaravans(drizzleDB);
    return Response.json({ success: true });
  });
}
