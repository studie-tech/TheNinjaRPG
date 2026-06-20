import { describe, it, expect } from "vitest";
import { periodCompletionSet } from "@/libs/quest";

describe("periodCompletionSet", () => {
  it("none → no period fields", () => {
    expect(periodCompletionSet("none", new Date())).toEqual({});
  });
  it("weekly → returns cps and a flag to drive the SQL CASE", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const r = periodCompletionSet("weekly", now);
    expect(r.cps?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
});
