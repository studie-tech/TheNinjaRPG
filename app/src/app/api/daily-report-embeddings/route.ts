import { lockWithDailyTimer, runClaimedCron } from "@/libs/gamesettings";
import { deleteOrphanedReportEmbeddings } from "@/libs/moderation/reportSearch";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "daily-report-embeddings";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  const timerCheck = await lockWithDailyTimer(drizzleDB, ENDPOINT_NAME);

  return runClaimedCron(timerCheck, "/api/daily-report-embeddings", async () => {
    await deleteOrphanedReportEmbeddings(drizzleDB);
    return Response.json("OK");
  });
}
