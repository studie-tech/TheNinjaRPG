import { hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs } from "@/app/_trpc/client";

/** Reconcile conversation discovery and the comment variants shared by chat surfaces. */
export const useConversationCacheUpdate = () => {
  const utils = api.useUtils();
  const refreshConversationList = () =>
    utils.comments.getUserConversations.invalidate();
  const refreshConversationComments = (
    conversationId: string,
    updatedInput?: RouterInputs["comments"]["getConversationComments"],
  ) => {
    const updatedKey = updatedInput
      ? getQueryKey(api.comments.getConversationComments, updatedInput, "infinite")
      : undefined;
    return utils.comments.getConversationComments.invalidate(
      { convo_id: conversationId },
      {
        predicate: (query) =>
          !updatedKey || hashKey(query.queryKey) !== hashKey(updatedKey),
      },
    );
  };
  return { refreshConversationList, refreshConversationComments };
};
