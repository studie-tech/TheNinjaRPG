"use client";

import { useAtomValue, useStore } from "jotai";
import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import { MAX_MUTED_CONVERSATIONS } from "@/drizzle/constants";
import {
  chatMutePendingAtom,
  isConversationMuted,
  toggleMutedConversation,
} from "@/libs/chatPanel";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/** Read and change chat mutes, saved on the account so every device agrees. */
export const useChatMutes = () => {
  const { data: userData, updateUser } = useUserData();
  const store = useStore();
  const pending = useAtomValue(chatMutePendingAtom);
  const pendingUserId = useRef<string | undefined>(undefined);
  const { mutate: updatePreferences, isPending } =
    api.profile.updatePreferences.useMutation({
      onMutate: () => pendingUserId.current,
      onSuccess: (result, patch, userId) => {
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        return updateUser((current) =>
          current.userId === userId
            ? {
                ...(patch.chatMuted !== undefined && { chatMuted: patch.chatMuted }),
                ...(patch.mutedConversationIds !== undefined && {
                  mutedConversationIds: patch.mutedConversationIds,
                }),
              }
            : undefined,
        );
      },
      onSettled: (_result, _error, _patch, userId) => {
        // The global session guard can reject before this hook's onMutate runs.
        const savingUserId = userId ?? pendingUserId.current;
        pendingUserId.current = undefined;
        if (!savingUserId) return;
        store.set(chatMutePendingAtom, (current) => {
          const next = { ...current };
          delete next[savingUserId];
          return next;
        });
      },
    });

  const save = (patch: { chatMuted?: boolean; mutedConversationIds?: string[] }) => {
    if (
      !userData ||
      pendingUserId.current ||
      store.get(chatMutePendingAtom)[userData.userId]
    )
      return;
    pendingUserId.current = userData.userId;
    // The synchronous store guard also covers two clicks before React rerenders.
    store.set(chatMutePendingAtom, (current) => ({
      ...current,
      [userData.userId]: true,
    }));
    updatePreferences(patch);
  };

  return {
    chatMuted: userData?.chatMuted ?? false,
    isPending: isPending || !!(userData && pending[userData.userId]),
    /** Muted on its own, ignoring "mute all". */
    isMuted: (conversationId: string | undefined) =>
      !!conversationId && !!userData?.mutedConversationIds.includes(conversationId),
    /** Silenced either on its own or by "mute all". */
    isSilenced: (conversationId: string | undefined) =>
      isConversationMuted(userData, conversationId),
    toggleMute: (conversationId: string) => {
      if (!userData) return;
      if (
        !userData.mutedConversationIds.includes(conversationId) &&
        userData.mutedConversationIds.length >= MAX_MUTED_CONVERSATIONS
      ) {
        showMutationToast({
          success: false,
          message: `You can mute up to ${MAX_MUTED_CONVERSATIONS} conversations.`,
        });
        return;
      }
      save({
        mutedConversationIds: toggleMutedConversation(
          userData.mutedConversationIds,
          conversationId,
        ),
      });
    },
    setChatMuted: (chatMuted: boolean) => save({ chatMuted }),
  };
};
