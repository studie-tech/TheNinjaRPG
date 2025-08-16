import { and, sql, eq, gt } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { rankedSeason, userData, battleHistory } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { cookies } from "next/headers";
import { endRankedSeason } from "@/server/api/routers/pvprank";

const ENDPOINT_NAME = "daily-ranked-pvp";

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
      // Apply LP decay only to Legend rank users (900+ LP) who haven't had ranked matches in 5 days
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      
      await drizzleDB
        .update(userData)
        .set({
          rankedLp: sql`${userData.rankedLp} - 70`,
        })
        .where(
          and(
            gt(userData.rankedLp, 899),
            sql`${userData.userId} NOT IN (
              SELECT DISTINCT userId FROM (
                SELECT attackedId as userId FROM BattleHistory 
                WHERE battleType = 'RANKED_PVP' AND createdAt > ${fiveDaysAgo}
                UNION
                SELECT defenderId as userId FROM BattleHistory 
                WHERE battleType = 'RANKED_PVP' AND createdAt > ${fiveDaysAgo}
              ) recent_battles
            )`
          )
        );

      // Reset streaks for all users (not just Legend/Sannin)
      await drizzleDB
        .update(userData)
        .set({
          rankedStreak: 0,
        })
        .where(gt(userData.rankedLp, 0));
    }

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
