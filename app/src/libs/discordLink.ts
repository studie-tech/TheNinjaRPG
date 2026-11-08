import {
  DISCORD_MAX_CHARACTERS_PER_ACCOUNT,
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_NICKNAME_MAX_LENGTH,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import { addDays } from "@/utils/time";

/**
 * Outcomes of the Discord linking flow. The OAuth callback redirects to
 * `/discord/link?result=<code>`, and the page renders the matching explanation.
 */
export const DiscordLinkResults = [
  "linked",
  "linked_second",
  "relinked",
  "discord_full",
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
  /** Masked usernames of the characters the Discord account is linked to. */
  hint?: string;
  /** When the cooldown or account-age requirement is met, as an ISO date. */
  until?: string;
  /** The link reused the player's Discord sign-in instead of a consent screen. */
  automatic?: boolean;
};

/** Shown wherever a link was made from the player's Discord sign-in. */
export const DISCORD_AUTOMATIC_LINK_TEXT =
  "Linked automatically from your Discord sign-in.";

/**
 * Start of the sync error stored when the link no longer has a usable Discord token (the
 * player removed Discord from their sign-in methods, revoked the app, or the scope is gone);
 * the profile then asks them to re-link.
 */
export const DISCORD_RELINK_REQUIRED = "Discord authorization missing";

export const needsDiscordRelink = (syncError: string | null | undefined) =>
  !!syncError?.includes(DISCORD_RELINK_REQUIRED);

/** Start of the action log message recording a new link's abuse flags; staff find flags by it. */
export const DISCORD_LINK_FLAG_PREFIX = "Discord link flag";

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
        description: `${details.automatic ? `${DISCORD_AUTOMATIC_LINK_TEXT} ` : ""}Your Discord account is now linked to your character. Return to Discord: the Verified Ninja role unlocks the server channels.`,
      };
    case "linked_second":
      return {
        success: true,
        title: "Second character linked",
        description: `${details.automatic ? `${DISCORD_AUTOMATIC_LINK_TEXT} ` : ""}This Discord account is now linked to two characters. Your other character stays primary for your server nickname and village role; you can switch that in profile settings.`,
      };
    case "relinked":
      return {
        success: true,
        title: "Already linked",
        description: `${details.automatic ? `${DISCORD_AUTOMATIC_LINK_TEXT} ` : ""}This Discord account was already linked to your character. Your Discord roles and nickname have been refreshed.`,
      };
    case "discord_full":
      return {
        success: false,
        title: "Discord account full",
        description: `This Discord account is already linked to ${DISCORD_MAX_CHARACTERS_PER_ACCOUNT} characters${details.hint ? ` (${details.hint})` : ""}, the most allowed. Unlink one of them first.`,
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
        description: `After unlinking, a character must wait ${DISCORD_UNLINK_COOLDOWN_DAYS} days before linking a different Discord account, and a Discord account cannot be linked to more than ${DISCORD_MAX_CHARACTERS_PER_ACCOUNT} different characters within ${DISCORD_UNLINK_COOLDOWN_DAYS} days.${untilText ? ` You can link again from ${untilText}.` : ""}`,
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
          "This Discord account cannot be linked because of an active sanction on it or on a character linked to it. Contact a moderator through a support ticket if you believe this is a mistake.",
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
  addDays(createdAt, DISCORD_MIN_ACCOUNT_AGE_DAYS);

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
