// app/tests/libs/quest.periodcap.test.ts
import { describe, it, expect } from "vitest";
import { periodCapReached } from "@/libs/quest";

const NOW = new Date("2026-06-19T12:00:00Z"); // Fri; week start Mon 2026-06-15

describe("periodCapReached", () => {
  it("none → never capped", () => {
    expect(periodCapReached({ retryDelay: "none", maxCompletes: 1, periodCompletes: 99, periodStartAt: NOW }, NOW)).toBe(false);
  });
  it("maxCompletes<=0 → uncapped", () => {
    expect(periodCapReached({ retryDelay: "weekly", maxCompletes: 0, periodCompletes: 5, periodStartAt: NOW }, NOW)).toBe(false);
  });
  it("weekly, completes in current period >= max → capped", () => {
    expect(periodCapReached({ retryDelay: "weekly", maxCompletes: 1, periodCompletes: 1, periodStartAt: new Date("2026-06-15T00:00:00Z") }, NOW)).toBe(true);
  });
  it("weekly, completes from a PRIOR period → not capped (stale count ignored)", () => {
    expect(periodCapReached({ retryDelay: "weekly", maxCompletes: 1, periodCompletes: 5, periodStartAt: new Date("2026-06-08T00:00:00Z") }, NOW)).toBe(false);
  });
  it("null periodStartAt → not capped", () => {
    expect(periodCapReached({ retryDelay: "daily", maxCompletes: 1, periodCompletes: 0, periodStartAt: null }, NOW)).toBe(false);
  });
});
