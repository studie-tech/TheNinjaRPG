import { lockWithMinuteTimer, runClaimedCron } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { maintainKageDefenses } from "@/server/utils/kage";

const TIMER = "kage-defense-maintenance";
export const maxDuration = 300;

/** Reconcile assignments and attendance even when participants close the game. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, TIMER);
  return runClaimedCron(timer, "/api/kage-defense-maintenance", async () => {
    await maintainKageDefenses(drizzleDB);
    return Response.json({ success: true });
  });
}
