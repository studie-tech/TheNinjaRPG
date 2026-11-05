/**
 * Database access for sitemap; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  bloodline,
  forumThread,
  guideArticle,
  item,
  jutsu,
  userData,
} from "@/drizzle/schema";
import { profileIndexableWhere } from "@/libs/profileIndexing";
import type { DrizzleClient } from "@/server/db";

/** Build the `bloodline` selection for `manualEntries`, using predicates on `hidden`. */
export const selectBloodlineForManualEntries = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: bloodline.id, updatedAt: bloodline.updatedAt })
    .from(bloodline)
    .where(eq(bloodline.hidden, false));

/** Build the `jutsu` selection for `manualEntries`, using predicates on `hidden`. */
export const selectJutsuForManualEntries = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: jutsu.id, updatedAt: jutsu.updatedAt })
    .from(jutsu)
    .where(eq(jutsu.hidden, false));

/** Build the `item` selection for `manualEntries`, using predicates on `hidden`. */
export const selectItemForManualEntries = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: item.id, updatedAt: item.updatedAt })
    .from(item)
    .where(eq(item.hidden, false));

/** Build the `guideArticle` selection for `guideEntries`, using predicates on `published`. */
export const selectGuideArticleForGuideEntries = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      slug: guideArticle.slug,
      updatedAt: guideArticle.updatedAt,
    })
    .from(guideArticle)
    .where(eq(guideArticle.published, true));

/** Build the `forumThread` selection for `umThreadForForumEntries`. */
export const selectForumThreadForForumEntries = (
  client: Pick<DrizzleClient, "select">,
  MAX_THREADS: 10000,
) =>
  client
    .select({
      id: forumThread.id,
      boardId: forumThread.boardId,
      updatedAt: forumThread.updatedAt,
    })
    .from(forumThread)
    .where(and(isNull(forumThread.deletedAt), eq(forumThread.isApproved, true)))
    .orderBy(desc(forumThread.updatedAt))
    .limit(MAX_THREADS);

/** Build the `userData` selection for `profileEntries`, including predicates on `level`, `updatedAt`, `isAi`. */
export const selectUserDataForProfileEntries = (
  client: Pick<DrizzleClient, "select">,
  MAX_PROFILES: 2000,
) =>
  client
    .select({ username: userData.username, updatedAt: userData.updatedAt })
    .from(userData)
    .where(profileIndexableWhere())
    .orderBy(desc(userData.level))
    .limit(MAX_PROFILES);
