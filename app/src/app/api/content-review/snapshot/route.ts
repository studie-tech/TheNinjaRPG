import { buildAuditSnapshot } from "@/libs/contentReview/snapshot";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { auditSnapshotQuerySchema } from "@/validators/contentReview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Input for the daily content audit (.github/workflows/content-audit.yml), as
 * `buildAuditSnapshot` assembles it. A scheduled CI job has no user session, so it
 * authenticates with the cron secret like Vercel's crons.
 */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  const parsed = auditSnapshotQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: "Unknown focus" }, { status: 400 });
  }
  const snapshot = await buildAuditSnapshot(drizzleDB, parsed.data.focus);
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
