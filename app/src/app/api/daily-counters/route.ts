import { eq, inArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { KAGE_DAILY_PRESTIGE_LOSS } from "@/drizzle/constants";
import { userData, village } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithDailyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "daily-counters";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  try {
    // Get all kages
    const kages = await drizzleDB.query.village.findMany({
      where: eq(village.type, "VILLAGE"),
    });
    const kageIds = kages?.map((kage: (typeof kages)[number]) => kage.kageId);

    // For all users, increment villagePrestige by 1
    await drizzleDB.update(userData).set({
      villagePrestige: sql`${userData.villagePrestige} + 1`,
      dailyArenaFights: 0,
      dailyMissions: 0,
      dailyErrands: 0,
      dailyMedicalMissions: 0,
      dailyPvpMissions: 0,
      dailyTrainings: 0,
      aiCalls: 0,
    });

    // For kages, reduce village Prestige by KAGE_DAILY_PRESTIGE_LOSS & the 1 just added
    if (kageIds.length > 0) {
      await drizzleDB
        .update(userData)
        .set({
          villagePrestige: sql`${userData.villagePrestige} - ${KAGE_DAILY_PRESTIGE_LOSS + 1}`,
        })
        .where(inArray(userData.userId, kageIds));
    }

    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
