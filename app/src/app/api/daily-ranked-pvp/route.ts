import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { battleHistory, rankedSeason, userData } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { endRankedSeason } from "@/server/api/routers/pvprank";
import { drizzleDB } from "@/server/db";

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
  const endedSeason = activeSeasons.find(
    (season: (typeof activeSeasons)[number]) => season.endDate < new Date(),
  );

  // Perform work
  try {
    if (endedSeason) {
      await endRankedSeason(drizzleDB, endedSeason.id);
    } else {
      // Apply LP decay only to Legend rank users (900+ LP) who haven't had ranked matches in 5 days
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      await drizzleDB.execute(
        sql`
          UPDATE ${userData} u
          LEFT JOIN (
            SELECT attackedId AS userId FROM ${battleHistory}
            WHERE battleType = 'RANKED_PVP' AND createdAt > ${fiveDaysAgo}
            UNION
            SELECT defenderId AS userId FROM ${battleHistory}
            WHERE battleType = 'RANKED_PVP' AND createdAt > ${fiveDaysAgo}
          ) b ON u.userId = b.userId
          SET u.rankedLp = u.rankedLp - 70
          WHERE u.rankedLp > 899 AND b.userId IS NULL
        `,
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
    return await handleEndpointError(cause);
  }
}
