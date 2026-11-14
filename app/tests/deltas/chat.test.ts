import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import {
  applyConversationRead,
  clearInboxNotifications,
  incrementInboxNotifications,
  matchesConversationSearch,
} from "@/deltas/chat";
import { getInboxNews, isConversationUnread } from "@/libs/chatPanel";
import type { NavBarDropdownLink } from "@/libs/menus";

it("counts a delivered message in the inbox notice the profile builds, keeping other notices", () => {
  const news: NavBarDropdownLink = { href: "/news", name: "1 news", color: "blue" };
  const first = incrementInboxNotifications([news]);
  expect(first).toEqual([
    news,
    { href: "/inbox", name: "1 messages", color: "hidden", notificationCount: 1 },
  ]);
  expect(first[0]).toBe(news);
  const second = incrementInboxNotifications(first);
  expect(getInboxNews(second)).toBe(2);
  expect(second.find((link) => link.href === "/inbox")?.name).toBe("2 messages");
  expect(second).toHaveLength(2);
  expect(getInboxNews(incrementInboxNotifications(undefined))).toBe(1);
  // A list read acknowledging the incremented count clears it.
  expect(clearInboxNotifications(second, 2)).toEqual([news]);
  expect(clearInboxNotifications(second, 1)).toBe(second);
});

it("keeps newer activity unread and preserves later confirmed reads and unrelated conversations", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 12, minute));
  const conversations = [
    { id: "chat", updatedAt: at(4), lastReadAt: at(1) },
    { id: "other", updatedAt: at(2), lastReadAt: at(1) },
  ] as RouterOutputs["comments"]["getUserConversations"];
  const read = applyConversationRead(conversations, "chat", at(3))!;
  expect(read[0]?.lastReadAt).toEqual(at(3));
  expect(isConversationUnread(read[0]!)).toBe(true);
  expect(read[1]).toBe(conversations[1]);
  const latest = applyConversationRead(read, "chat", at(5))!;
  expect(isConversationUnread(latest[0]!)).toBe(false);
  expect(applyConversationRead(latest, "chat", at(2))?.[0]).toBe(latest[0]);
});

it("matches a live comment by content or author name, ignoring case, like the server search", () => {
  const comment = { content: "Meet at the <b>Gate</b>", username: "Pathfinder" };
  expect(matchesConversationSearch("", comment)).toBe(true);
  expect(matchesConversationSearch("  ", comment)).toBe(true);
  expect(matchesConversationSearch("gate", comment)).toBe(true);
  expect(matchesConversationSearch("FINDER", comment)).toBe(true);
  expect(matchesConversationSearch("ramen", comment)).toBe(false);
});

it.each(["%", "_", "\\"])(
  "matches %j literally in content or author names",
  (symbol) => {
    expect(
      matchesConversationSearch(symbol, {
        content: "Another message",
        username: "Peer",
      }),
    ).toBe(false);
    expect(
      matchesConversationSearch(symbol, {
        content: `Found ${symbol}`,
        username: "Peer",
      }),
    ).toBe(true);
    expect(
      matchesConversationSearch(symbol, {
        content: "Another message",
        username: `Peer${symbol}`,
      }),
    ).toBe(true);
  },
);
