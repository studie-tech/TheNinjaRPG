import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  formatClockTime,
  formatHoursMinutes,
  getLocalDateStringMonthsAgo,
} from "@/utils/time";

afterEach(() => {
  setSystemTime();
});

describe("formatClockTime", () => {
  it.each([
    [59_000, "00:59"],
    [65_000, "01:05"],
    [3_725_000, "01:02:05"],
    [86_399_000, "23:59:59"],
    [86_400_000, "1d 00:00:00"],
    [90_000_000, "1d 01:00:00"],
    [260_000_000, "3d 00:13:20"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatClockTime(ms)).toBe(expected);
  });
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
