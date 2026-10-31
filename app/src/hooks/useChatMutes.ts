"use client";

import { api } from "@/app/_trpc/client";
import { MAX_MUTED_CONVERSATIONS } from "@/drizzle/constants";
import { isConversationMuted, toggleMutedConversation } from "@/libs/chatPanel";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/** Read and change chat mutes, saved on the account so every device agrees. */
export const useChatMutes = () => {
  const { data: userData, updateUser } = useUserData();
  const { mutate: updatePreferences, isPending } =
    api.profile.updatePreferences.useMutation({
      onMutate: () => userData?.userId,
      onSuccess: (result, patch, userId) => {
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        void updateUser((current) =>
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
    });

  const save = (patch: { chatMuted?: boolean; mutedConversationIds?: string[] }) => {
    if (!userData) return;
    updatePreferences(patch);
  };

  return {
    chatMuted: userData?.chatMuted ?? false,
    isPending,
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
