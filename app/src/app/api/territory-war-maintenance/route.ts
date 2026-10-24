import { cookies } from "next/headers";
import { handleEndpointError, lockWithMinuteTimer } from "@/libs/gamesettings";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { syncTerritoryWars } from "@/server/utils/territoryWar";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  await cookies();
  const timer = await lockWithMinuteTimer(drizzleDB, "territory-war-maintenance");
  if (!timer.isNewMinute && timer.response) return timer.response;
  try {
    await syncTerritoryWars(drizzleDB);
    return Response.json({ success: true });
  } catch (error) {
    return handleEndpointError(error, { endpoint: "territory-war-maintenance" });
  }
}
