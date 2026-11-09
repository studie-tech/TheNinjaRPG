import { format } from "date-fns";
import type { RetryQuestDelay, TimeUnit } from "@/drizzle/constants";
import {
  BANK_INTEREST_CLAIM_DAYS,
  PET_FEED_COOLDOWN_HOURS,
  REGEN_SECONDS,
  SHRINE_BOOST_DURATION_HOURS,
  SHRINE_BOOST_SLOTS_PER_DAY,
  STEALTH_POST_COMBAT_COOLDOWN_SECONDS,
} from "@/drizzle/constants";
import { clamp } from "@/utils/math";
import type { ObjectiveTrackerType } from "@/validators/objectives";

/**
 * Enumerate sorted UTC starts at fixed spacing, including earliest when it is a slot.
 * Window days use Sunday = 0; the horizon counts calendar days from earliest's UTC date.
 * Window ends are exclusive and input dates are left unchanged.
 */
export const getWeeklyWindowSlots = (
  windows: { day: number; hour: number }[],
  earliest: Date,
  days: number,
  durationHours: number,
  slotMinutes: number,
) => {
  const slots: Date[] = [];
  const midnight = periodStart("daily", earliest);
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(midnight.getTime() + offset * 86_400_000);
    for (const window of windows.filter((w) => w.day === date.getUTCDay())) {
      for (let minute = 0; minute < durationHours * 60; minute += slotMinutes) {
        const slot = new Date(date.getTime() + (window.hour * 60 + minute) * 60_000);
        if (slot >= earliest) slots.push(slot);
      }
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
};

/** Calendar purchase periods follow UTC game time; weeks begin on Monday. */
export const getItemPurchasePeriodStart = (
  period: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY",
  now = new Date(),
) => {
  if (period === "NONE") return null;
  return periodStart(period.toLowerCase() as Lowercase<typeof period>, now);
};

/** Match MySQL NOW() precision when a timestamp must be returned with its write. */
export const getSecondPrecisionDate = (date = new Date()) =>
  new Date(Math.floor(date.getTime() / 1000) * 1000);

/**
 * Get game time which is the UTC HH:MM:SS timestring
 *
 * @returns The game time
 */
export const getGameTime = () => {
  const now = new Date();
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const minutes = now.getUTCMinutes().toString().padStart(2, "0");
  const seconds = now.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

/**
 * Number of seconds passed since the given date
 *
 * @param date - The date to calculate the seconds passed since; battle JSON columns
 *   carry it as an ISO string
 * @param timeDiff - The time difference in milliseconds
 * @param floor - Whether to floor the result
 * @returns The number of seconds passed since the given date
 */
export const secondsPassed = (date: Date | string, timeDiff?: number, floor = true) => {
  let now = Date.now();
  if (timeDiff) now = now - timeDiff;
  const parsedDate = date instanceof Date ? date : new Date(date);
  const rawPassedValue = (now - parsedDate.getTime()) / 1000;
  return floor ? Math.floor(rawPassedValue) : rawPassedValue;
};

/**
 * The given date plus the given number of seconds
 *
 * @param seconds - The number of seconds to add
 * @param date - The date to add the seconds to
 * @returns The date plus the given number of seconds
 */
export const secondsFromDate = (seconds: number, date: Date) => {
  return new Date(date.getTime() + seconds * 1000);
};

/** End of the stealth cooldown after leaving combat, on the column's whole-second clock. */
export const postCombatStealthCooldownAt = (settledAt: Date) =>
  new Date(
    Math.floor(settledAt.getTime() / 1000) * 1000 +
      STEALTH_POST_COMBAT_COOLDOWN_SECONDS * 1000,
  );

/** Whole regeneration ticks elapsed on the saved clock, adjusted for client/server time. */
export const regenTicksSince = (regenAt: Date, timeDiff?: number) =>
  Math.max(0, Math.floor(secondsPassed(regenAt, timeDiff) / REGEN_SECONDS));

/** Next regeneration tick anchored to the saved clock, adjusted for client/server time. */
export const nextRegenerationTickAt = (regenAt: Date, timeDiff?: number) =>
  secondsFromDate((regenTicksSince(regenAt, timeDiff) + 1) * REGEN_SECONDS, regenAt);

/**
 * Current date plus the given number of seconds
 */
export const secondsFromNow = (seconds: number) => {
  return secondsFromDate(seconds, new Date());
};

/**
 * Return the number of days, hours, minutes and seconds from a given number timestamp in  milliseconds
 */
export const getDaysHoursMinutesSeconds = (countDown: number) => {
  const days = Math.floor(countDown / (1000 * 60 * 60 * 24));
  const hours = Math.floor((countDown % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((countDown % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((countDown % (1000 * 60)) / 1000);
  return [days, hours, minutes, seconds] as const;
};

/** Return a string of how much time is left of a duration in milliseconds */
export const getTimeLeftStr = (ms: number) => {
  const [days, hours, minutes, seconds] = getDaysHoursMinutesSeconds(ms);
  if (days > 0) {
    return `${days} days, ${hours} hours`;
  } else if (hours > 0) {
    return `${hours} hours, ${minutes} mins`;
  } else if (minutes > 0) {
    return `${minutes} mins, ${seconds} secs`;
  } else if (seconds > 0) {
    return `${seconds} secs`;
  }
  return "0 seconds";
};

/**
 * Sleep for x number of milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((res) => setTimeout(res, ms));
};

/**
 * Adds the specified number of days to the given date
 *
 * @param {Date} date - The date to which the days should be added.
 * @param {number} days - The number of days to add.
 * @returns {Date} - The new date after adding the specified number of days.
 */
export const addDays = (date: Date, days: number) => {
  const newDate = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return newDate;
};

export const getCurrentSeason = () => {
  // Use UTC month to ensure consistent results between server and client
  // regardless of timezone differences
  const now = new Date();
  const month = now.getUTCMonth();
  switch (month) {
    case 11:
    case 0:
    case 1:
      return "winter";
    case 2:
    case 3:
    case 4:
      return "spring";
    case 5:
    case 6:
    case 7:
      return "summer";
    case 9:
      return "halloween";
    case 8:
    case 10:
      return "fall";
    default:
      return "summer";
  }
};

export const getMillisecondsFromTimeUnit = (timeUnit: TimeUnit) => {
  switch (timeUnit) {
    case "minutes":
      return 1000 * 60;
    case "hours":
      return 1000 * 60 * 60;
    case "days":
      return 1000 * 60 * 60 * 24;
    case "weeks":
      return 1000 * 60 * 60 * 24 * 7;
    case "months":
      return 1000 * 60 * 60 * 24 * 30;
    default:
      return 1000;
  }
};

/**
 * Convenience variables for time units
 */
export const MINUTE_S = 60;
export const HOUR_S = 60 * MINUTE_S;
export const DAY_S = 24 * HOUR_S;
export const WEEK_S = 7 * DAY_S;
export const MONTH_S = 30 * DAY_S;
export const YEAR_S = 365 * DAY_S;

/**
 * Check if two dates are on different days (UTC-based comparison)
 * This is more reliable than comparing getDate() which doesn't account for month/year differences
 */
export const isDifferentDay = (date1: Date, date2: Date): boolean =>
  periodStart("daily", date1).getTime() !== periodStart("daily", date2).getTime();

/**
 * Format a date to a short datetime string in "YYYY-MM-DD HH:MM" format (UTC)
 *
 * @param date - The date to format
 * @returns The formatted datetime string
 */
export const formatDateTimeShort = (date: Date): string => {
  return date.toISOString().replace("T", " ").slice(0, 16);
};

/** Format browser-local calendar time for a datetime-local input, without converting it to UTC. */
export const formatLocalDateTimeInput = (date: Date) =>
  format(date, "yyyy-MM-dd'T'HH:mm");

export const formatTimeAgo = (date: Date) => {
  const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "Just now";
  if (diffInSeconds < HOUR_S) return `${Math.floor(diffInSeconds / MINUTE_S)}m ago`;
  if (diffInSeconds < DAY_S) return `${Math.floor(diffInSeconds / HOUR_S)}h ago`;
  return `${Math.floor(diffInSeconds / DAY_S)}d ago`;
};

/**
 * Check if two dates are on the same day (UTC-based comparison)
 */
export const isSameDay = (date1: Date, date2: Date): boolean => {
  return !isDifferentDay(date1, date2);
};

/**
 * Browser-local yyyy-MM-dd for local midnight `months` ago, the value of a date input.
 * Month ends overflow as `Date.setMonth` does: May 31 minus 3 months is March 3.
 */
export const getLocalDateStringMonthsAgo = (months: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setMonth(date.getMonth() - months);
  return format(date, "yyyy-MM-dd");
};

/**
 * Check if a date is today (UTC-based comparison)
 */
export const isToday = (date: Date | null): boolean => {
  if (!date) return false;
  return isSameDay(date, new Date());
};

/**
 * Check if a date is within a given date range (inclusive)
 * @param start - Start date of the range (null means no lower bound)
 * @param end - End date of the range (null means no upper bound)
 */
export const isWithinDateRange = (start: Date | null, end: Date | null): boolean => {
  const now = new Date();
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
};

/**
 * Get a date key string in format YYYY-M-D for use in localStorage or caching
 * Uses UTC methods for consistency with other time utilities
 */
export const getDateKey = (date: Date): string => {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
};

/** Zero-padded UTC day (YYYY-MM-DD), the format of date columns; getDateKey is unpadded. */
export const getUtcDayKey = (now = new Date()) => now.toISOString().slice(0, 10);

/** Exclusive upper bound of a date range that includes its whole `YYYY-MM-DD` end day. */
export const getDateRangeEndExclusive = (endDate: string) =>
  addDays(new Date(endDate), 1);

/** Whether a date column's end has passed; availability stops at midnight UTC of that date. */
export const hasEndDatePassed = (endsAt?: string | null, now = new Date()) =>
  !!endsAt && new Date(endsAt) <= now;

/**
 * Return the next meal time, or null if this companion has never been fed.
 * The rolling cooldown is independent of battles and UTC day boundaries.
 */
export const getPetFeedAvailableAt = (lastFedAt: Date | null) =>
  lastFedAt ? secondsFromDate(PET_FEED_COOLDOWN_HOURS * HOUR_S, lastFedAt) : null;

/**
 * Format a duration in seconds to a human-readable string (e.g., "5m 30s", "2m", "45s")
 */
export const formatSecondsToTimeDisplay = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${totalSeconds}s`;
};

/**
 * Compact length such as "2h", "1h 30m" or "45m", rounded up to whole minutes. Under a
 * minute it reads as seconds.
 */
export const formatHoursMinutes = (totalSeconds: number): string => {
  if (totalSeconds < 60) return formatSecondsToTimeDisplay(totalSeconds);
  const totalMinutes = Math.ceil(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

/** Clock-style time left: "MM:SS", "HH:MM:SS" from one hour up, "1d HH:MM:SS" from one day. */
export const formatClockTime = (ms: number): string => {
  const [days, hours, minutes, seconds] = getDaysHoursMinutesSeconds(ms);
  const parts = days > 0 || hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];
  const clock = parts.map((part) => part.toString().padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
};

/**
 * Length of a sound clip, e.g. "2.5 s". Epidemic Sound reports whole seconds, so a clip
 * shorter than one second arrives as 0.
 */
export const formatSoundLength = (lengthMs: number) =>
  lengthMs < 1000 ? "under 1 s" : `${(lengthMs / 1000).toFixed(1)} s`;

/**
 * Get the first day of the next month at midnight UTC
 * Used for monthly reset countdowns
 */
export const getFirstOfNextMonth = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
};

/**
 * Returns the slot index (0–11) for a given UTC hour (0–23).
 * Each slot covers a 2-hour window: slot 0 = 00:00–02:00, slot 11 = 22:00–00:00.
 * Non-finite, negative, or out-of-range inputs are clamped so the result is
 * always within 0–11.
 */
export const getSlotIndex = (utcHour: number): number => {
  if (!Number.isFinite(utcHour)) return 0;
  return clamp(
    Math.floor(utcHour / SHRINE_BOOST_DURATION_HOURS),
    0,
    SHRINE_BOOST_SLOTS_PER_DAY - 1,
  );
};

/**
 * Returns a Date set to the start of the 2-hour UTC slot containing `d`.
 * Minutes, seconds, and milliseconds are zeroed.
 */
export const getCurrentSlotBoundary = (d: Date = new Date()): Date => {
  const boundary = new Date(d);
  boundary.setUTCHours(
    Math.floor(d.getUTCHours() / SHRINE_BOOST_DURATION_HOURS) *
      SHRINE_BOOST_DURATION_HOURS,
    0,
    0,
    0,
  );
  return boundary;
};

/**
 * Returns true if a slot boundary falls in the half-open window (prevTime, now].
 * Use this in the cron to determine whether a new slot just started,
 * even if the cron fired slightly late.
 */
export const isNewSlotDue = (now: Date, prevTime: Date): boolean => {
  const boundary = getCurrentSlotBoundary(now);
  return boundary > prevTime && boundary <= now;
};

/**
 * UTC calendar period start for a quest retry delay.
 * daily = midnight UTC; weekly = Monday 00:00 UTC (ISO week); monthly = 1st 00:00 UTC.
 */
export const periodStart = (
  delay: Exclude<RetryQuestDelay, "none">,
  now: Date,
): Date => {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (delay === "daily") return new Date(Date.UTC(y, m, d));
  if (delay === "monthly") return new Date(Date.UTC(y, m, 1));
  // weekly: back up to Monday (getUTCDay: 0=Sun..6=Sat)
  const dow = now.getUTCDay();
  const deltaToMonday = (dow + 6) % 7; // Sun→6, Mon→0, Tue→1, ...
  return new Date(Date.UTC(y, m, d - deltaToMonday));
};

/** Inclusive UTC dates eligible for bank interest: today and the preceding days. */
export const getBankInterestDateRange = (now = new Date()) => {
  const oldest = new Date(now);
  oldest.setUTCDate(oldest.getUTCDate() - (BANK_INTEREST_CLAIM_DAYS - 1));
  return {
    oldestDate: getUtcDayKey(oldest),
    today: getUtcDayKey(now),
  };
};

/** Next UTC daily reset, used to refresh calendar-based eligibility. */
export const nextUtcDayAt = (now = new Date()) =>
  new Date(periodStart("daily", now).getTime() + DAY_S * 1000);

/** UTC key shared by monthly Skills and Bloodright reset claims. */
export const getUtcMonthKey = (now = new Date()) => now.toISOString().slice(0, 7);

/** Start of a UTC calendar window including today and the preceding days. */
export const getUtcDayWindowStart = (days: number, now = new Date()) =>
  new Date(periodStart("daily", now).getTime() - (days - 1) * DAY_S * 1000);
/** Number of calendar months between two UTC month keys. */
export const getUtcMonthDistance = (from: string, to: string) => {
  const [fromYear = 0, fromMonth = 0] = from.split("-").map(Number);
  const [toYear = 0, toMonth = 0] = to.split("-").map(Number);
  return Math.max(0, (toYear - fromYear) * 12 + toMonth - fromMonth);
};
/**
 * Apply a percentage reduction after existing modifiers, with a one-second minimum.
 * Round up once so farm responses and queued jobs retain whole-second durations.
 * No bonus preserves the original duration, including fractional-second legacy timers.
 */
export const reduceActivitySeconds = (existingSeconds: number, reductionPercent = 0) =>
  reductionPercent === 0
    ? existingSeconds
    : Math.max(1, Math.ceil(existingSeconds * (1 - reductionPercent / 100)));

/**
 * Share the saved collection deadline between server guards and client countdowns.
 * Older trackers without a snapshot retain their original configured duration.
 * Return null before collection starts or when the objective is untimed.
 */
export const getCollectDeadline = (
  progress: Pick<ObjectiveTrackerType, "timestamp" | "collectDeadline">,
  configuredMinutes: number,
) =>
  progress.timestamp && configuredMinutes > 0
    ? new Date(
        progress.collectDeadline ??
          new Date(Date.parse(progress.timestamp) + configuredMinutes * 60_000),
      )
    : null;

/** Always advances a millisecond-precision snapshot, even within the same clock tick. */
export const getNextUserSnapshotAt = (updatedAt: Date, now = new Date()) =>
  new Date(Math.max(now.getTime(), updatedAt.getTime() + 1));
