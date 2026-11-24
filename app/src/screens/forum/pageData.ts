import { cache } from "react";
import { buildForumContext, loadForumAccess, loadForumStructure } from "@/libs/forum";
import { drizzleDB } from "@/server/db";

/**
 * Board structure shared by a server render and its guest-visibility metadata check.
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
