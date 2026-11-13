import { hashKey, type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useCallback, useEffect } from "react";
import { api, type RouterInputs, type RouterOutputs } from "@/app/_trpc/client";
import { applyConversationRead, clearInboxNotifications } from "@/deltas/chat";
import { getInboxNews } from "@/libs/chatPanel";
import { updateQueryCache } from "@/utils/queryCache";
import { useUserDataSelector } from "@/utils/UserContext";

type CommentPage = RouterOutputs["comments"]["getConversationComments"];

/** Reconcile conversation discovery and the comment variants shared by chat surfaces. */
export const useConversationCacheUpdate = () => {
  const utils = api.useUtils();
  const client = useQueryClient();
  const refreshConversationList = () =>
    utils.comments.getUserConversations.invalidate();
  const recordConversationRead = useCallback(
    (conversationId: string, lastReadAt: Date) => {
      return Promise.all(
        client
          .getQueryCache()
          .findAll({
            queryKey: getQueryKey(api.comments.getUserConversations),
          })
          .map((query) =>
            updateQueryCache<RouterOutputs["comments"]["getUserConversations"]>(
              client,
              query.queryKey,
              (current) => applyConversationRead(current, conversationId, lastReadAt),
            ),
          ),
      );
    },
    [client],
  );
  const refreshConversationComments = (
    conversationId: string,
    updatedInput?: RouterInputs["comments"]["getConversationComments"],
  ) => {
    const updatedKey = updatedInput
      ? getQueryKey(api.comments.getConversationComments, updatedInput, "infinite")
      : undefined;
    return utils.comments.getConversationComments.invalidate(undefined, {
      predicate: (query) => {
        if (updatedKey && hashKey(query.queryKey) === hashKey(updatedKey)) return false;
        const cached = query.state.data as InfiniteData<CommentPage> | undefined;
        const key = query.queryKey[1] as { input?: { convo_id?: string } } | undefined;
        return (
          cached?.pages?.[0]?.convo?.id === conversationId ||
          key?.input?.convo_id === conversationId
        );
      },
    });
  };
  return {
    refreshConversationList,
    refreshConversationComments,
    recordConversationRead,
  };
};

/**
 * List the player's conversations and mirror the inbox counter reset that the listing
 * performs on the server.
 * @param options - How the listing refetches; the inbox page refreshes it on every mount
 */
export function useInboxConversations(
  options: { staleTime?: number; refetchOnMount?: "always" } = {},
) {
  const {
    data: userData,
    notifications,
    updateNotifications,
  } = useUserDataSelector((u) => u.userId);
  const result = api.comments.getUserConversations.useQuery(undefined, {
    enabled: !!userData,
    ...options,
  });
  useEffect(() => {
    if (result.data && getInboxNews(notifications) > 0) {
      void updateNotifications(clearInboxNotifications);
    }
  }, [result.data, notifications, updateNotifications]);
  return result;
}
