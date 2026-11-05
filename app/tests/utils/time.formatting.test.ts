import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { formatHoursMinutes, getLocalDateStringMonthsAgo } from "@/utils/time";

afterEach(() => {
  setSystemTime();
});

describe("formatHoursMinutes", () => {
  it.each([
    [45, "45s"],
    [60, "1m"],
    [61, "2m"],
    [90 * 60, "1h 30m"],
    [3600, "1h"],
    [7200, "2h"],
  ])("formats %p seconds as %s", (seconds, text) => {
    expect(formatHoursMinutes(seconds)).toBe(text);
  });

  it("carries rounded minutes into the hour", () => {
    expect(formatHoursMinutes(3599)).toBe("1h");
    expect(formatHoursMinutes(7199)).toBe("2h");
  });
});

describe("getLocalDateStringMonthsAgo", () => {
  it("returns a padded local date", () => {
    setSystemTime(new Date(2026, 2, 5, 23, 30));
    expect(getLocalDateStringMonthsAgo(1)).toBe("2026-02-05");
  });

  it("overflows month ends like Date.setMonth", () => {
    setSystemTime(new Date(2026, 4, 31, 12));
    expect(getLocalDateStringMonthsAgo(3)).toBe("2026-03-03");
  });
});
