import type { ReactNode } from "react";
import { createElement, Fragment } from "react";
import type { AttackMethod, AttackTarget, BattleUsageType } from "@/drizzle/constants";

/** Swap whole words for components; each swap is keyed by position, so a word may repeat. */
export const insertComponentsIntoText = (
  text: string,
  replacements: Record<string, ReactNode>,
) => {
  const splitRegex = new RegExp(/(\w*)/g);
  const parts = text.split(splitRegex);
  return parts.map((part, index) => {
    if (Object.hasOwn(replacements, part)) {
      return createElement(Fragment, { key: index }, replacements[part]);
    }
    return part;
  });
};

export const capitalizeFirstLetter = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
};

/**
 * Readable words for a constant such as "CONTENT-ADMIN" or "ACTIVITY_STREAK_RECURRING".
 * Text that is not an upper-case constant, e.g. a staff-written reason, is returned as is.
 */
export const humanizeConstant = (value: string) =>
  /^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/.test(value)
    ? value.split(/[_-]/).map(capitalizeFirstLetter).join(" ")
    : value;

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

/** Sentence-case label for an upper snake case enum value ("FIST_WEAPON" -> "Fist weapon"). */
export const formatEnumLabel = (value: string): string =>
  capitalizeFirstLetter(value.replaceAll("_", " "));

const ATTACK_TARGET_LABELS: Record<AttackTarget, string> = {
  SELF: "Self",
  OTHER_USER: "Other player",
  OPPONENT: "Opponent",
  ALLY: "Ally",
  CHARACTER: "Any character",
  GROUND: "Ground",
  EMPTY_GROUND: "Empty ground",
};

/** Player-facing name of who or what an attack can target. */
export const formatAttackTarget = (target: AttackTarget): string =>
  ATTACK_TARGET_LABELS[target];

const ATTACK_METHOD_LABELS: Record<AttackMethod, string> = {
  SINGLE: "Single target",
  ALL: "All targets",
  AOE_CIRCLE_SPAWN: "Area: circle around target",
  AOE_LINE_SHOOT: "Area: line",
  AOE_WALL_SHOOT: "Area: wall",
  AOE_LARGE_WALL_SHOOT: "Area: large wall",
  AOE_CIRCLE_SHOOT: "Area: circle shot",
  AOE_SPIRAL_SHOOT: "Area: spiral",
  COORDINATES: "Chosen tiles",
};

/** Player-facing name of how an attack reaches its targets. */
export const formatAttackMethod = (method: AttackMethod): string =>
  ATTACK_METHOD_LABELS[method];

/** One-decimal percentage, or a dash when there is no value. */
export const formatPercent = (value: number | null) =>
  value == null ? "—" : `${value.toFixed(1)}%`;

/**
 * Plain preview of stored rich text: block boundaries become sentence breaks (". " unless the
 * block already ends in punctuation), other tags become spaces, common entities are decoded in
 * one pass and whitespace collapses. A light client stand-in for `htmlToPlainText`, which pulls
 * sanitize-html into the bundle. Decoded text can contain `<`: render it as text, never as HTML.
 */
export const stripHtmlPreview = (html: string | null) =>
  (html ?? "")
    .replace(PREVIEW_BLOCK_BOUNDARY, "\u0000")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|#39);/g,
      (entity) => PREVIEW_ENTITIES[entity] ?? entity,
    )
    .split("\u0000")
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .reduce(
      (text, block) =>
        text ? `${text}${/[.!?:;…]["')\]]?$/.test(text) ? " " : ". "}${block}` : block,
      "",
    );

/** Closing block tags, which separate sentences in a preview. */
const PREVIEW_BLOCK_BOUNDARY = /<\/(?:p|div|h[1-6]|li|blockquote|pre|tr|ul|ol)\s*>/gi;

const PREVIEW_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * Truncate a string to maximumLength, appending an indicator if truncated.
 * @param text - The string to truncate
 * @param maximumLength - Maximum length including the indicator
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
