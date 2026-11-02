import type { RouterOutputs } from "@/app/_trpc/client";
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

/** Clear the inbox news acknowledged by viewing the private conversation list. */
export const clearInboxNotifications = (
  notifications: NavBarDropdownLink[] | undefined,
) => notifications?.filter((entry) => entry.href !== "/inbox");
