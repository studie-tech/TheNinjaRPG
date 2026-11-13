import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { applyForumReaction, type ForumReactionChange } from "@/deltas/forum";
import { FORUM_THREAD_POSTS_PER_PAGE } from "@/drizzle/constants";

/** Bind confirmed reactions to the thread captured by each mutation's callback. */
export const useForumCacheUpdate = (threadId: string) => {
  const utils = api.useUtils();
  const client = useQueryClient();
  /** Patch the post across cached pages while preserving unrelated destination reads. */
  const updateReaction = async (change: ForumReactionChange) => {
    const filter = { thread_id: threadId, limit: FORUM_THREAD_POSTS_PER_PAGE };
    // Reactions are absolute, revision-free patches. Only reads containing this post
    // can overwrite them; leave pending destination pages and unrelated reads alone.
    await client.cancelQueries({
      queryKey: getQueryKey(api.comments.getForumComments, filter, "query"),
      predicate: (query) => {
        const cached = query.state.data as ThreadData | undefined;
        return cached?.data.some((post) => post.id === change.postId) ?? false;
      },
    });
    utils.comments.getForumComments.setQueriesData(filter, {}, (current) =>
      current ? applyForumReaction(current, change) : current,
    );
  };
  return { updateReaction };
};

type ThreadData = RouterOutputs["comments"]["getForumComments"];
