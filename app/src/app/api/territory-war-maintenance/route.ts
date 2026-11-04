import { lockWithMinuteTimer, runClaimedCron } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { syncDiscordEvents } from "@/server/utils/discord/events";
import { syncTerritoryWars } from "@/server/utils/territoryWar";

/** Authenticate before touching timers/data, then retain the shared once-per-minute lock. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, "territory-war-maintenance");
  return runClaimedCron(
    timer,
    "/api/territory-war-maintenance",
    async () => {
      await syncTerritoryWars(drizzleDB);
      await syncDiscordEvents(drizzleDB);
      return Response.json({ success: true });
      // The next minute's run retries; failed work does not repeat inside this one.
    },
    { keepClaimOnError: true },
  );
}
