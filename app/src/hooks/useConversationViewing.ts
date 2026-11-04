import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { clearConversationMentions, updateConversationViewCount } from "@/deltas/chat";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  CHAT_PANEL_PHONE_MEDIA_QUERY,
  chatMentionsAtom,
  chatPanelAtom,
  chatTavernActivityAtom,
  chatViewedConversationsAtom,
} from "@/libs/chatPanel";

/** Own one visible conversation registration for a full page or compact chat surface. */
export const useConversationViewing = (
  conversationId: string | undefined,
  isPageActive: boolean,
  isInChatPanel = false,
) => {
  const store = useStore();
  const isPhone = useMediaQuery(CHAT_PANEL_PHONE_MEDIA_QUERY);
  const isPanelOpen = useAtomValue(chatPanelAtom).owner !== null;
  useEffect(() => {
    // Lifecycle and media hooks settle initial state in effects; obscured mounts must retain their mentions.
    const isCoveredByPanel =
      !isInChatPanel &&
      isPanelOpen &&
      (isPhone || window.matchMedia?.(CHAT_PANEL_PHONE_MEDIA_QUERY).matches);
    if (!conversationId || !isPageActive || document.hidden || isCoveredByPanel) return;
    store.set(chatViewedConversationsAtom, (current) =>
      updateConversationViewCount(current, conversationId, 1),
    );
    store.set(chatMentionsAtom, (current) =>
      clearConversationMentions(current, conversationId),
    );
    store.set(chatTavernActivityAtom, (current) =>
      clearConversationMentions(current, conversationId),
    );
    return () => {
      store.set(chatViewedConversationsAtom, (current) =>
        updateConversationViewCount(current, conversationId, -1),
      );
    };
  }, [conversationId, isPageActive, isInChatPanel, isPanelOpen, isPhone, store]);
};
