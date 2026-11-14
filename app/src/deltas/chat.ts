import type { RouterOutputs } from "@/app/_trpc/client";
import { getInboxNews } from "@/libs/chatPanel";
import type { NavBarDropdownLink } from "@/libs/menus";

/** Advance one inbox read marker to the timestamp confirmed by an authorized read. */
export const applyConversationRead = (
  conversations: RouterOutputs["comments"]["getUserConversations"] | undefined,
  conversationId: string,
  lastReadAt: Date,
) =>
  conversations?.map((conversation) =>
    conversation.id === conversationId &&
    (!conversation.lastReadAt || conversation.lastReadAt < lastReadAt)
      ? { ...conversation, lastReadAt }
      : conversation,
  );

/** Register or release one visible surface without clearing another surface's ownership. */
export const updateConversationViewCount = (
  views: Record<string, number>,
  conversationId: string,
  change: 1 | -1,
): Record<string, number> => {
  const count = (views[conversationId] ?? 0) + change;
  if (count > 0) return { ...views, [conversationId]: count };
  const { [conversationId]: _released, ...remaining } = views;
  return remaining;
};

/** Count a public mention addressed to the player in an unseen conversation. */
export const addConversationMention = (
  mentions: Record<string, number>,
  conversationId: string,
): Record<string, number> => ({
  ...mentions,
  [conversationId]: (mentions[conversationId] ?? 0) + 1,
});

/** Clear mentions for the conversation the player can see, preserving other badges. */
export const clearConversationMentions = (
  mentions: Record<string, number>,
  conversationId: string,
): Record<string, number> => {
  if (!mentions[conversationId]) return mentions;
  const { [conversationId]: _seen, ...remaining } = mentions;
  return remaining;
};

/** Discard unread activity for taverns the player can no longer open. */
export const retainTavernActivity = (
  activity: Record<string, number>,
  conversationIds: string[],
): Record<string, number> => {
  const available = new Set(conversationIds);
  const entries = Object.entries(activity);
  const remaining = entries.filter(([id]) => available.has(id));
  return remaining.length === entries.length ? activity : Object.fromEntries(remaining);
};

/** Clear acknowledged inbox news while preserving a superseding cached count. */
export const clearInboxNotifications = (
  notifications: NavBarDropdownLink[] | undefined,
  expectedCount?: number,
) =>
  expectedCount !== undefined && getInboxNews(notifications) !== expectedCount
    ? notifications
    : notifications?.filter((entry) => entry.href !== "/inbox");

/** Server clock tolerance between a profile read and a delivery's counting. */
const INBOX_DELIVERY_MARGIN_MS = 1000;

/**
 * Whether a delivered message was counted clearly after the cached profile was read, so the
 * profile's inbox news cannot include it yet. Unknown times leave the count to a profile read.
 */
export const isInboxDeliveryAfterProfile = (
  profileServerTime: number | undefined,
  countedAt: number | undefined,
) =>
  profileServerTime !== undefined &&
  countedAt !== undefined &&
  profileServerTime < countedAt - INBOX_DELIVERY_MARGIN_MS;

/**
 * Count a delivered private message in the inbox notification, matching the entry the
 * profile builds from the server's `inboxNews` counter.
 */
export const incrementInboxNotifications = (
  notifications: NavBarDropdownLink[] | undefined,
  by = 1,
): NavBarDropdownLink[] => {
  const count = getInboxNews(notifications) + by;
  const entry: NavBarDropdownLink = {
    href: "/inbox",
    name: `${count} messages`,
    color: "hidden",
    notificationCount: count,
  };
  const current = notifications ?? [];
  return current.some((link) => link.href === "/inbox")
    ? current.map((link) => (link.href === "/inbox" ? { ...link, ...entry } : link))
    : [...current, entry];
};

/**
 * Whether a live comment belongs in the active search results, matching the server's
 * case-insensitive search of the content and the author's username.
 */
export const matchesConversationSearch = (
  searchQuery: string,
  comment: { content: string; username: string },
) => {
  if (searchQuery.trim() === "") return true;
  const query = searchQuery.toLowerCase();
  return (
    comment.content.toLowerCase().includes(query) ||
    comment.username.toLowerCase().includes(query)
  );
};
