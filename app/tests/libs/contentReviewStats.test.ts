import { describe, expect, it } from "bun:test";
import { buildReviewStats } from "@/libs/contentReview/stats";
import { reviewStatsSchema } from "@/validators/contentReview";

const now = new Date("2026-01-07T12:00:00Z");
const input = reviewStatsSchema.parse({ days: 7, interval: "daily" });
const proposal = (
  id: string,
  status: "APPLIED" | "REJECTED" | "PENDING" | "OUTDATED" | "REVERTED",
  date = "2026-01-01T00:00:00Z",
) => ({
  id,
  status,
  createdAt: new Date(date),
  source: "AGENT" as const,
  agentName: "Codex",
  category: "GRAMMAR" as const,
  changes: [
    { entityType: "ITEM" as const },
    { entityType: "ITEM" as const },
    { entityType: "JUTSU" as const },
  ],
});

describe("content review analytics", () => {
  it("uses reviewed suggestions as the denominator and distinguishes reverted approvals", () => {
    const stats = buildReviewStats(
      [
        proposal("a", "APPLIED"),
        proposal("b", "REVERTED"),
        proposal("c", "REJECTED"),
        proposal("d", "OUTDATED"),
        proposal("e", "PENDING"),
      ],
      input,
      now,
    );
    expect(stats.summary.total).toBe(5);
    expect(stats.summary.reviewed).toBe(3);
    expect(stats.summary.acceptanceRate).toBeCloseTo(200 / 3);
    expect(stats.summary.reviewCoverage).toBe(60);
    expect(stats.summary.APPLIED).toBe(1);
    expect(stats.summary.REVERTED).toBe(1);
    expect(stats.trend).toHaveLength(7);
    expect(stats.trend[1]?.acceptanceRate).toBeNull();
    expect(stats.trend[1]?.total).toBe(0);
  });

  it("includes the UTC window boundary, excludes older and future submissions", () => {
    const stats = buildReviewStats(
      [
        proposal("at", "APPLIED"),
        proposal("before", "REJECTED", "2025-12-31T23:59:59Z"),
        proposal("after", "REJECTED", "2026-01-07T12:00:01Z"),
      ],
      input,
      now,
    );
    expect(stats.summary.total).toBe(1);
    expect(stats.start).toBe("2026-01-01T00:00:00.000Z");
  });

  it("groups by Monday across years and preserves empty periods", () => {
    const stats = buildReviewStats(
      [proposal("a", "APPLIED"), proposal("b", "REJECTED", "2026-01-05T00:00:00Z")],
      { ...input, interval: "weekly" },
      now,
    );
    expect(stats.trend.map((row) => row.date)).toEqual(["2025-12-29", "2026-01-05"]);
    expect(stats.trend.map((row) => row.acceptanceRate)).toEqual([100, 0]);
    const months = buildReviewStats(
      [],
      { ...input, days: 40, interval: "monthly" },
      now,
    );
    expect(months.trend.map((row) => row.date)).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);
  });

  it("combines filters without multiplying multi-entity suggestions and keeps agent options available", () => {
    const rows = [
      proposal("a", "APPLIED"),
      { ...proposal("b", "REJECTED"), agentName: "Claude" },
      { ...proposal("c", "REJECTED"), source: "STAFF" as const, agentName: "Codex" },
    ];
    const stats = buildReviewStats(
      rows,
      {
        ...input,
        entityType: "ITEM",
        category: "GRAMMAR",
        agentName: "Codex",
        source: "AGENT",
      },
      now,
    );
    expect(stats.summary.total).toBe(1);
    expect(stats.breakdown).toHaveLength(1);
    expect(stats.agents).toEqual(["Claude", "Codex"]);
    expect(
      buildReviewStats(rows, { ...input, entityType: "AI" }, now).summary
        .acceptanceRate,
    ).toBeNull();
    expect(
      buildReviewStats(rows, { ...input, source: "STAFF" }, now).summary.total,
    ).toBe(1);
  });

  it("accepts ninety days and bounds filters to known values", () => {
    expect(reviewStatsSchema.parse({}).days).toBe(90);
    expect(reviewStatsSchema.safeParse({ days: 91 }).success).toBe(false);
    expect(reviewStatsSchema.safeParse({ entityType: "UNKNOWN" }).success).toBe(false);
    expect(reviewStatsSchema.safeParse({ interval: "hourly" }).success).toBe(false);
  });
});
