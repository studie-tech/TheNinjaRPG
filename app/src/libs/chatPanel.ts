import { atom } from "jotai";
import type { FederalStatus, UserRank } from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/routers/profile";

export const ChatTabs = ["tavern", "inbox", "ai"] as const;
export type ChatTab = (typeof ChatTabs)[number];

/** A player to message privately, with the fields the new-conversation form shows. */
export type ChatStartUser = {
  userId: string;
  username: string;
  rank: UserRank;
  level: number;
  avatar?: string | null;
  federalStatus: FederalStatus;
};

/** Open state of the chat panel; other features open it on a tab or conversation. */
export const chatPanelAtom = atom<{
  /**
   * Chat button that shows the open panel. Layouts place the button more than
   * once (floating, header, menu); only one may show the panel.
   */
  owner: string | null;
  /** Asks the first visible chat button to open, e.g. from a notification. */
  openRequested?: boolean;
  tab: ChatTab;
  /** Selected inbox conversation. */
  conversationId?: string;
  /** Start or reopen a private conversation with this player. */
  startWith?: ChatStartUser;
}>({ owner: null, tab: "tavern" });

/** Unsent text per conversation, kept while the panel is closed or switches chats. */
export const chatDraftsAtom = atom<Record<string, string>>({});

/** Number of visible chat surfaces showing each conversation. */
export const chatViewedConversationsAtom = atom<Record<string, number>>({});

/** Serialize full-list preference saves across every chat surface for the same account. */
export const chatMutePendingAtom = atom<Record<string, boolean>>({});

/**
 * Tavern mentions and replies received since the page loaded, per conversation.
 * Tavern traffic itself never counts; only messages aimed at the player do.
 */
export const chatMentionsAtom = atom<Record<string, number>>({});

type ChatMuteUser = Pick<
  NonNullable<UserWithRelations>,
  "chatMuted" | "mutedConversationIds"
>;

/** Whether a conversation's activity should stay out of counts and in-game pings. */
export const isConversationMuted = (
  user: ChatMuteUser | null | undefined,
  conversationId: string | undefined,
) =>
  !!user &&
  (user.chatMuted ||
    (!!conversationId && user.mutedConversationIds.includes(conversationId)));

/** Mute list after toggling one conversation. */
export const toggleMutedConversation = (mutedIds: string[], conversationId: string) =>
  mutedIds.includes(conversationId)
    ? mutedIds.filter((id) => id !== conversationId)
    : [...mutedIds, conversationId];

/** Unread inbox news plus unmuted tavern mentions, for the chat button badge. */
export const countChatNotifications = (
  user: ChatMuteUser | null | undefined,
  inboxNews: number,
  mentions: Record<string, number>,
) => {
  if (!user || user.chatMuted) return 0;
  const mentionCount = Object.entries(mentions)
    .filter(([conversationId]) => !isConversationMuted(user, conversationId))
    .reduce((sum, [, count]) => sum + count, 0);
  return inboxNews + mentionCount;
};

/** A conversation is unread when it changed after the player last opened it. */
export const isConversationUnread = (convo: {
  updatedAt: Date;
  lastReadAt: Date | null;
}) => !convo.lastReadAt || convo.updatedAt > convo.lastReadAt;

/** Inbox news count from the user's notification list. */
export const getInboxNews = (notifications: NavBarDropdownLink[] | undefined) =>
  notifications?.find((n) => n.href === "/inbox")?.notificationCount ?? 0;
