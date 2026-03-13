import type { BattleUsageType } from "@/drizzle/constants";

export const insertComponentsIntoText = (
  text: string,
  replacements: Record<string, React.ReactNode>,
) => {
  const splitRegex = new RegExp(/(\w*)/g);
  const parts = text.split(splitRegex);
  return parts.map((part) => {
    if (Object.hasOwn(replacements, part)) {
      return replacements[part];
    }
    return part;
  });
};

/**
 * Also removes thousands and replace with k, m, b, t, etc.
 * @param number
 * @returns
 */
export const prettyNumber = (number: number) => {
  if (number < 1000) return number;
  if (number < 1000000) return `${Math.floor(number / 1000)}k`;
  if (number < 1000000000) return `${Math.floor(number / 1000000)}m`;
  return `${Math.floor(number / 1000000000)}b`;
};

/**
 * Formats a battle usage type for display.
 * Maps "BOTH" to "PVP & PVE" for better readability.
 * @param battleUsageType - The battle usage type to format
 * @returns The formatted label
 */
export const formatBattleUsageType = (battleUsageType: BattleUsageType): string => {
  return battleUsageType === "BOTH" ? "PVP & PVE" : battleUsageType;
};

/**
 * Truncate a string to maxLength, appending an indicator if truncated.
 * @param text - The string to truncate
 * @param maxLength - Maximum length including the indicator
 * @param indicator - The truncation indicator (default: "...")
 * @returns The truncated string
 */
export const truncateString = (
  text: string,
  maximumLength: number,
  indicator: string = "...",
): string => {
  if (maximumLength <= 0) return "";
  if (text.length <= maximumLength) return text;
  if (maximumLength <= indicator.length) return text.slice(0, maximumLength);
  return `${text.slice(0, maximumLength - indicator.length)}${indicator}`;
};
