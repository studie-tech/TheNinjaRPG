"use client";

import { useAtomValue, useStore } from "jotai";
import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import { MAX_MUTED_CONVERSATIONS } from "@/drizzle/constants";
import {
  chatMutePendingAtom,
  getUnmutedTavernIds,
  isConversationMuted,
  isTavernMuted,
  toggleMutedConversation,
} from "@/libs/chatPanel";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { useUserDataSelector } from "@/utils/UserContext";

/** Read and change chat mutes, saved on the account so every device agrees. */
export const useChatMutes = () => {
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector(selectChatMutes);
  const store = useStore();
  const pending = useAtomValue(chatMutePendingAtom);
  const pendingUserId = useRef<string | undefined>(undefined);
  const { mutate: updatePreferences, isPending } =
    api.profile.updatePreferences.useMutation({
      onMutate: () => ({
        userId: pendingUserId.current,
        revision: prepareUserUpdate(),
      }),
      onSuccess: (result, _patch, context) => {
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        return updateUser(
          (current) =>
            current.userId === context?.userId ? result.userPatch : undefined,
          { revision: context?.revision },
        );
      },
      onSettled: (_result, _error, _patch, context) => {
        // The global session guard can reject before this hook's onMutate runs.
        const savingUserId = context?.userId ?? pendingUserId.current;
        pendingUserId.current = undefined;
        if (!savingUserId) return;
        store.set(chatMutePendingAtom, (current) => {
          const next = { ...current };
          delete next[savingUserId];
          return next;
        });
      },
    });

  /** Serialize preference saves across chat controls and bind each save to its account. */
  const save = (patch: {
    chatMuted?: boolean;
    mutedConversationIds?: string[];
    unmutedTavernIds?: string[];
  }) => {
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
    /** Taverns start muted (pings only); also muted by "mute all". */
    isTavernSilenced: (tavernId: string) => isTavernMuted(userData, tavernId),
    /** Unmute a tavern to count its new messages, or mute it back to pings only. */
    toggleTavernMute: (tavernId: string) => {
      if (!userData) return;
      const unmutedTavernIds = getUnmutedTavernIds(userData);
      if (
        !unmutedTavernIds.includes(tavernId) &&
        unmutedTavernIds.length >= MAX_MUTED_CONVERSATIONS
      ) {
        showMutationToast({
          success: false,
          message: `You can unmute up to ${MAX_MUTED_CONVERSATIONS} taverns.`,
        });
        return;
      }
      save({
        unmutedTavernIds: toggleMutedConversation(unmutedTavernIds, tavernId),
      });
    },
    setChatMuted: (chatMuted: boolean) => save({ chatMuted }),
  };
};

/** Subscribe mute controls to account identity and preferences without unrelated profile updates. */
const selectChatMutes = (user: NonNullable<UserWithRelations>) => ({
  userId: user.userId,
  chatMuted: user.chatMuted,
  mutedConversationIds: user.mutedConversationIds,
  unmutedTavernIds: user.unmutedTavernIds,
});
