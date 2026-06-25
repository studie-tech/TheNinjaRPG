import { describe, it, expect } from "vitest";
import { attemptCapReached } from "@/libs/quest";

const NOW = new Date("2026-06-24T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("attemptCapReached", () => {
  it("is never capped when attemptDelay is 'none', even with a just-now attempt", () => {
    expect(attemptCapReached({ attemptDelay: "none", lastAttemptAt: NOW }, NOW)).toBe(false);
  });

  it("is not capped when there is no prior attempt", () => {
    expect(attemptCapReached({ attemptDelay: "daily", lastAttemptAt: null }, NOW)).toBe(false);
    expect(attemptCapReached({ attemptDelay: "daily" }, NOW)).toBe(false);
  });

  it("is capped when the last attempt is within the current day", () => {
    expect(attemptCapReached({ attemptDelay: "daily", lastAttemptAt: ago(1 * HOUR) }, NOW)).toBe(true);
  });

  it("is not capped when the last attempt was a prior day", () => {
    expect(attemptCapReached({ attemptDelay: "daily", lastAttemptAt: ago(25 * HOUR) }, NOW)).toBe(false);
  });

  it("respects weekly periods", () => {
    expect(attemptCapReached({ attemptDelay: "weekly", lastAttemptAt: ago(1 * HOUR) }, NOW)).toBe(true);
    expect(attemptCapReached({ attemptDelay: "weekly", lastAttemptAt: ago(8 * DAY) }, NOW)).toBe(false);
  });

  it("respects monthly periods", () => {
    expect(attemptCapReached({ attemptDelay: "monthly", lastAttemptAt: ago(1 * HOUR) }, NOW)).toBe(true);
    expect(attemptCapReached({ attemptDelay: "monthly", lastAttemptAt: ago(40 * DAY) }, NOW)).toBe(false);
  });

  it("accepts a string timestamp", () => {
    expect(
      attemptCapReached({ attemptDelay: "daily", lastAttemptAt: ago(1 * HOUR).toISOString() }, NOW),
    ).toBe(true);
  });
});
