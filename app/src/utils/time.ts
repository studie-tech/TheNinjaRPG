import type { TimeUnit } from "@/drizzle/constants";

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
 * Get time since last reset which is in YYYY-MM-DDTHH:mm:ss.sssZ format
 *
 * @returns The time since last reset
 */
export const getTimeOfLastReset = () => {
  const date = new Date();
  const now_utc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
  );
  return new Date(now_utc);
};

/**
 * Number of seconds passed since the given date
 *
 * @param date - The date to calculate the seconds passed since
 * @param timeDiff - The time difference in milliseconds
 * @param floor - Whether to floor the result
 * @returns The number of seconds passed since the given date
 */
export const secondsPassed = (date: Date, timeDiff?: number, floor = true) => {
  let now = new Date().getTime();
  if (timeDiff) now = now - timeDiff;
  const parsedDate = date instanceof Date ? date : new Date(date);
  const rawPassedValue = (now - parsedDate.getTime()) / 1000;
  return floor ? Math.floor(rawPassedValue) : rawPassedValue;
};

/**
 * Current date plus the given number of seconds
 *
 * @param seconds - The number of seconds to add
 * @param date - The date to add the seconds to
 * @returns The date plus the given number of seconds
 */
export const secondsFromDate = (seconds: number, date: Date) => {
  return new Date(date.getTime() + seconds * 1000);
};

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

/** Return a string of how much time left */
export const getTimeLeftStr = (
  days: number,
  hours: number,
  minutes: number,
  seconds: number,
) => {
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
export const sleep = (ms: number) => {
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
 * Get the week number of the given date
 */
export const getWeekNumber = (date: Date) => {
  const yearStart = +new Date(date.getFullYear(), 0, 1);
  const today = +new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = (today - yearStart + 1) / 86400000;
  return Math.ceil(dayOfYear / 7).toString();
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
export const isDifferentDay = (date1: Date, date2: Date): boolean => {
  const utc1 = new Date(
    date1.getUTCFullYear(),
    date1.getUTCMonth(),
    date1.getUTCDate(),
  );
  const utc2 = new Date(
    date2.getUTCFullYear(),
    date2.getUTCMonth(),
    date2.getUTCDate(),
  );
  return utc1.getTime() !== utc2.getTime();
};

/**
 * Format a date to a short datetime string in "YYYY-MM-DD HH:MM" format (UTC)
 *
 * @param date - The date to format
 * @returns The formatted datetime string
 */
export const formatDateTimeShort = (date: Date): string => {
  return date.toISOString().replace("T", " ").slice(0, 16);
};

/**
 * Combine a date and time string (HH:MM) into a single Date object
 *
 * @param date - The date to use
 * @param timeHHMM - The time string in "HH:MM" format
 * @returns A new Date with the combined date and time
 */
export const combineLocalDateTime = (date: Date, timeHHMM: string): Date => {
  const [hhStr = "00", mmStr = "00"] = timeHHMM.split(":");
  const out = new Date(date);
  out.setHours(parseInt(hhStr, 10), parseInt(mmStr, 10), 0, 0);
  return out;
};

/**
 * Check if two dates are on the same day (UTC-based comparison)
 */
export const isSameDay = (date1: Date, date2: Date): boolean => {
  return !isDifferentDay(date1, date2);
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
 * Number of hours elapsed since a given date
 */
export const hoursSince = (date: Date | null): number => {
  if (!date) return Infinity;
  const now = new Date();
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
};

/**
 * Get a date key string in format YYYY-M-D for use in localStorage or caching
 * Uses UTC methods for consistency with other time utilities
 */
export const getDateKey = (date: Date): string => {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
};
