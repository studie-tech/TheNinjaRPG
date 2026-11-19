import { env } from "@/env/server.mjs";
import { lockWithMinuteTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  deleteExpiredMetaTracking,
  markMetaConversionReported,
  selectMetaConsentForDispatch,
  selectMetaConversions,
} from "@/queries/metaTracking";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";
import { sendMetaConversions } from "@/server/utils/metaCapi";
import { isMetaCapiConfigured } from "@/server/utils/metaTracking";

/** Report confirmed game records, retrying identical event IDs while deduplication is safe. */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;
  const claim = await lockWithMinuteTimer(drizzleDB, "meta-conversions");
  return runClaimedCron(claim, "/api/meta-conversions", async () => {
    // Retention and withdrawal work even while outbound reporting is switched off.
    await deleteExpiredMetaTracking(drizzleDB);
    if (!isMetaCapiConfigured()) return Response.json({ sent: 0, configured: false });
    const [registrations, tutorials] = await Promise.all([
      selectMetaConversions(drizzleDB, "register", { pendingOnly: true }),
      selectMetaConversions(drizzleDB, "tutorial_complete", { pendingOnly: true }),
    ]);
    const conversions = [
      ...registrations.map((row) => ({ ...row, event: "register" as const })),
      ...tutorials.map((row) => ({ ...row, event: "tutorial_complete" as const })),
    ];
    const current = conversions.length
      ? await selectMetaConsentForDispatch(drizzleDB, conversions)
      : [];
    const decisionKey = (row: { userId: string; consentId: string; decidedAt: Date }) =>
      `${row.userId}:${row.consentId}:${row.decidedAt.getTime()}`;
    const allowed = new Set(current.map(decisionKey));
    const dispatch = conversions.filter((row) => allowed.has(decisionKey(row)));
    // The external request cannot be atomic with withdrawal. Check at the final
    // dispatch boundary, without keeping database locks across network I/O.
    await sendMetaConversions(
      env.NEXT_PUBLIC_META_PIXEL_ID ?? "",
      env.META_CAPI_ACCESS_TOKEN ?? "",
      dispatch,
    );
    await Promise.all(
      dispatch.map((row) => markMetaConversionReported(drizzleDB, row, row.event)),
    );
    return Response.json({ sent: dispatch.length });
  });
}
