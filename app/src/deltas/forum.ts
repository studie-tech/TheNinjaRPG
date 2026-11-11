/** One player's confirmed reaction state on a forum post. */
export interface ForumReactionChange {
  postId: string;
  userId: string;
  reaction: string;
  active: boolean;
}

/**
 * Apply a confirmed reaction to a cached thread page. The server stores reactions
 * idempotently, so the patch sets the player's entry present or absent rather than
 * toggling it; pages without the post are returned unchanged.
 */
export const applyForumReaction = <
  Page extends {
    data: { id: string; reactions: { userId: string; reaction: string }[] }[];
  },
>(
  page: Page,
  change: ForumReactionChange,
): Page => {
  if (!page.data.some((post) => post.id === change.postId)) return page;
  return {
    ...page,
    data: page.data.map((post) => {
      if (post.id !== change.postId) return post;
      const others = post.reactions.filter(
        (entry) =>
          !(entry.userId === change.userId && entry.reaction === change.reaction),
      );
      return {
        ...post,
        reactions: change.active
          ? [...others, { userId: change.userId, reaction: change.reaction }]
          : others,
      };
    }),
  };
};
