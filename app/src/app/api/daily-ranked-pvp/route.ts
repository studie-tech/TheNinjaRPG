import { RANKED_DECAY_INACTIVE_DAYS } from "@/drizzle/constants";
import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  decayInactiveLegendRankedLp,
  listRankedSeasonForGET,
  updateUserDataForGET,
} from "@/queries/pvprank";
import { endRankedSeason } from "@/server/api/routers/pvprank";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-ranked-pvp";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  return runClaimedCron(timerCheck, "/api/daily-ranked-pvp", async () => {
    // Fetch active (non-ended) seasons
    const activeSeasons = await listRankedSeasonForGET(drizzleDB);

    // Check if any active season has expired
    const endedSeason = activeSeasons.find(
      (season: (typeof activeSeasons)[number]) => season.endDate < new Date(),
    );

    // Perform work
    if (endedSeason) {
      await endRankedSeason(drizzleDB, endedSeason.id);
    } else {
      // Apply LP decay only to Legend rank users who haven't had recent ranked matches
      const inactiveSince = new Date();
      inactiveSince.setDate(inactiveSince.getDate() - RANKED_DECAY_INACTIVE_DAYS);

      await decayInactiveLegendRankedLp(drizzleDB, inactiveSince);

      // Reset streaks for all users (not just Legend/Sannin)
      await updateUserDataForGET(drizzleDB);
    }

    return Response.json(`OK`);
  });
}
