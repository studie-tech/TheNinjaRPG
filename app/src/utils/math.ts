/**
 * min and max included
 */
export const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

/**
 * Rounds a number to a specified number of decimal places.
 * @param value - The number to round.
 * @param decimals - The number of decimal places to round to.
 * @returns The rounded number.
 */
export const round = (value: number, decimals = 2) => {
  return Number(Math.round(Number(value + "e" + decimals)) + "e-" + decimals);
};

/**
 * Calculates percentage clamped between 0 and 100.
 * @param current - The current value.
 * @param max - The maximum value (divisor). Defaults to 1 if 0 to avoid division by zero.
 * @returns The percentage value between 0 and 100.
 */
export const calculatePercent = (current: number, max: number): number => {
  const safeMax = max || 1;
  return Math.min(100, Math.max(0, (current / safeMax) * 100));
};
