import type { RouterOutputs } from "@/app/_trpc/client";
import type { NavBarDropdownLink } from "@/libs/menus";

/** Add one confirmed inbox message while preserving unrelated notifications. */
export const addInboxNotification = (
  notifications: NavBarDropdownLink[] | undefined,
): NavBarDropdownLink[] => {
  const list = notifications ?? [];
  const current = list.find((entry) => entry.href === "/inbox");
  const count = (current?.notificationCount ?? 0) + 1;
  const entry: NavBarDropdownLink = {
    href: "/inbox",
    name: `${count} messages`,
    color: "hidden",
    notificationCount: count,
  };
  return current
    ? list.map((item) => (item === current ? entry : item))
    : [...list, entry];
};

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
