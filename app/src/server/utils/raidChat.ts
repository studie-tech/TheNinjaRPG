import { and, eq, inArray, like } from "drizzle-orm";
import { user2conversation } from "@/drizzle/schema";
import { RAID_CHAT_CONVERSATION_LIKE_PATTERN } from "@/libs/raids";
import type { DrizzleClient } from "@/server/db";

/**
 * Delete user2conversation rows for a single raid-chat conversation,
 * scoped to one user or a set of users. Returns the Drizzle query so callers
 * can batch it inside their own `Promise.all`.
 *
 * Guards against an empty `userIds` array — Drizzle's `inArray` emits invalid
 * `IN ()` SQL on an empty list, which MySQL rejects. Callers (e.g. rollback
 * paths) may legitimately pass an empty attacker list, so resolve to undefined
 * in that case to keep the call site's `Promise.all` shape intact.
 */
export const purgeRaidChatMembership = (
  client: DrizzleClient,
  conversationId: string,
  userIds: string | string[],
) => {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (ids.length === 0) return Promise.resolve(undefined);
  return client
    .delete(user2conversation)
    .where(
      and(
        eq(user2conversation.conversationId, conversationId),
        inArray(user2conversation.userId, ids),
      ),
    );
};

/**
 * Drop every raid-chat membership owned by a single user. Used when the
 * specific raid id is not recoverable (orphaned queue rows) and we have to
 * conservatively clear all stale raid-chat access.
 */
export const purgeAllRaidChatMembershipsForUser = (
  client: DrizzleClient,
  userId: string,
) =>
  client
    .delete(user2conversation)
    .where(
      and(
        eq(user2conversation.userId, userId),
        like(user2conversation.conversationId, RAID_CHAT_CONVERSATION_LIKE_PATTERN),
      ),
    );
