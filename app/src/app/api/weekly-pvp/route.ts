import { cookies } from "next/headers";
import { anbuSquad } from "@/drizzle/schema";
import {
  handleEndpointError,
  lockWithWeeklyTimer,
  updateGameSetting,
} from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";

const ENDPOINT_NAME = "weekly-pvp";

export async function GET() {
  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Check timer
  const timerCheck = await lockWithWeeklyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewWeek && timerCheck.response) return timerCheck.response;

  // Perform work
  try {
    await Promise.all([
      drizzleDB.update(anbuSquad).set({
        pvpActivity: 0,
      }),
    ]);
    return Response.json(`OK`);
  } catch (cause) {
    // Rollback
    await updateGameSetting(drizzleDB, ENDPOINT_NAME, 0, timerCheck.prevTime);
    return await handleEndpointError(cause);
  }
}
