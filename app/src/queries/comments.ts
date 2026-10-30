/**
 * Database access for comments; authorization and transaction scopes stay in callers.
 */

import type { SupportTicketStatus, UserRole } from "@/drizzle/constants";

/**
 * Fetches comments from the database.
 * @param client - The DrizzleClient instance used for database operations.
 * @param ids - An array of comment IDs to fetch.
 * @returns An array of comments.
 */
export const fetchComments = async (client: DrizzleClient, ids: string[]) => {
  if (ids.length > 0) {
    const comments = await client.query.conversationComment.findMany({
      where: inArray(conversationComment.id, ids),
      with: {
        user: {
          columns: {
            userId: true,
            username: true,
          },
        },
      },
    });
    return comments;
  } else {
    return [];
  }
};

/**
 * Retained senders must stay subject to approval after leaving a private conversation.
 * Without an explicit conversation ID, loads senders across the account's memberships.
 */
export const fetchPrivateConversationSenders = (
  client: DrizzleClient,
  userId: string,
  conversationId?: string,
) =>
  client
    .selectDistinct({
      conversationId: conversationComment.conversationId,
      userId: conversationComment.userId,
    })
    .from(conversationComment)
    .innerJoin(conversation, eq(conversation.id, conversationComment.conversationId))
    .where(
      and(
        eq(conversation.isPublic, false),
        eq(conversation.isStaffAvailable, false),
        conversationId
          ? eq(conversationComment.conversationId, conversationId)
          : inArray(
              conversationComment.conversationId,
              client
                .select({ conversationId: user2conversation.conversationId })
                .from(user2conversation)
                .where(eq(user2conversation.userId, userId)),
            ),
      ),
    );

/** Build the `userData` listing, selecting row fields `userId` and `username`, using predicates on `targetUserId`. */
export const listNotificationUserCandidates = (
  client: DrizzleClient,
  whereClause: SQL | undefined,
  currentUserId: string,
) =>
  client.query.userData.findMany({
    where: whereClause,
    columns: {
      userId: true,
      username: true,
    },
    with: {
      // Users who have blacklisted the sender (current user is the target)
      creatorBlacklist: {
        where: eq(userBlackList.targetUserId, currentUserId),
      },
    },
  });

import type { SQL } from "drizzle-orm";
import { and, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  conversation,
  conversationComment,
  supportTicket,
  supportTicketActivity,
  user2conversation,
  userBlackList,
  userData,
  userReportComment,
  village,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { displayTitleSql } from "@/server/utils/titleDisplay";
import { canModerateRoles, canSeeSecretData } from "@/utils/permissions";
import sanitize from "@/utils/sanitize";

/** Table alias for reader blacklist joins, keeping its columns distinct from other participants. */
const readerBlacklist = alias(userBlackList, "readerBlacklist");

/** Table alias for poster blacklist joins, keeping its columns distinct from other participants. */
const posterBlacklist = alias(userBlackList, "posterBlacklist");

/** Table alias for reader user joins, keeping its columns distinct from other participants. */
const readerUser = alias(userData, "readerUser");

/** Table alias for poster user joins, keeping its columns distinct from other participants. */
const posterUser = alias(userData, "posterUser");
/** Build the `userReportComment` listing for `getReportComments`, using predicates on `reportId`. */
export const listUserReportCommentForGetReportComments = (
  client: Pick<DrizzleClient, "query">,
  skip: number,
  input: { limit: number },
  report: { id: string },
) =>
  client.query.userReportComment.findMany({
    offset: skip,
    limit: input.limit,
    where: eq(userReportComment.reportId, report.id),
    with: {
      user: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          rank: true,
          isOutlaw: true,
          level: true,
          role: true,
          federalStatus: true,
        },
      },
    },
    orderBy: [desc(userReportComment.createdAt)],
  });

