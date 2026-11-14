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
  const inboxNews = getInboxNews(notifications);
  const client = useQueryClient();
  // A count change can follow an in-flight read's server reset. Capture shared reads
  // before useQuery starts this mount's own read so each consumer waits for a newer read.
  const news = useRef({
    count: inboxNews,
    refetched: false,
    readInFlight:
      client.isFetching({
        queryKey: getQueryKey(api.comments.getUserConversations, undefined, "query"),
        exact: true,
      }) > 0,
    mounted: false,
  });
  const result = api.comments.getUserConversations.useQuery(undefined, {
    enabled: !!userData,
    ...options,
  });
  const { data, fetchStatus, refetch } = result;
  useEffect(() => {
    const queryHash = hashKey(
      getQueryKey(api.comments.getUserConversations, undefined, "query"),
    );
    return client.getQueryCache().subscribe((event) => {
      if (
        event.query.queryHash !== queryHash ||
        event.type !== "updated" ||
        event.action.type !== "success" ||
        event.action.manual ||
        news.current.count === 0
      )
        return;
      if (news.current.readInFlight) {
        // This read predates the news; subsequent shared reads can acknowledge it.
        news.current.readInFlight = false;
        return;
      }
      // Only a successful server read proves the reset; local writes and wall clocks do not.
      news.current.refetched = true;
      const { count } = news.current;
      void updateNotifications((notifications) =>
        clearInboxNotifications(notifications, count),
      );
    });
  }, [client, updateNotifications]);
  useEffect(() => {
    if (inboxNews !== news.current.count) {
      news.current = {
        count: inboxNews,
        refetched: false,
        readInFlight: news.current.mounted && fetchStatus !== "idle",
        mounted: true,
      };
    }
    news.current.mounted = true;
    if (inboxNews === 0 || !data || fetchStatus !== "idle") return;
    if (!news.current.refetched) {
      // One read per news; after a failed read the badge waits for the next list read.
      news.current.refetched = true;
      news.current.readInFlight = false;
      void refetch({ cancelRefetch: false });
    }
  }, [inboxNews, data, fetchStatus, refetch]);
  return result;
}
