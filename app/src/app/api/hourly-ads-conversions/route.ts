import * as Sentry from "@sentry/nextjs";
import { lockWithHourlyTimer, runClaimedCron } from "@/libs/gamesettings";
import {
  deleteAdConversionUploads,
  insertAdConversionUploads,
  markAdConversionsReported,
  selectAdConversionUploads,
  selectPendingRegisterAdConversions,
  selectPendingTutorialAdConversions,
} from "@/queries/adConversions";
import { drizzleDB } from "@/server/db";
import {
  AD_CONVERSION_BATCH_SIZE,
  AD_CONVERSION_UPLOAD_STALE_DAYS,
  type AdConversion,
  buildAdConversionIngestRequest,
  settleAdConversionUpload,
} from "@/server/utils/adConversions";
import { authenticateCronRequest } from "@/server/utils/cron";
import {
  getAdConversionDestinations,
  getDataManagerToken,
  ingestAdConversions,
  retrieveAdConversionStatus,
} from "@/server/utils/googleDataManager";
import { groupBy, reduceByKey } from "@/utils/grouping";

const ENDPOINT_NAME = "hourly-ads-conversions";

/** Upload rows settled per run; each run reads the status of their requests. */
const UPLOAD_SETTLE_LIMIT = 10_000;

/**
 * Report sign-ups and tutorial completions of characters linked to a Google Ads click
 * through the Data Manager API. Each run first settles earlier uploads from Google's
 * processing status and saves that, then sends conversions that are neither settled nor
 * awaiting a status. A conversion Google failed to process for a transient reason is sent
 * again next run; one Google refuses as invalid is settled so it cannot block the rest.
 */
export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // Until Google Ads is connected, conversions wait in the database.
  const destinations = getAdConversionDestinations();
  if (!destinations) return Response.json("Google Ads conversions are not configured");

  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  return runClaimedCron(timerCheck, `/api/${ENDPOINT_NAME}`, async () => {
    const [token, uploads] = await Promise.all([
      getDataManagerToken(),
      selectAdConversionUploads(drizzleDB, UPLOAD_SETTLE_LIMIT),
    ]);

    // Settle earlier uploads, and save that before sending anything new
    const statuses = await Promise.all(
      [...groupBy(uploads, "requestId")].map(async ([requestId, rows]) => ({
        rows,
        status: await retrieveAdConversionStatus(token, requestId),
      })),
    );
    const settled: SettledConversion[] = [];
    const finishedUploadIds: string[] = [];
    const rejections: { reason: string; count: number }[] = [];
    const staleBefore = Date.now() - AD_CONVERSION_UPLOAD_STALE_DAYS * 86_400_000;
    for (const { rows, status } of statuses) {
      const isStale = rows.every((row) => row.createdAt.getTime() < staleBefore);
      const settlement = status ? settleAdConversionUpload(status, rows) : null;
      if (settlement?.isProcessing && !isStale) continue;
      // An unknown or long-unfinished request is sent again; transaction IDs dedupe it.
      settled.push(...(settlement?.settled ?? []));
      finishedUploadIds.push(...rows.map((row) => row.id));
      rejections.push(...(settlement?.rejections ?? []));
    }
    await recordSettled(settled, finishedUploadIds);
    // Reported now: the upload rows are gone, so a failed send below cannot lose them.
    reportRejections(reduceByKey(rejections, "reason"));

    // Select after settling, so a resent conversion and a click withdrawn meanwhile are
    // both current
    const [registers, tutorials] = await Promise.all([
      selectPendingRegisterAdConversions(drizzleDB, AD_CONVERSION_BATCH_SIZE),
      selectPendingTutorialAdConversions(drizzleDB, AD_CONVERSION_BATCH_SIZE),
    ]);
    const conversions: AdConversion[] = [
      ...registers.map((row) => ({ ...row, action: "register" as const })),
      ...tutorials.map((row) => ({ ...row, action: "tutorialComplete" as const })),
    ].slice(0, AD_CONVERSION_BATCH_SIZE);
    const result =
      conversions.length > 0
        ? await ingestAdConversions(
            token,
            buildAdConversionIngestRequest(conversions, destinations),
          )
        : null;

    if (result && "invalidEventIndices" in result) {
      // Google refused the whole request over these events; settle them as rejected so
      // the rest can be sent on the next run instead of the same batch failing again.
      const invalid = result.invalidEventIndices.flatMap(
        (index) => conversions[index] ?? [],
      );
      await recordSettled(invalid, []);
      reportRejections({ INVALID_EVENT: result.invalidEventIndices.length });
    } else if (result) {
      await insertAdConversionUploads(drizzleDB, result.requestId, conversions);
    }
    const sent = result && "requestId" in result ? conversions.length : 0;
    return Response.json(
      `Settled ${finishedUploadIds.length} and sent ${sent} conversions`,
    );
  });
}

/** Mark settled conversions and remove the upload rows that are finished. */
const recordSettled = (settled: SettledConversion[], finishedUploadIds: string[]) =>
  Promise.all([
    ...[...groupBy(settled, "action")].map(([action, rows]) =>
      markAdConversionsReported(
        drizzleDB,
        action,
        rows.map((row) => row.adClickId),
      ),
    ),
    ...(finishedUploadIds.length > 0
      ? [deleteAdConversionUploads(drizzleDB, finishedUploadIds)]
      : []),
  ]);

/** Report conversions Google rejected for good, by reason, for monitoring. */
const reportRejections = (rejections: Record<string, number>) => {
  if (Object.keys(rejections).length === 0) return;
  Sentry.captureException(new Error("Google Ads rejected ad click conversions"), {
    level: "warning",
    tags: { source: ENDPOINT_NAME },
    extra: { rejections },
  });
};

/** A conversion Google settled, whether processed or refused for good. */
type SettledConversion = Pick<AdConversion, "action" | "adClickId">;
