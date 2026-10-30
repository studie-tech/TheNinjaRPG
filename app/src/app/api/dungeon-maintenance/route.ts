import { handleEndpointError, lockWithMinuteTimer } from "@/libs/gamesettings";
import { listExpiredDungeonRuns } from "@/queries/dungeon";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { expireDungeonRun } from "@/server/utils/dungeon";

/** Give the bounded deadline sweep the shared maintenance execution budget. */
export const maxDuration = 300;

/** Release offline squads on their deadline, guarded by the shared minute lock and run CAS. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const timer = await lockWithMinuteTimer(drizzleDB, "dungeon-maintenance");
  if (!timer.isNewMinute) return timer.response;
  try {
    const runs = await listExpiredDungeonRuns(drizzleDB);
    await Promise.all(runs.map((run) => expireDungeonRun(drizzleDB, run)));
    return Response.json({ success: true });
  } catch (error) {
    await timer.release();
    return handleEndpointError(error);
  }
}
