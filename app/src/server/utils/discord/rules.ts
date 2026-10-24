import { DISCORD_UNLINK_COOLDOWN_DAYS } from "@/drizzle/constants";
import type { DiscordLink, DiscordLinkHistory } from "@/drizzle/schema";
import {
  type DiscordLinkResult,
  type DiscordLinkResultDetails,
  discordAccountEligibleAt,
  maskName,
} from "@/libs/discordLink";

/** Everything the linking rules read, loaded upfront by the callback. */
export type DiscordLinkCandidate = {
  userId: string;
  discordId: string;
  discordCreatedAt: Date;
  /** The character, or null when the account has none. */
  character: { isBanned: boolean } | null;
  /** True while a ban, or a ban or silence long enough to count as indefinite, runs. */
  hasBlockingSanction: boolean;
  /** True when a deleted, sanctioned account's tombstone holds this Discord id. */
  matchesSanctionTombstone: boolean;
  linkForUser: Pick<DiscordLink, "discordId"> | null;
  linkForDiscord: (Pick<DiscordLink, "userId"> & { username: string | null }) | null;
  /** Ended links of this character and of this Discord account, any order. */
  history: Pick<
    DiscordLinkHistory,
    "userId" | "discordId" | "unlinkedAt" | "cooldownWaived"
  >[];
};

export type DiscordLinkDecision =
  | { allowed: true; relink: boolean }
  | ({ allowed: false; result: DiscordLinkResult } & DiscordLinkResultDetails);

const COOLDOWN_MS = DISCORD_UNLINK_COOLDOWN_DAYS * 86_400_000;

/**
 * Decide whether a character may link a Discord account. One active link per character and
 * per Discord account is enforced by unique keys as well; these checks turn the common cases
 * into explanations and add the age, cooldown and sanction rules.
 */
export const evaluateDiscordLink = (
  candidate: DiscordLinkCandidate,
  now = new Date(),
): DiscordLinkDecision => {
  if (!candidate.character) return { allowed: false, result: "no_character" };
  if (candidate.character.isBanned || candidate.hasBlockingSanction)
    return { allowed: false, result: "banned" };
  if (candidate.matchesSanctionTombstone) return { allowed: false, result: "blocked" };
  const sameLink =
    candidate.linkForUser?.discordId === candidate.discordId &&
    candidate.linkForDiscord?.userId === candidate.userId;
  if (sameLink) return { allowed: true, relink: true };
  if (candidate.linkForDiscord && candidate.linkForDiscord.userId !== candidate.userId)
    return {
      allowed: false,
      result: "linked_elsewhere",
      hint: candidate.linkForDiscord.username
        ? maskName(candidate.linkForDiscord.username)
        : undefined,
    };
  if (candidate.linkForUser) return { allowed: false, result: "character_has_link" };
  const eligibleAt = discordAccountEligibleAt(candidate.discordCreatedAt);
  if (eligibleAt > now)
    return { allowed: false, result: "too_new", until: eligibleAt.toISOString() };
  // Relinking the same pair is always allowed; a different partner waits out the cooldown.
  const blocking = candidate.history.filter(
    (entry) =>
      !entry.cooldownWaived &&
      entry.unlinkedAt.getTime() + COOLDOWN_MS > now.getTime() &&
      ((entry.userId === candidate.userId && entry.discordId !== candidate.discordId) ||
        (entry.discordId === candidate.discordId && entry.userId !== candidate.userId)),
  );
  if (blocking.length > 0) {
    const latest = Math.max(...blocking.map((entry) => entry.unlinkedAt.getTime()));
    return {
      allowed: false,
      result: "cooldown",
      until: new Date(latest + COOLDOWN_MS).toISOString(),
    };
  }
  return { allowed: true, relink: false };
};
