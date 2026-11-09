import { describe, expect, it } from "bun:test";
import { TERR_BOT_ID } from "@/drizzle/constants";
import { buildModBotStats } from "@/libs/moderation/stats";
import type { ModBotPerformanceInput } from "@/validators/reports";

const now = new Date("2026-01-04T12:00:00Z");
const input: ModBotPerformanceInput = { days: 7, interval: "daily", surface: "all" };
const report = (
  overrides: Partial<Parameters<typeof buildModBotStats>[0][number]> = {},
) => ({
  createdAt: new Date("2025-12-31T23:59:00Z"),
  reporterUserId: TERR_BOT_ID,
  status: "REPORT_CLEARED" as const,
  system: "comment",
  predictedStatus: "OFFICIAL_WARNING" as const,
  predictedAt: now,
  promptVersion: "evidence-v1",
  ...overrides,
});

describe("moderation dashboard cohorts", () => {
  it("counts all bot alerts even when the legacy prediction was overwritten to clear", () => {
    const data = buildModBotStats(
      [
        report({
          predictedStatus: "REPORT_CLEARED",
          predictedAt: null,
          promptVersion: null,
        }),
        report({ status: "OFFICIAL_WARNING" }),
        report({ status: "UNVIEWED" }),
      ],
      [],
      input,
      now,
    );
    expect(data.summary.botTotal).toBe(3);
    expect(data.summary.botReviewed).toBe(2);
    expect(data.summary.botPending).toBe(1);
    expect(data.summary.actionYield).toBe(50);
    expect(data.summary.evaluated).toBe(1);
    expect(data.summary.excludedPredictions).toBe(1);
  });

  it("does not infer bot misses from human reports or unverifiable predictions", () => {
    const data = buildModBotStats(
      [
        report({
          reporterUserId: "human",
          system: "user_profile",
          status: "BAN_ACTIVATED",
          predictedAt: null,
        }),
      ],
      [],
      input,
      now,
    );
    expect(data.summary.humanAction).toBe(1);
    expect(data.summary.missedAction).toBe(0);
    expect(data.summary.actionYield).toBeNull();
    expect(data.summary.agreement).toBeNull();
  });

  it("separates the four verified prediction outcomes and excludes pending cases", () => {
    const data = buildModBotStats(
      [
        report({ status: "OFFICIAL_WARNING" }),
        report(),
        report({ status: "BAN_ACTIVATED", predictedStatus: "REPORT_CLEARED" }),
        report({ predictedStatus: "REPORT_CLEARED" }),
        report({ status: "UNVIEWED" }),
      ],
      [],
      input,
      now,
    );
    expect(data.summary.supportedAction).toBe(1);
    expect(data.summary.unsupportedAction).toBe(1);
    expect(data.summary.missedAction).toBe(1);
    expect(data.summary.supportedClear).toBe(1);
    expect(data.summary.agreement).toBe(50);
    expect(data.summary.evaluated).toBe(4);
  });

  it("fills empty UTC periods and orders dates across a year boundary", () => {
    const data = buildModBotStats([report()], [], input, now);
    expect(data.trend.map((row) => row.date)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(data.trend[0]?.actionYield).toBeNull();
    const weekly = buildModBotStats(
      [report()],
      [],
      { ...input, interval: "weekly" },
      now,
    );
    expect(weekly.trend).toHaveLength(1);
    expect(weekly.trend[0]?.botTotal).toBe(1);
  });

  it("weights aggregated scan rows without attributing them to one report", () => {
    const data = buildModBotStats(
      [],
      [
        {
          createdAt: now,
          relationType: "comment",
          outcome: "GATE_CLEAR",
          flagged: false,
          promptVersion: "evidence-v1",
          count: 150000,
        },
      ],
      input,
      now,
    );
    expect(data.summary.scans).toBe(150000);
    expect(data.summary.GATE_CLEAR).toBe(150000);
    expect(data.trend.at(-1)?.scans).toBe(150000);
    expect(data.telemetryStart).toBe(now.toISOString());
  });
  it("filters canonical surfaces, includes all scan outcomes and limits the date window", () => {
    const scan = (
      outcome: Parameters<typeof buildModBotStats>[1][number]["outcome"],
    ) => ({
      createdAt: now,
      relationType: "forumPost" as const,
      outcome,
      flagged: outcome === "DECISION_CLEAR" || outcome === "REPORTED",
      promptVersion: "evidence-v1",
    });
    const data = buildModBotStats(
      [
        report({ system: "forum_comment" }),
        report(),
        report({ system: "forumPost", createdAt: new Date("2025-12-20") }),
      ],
      [
        scan("GATE_CLEAR"),
        scan("DECISION_CLEAR"),
        scan("REPORTED"),
        scan("ERROR"),
        scan("CHECKING"),
      ],
      { ...input, surface: "forum" },
      now,
    );
    expect(data.summary.botTotal).toBe(1);
    expect(data.summary.scans).toBe(5);
    expect(data.summary.flagged).toBe(2);
    expect(data.summary.ERROR).toBe(1);
    expect(data.summary.CHECKING).toBe(1);
    expect(data.telemetryStart).toBe(now.toISOString());
    expect(data.versions[0]?.scans).toBe(5);
  });
});
