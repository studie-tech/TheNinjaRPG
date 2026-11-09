import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import { applyConversationRead, matchesConversationSearch } from "@/deltas/chat";
import { isConversationUnread } from "@/libs/chatPanel";

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
