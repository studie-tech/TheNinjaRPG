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
        trainingBoost: sql`GREATEST(${clan.trainingBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        ryoBoost: sql`GREATEST(${clan.ryoBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        regenBoost: sql`GREATEST(${clan.regenBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        missionRewardBoost: sql`GREATEST(${clan.missionRewardBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        craftingTimeBoost: sql`GREATEST(${clan.craftingTimeBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        craftingExpBoost: sql`GREATEST(${clan.craftingExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        hunterExpBoost: sql`GREATEST(${clan.hunterExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
        gathererExpBoost: sql`GREATEST(${clan.gathererExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
      }),
    ]);
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return handleEndpointError(cause);
  }
}
