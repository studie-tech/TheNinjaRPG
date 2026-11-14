import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  formatClockTime,
  formatDateTime,
  formatHoursMinutes,
  getLocalDateStringMonthsAgo,
  getTimeLeftStr,
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

describe("formatDateTime", () => {
  it("shows local date and time to the minute", () => {
    expect(formatDateTime(new Date(2026, 10, 11, 15, 4, 59))).toBe(
      "Nov 11, 2026, 3:04 PM",
    );
  });
});

describe("getTimeLeftStr", () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const label = getTimeLeftStr;

  it("shows the two largest units from the first one set", () => {
    expect(label(2 * DAY + 3 * HOUR + 4 * MINUTE)).toBe("2 days, 3 hours");
    expect(label(DAY)).toBe("1 day, 0 hours");
    expect(label(DAY + HOUR)).toBe("1 day, 1 hour");
    expect(label(HOUR + MINUTE + SECOND)).toBe("1 hour, 1 min");
    expect(label(MINUTE + SECOND)).toBe("1 min, 1 sec");
    expect(label(SECOND)).toBe("1 sec");
    expect(label(3 * HOUR + 4 * MINUTE + 5 * SECOND)).toBe("3 hours, 4 mins");
    expect(label(4 * MINUTE + 5 * SECOND)).toBe("4 mins, 5 secs");
    expect(label(5 * SECOND + 999)).toBe("5 secs");
  });

  it("reads zero below a second and once time has passed", () => {
    expect(label(999)).toBe("0 seconds");
    expect(label(0)).toBe("0 seconds");
    expect(label(-5 * SECOND)).toBe("0 seconds");
  });
});
