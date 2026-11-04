import { lockWithWeeklyTimer, runClaimedCron } from "@/libs/gamesettings";
import { updateAnbuSquadForGET } from "@/queries/anbu";
import { updateUserDataForWeeklyPvpReset as updateUserDataForGET } from "@/queries/pvprank";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { periodStart } from "@/utils/time";

const ENDPOINT_NAME = "weekly-pvp";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Check timer
  const timerCheck = await lockWithWeeklyTimer(drizzleDB, ENDPOINT_NAME);

  // Perform work
  return runClaimedCron(timerCheck, "/api/weekly-pvp", async () => {
    const weekStart = periodStart("weekly", new Date());
    await Promise.all([
      // Kills earned after the week boundary survive a delayed reset or job retry.
      // Leave updatedAt alone: it doubles as last activity (online counts, cleanup,
      // sector lists), and no snapshot claim writes these columns as absolute values.
      updateUserDataForGET(drizzleDB, weekStart),
      updateAnbuSquadForGET(drizzleDB),
    ]);
    return Response.json(`OK`);
  });
}
