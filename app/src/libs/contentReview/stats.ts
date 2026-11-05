import type { ContentProposal, ContentProposalChange } from "@/drizzle/schema";
import { DAY_S, getUtcDayKey, getUtcDayWindowStart, periodStart } from "@/utils/time";
import type { ReviewStatsInput } from "@/validators/contentReview";

/** Current outcomes of submission cohorts; these are not a historical decision event log. */
export const buildReviewStats = (
  proposals: StatsProposal[],
  input: ReviewStatsInput,
  now: Date,
) => {
  const start = getUtcDayWindowStart(input.days, now);
  const inWindow = proposals.filter(
    (row) => row.createdAt >= start && row.createdAt <= now,
  );
  const agents = [
    ...new Set(
      inWindow
        .filter((row) => row.source === "AGENT")
        .map((row) => row.agentName ?? ""),
    ),
  ].sort();
  const filtered = inWindow.filter(
    (row) =>
      (!input.category || row.category === input.category) &&
      (!input.source || row.source === input.source) &&
      (input.agentName == null ||
        (row.source === "AGENT" && (row.agentName ?? "") === input.agentName)) &&
      (!input.entityType ||
        row.changes.some((change) => change.entityType === input.entityType)),
  );
  const periods = new Map<string, Counts>();
  for (let at = start.getTime(); at <= now.getTime(); at += DAY_S * 1000) {
    const key = getUtcDayKey(periodStart(input.interval, new Date(at)));
    if (!periods.has(key)) periods.set(key, emptyCounts());
  }
  const summary = emptyCounts();
  const groups = new Map<
    string,
    {
      source: StatsProposal["source"];
      agentName: string | null;
      category: StatsProposal["category"];
      counts: Counts;
    }
  >();
  for (const row of filtered) {
    const period = periods.get(
      getUtcDayKey(periodStart(input.interval, row.createdAt)),
    );
    const key = JSON.stringify([row.source, row.agentName, row.category]);
    const group = groups.get(key) ?? {
      source: row.source,
      agentName: row.agentName,
      category: row.category,
      counts: emptyCounts(),
    };
    for (const counts of [summary, group.counts, period]) {
      if (counts) {
        counts.total++;
        counts[row.status]++;
      }
    }
    groups.set(key, group);
  }
  return {
    start: start.toISOString(),
    end: now.toISOString(),
    agents,
    summary: withRates(summary),
    trend: [...periods].map(([date, counts]) => ({ date, ...withRates(counts) })),
    breakdown: [...groups.values()]
      .map(({ counts, ...group }) => ({ ...group, ...withRates(counts) }))
      .sort(
        (a, b) =>
          b.total - a.total || JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
  };
};

const emptyCounts = () => ({
  total: 0,
  APPLIED: 0,
  REVERTED: 0,
  REJECTED: 0,
  PENDING: 0,
  OUTDATED: 0,
});
const withRates = (counts: Counts) => {
  const accepted = counts.APPLIED + counts.REVERTED;
  const reviewed = accepted + counts.REJECTED;
  return {
    ...counts,
    accepted,
    reviewed,
    acceptanceRate: reviewed ? (100 * accepted) / reviewed : null,
    reviewCoverage: counts.total ? (100 * reviewed) / counts.total : null,
  };
};
type Counts = ReturnType<typeof emptyCounts>;
type StatsProposal = Pick<
  ContentProposal,
  "id" | "source" | "agentName" | "category" | "status" | "createdAt"
> & { changes: Pick<ContentProposalChange, "entityType">[] };
