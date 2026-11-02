import { useStore } from "jotai";
import { useEffect } from "react";
import { clearConversationMentions, updateConversationViewCount } from "@/deltas/chat";
import { chatMentionsAtom, chatViewedConversationsAtom } from "@/libs/chatPanel";

/** Own one visible conversation registration for a full page or compact chat surface. */
export const useConversationViewing = (
  conversationId: string | undefined,
  isPageActive: boolean,
) => {
  const store = useStore();
  useEffect(() => {
    // The activity hook settles initial visibility in an effect; hidden mounts must retain their mentions.
    if (!conversationId || !isPageActive || document.hidden) return;
    store.set(chatViewedConversationsAtom, (current) =>
      updateConversationViewCount(current, conversationId, 1),
    );
    store.set(chatMentionsAtom, (current) =>
      clearConversationMentions(current, conversationId),
    );
    return () => {
      store.set(chatViewedConversationsAtom, (current) =>
        updateConversationViewCount(current, conversationId, -1),
      );
    };
  }, [conversationId, isPageActive, store]);
};
