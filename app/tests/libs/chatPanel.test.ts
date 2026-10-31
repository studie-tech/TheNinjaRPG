import { describe, expect, it } from "bun:test";
import {
  addInboxNotification,
  countChatNotifications,
  getInboxNews,
  isConversationMuted,
  isConversationUnread,
  toggleMutedConversation,
} from "@/libs/chatPanel";

const user = (chatMuted: boolean, mutedConversationIds: string[] = []) => ({
  chatMuted,
  mutedConversationIds,
});

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
  it("adds inbox news to mentions from unmuted conversations", () => {
    expect(countChatNotifications(user(false, ["muted"]), 2, { tavern: 3, muted: 4 })).toBe(5);
  });

  it("shows nothing while all chat is muted or without a player", () => {
    expect(countChatNotifications(user(true), 2, { tavern: 3 })).toBe(0);
    expect(countChatNotifications(null, 2, { tavern: 3 })).toBe(0);
  });
});

describe("inbox notifications", () => {
  it("adds the inbox entry the server sends, then counts it up", () => {
    const first = addInboxNotification([{ href: "/news", name: "1 news" }]);
    expect(getInboxNews(first)).toBe(1);
    expect(first).toContainEqual({
      href: "/inbox",
      name: "1 messages",
      color: "hidden",
      notificationCount: 1,
    });
    const second = addInboxNotification(first);
    expect(getInboxNews(second)).toBe(2);
    expect(second.filter((n) => n.href === "/inbox")).toHaveLength(1);
    expect(second.find((n) => n.href === "/news")).toEqual({ href: "/news", name: "1 news" });
  });

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