/** Build the `userReportComment` insert for `createReportComment`. */
export const insertUserReportCommentForCreateReportComment = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { object_id: string; comment: string },
) =>
  client.insert(userReportComment).values({
    id: nanoid(),
    userId: ctx.userId,
    reportId: input.object_id,
    content: sanitize(input.comment),
  });

/** Build the `userData` lookup for `getUserConversations`, using predicates on `userId`. */
export const findUserDataForGetUserConversations = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    with: {
      creatorBlacklist: true,
      conversations: {
        with: {
          conversation: {
            with: {
              users: {
                with: {
                  userData: {
                    columns: {
                      userId: true,
                      username: true,
                      avatar: true,
                      role: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

/** Build the `userData` update for `getUserConversations`, setting `inboxNews`, using predicates on `userId`. */
export const updateUserDataForGetUserConversations = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
) =>
  client.update(userData).set({ inboxNews: 0 }).where(eq(userData.userId, ctx.userId));

/** Build the `supportTicket` lookup for `exitConversation`, selecting only `id`, using predicates on `conversationId`. */
export const findSupportTicketForExitConversation = (
  client: Pick<DrizzleClient, "query">,
  input: { convo_id: string },
) =>
  client.query.supportTicket.findFirst({
    where: eq(supportTicket.conversationId, input.convo_id),
    columns: { id: true },
  });

/** Build the `conversation` deletion for `exitConversation`, using predicates on `id`. */
export const deleteConversationForExitConversation = (
  client: Pick<DrizzleClient, "delete">,
  convo: { id: string },
  noMembersLeft: SQL<unknown>,
) =>
  client.delete(conversation).where(and(eq(conversation.id, convo.id), noMembersLeft));

/** Build the `conversationComment` deletion for `exitConversation`, using predicates on `conversationId`. */
export const deleteConversationCommentForExitConversation = (
  client: Pick<DrizzleClient, "delete">,
  convo: { id: string },
  noMembersLeft: SQL<unknown>,
) =>
  client
    .delete(conversationComment)
    .where(and(eq(conversationComment.conversationId, convo.id), noMembersLeft));

/**
 * Build the `conversationComment` selection for `fetchConversationComment`, using
 * predicates on `id`, `conversationId`, `role`.
 */
export const selectConversationCommentForFetchConversationComment = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: { commentId: string; conversationId?: undefined | string },
) =>
  client
    .select({
      id: conversationComment.id,
      createdAt: conversationComment.createdAt,
      content: conversationComment.content,
      conversationId: conversationComment.conversationId,
      authorId: conversationComment.authorId,
      isPinned: conversationComment.isPinned,
      isReported: conversationComment.isReported,
      reactions: conversationComment.reactions,
      villageName: village.name,
      villageHexColor: village.hexColor,
      villageKageId: village.kageId,
      userId: posterUser.userId,
      username: posterUser.username,
      avatar: posterUser.avatar,
      rank: posterUser.rank,
      isOutlaw: posterUser.isOutlaw,
      level: posterUser.level,
      role: posterUser.role,
      readerRole: readerUser.role,
      displayTitle: displayTitleSql(posterUser),
      federalStatus: posterUser.federalStatus,
      tavernUsernameColor: posterUser.tavernUsernameColor,
      tavernTitleColor: posterUser.tavernTitleColor,
      nRecruited: posterUser.nRecruited,
      tavernMessages: posterUser.tavernMessages,
      isStaffOnly: conversationComment.isStaffOnly,
    })
    .from(conversationComment)
    .innerJoin(posterUser, eq(posterUser.userId, conversationComment.userId))
    .innerJoin(readerUser, eq(readerUser.userId, ctx.userId))
    .leftJoin(
      posterBlacklist,
      and(
        notInArray(readerUser.role, canModerateRoles),
        eq(posterBlacklist.creatorUserId, conversationComment.userId),
        eq(posterBlacklist.targetUserId, ctx.userId),
      ),
    )
    .leftJoin(
      readerBlacklist,
      and(
        eq(readerBlacklist.creatorUserId, ctx.userId),
        eq(readerBlacklist.targetUserId, conversationComment.userId),
      ),
    )
    .leftJoin(village, eq(village.id, posterUser.villageId))
    .where(
      and(
        eq(conversationComment.id, input.commentId),
        input.conversationId
          ? eq(conversationComment.conversationId, input.conversationId)
          : undefined,
        or(isNull(readerBlacklist.id), inArray(posterUser.role, canModerateRoles)),
        isNull(posterBlacklist.id),
      ),
    );

/** Build the `conversationComment` selection for `getConversationComments`, using the configured predicates. */
export const selectConversationCommentForGetConversationComments = (
  client: Pick<DrizzleClient, "select">,
  user: {
    role: UserRole;
  },
  ctx: { userId: string },
  whereConditions: undefined | SQL<unknown>,
  input: { limit: number },
  skip: number,
) =>
  client
    .select({
      id: conversationComment.id,
      createdAt: conversationComment.createdAt,
      content: conversationComment.content,
      conversationId: conversationComment.conversationId,
      authorId: conversationComment.authorId,
      reactions: conversationComment.reactions,
      isPinned: conversationComment.isPinned,
      isReported: conversationComment.isReported,
      villageName: village.name,
      villageHexColor: village.hexColor,
      villageKageId: village.kageId,
      userId: userData.userId,
      username: userData.username,
      avatar: userData.avatar,
      rank: userData.rank,
      isOutlaw: userData.isOutlaw,
      level: userData.level,
      role: userData.role,
      displayTitle: displayTitleSql(userData),
      federalStatus: userData.federalStatus,
      tavernUsernameColor: userData.tavernUsernameColor,
      tavernTitleColor: userData.tavernTitleColor,
      nRecruited: userData.nRecruited,
      tavernMessages: userData.tavernMessages,
      isStaffOnly: conversationComment.isStaffOnly,
    })
    .from(conversationComment)
    .innerJoin(userData, eq(conversationComment.userId, userData.userId))
    .leftJoin(
      posterBlacklist,
      and(
        eq(
          posterBlacklist.creatorUserId,
          canSeeSecretData(user.role) ? "neverfound" : conversationComment.userId,
        ),
        eq(posterBlacklist.targetUserId, ctx.userId),
      ),
    )
    .leftJoin(
      readerBlacklist,
      and(
        eq(readerBlacklist.creatorUserId, ctx.userId),
        eq(readerBlacklist.targetUserId, conversationComment.userId),
      ),
    )
    .leftJoin(village, eq(village.id, userData.villageId))
    .where(whereConditions)
    .orderBy(desc(conversationComment.createdAt))
    .limit(input.limit)
    .offset(skip);

/**
 * Build the `user2conversation` update for `getConversationComments`, setting
 * `lastReadAt`, using predicates on `userId` and `conversationId`.
 */
export const updateUser2conversationForGetConversationComments = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  convo: { id: string },
) =>
  client
    .update(user2conversation)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(user2conversation.userId, ctx.userId),
        eq(user2conversation.conversationId, convo.id),
      ),
    );

/**
 * Build the `supportTicket` lookup for `createConversationComment`, selecting only
 * `createdByUserId`, using predicates on `conversationId`.
 */
export const findSupportTicketForCreateConversationComment = (
  client: Pick<DrizzleClient, "query">,
  convo: { id: string },
) =>
  client.query.supportTicket.findFirst({
    where: eq(supportTicket.conversationId, convo.id),
    columns: { createdByUserId: true },
  });

/** Build a conversation comment insert with separate displayed user and author IDs. */
export const insertConversationComment = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  content: string,
  userId: string,
  authorId: string,
  conversationId: string,
) =>
  client.insert(conversationComment).values({
    id: id,
    content: content,
    userId: userId,
    authorId: authorId,
    conversationId: conversationId,
  });

/** Build the `conversation` update for `createConversationComment`, setting `updatedAt`, using predicates on `id`. */
export const updateConversationForCreateConversationComment = (
  client: Pick<DrizzleClient, "update">,
  convo: { id: string },
) =>
  client
    .update(conversation)
    .set({ updatedAt: new Date() })
    .where(eq(conversation.id, convo.id));

/** Build the `userData` update for `createConversationComment`, setting `inboxNews`, using predicates on `userId`. */
export const updateUserDataForCreateConversationComment = (
  client: Pick<DrizzleClient, "update">,
  usersIdsInConvo: string[],
  conversationId: string,
) =>
  client
    .update(userData)
    .set({ inboxNews: sql`${userData.inboxNews} + 1` })
    .where(
      and(
        inArray(userData.userId, usersIdsInConvo),
        // Muted chat stays readable but no longer counts as new inbox news.
        eq(userData.chatMuted, false),
        sql`NOT JSON_CONTAINS(${userData.mutedConversationIds}, JSON_QUOTE(${conversationId}))`,
      ),
    );

/** Build the `userData` update for `createConversationComment`, setting `tavernMessages`, using predicates on `userId`. */
export const updateUserDataForCreateConversationComment2 = (
  client: Pick<DrizzleClient, "update">,
  effectiveUserId: string,
) =>
  client
    .update(userData)
    .set({ tavernMessages: sql`${userData.tavernMessages} + 1` })
    .where(eq(userData.userId, effectiveUserId));

/** Build a conversation comment lookup by ID. */
export const findConversationCommentById = (
  client: Pick<DrizzleClient, "query">,
  commentId: string,
) =>
  client.query.conversationComment.findFirst({
    where: eq(conversationComment.id, commentId),
  });

/** Build the `conversationComment` update for `reactConversationComment`, setting `reactions`, using predicates on `id`. */
export const updateConversationCommentForReactConversationComment = (
  client: Pick<DrizzleClient, "update">,
  newReactions: Record<string, string[]>,
  input: { commentId: string },
) =>
  client
    .update(conversationComment)
    .set({ reactions: newReactions })
    .where(eq(conversationComment.id, input.commentId));

/**
 * Build the `userData` lookup for `sendTypingIndicator`, selecting only `username` and
 * `role`, using predicates on `userId`.
 */
export const findUserDataForSendTypingIndicator = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    columns: { username: true, role: true },
  });

/** Build the `conversationComment` lookup for `editConversationComment`, using predicates on `id` and `userId`. */
export const findConversationCommentForEditConversationComment = (
  client: Pick<DrizzleClient, "query">,
  input: { object_id: string },
  ctx: { userId: string },
) =>
  client.query.conversationComment.findFirst({
    where: and(
      eq(conversationComment.id, input.object_id),
      eq(conversationComment.userId, ctx.userId),
    ),
  });

/** Build the `conversationComment` update for `editConversationComment`, setting `content`, using predicates on `id`. */
export const updateConversationCommentForEditConversationComment = (
  client: Pick<DrizzleClient, "update">,
  sanitized: string,
  commentId: string,
) =>
  client
    .update(conversationComment)
    .set({ content: sanitized })
    .where(eq(conversationComment.id, commentId));

/** Build the `conversationComment` deletion for `deleteConversationComment`, using predicates on `id`. */
export const deleteConversationCommentForDeleteConversationComment = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(conversationComment).where(eq(conversationComment.id, input.id));

/** Build the `conversation` lookup for `getConvo`, using predicates on `id`. */
export const findConversationForGetConvo = (
  client: Pick<DrizzleClient, "query">,
  id: string,
) =>
  client.query.conversation.findFirst({
    where: eq(conversation.id, id),
    with: { users: true },
  });

/** Build the `conversation` lookup for `getConvo`, using predicates on `title` and `isPublic`. */
export const findConversationForGetConvo2 = (
  client: Pick<DrizzleClient, "query">,
  title: string,
) =>
  client.query.conversation.findFirst({
    where: and(eq(conversation.title, title), eq(conversation.isPublic, true)),
    with: { users: true },
  });

/** Build the `conversation` lookup for `getConvo`, using predicates on `title`. */
export const findConversationForGetConvo3 = (
  client: Pick<DrizzleClient, "query">,
  title: string,
) =>
  client.query.conversation.findFirst({
    where: eq(conversation.title, title),
    with: { users: true },
  });

/** Build the `supportTicket` lookup for `updateSupportTicketStatusAfterComment`, using predicates on `conversationId`. */
export const findSupportTicketForUpdateSupportTicketStatusAfterComment = (
  client: Pick<DrizzleClient, "query">,
  input: { conversationId: string },
) =>
  client.query.supportTicket.findFirst({
    where: eq(supportTicket.conversationId, input.conversationId),
    columns: { id: true, status: true, createdByUserId: true },
  });

/**
 * Build the `supportTicket` update for `updateSupportTicketStatusAfterComment`,
 * setting `status` and `updatedAt`, using predicates on `id` and `status`.
 */
export const updateSupportTicketForUpdateSupportTicketStatusAfterComment = (
  client: Pick<DrizzleClient, "update">,
  nextStatus: SupportTicketStatus,
  ticket: {
    id: string;
    status: SupportTicketStatus;
  },
) =>
  client
    .update(supportTicket)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(
      and(eq(supportTicket.id, ticket.id), eq(supportTicket.status, ticket.status)),
    );

/** Build the `supportTicketActivity` insert for `updateSupportTicketStatusAfterComment`. */
export const insertSupportTicketActivityForUpdateSupportTicketStatusAfterComment = (
  client: Pick<DrizzleClient, "insert">,
  ticket: {
    id: string;
    status: SupportTicketStatus;
  },
  input: { userId: string },
  nextStatus: SupportTicketStatus,
) =>
  client.insert(supportTicketActivity).values({
    id: nanoid(),
    ticketId: ticket.id,
    authorId: input.userId,
    action: "STATUS_CHANGED",
    oldValue: ticket.status,
    newValue: nextStatus,
    metadata: {},
  });

/** Build the `conversation` insert for `createConvo`. */
export const insertConversationForCreateConvo = (
  client: Pick<DrizzleClient, "insert">,
  insertId: string,
  title: string,
  senderUserId: string,
  isPublic: false | true,
  isStaffAvailable: false | true,
) =>
  client.insert(conversation).values({
    id: insertId,
    title: title,
    createdById: senderUserId,
    isPublic: isPublic,
    isLocked: false,
    isStaffAvailable: isStaffAvailable,
  });

/** Build the `user2conversation` insert for `createConvo`. */
export const insertUser2conversationForCreateConvo = (
  client: Pick<DrizzleClient, "insert">,
  insertId: string,
  user: string,
) =>
  client.insert(user2conversation).values({
    conversationId: insertId,
    userId: user,
  });

/** Build conversation membership insertion, retaining existing membership on duplicate keys. */
export const insertConversationMember = (
  client: Pick<DrizzleClient, "insert">,
  conversationId: string,
  userId: string,
) =>
  client
    .insert(user2conversation)
    .values({ conversationId: conversationId, userId })
    .onDuplicateKeyUpdate({ set: { conversationId: sql`conversationId` } });

/** Build deletion of one user’s membership in a conversation. */
export const deleteConversationMembership = (
  client: DrizzleClient,
  conversationId: string,
  userId: string,
) =>
  client
    .delete(user2conversation)
    .where(
      and(
        eq(user2conversation.conversationId, conversationId),
        eq(user2conversation.userId, userId),
      ),
    );
