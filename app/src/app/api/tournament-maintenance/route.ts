import { lockWithMinuteTimer, runClaimedCron } from "@/libs/gamesettings";
import { maintainEventTournaments } from "@/routers/tournamentEvents";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const TIMER = "tournament-maintenance";
export const maxDuration = 300;

/** Authenticate and claim the shared minute lock before reconciling event progress and payouts. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, TIMER);
  return runClaimedCron(timer, "/api/tournament-maintenance", async () => {
    await maintainEventTournaments(drizzleDB);
    return Response.json({ success: true });
  });
}
