import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { KAGE_MAX_ELDERS } from "@/drizzle/constants";
import {
  isElderCandidateWithoutCutoff,
  rankElderCandidates,
  tallyElderVotes,
} from "@/libs/elder";

const clan = (id: string, activityPoints: number, points = 0, month?: number) => ({
  id,
  activityPoints,
  points,
  elderCutoffMonth: month ?? null,
  elderCutoffYear: month ? 2026 : null,
});

describe("nominateElder eligibility message", () => {
  it("names the candidate count from the constant the ranking slices by", () => {
    const router = readFileSync(
      new URL("../../src/server/api/routers/clan.ts", import.meta.url),
      "utf8",
    );
    expect(router).toContain("not in top ${KAGE_MAX_ELDERS} by activity points");
  });
});

describe("rankElderCandidates", () => {
  it("orders by activity then points and leaves idle clans out", () => {
    const ranked = rankElderCandidates([
      clan("idle", 0, 999),
      clan("second", 5, 1),
      clan("first", 5, 2),
      clan("top", 9),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["top", "first", "second"]);
  });

  it("stops at the elder seats", () => {
    const clans = Array.from({ length: KAGE_MAX_ELDERS + 2 }, (_, i) =>
      clan(`clan-${i}`, i + 1),
    );
    expect(rankElderCandidates(clans)).toHaveLength(KAGE_MAX_ELDERS);
  });

  it("does not reorder its input", () => {
    const clans = [clan("low", 1), clan("high", 2)];
    rankElderCandidates(clans);
    expect(clans.map((c) => c.id)).toEqual(["low", "high"]);
  });
});

describe("isElderCandidateWithoutCutoff", () => {
  it("ranks live when the village has no snapshot this month", () => {
    const clans = [clan("active", 3), clan("last-month", 1, 0, 9)];
    expect(isElderCandidateWithoutCutoff(clans, "active", 10, 2026)).toBe(true);
  });

  it("refuses an idle clan the rotation would never promote", () => {
    expect(isElderCandidateWithoutCutoff([clan("idle", 0)], "idle", 10, 2026)).toBe(
      false,
    );
  });

  it("treats an existing snapshot as final for the whole village", () => {
    const clans = [clan("climbed", 9), clan("snapshotted", 1, 0, 10)];
    expect(isElderCandidateWithoutCutoff(clans, "climbed", 10, 2026)).toBe(false);
  });
});

describe("tallyElderVotes", () => {
  const entries = [
    { userId: "a", vote: "YES" },
    { userId: "b", vote: "YES" },
    { userId: "c", vote: "NO" },
  ];

  it("counts every ballot by default", () => {
    expect(tallyElderVotes(entries)).toEqual({ yes: 2, no: 1 });
  });

  it("counts only the electorate when given", () => {
    expect(tallyElderVotes(entries, new Set(["a", "c"]))).toEqual({ yes: 1, no: 1 });
  });
});
