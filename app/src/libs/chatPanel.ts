import { atom } from "jotai";
import type { FederalStatus, UserRank } from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/routers/profile";

export const CHAT_PANEL_PHONE_MEDIA_QUERY = "(max-width: 639px)";

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

/** Keep a conversation's unsent text, or forget it when only whitespace remains. */
export const saveChatDraft = (
  drafts: Record<string, string>,
  key: string,
  text: string,
): Record<string, string> => {
  const { [key]: _previous, ...rest } = drafts;
  return text.trim() ? { ...rest, [key]: text } : rest;
};

/** Forget a saved draft once that exact text has been sent. */
export const clearSentChatDraft = (
  drafts: Record<string, string>,
  key: string,
  sentText: string,
) => (drafts[key] === sentText ? saveChatDraft(drafts, key, "") : drafts);

/** Number of visible chat surfaces showing each conversation. */
export const chatViewedConversationsAtom = atom<Record<string, number>>({});

/** Serialize full-list preference saves across every chat surface for the same account. */
export const chatMutePendingAtom = atom<Record<string, boolean>>({});

/**
 * Tavern mentions and replies received since the page loaded, per conversation.
 * Tavern traffic itself never counts; only messages aimed at the player do.
 */
export const chatMentionsAtom = atom<Record<string, number>>({});

/** New tavern messages from other players since the page loaded, per tavern. */
export const chatTavernActivityAtom = atom<Record<string, number>>({});

type ChatMuteUser = Pick<
  NonNullable<UserWithRelations>,
  "chatMuted" | "mutedConversationIds"
> &
  Partial<Pick<NonNullable<UserWithRelations>, "unmutedTavernIds">>;

/** Whether a conversation's ordinary activity stays out of counts and alerts; pings always arrive. */
export const isConversationMuted = (
  user: ChatMuteUser | null | undefined,
  conversationId: string | undefined,
) =>
  !!user &&
  (user.chatMuted ||
    (!!conversationId && user.mutedConversationIds.includes(conversationId)));

/**
 * Taverns the player has unmuted. This list renders in the shell on every page, so a profile
 * arriving without it counts as the default, every tavern muted, instead of crashing the page.
 */
export const getUnmutedTavernIds = (user: Pick<ChatMuteUser, "unmutedTavernIds">) =>
  user.unmutedTavernIds ?? [];

/**
 * Whether a tavern's ordinary messages stay out of counts. Taverns start muted, so only pings
 * reach the player until they unmute one; muting all chat mutes every tavern.
 */
export const isTavernMuted = (
  user: ChatMuteUser | null | undefined,
  tavernId: string,
) => !!user && (user.chatMuted || !getUnmutedTavernIds(user).includes(tavernId));

/** Mute list after toggling one conversation. */
export const toggleMutedConversation = (mutedIds: string[], conversationId: string) =>
  mutedIds.includes(conversationId)
    ? mutedIds.filter((id) => id !== conversationId)
    : [...mutedIds, conversationId];

/**
 * New messages for one tavern: its new messages or its pings, whichever is higher. Pings
 * (mentions and quotes) always count; a muted tavern, or all chat muted, counts only them.
 */
export const unreadForTavern = (
  user: ChatMuteUser | null | undefined,
  conversationId: string,
  mentions: Record<string, number>,
  activity: Record<string, number>,
) => {
  if (!user) return 0;
  const pings = mentions[conversationId] ?? 0;
  return isTavernMuted(user, conversationId)
    ? pings
    : Math.max(pings, activity[conversationId] ?? 0);
};

/** New tavern messages and pings across taverns, for the Tavern tab and menu entry. */
export const countTavernUnread = (
  user: ChatMuteUser | null | undefined,
  mentions: Record<string, number>,
  activity: Record<string, number>,
) =>
  Object.keys({ ...mentions, ...activity }).reduce(
    (sum, conversationId) =>
      sum + unreadForTavern(user, conversationId, mentions, activity),
    0,
  );

/** Unread inbox news plus tavern counts, for the chat button badge; muted chat keeps only pings. */
export const countChatNotifications = (
  user: ChatMuteUser | null | undefined,
  inboxNews: number,
  mentions: Record<string, number>,
  activity: Record<string, number>,
) =>
  !user
    ? 0
    : (user.chatMuted ? 0 : inboxNews) + countTavernUnread(user, mentions, activity);

/** A conversation is unread when it changed after the player last opened it. */
export const isConversationUnread = (convo: {
  updatedAt: Date;
  lastReadAt: Date | null;
}) => !convo.lastReadAt || convo.updatedAt > convo.lastReadAt;

/** Inbox news count from the user's notification list. */
export const getInboxNews = (notifications: NavBarDropdownLink[] | undefined) =>
  notifications?.find((n) => n.href === "/inbox")?.notificationCount ?? 0;
