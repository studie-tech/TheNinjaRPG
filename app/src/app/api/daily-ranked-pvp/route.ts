import { and, sql, eq } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { rankedSeason, userData } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { endRankedSeason } from "@/server/api/routers/pvprank";

const ENDPOINT_NAME = "daily-pvp";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  // Fetch active (non-ended) seasons
  const activeSeasons = await drizzleDB.query.rankedSeason.findMany({
    where: and(eq(rankedSeason.ended, false)),
  });

  // Check if any active season has expired
  const endedSeason = activeSeasons.find((season) => season.endDate < new Date());

  // Perform work
  try {
    if (endedSeason) {
      await endRankedSeason(drizzleDB, endedSeason.id);
    } else {
      await drizzleDB.update(userData).set({
        rankedLp: sql`${userData.rankedLp} * 0.95`,
      });
    }

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
