import { describe, expect, it } from "bun:test";
import {
  countChatNotifications,
  countTavernUnread,
  getInboxNews,
  isConversationMuted,
  isConversationUnread,
  isTavernMuted,
  unreadForTavern,
  toggleMutedConversation,
} from "@/libs/chatPanel";

const user = (
  chatMuted: boolean,
  mutedConversationIds: string[] = [],
  unmutedTavernIds: string[] = [],
) => ({ chatMuted, mutedConversationIds, unmutedTavernIds });

describe("chat mutes", () => {
  it("silences a muted conversation, or every conversation when chat is muted", () => {
    expect(isConversationMuted(user(false, ["a"]), "a")).toBe(true);
    expect(isConversationMuted(user(false, ["a"]), "b")).toBe(false);
    expect(isConversationMuted(user(true), "b")).toBe(true);
    expect(isConversationMuted(user(true), undefined)).toBe(true);
    expect(isConversationMuted(user(false), undefined)).toBe(false);
    expect(isConversationMuted(null, "a")).toBe(false);
  });

  it("toggles one conversation in the mute list", () => {
    expect(toggleMutedConversation(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleMutedConversation(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("chat badge", () => {
  it("adds inbox news to tavern counts, keeping only pings from muted taverns", () => {
    expect(
      countChatNotifications(
        user(false, [], ["tavern"]),
        2,
        { tavern: 3, quiet: 4 },
        { quiet: 9 },
      ),
    ).toBe(9);
  });

  it("keeps only pings while all chat is muted, and shows nothing without a player", () => {
    expect(
      countChatNotifications(
        user(true, [], ["tavern"]),
        2,
        { tavern: 3 },
        { tavern: 8, other: 5 },
      ),
    ).toBe(3);
    expect(countChatNotifications(null, 2, { tavern: 3 }, {})).toBe(0);
  });
});

describe("inbox notifications", () => {
  it("reads zero without an inbox entry", () => {
    expect(getInboxNews(undefined)).toBe(0);
    expect(getInboxNews([{ href: "/news", name: "1 news" }])).toBe(0);
  });
});

describe("unread conversations", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 30, 12, minutes));
  it("is unread when it changed after the last read, or was never read", () => {
    expect(isConversationUnread({ updatedAt: at(10), lastReadAt: at(5) })).toBe(true);
    expect(isConversationUnread({ updatedAt: at(5), lastReadAt: at(10) })).toBe(false);
    expect(isConversationUnread({ updatedAt: at(5), lastReadAt: null })).toBe(true);
  });
});

describe("tavern unread", () => {
  it("starts every tavern muted until the player unmutes it", () => {
    expect(isTavernMuted(user(false), "global")).toBe(true);
    expect(isTavernMuted(user(false, [], ["global"]), "global")).toBe(false);
    expect(isTavernMuted(user(true, [], ["global"]), "global")).toBe(true);
    expect(isTavernMuted(null, "global")).toBe(false);
  });

  it("treats a profile without the unmute list as having every tavern muted", () => {
    const profile = { chatMuted: false, mutedConversationIds: [] };
    expect(isTavernMuted(profile, "global")).toBe(true);
    expect(unreadForTavern(profile, "global", { global: 2 }, { global: 7 })).toBe(2);
    expect(countTavernUnread(profile, { global: 2 }, { global: 7, ally: 4 })).toBe(2);
  });

  it("counts new messages only in unmuted taverns, and pings everywhere", () => {
    expect(
      countTavernUnread(
        user(false, [], ["global"]),
        { global: 1, ally: 2 },
        { global: 3, akikaze: 5, ally: 4 },
      ),
    ).toBe(5);
    expect(
      unreadForTavern(user(false), "akikaze", { akikaze: 2 }, { akikaze: 7 }),
    ).toBe(2);
    expect(
      unreadForTavern(
        user(false, [], ["akikaze"]),
        "akikaze",
        { akikaze: 2 },
        { akikaze: 7 },
      ),
    ).toBe(7);
    expect(
      unreadForTavern(
        user(true, [], ["akikaze"]),
        "akikaze",
        { akikaze: 2 },
        { akikaze: 7 },
      ),
    ).toBe(2);
  });

  it("is zero without a player", () => {
    expect(countTavernUnread(null, { global: 1 }, { global: 3 })).toBe(0);
  });
});
