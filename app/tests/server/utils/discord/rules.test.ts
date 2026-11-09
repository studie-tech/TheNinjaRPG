import { describe, expect, it } from "bun:test";
import {
  DISCORD_MIN_ACCOUNT_AGE_DAYS,
  DISCORD_UNLINK_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import {
  type DiscordAccountLink,
  type DiscordLinkCandidate,
  type DiscordLinkDecision,
  evaluateDiscordLink,
} from "@/server/utils/discord/rules";

const DAY = 86_400_000;
const NOW = new Date("2026-10-24T12:00:00.000Z");

const FIRST: DiscordLinkDecision = {
  allowed: true,
  relink: false,
  slot: 1,
  isPrimary: true,
  sibling: null,
};
const linkOf = (
  userId: string,
  slot: number,
  username: string | null = null,
): DiscordAccountLink => ({
  userId,
  slot,
  isPrimary: slot === 1,
  username,
});
const unlink = (
  userId: string,
  discordId: string,
  daysAgo: number,
  cooldownWaived = false,
) => ({
  userId,
  discordId,
  unlinkedAt: new Date(NOW.getTime() - daysAgo * DAY),
  cooldownWaived,
});
const DISCORD = "100000000000000001";

const candidate = (
  overrides: Partial<DiscordLinkCandidate> = {},
): DiscordLinkCandidate => ({
  userId: "user-a",
  discordId: "100000000000000001",
  discordCreatedAt: new Date(NOW.getTime() - 400 * DAY),
  character: { isBanned: false },
  hasBlockingSanction: false,
  matchesSanctionTombstone: false,
  discordBanned: false,
  linkForUser: null,
  linksForDiscord: [],
  history: [],
  ...overrides,
});

describe("evaluateDiscordLink", () => {
  it("allows a first link", () => {
    expect(evaluateDiscordLink(candidate(), NOW)).toEqual(FIRST);
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
    expect(
      evaluateDiscordLink(candidate({ hasBlockingSanction: true }), NOW),
    ).toMatchObject({
      result: "banned",
    });
  });

  it("refuses a Discord id held by an active sanction tombstone", () => {
    expect(
      evaluateDiscordLink(candidate({ matchesSanctionTombstone: true }), NOW),
    ).toMatchObject({ result: "blocked" });
  });

  it("links a second character to a free slot, keeping the existing primary", () => {
    const first = linkOf("user-b", 1, "Terriator");
    expect(evaluateDiscordLink(candidate({ linksForDiscord: [first] }), NOW)).toEqual({
      allowed: true,
      relink: false,
      slot: 2,
      isPrimary: false,
      sibling: first,
    });
    // Slot 1 freed by an unlink is reused.
    const second = { ...linkOf("user-b", 2), isPrimary: true };
    expect(
      evaluateDiscordLink(candidate({ linksForDiscord: [second] }), NOW),
    ).toMatchObject({
      slot: 1,
      isPrimary: false,
    });
  });

  it("refuses a third character with the masked names of the two linked ones", () => {
    expect(
      evaluateDiscordLink(
        candidate({
          linksForDiscord: [
            linkOf("user-b", 1, "Terriator"),
            linkOf("user-c", 2, "Kakashi"),
          ],
        }),
        NOW,
      ),
    ).toEqual({ allowed: false, result: "discord_full", hint: "T******r, K*****i" });
  });

  it("refuses a second character while the Discord account is banned through the first", () => {
    expect(
      evaluateDiscordLink(
        candidate({ linksForDiscord: [linkOf("user-b", 1)], discordBanned: true }),
        NOW,
      ),
    ).toMatchObject({ result: "blocked" });
  });

  it("refuses a character already linked to a different Discord account", () => {
    expect(
      evaluateDiscordLink(
        candidate({ linkForUser: { discordId: "100000000000000002" } }),
        NOW,
      ),
    ).toMatchObject({ result: "character_has_link" });
  });

  it("treats the same pair as a relink", () => {
    expect(
      evaluateDiscordLink(
        candidate({
          linkForUser: { discordId: "100000000000000001" },
          linksForDiscord: [linkOf("user-b", 1), linkOf("user-a", 2)],
        }),
        NOW,
      ),
    ).toEqual({ allowed: true, relink: true });
  });

  it("refuses accounts younger than the minimum age and says when they qualify", () => {
    const createdAt = new Date(
      NOW.getTime() - (DISCORD_MIN_ACCOUNT_AGE_DAYS - 1) * DAY,
    );
    expect(
      evaluateDiscordLink(candidate({ discordCreatedAt: createdAt }), NOW),
    ).toEqual({
      allowed: false,
      result: "too_new",
      until: new Date(
        createdAt.getTime() + DISCORD_MIN_ACCOUNT_AGE_DAYS * DAY,
      ).toISOString(),
    });
    const oldEnough = new Date(NOW.getTime() - DISCORD_MIN_ACCOUNT_AGE_DAYS * DAY);
    expect(
      evaluateDiscordLink(candidate({ discordCreatedAt: oldEnough }), NOW).allowed,
    ).toBe(true);
  });

  it("keeps a character that unlinked from switching Discord accounts", () => {
    const history = [unlink("user-a", "100000000000000009", 5)];
    expect(evaluateDiscordLink(candidate({ history }), NOW)).toEqual({
      allowed: false,
      result: "cooldown",
      until: new Date(
        NOW.getTime() + (DISCORD_UNLINK_COOLDOWN_DAYS - 5) * DAY,
      ).toISOString(),
    });
  });

  it("counts unlinked characters toward the Discord account's limit during the cooldown", () => {
    // One character unlinked recently: a second, different character may still link.
    expect(
      evaluateDiscordLink(candidate({ history: [unlink("user-b", DISCORD, 5)] }), NOW),
    ).toEqual(FIRST);
    // One linked and one unlinked recently: a third character waits for the unlink to age out.
    expect(
      evaluateDiscordLink(
        candidate({
          linksForDiscord: [linkOf("user-b", 1)],
          history: [unlink("user-c", DISCORD, 5)],
        }),
        NOW,
      ),
    ).toEqual({
      allowed: false,
      result: "cooldown",
      until: new Date(
        NOW.getTime() + (DISCORD_UNLINK_COOLDOWN_DAYS - 5) * DAY,
      ).toISOString(),
    });
    // Two unlinked recently: the window frees once the older one ages out.
    expect(
      evaluateDiscordLink(
        candidate({
          history: [unlink("user-b", DISCORD, 5), unlink("user-c", DISCORD, 10)],
        }),
        NOW,
      ),
    ).toEqual({
      allowed: false,
      result: "cooldown",
      until: new Date(
        NOW.getTime() + (DISCORD_UNLINK_COOLDOWN_DAYS - 10) * DAY,
      ).toISOString(),
    });
    // Relinking a character from the window adds nobody new.
    expect(
      evaluateDiscordLink(
        candidate({
          linksForDiscord: [linkOf("user-b", 1)],
          history: [unlink("user-a", DISCORD, 5), unlink("user-a", DISCORD, 2)],
        }),
        NOW,
      ),
    ).toMatchObject({ allowed: true, slot: 2 });
  });

  it("lets the same pair relink, and ignores waived or expired cooldowns", () => {
    const expiredDays = DISCORD_UNLINK_COOLDOWN_DAYS + 1;
    expect(
      evaluateDiscordLink(
        candidate({
          linksForDiscord: [linkOf("user-d", 1)],
          history: [
            unlink("user-a", DISCORD, 1),
            unlink("user-a", "100000000000000009", 1, true),
            unlink("user-b", DISCORD, expiredDays),
            unlink("user-c", DISCORD, 1, true),
          ],
        }),
        NOW,
      ),
    ).toMatchObject({ allowed: true, relink: false, slot: 2, isPrimary: false });
  });
});
