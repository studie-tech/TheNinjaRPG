import { describe, expect, it } from "bun:test";
import {
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import { type DiscordLinkCandidate, evaluateDiscordLink } from "@/server/utils/discord/rules";

const DAY = 86_400_000;
const NOW = new Date("2026-10-24T12:00:00.000Z");

const candidate = (overrides: Partial<DiscordLinkCandidate> = {}): DiscordLinkCandidate => ({
  userId: "user-a",
  discordId: "100000000000000001",
  discordCreatedAt: new Date(NOW.getTime() - 400 * DAY),
  character: { isBanned: false },
  hasBlockingSanction: false,
  matchesSanctionTombstone: false,
  linkForUser: null,
  linkForDiscord: null,
  history: [],
  ...overrides,
});

describe("evaluateDiscordLink", () => {
  it("allows a first link", () => {
    expect(evaluateDiscordLink(candidate(), NOW)).toEqual({ allowed: true, relink: false });
  });

  it("requires a character", () => {
    expect(evaluateDiscordLink(candidate({ character: null }), NOW)).toMatchObject({
      allowed: false,
      result: "no_character",
    });
  });

  it("refuses banned and indefinitely sanctioned characters", () => {
    expect(
      evaluateDiscordLink(candidate({ character: { isBanned: true } }), NOW),
    ).toMatchObject({ result: "banned" });
    expect(evaluateDiscordLink(candidate({ hasBlockingSanction: true }), NOW)).toMatchObject({
      result: "banned",
    });
  });

  it("refuses a Discord id held by an active sanction tombstone", () => {
    expect(
      evaluateDiscordLink(candidate({ matchesSanctionTombstone: true }), NOW),
    ).toMatchObject({ result: "blocked" });
  });

  it("refuses a Discord account linked to another character with a masked name", () => {
    expect(
      evaluateDiscordLink(
        candidate({ linkForDiscord: { userId: "user-b", username: "Terriator" } }),
        NOW,
      ),
    ).toEqual({ allowed: false, result: "linked_elsewhere", hint: "T******r" });
  });

  it("refuses a character already linked to a different Discord account", () => {
    expect(
      evaluateDiscordLink(candidate({ linkForUser: { discordId: "100000000000000002" } }), NOW),
    ).toMatchObject({ result: "character_has_link" });
  });

  it("treats the same pair as a relink", () => {
    expect(
      evaluateDiscordLink(
        candidate({
          linkForUser: { discordId: "100000000000000001" },
          linkForDiscord: { userId: "user-a", username: "Me" },
        }),
        NOW,
      ),
    ).toEqual({ allowed: true, relink: true });
  });

  it("refuses accounts younger than the minimum age and says when they qualify", () => {
    const createdAt = new Date(NOW.getTime() - (DISCORD_MIN_ACCOUNT_AGE_DAYS - 1) * DAY);
    expect(evaluateDiscordLink(candidate({ discordCreatedAt: createdAt }), NOW)).toEqual({
      allowed: false,
      result: "too_new",
      until: new Date(createdAt.getTime() + DISCORD_MIN_ACCOUNT_AGE_DAYS * DAY).toISOString(),
    });
    const oldEnough = new Date(NOW.getTime() - DISCORD_MIN_ACCOUNT_AGE_DAYS * DAY);
    expect(evaluateDiscordLink(candidate({ discordCreatedAt: oldEnough }), NOW).allowed).toBe(
      true,
    );
  });

  it("applies the unlink cooldown to a different partner on either side", () => {
    const unlinkedAt = new Date(NOW.getTime() - 5 * DAY);
    const until = new Date(
      unlinkedAt.getTime() + DISCORD_UNLINK_COOLDOWN_DAYS * DAY,
    ).toISOString();
    // This character recently unlinked another Discord account.
    expect(
      evaluateDiscordLink(
        candidate({
          history: [
            { userId: "user-a", discordId: "100000000000000009", unlinkedAt, cooldownWaived: false },
          ],
        }),
        NOW,
      ),
    ).toEqual({ allowed: false, result: "cooldown", until });
    // This Discord account was recently unlinked from another character.
    expect(
      evaluateDiscordLink(
        candidate({
          history: [
            { userId: "user-b", discordId: "100000000000000001", unlinkedAt, cooldownWaived: false },
          ],
        }),
        NOW,
      ),
    ).toMatchObject({ result: "cooldown" });
  });

  it("lets the same pair relink, and ignores waived or expired cooldowns", () => {
    const recent = new Date(NOW.getTime() - DAY);
    const expired = new Date(NOW.getTime() - (DISCORD_UNLINK_COOLDOWN_DAYS + 1) * DAY);
    expect(
      evaluateDiscordLink(
        candidate({
          history: [
            { userId: "user-a", discordId: "100000000000000001", unlinkedAt: recent, cooldownWaived: false },
            { userId: "user-a", discordId: "100000000000000009", unlinkedAt: recent, cooldownWaived: true },
            { userId: "user-b", discordId: "100000000000000001", unlinkedAt: expired, cooldownWaived: false },
          ],
        }),
        NOW,
      ),
    ).toEqual({ allowed: true, relink: false });
  });
});
