import { sql } from "drizzle-orm";
import { drizzleDB } from "@/server/db";
import { userData } from "@/drizzle/schema";
import { anbuSquad, clan } from "@/drizzle/schema";
import { updateGameSetting } from "@/libs/gamesettings";
import { lockWithDailyTimer, handleEndpointError } from "@/libs/gamesettings";
import { CLAN_BOOST_PERCENT_PER_LEVEL } from "@/drizzle/constants";
import { cookies } from "next/headers";

const ENDPOINT_NAME = "daily-pvp";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewDay && timerCheck.response) return timerCheck.response;

  // Perform work
  try {
    await Promise.all([
      drizzleDB.update(userData).set({
        pvpActivity: sql`${userData.pvpActivity} * 0.95`,
      }),
      drizzleDB.update(anbuSquad).set({
        pvpActivity: sql`${anbuSquad.pvpActivity} * 0.95`,
      }),
      drizzleDB.update(clan).set({
        pvpActivity: sql`${clan.pvpActivity} * 0.95`,
        trainingBoost: sql`CASE WHEN ${clan.trainingBoost} > 0 THEN ${clan.trainingBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        ryoBoost: sql`CASE WHEN ${clan.ryoBoost} > 0 THEN ${clan.ryoBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        regenBoost: sql`CASE WHEN ${clan.regenBoost} > 0 THEN ${clan.regenBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        missionRewardBoost: sql`CASE WHEN ${clan.missionRewardBoost} > 0 THEN ${clan.missionRewardBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        craftingTimeBoost: sql`CASE WHEN ${clan.craftingTimeBoost} > 0 THEN ${clan.craftingTimeBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        craftingExpBoost: sql`CASE WHEN ${clan.craftingExpBoost} > 0 THEN ${clan.craftingExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        hunterExpBoost: sql`CASE WHEN ${clan.hunterExpBoost} > 0 THEN ${clan.hunterExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
        gathererExpBoost: sql`CASE WHEN ${clan.gathererExpBoost} > 0 THEN ${clan.gathererExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL} ELSE 0 END`,
      }),
    ]);
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
