import { TERR_BOT_ID } from "@/drizzle/constants";
import type { moderationScan, UserReport } from "@/drizzle/schema";
import { DAY_S, getUtcDayKey, getUtcDayWindowStart, periodStart } from "@/utils/time";
import type { ModBotPerformanceInput } from "@/validators/reports";

/** Source aliases describe the same surfaces across automatic and human reports. */
export const moderationSurface = (system: string) => {
  if (
    ["comment", "privateMessage", "conversation_comment", "tavern_comment"].includes(
      system,
    )
  )
    return "conversation";
  if (["forumPost", "forum_comment"].includes(system)) return "forum";
  if (["user_profile", "userNindo", "userAvatar"].includes(system)) return "profile";
  return "other";
};

/** Current staff outcomes grouped by submission date, not detection recall. */
export const buildModBotStats = (
  reports: StatsReport[],
  scans: StatsScan[],
  input: ModBotPerformanceInput,
  now: Date,
) => {
  const start = getUtcDayWindowStart(input.days, now);
  const matches = (at: Date, system: string) =>
    at >= start &&
    at <= now &&
    (input.surface === "all" || moderationSurface(system) === input.surface);
  const summary = emptyCounts();
  const periods = new Map<string, Counts>();
  for (let at = start.getTime(); at <= now.getTime(); at += DAY_S * 1000) {
    periods.set(getUtcDayKey(periodStart(input.interval, new Date(at))), emptyCounts());
  }
  const surfaces = new Map<string, Counts>();
  const versions = new Map<string, Counts>();
  const group = (map: Map<string, Counts>, key: string) => {
    const counts = map.get(key) ?? emptyCounts();
    map.set(key, counts);
    return counts;
  };
  for (const report of reports.filter((row) => matches(row.createdAt, row.system))) {
    const counts = [
      summary,
      group(surfaces, moderationSurface(report.system)),
      periods.get(getUtcDayKey(periodStart(input.interval, report.createdAt))),
    ];
    if (report.predictedAt && report.promptVersion)
      counts.push(group(versions, report.promptVersion));
    for (const bucket of counts) {
      if (!bucket) continue;
      const bot = report.reporterUserId === TERR_BOT_ID;
      const reviewed = report.status !== "UNVIEWED";
      const action = reviewed && report.status !== "REPORT_CLEARED";
      bucket[bot ? "botTotal" : "humanTotal"]++;
      bucket[
        bot
          ? reviewed
            ? action
              ? "botAction"
              : "botCleared"
            : "botPending"
          : reviewed
            ? action
              ? "humanAction"
              : "humanCleared"
            : "humanPending"
      ]++;
      if (!reviewed) continue;
      // Reports without a recorded original prediction (including legacy rows whose
      // prediction the indexer overwrote) cannot be evaluated.
      if (
        !report.predictedAt ||
        !report.promptVersion ||
        !report.predictedStatus ||
        report.predictedStatus === "UNVIEWED"
      ) {
        bucket.excludedPredictions++;
        continue;
      }
      const positive = report.predictedStatus !== "REPORT_CLEARED";
      bucket[
        action
          ? positive
            ? "supportedAction"
            : "missedAction"
          : positive
            ? "unsupportedAction"
            : "supportedClear"
      ]++;
    }
  }
  const filteredScans = scans.filter((row) => matches(row.createdAt, row.relationType));
  for (const scan of filteredScans) {
    const counts = [
      summary,
      group(surfaces, moderationSurface(scan.relationType)),
      periods.get(getUtcDayKey(periodStart(input.interval, scan.createdAt))),
      group(versions, scan.promptVersion),
    ];
    for (const bucket of counts) {
      if (!bucket) continue;
      const count = scan.count ?? 1;
      bucket.scans += count;
      if (scan.flagged) bucket.flagged += count;
      bucket[scan.outcome] += count;
    }
  }
  const firstScan = filteredScans.reduce<Date | null>(
    (first, row) => (!first || row.createdAt < first ? row.createdAt : first),
    null,
  );
  return {
    start: start.toISOString(),
    end: now.toISOString(),
    telemetryStart: firstScan?.toISOString() ?? null,
    summary: withRates(summary),
    trend: [...periods].map(([date, counts]) => ({ date, ...withRates(counts) })),
    surfaces: [...surfaces].map(([surface, counts]) => ({
      surface,
      ...withRates(counts),
    })),
    versions: [...versions].map(([version, counts]) => ({
      version,
      ...withRates(counts),
    })),
  };
};

const emptyCounts = () => ({
  botTotal: 0,
  botAction: 0,
  botCleared: 0,
  botPending: 0,
  humanTotal: 0,
  humanAction: 0,
  humanCleared: 0,
  humanPending: 0,
  supportedAction: 0,
  missedAction: 0,
  unsupportedAction: 0,
  supportedClear: 0,
  excludedPredictions: 0,
  scans: 0,
  flagged: 0,
  CHECKING: 0,
  GATE_CLEAR: 0,
  DECISION_CLEAR: 0,
  REPORTED: 0,
  ERROR: 0,
});
const withRates = (counts: Counts) => {
  const botReviewed = counts.botAction + counts.botCleared;
  const evaluated =
    counts.supportedAction +
    counts.missedAction +
    counts.unsupportedAction +
    counts.supportedClear;
  return {
    ...counts,
    botReviewed,
    evaluated,
    actionYield: botReviewed ? (100 * counts.botAction) / botReviewed : null,
    reviewCoverage: counts.botTotal ? (100 * botReviewed) / counts.botTotal : null,
    agreement: evaluated
      ? (100 * (counts.supportedAction + counts.supportedClear)) / evaluated
      : null,
  };
};
type Counts = ReturnType<typeof emptyCounts>;
type StatsReport = Pick<
  UserReport,
  | "createdAt"
  | "reporterUserId"
  | "status"
  | "system"
  | "predictedStatus"
  | "predictedAt"
  | "promptVersion"
>;
type StatsScan = { count?: number } & Pick<
  typeof moderationScan.$inferSelect,
  "createdAt" | "relationType" | "outcome" | "flagged" | "promptVersion"
>;
