import { cookies } from "next/headers";
import { syncFishingRaidOccurrences } from "@/libs/fishingRaid";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

/** Idempotently materializes UTC raid windows; occurrence unique keys absorb cron retries. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  await cookies();
  const created = await syncFishingRaidOccurrences(drizzleDB);
  return Response.json({ success: true, created });
}
