import { hashKey, type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useCallback, useEffect, useRef } from "react";
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
 * performs on the server. A list not read after the inbox badge appeared is read again first,
 * so the badge clears only once the server counter has been reset.
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
  const inboxNews = getInboxNews(notifications);
  const { data, dataUpdatedAt, fetchStatus, isError, refetch } = result;
  // When the current news was first seen. The server only ever resets the counter to zero, so
  // any other count is new news.
  const news = useRef({ count: 0, seenAt: 0, refetched: false });
  useEffect(() => {
    if (inboxNews !== news.current.count) {
      news.current = {
        count: inboxNews,
        seenAt: inboxNews > 0 ? Date.now() : 0,
        refetched: false,
      };
    }
    if (inboxNews === 0 || !data || fetchStatus !== "idle") return;
    // A local write to the list also moves `dataUpdatedAt`; a failed read since then means
    // the server counter may still hold the news.
    if (dataUpdatedAt > news.current.seenAt && !isError) {
      void updateNotifications(clearInboxNotifications);
    } else if (!news.current.refetched) {
      // One read per news; after a failed read the badge waits for the next list read.
      news.current.refetched = true;
      void refetch({ cancelRefetch: false });
    }
  }, [
    inboxNews,
    data,
    dataUpdatedAt,
    fetchStatus,
    isError,
    refetch,
    updateNotifications,
  ]);
  return result;
}
