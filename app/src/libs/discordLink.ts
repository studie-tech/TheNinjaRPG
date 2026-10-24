import {
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_NICKNAME_MAX_LENGTH,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";

/**
 * Outcomes of the Discord linking flow. The OAuth callback redirects to
 * `/discord/link?result=<code>`, and the page renders the matching explanation.
 */
export const DiscordLinkResults = [
  "linked",
  "relinked",
  "linked_elsewhere",
  "character_has_link",
  "too_new",
  "cooldown",
  "banned",
  "blocked",
  "no_character",
  "signed_out",
  "cancelled",
  "invalid_state",
  "disabled",
  "error",
] as const;
export type DiscordLinkResult = (typeof DiscordLinkResults)[number];

export const isDiscordLinkResult = (value: unknown): value is DiscordLinkResult =>
  typeof value === "string" &&
  (DiscordLinkResults as readonly string[]).includes(value);

/** Optional details a result page may show; never another player's full name. */
export type DiscordLinkResultDetails = {
  /** Masked username of the character the Discord account is linked to. */
  hint?: string;
  /** When the cooldown or account-age requirement is met, as an ISO date. */
  until?: string;
};

type ResultCopy = { title: string; description: string; success: boolean };

/** Player-facing copy for each result. */
export const describeDiscordLinkResult = (
  result: DiscordLinkResult,
  details: DiscordLinkResultDetails = {},
): ResultCopy => {
  const until = details.until ? new Date(details.until) : null;
  const untilText =
    until && !Number.isNaN(until.getTime()) ? until.toUTCString().slice(5, 16) : null;
  switch (result) {
    case "linked":
      return {
        success: true,
        title: "Discord linked",
        description:
          "Your Discord account is now linked to your character. Return to Discord: the Verified Ninja role unlocks the server channels.",
      };
    case "relinked":
      return {
        success: true,
        title: "Already linked",
        description:
          "This Discord account was already linked to your character. Your Discord roles and nickname have been refreshed.",
      };
    case "linked_elsewhere":
      return {
        success: false,
        title: "Linked to another character",
        description: `This Discord account is already linked to another character${details.hint ? ` (${details.hint})` : ""}. Each Discord account can be linked to one character only. Unlink it from that character first.`,
      };
    case "character_has_link":
      return {
        success: false,
        title: "Character already linked",
        description:
          "Your character is already linked to a different Discord account. Unlink it in your profile settings first.",
      };
    case "too_new":
      return {
        success: false,
        title: "Discord account too new",
        description: `Discord accounts must be at least ${DISCORD_MIN_ACCOUNT_AGE_DAYS} days old before they can be linked.${untilText ? ` This account can be linked from ${untilText}.` : ""}`,
      };
    case "cooldown":
      return {
        success: false,
        title: "Unlink cooldown",
        description: `After unlinking, a character and a Discord account must wait ${DISCORD_UNLINK_COOLDOWN_DAYS} days before linking to a different partner.${untilText ? ` You can link again from ${untilText}.` : ""}`,
      };
    case "banned":
      return {
        success: false,
        title: "Character sanctioned",
        description:
          "Banned characters, and characters with an indefinite silence, cannot link a Discord account.",
      };
    case "blocked":
      return {
        success: false,
        title: "Discord account blocked",
        description:
          "This Discord account cannot be linked because of an active sanction. Contact a moderator through a support ticket if you believe this is a mistake.",
      };
    case "no_character":
      return {
        success: false,
        title: "No character",
        description: "Create a character before linking your Discord account.",
      };
    case "signed_out":
      return {
        success: false,
        title: "Sign in first",
        description: "Sign in to TheNinja-RPG, then start linking again.",
      };
    case "cancelled":
      return {
        success: false,
        title: "Linking cancelled",
        description:
          "Discord did not authorize the link. You can try again at any time.",
      };
    case "invalid_state":
      return {
        success: false,
        title: "Link expired",
        description:
          "The linking request expired or was started in another browser. Start again from this page.",
      };
    case "disabled":
      return {
        success: false,
        title: "Linking unavailable",
        description: "Discord linking is not available right now.",
      };
    case "error":
      return {
        success: false,
        title: "Something went wrong",
        description: "Discord could not be reached. Please try again in a few minutes.",
      };
  }
};

/** Discord snowflakes encode milliseconds since the Discord epoch in their upper bits. */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/** Creation time of a Discord account, read from its snowflake id. */
export const discordSnowflakeCreatedAt = (snowflake: string): Date => {
  if (!/^\d{1,20}$/.test(snowflake)) throw new Error("Invalid Discord snowflake");
  return new Date(Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH_MS));
};

/** The earliest time a Discord account created at `createdAt` may be linked. */
export const discordAccountEligibleAt = (createdAt: Date) =>
  new Date(createdAt.getTime() + DISCORD_MIN_ACCOUNT_AGE_DAYS * 86_400_000);

/**
 * Keep the first and last character so the owner recognizes the name without revealing it to
 * whoever is trying to link the same Discord account.
 */
export const maskName = (name: string) => {
  const chars = [...name];
  if (chars.length <= 2) return "*".repeat(Math.max(chars.length, 1));
  return `${chars[0]}${"*".repeat(Math.min(chars.length - 2, 6))}${chars[chars.length - 1]}`;
};

/** Guild nickname for a character; Discord limits nicknames to 32 characters. */
export const discordNicknameFor = (username: string) =>
  [...username].slice(0, DISCORD_NICKNAME_MAX_LENGTH).join("");
