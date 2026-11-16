import { cache } from "react";
import { buildForumContext, loadForumAccess, loadForumStructure } from "@/libs/forum";
import { fetchThread } from "@/queries/forum";
import { drizzleDB } from "@/server/db";

/**
 * Forum reads shared by a server render and its generateMetadata, so a page and its
 * guest-visibility metadata check load the board structure and topic once.
 */
const getForumStructure = cache(() => loadForumStructure(drizzleDB));

/** The forum access snapshot for one account, or for a guest when `userId` is null. */
export const getPageForumContext = cache(async (userId: string | null) => {
  const [structure, access] = await Promise.all([
    getForumStructure(),
    loadForumAccess(drizzleDB, userId),
  ]);
  return buildForumContext(structure, access);
});

/** A topic row without visibility filtering; callers authorize it against a context. */
export const getPageThread = cache(
  async (threadId: string) => await fetchThread(drizzleDB, threadId),
);
