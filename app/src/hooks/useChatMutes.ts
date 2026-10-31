"use client";

import { api } from "@/app/_trpc/client";
import { isConversationMuted, toggleMutedConversation } from "@/libs/chatPanel";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/** Read and change chat mutes, saved on the account so every device agrees. */
export const useChatMutes = () => {
  const { data: userData, updateUser } = useUserData();
  const { mutate: updatePreferences, isPending } =
    api.profile.updatePreferences.useMutation({
      onSuccess: (result) => {
        if (!result.success) showMutationToast(result);
      },
    });

  const save = (patch: { chatMuted?: boolean; mutedConversationIds?: string[] }) => {
    if (!userData) return;
    void updateUser(patch);
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
    toggleMute: (conversationId: string) =>
      userData &&
      save({
        mutedConversationIds: toggleMutedConversation(
          userData.mutedConversationIds,
          conversationId,
        ),
      }),
    setChatMuted: (chatMuted: boolean) => save({ chatMuted }),
  };
};
