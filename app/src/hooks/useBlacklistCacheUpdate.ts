import { api } from "@/app/_trpc/client";

/** Reconcile blocked players and every conversation list and message variant they affect. */
export const useBlacklistCacheUpdate = () => {
  const utils = api.useUtils();
  const refreshBlacklist = () =>
    Promise.all([
      utils.profile.getBlacklist.invalidate(),
      utils.comments.getConversationComments.invalidate(),
      utils.comments.getUserConversations.invalidate(),
    ]);
  return { refreshBlacklist };
};
