import { nanoid } from "nanoid";
import { z } from "zod";
import { eq, or, and, sql, desc, asc, inArray, isNull, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { format } from "date-fns";
import {
  village,
  userBlackList,
  conversation,
  userReportComment,
  forumPost,
  forumThread,
  userData,
} from "@/drizzle/schema";
import { user2conversation, conversationComment } from "@/drizzle/schema";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
  hasUserMiddleware,
} from "@/server/api/trpc";
import { getNewReactions, processMentions } from "@/utils/chat";
import { serverError, baseServerResponse, errorResponse } from "@/server/api/trpc";
import { mutateCommentSchema } from "@/validators/comments";
import { reportCommentSchema } from "@/validators/reports";
import { deleteCommentSchema } from "@/validators/comments";
import { canPostReportComment } from "@/utils/permissions";
import { canSeeReport } from "@/utils/permissions";
import { canDeleteComment } from "@/utils/permissions";
import { canModerateRoles } from "@/utils/permissions";
import { canSeeSecretData } from "@/utils/permissions";
import { createConversationSchema } from "@/validators/comments";
import { getServerPusher } from "@/libs/pusher";
import { fetchUserReport } from "@/routers/reports";
import { fetchThread } from "@/routers/forum";
import { fetchUser } from "@/routers/profile";
import { canViewConversation } from "@/utils/permissions";
import { moderateContent } from "@/libs/moderator";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { checkForBadWords } from "@/utils/profanity";
import sanitize from "@/utils/sanitize";
import { resolveSenderId } from "@/libs/comments";
import type { DrizzleClient } from "@/server/db";

export const commentsRouter = createTRPCRouter({
  /**
   * USER REPORTS
   * Creating, editing, deleting and getting comments on user reports
   */
  getReportComments: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      const [report, user] = await Promise.all([
        fetchUserReport(ctx.drizzle, input.id, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Get comments
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const comments = await ctx.drizzle.query.userReportComment.findMany({
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
      const nextCursor = comments.length < input.limit ? null : currentCursor + 1;
      // If not able to see secret data, hide reporter
      if (!canSeeSecretData(user.role)) {
        comments.forEach((comment) => {
          if (comment.user.role !== "USER") {
            comment.user.username = "moderator";
            comment.user.avatar = IMG_AVATAR_DEFAULT;
            comment.user.rank = "STUDENT";
            comment.user.isOutlaw = false;
            comment.user.level = 0;
            comment.user.role = "MODERATOR";
            comment.user.federalStatus = "NONE";
          }
        });
      }
      return {
        data: comments,
        nextCursor: nextCursor,
      };
    }),
  createReportComment: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .output(baseServerResponse)
    .input(reportCommentSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (!canPostReportComment(report)) return errorResponse("Already resolved");
      if (!canSeeReport(user, report)) return errorResponse("No access to report");
      // Update
      await ctx.drizzle.insert(userReportComment).values({
        id: nanoid(),
        userId: ctx.userId,
        reportId: input.object_id,
        content: sanitize(input.comment),
      });
      return { success: true, message: "Comment posted" };
    }),
  /**
   * FORUM POSTS
   * Creating, editing, deleting and getting comments on forum threads
   */
  getForumComments: publicProcedure
    .input(
      z.object({
        thread_id: z.string(),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const [thread, comments, counts] = await Promise.all([
        fetchThread(ctx.drizzle, input.thread_id),
        ctx.drizzle.query.forumPost.findMany({
          offset: skip,
          limit: input.limit,
          where: eq(forumPost.threadId, input.thread_id),
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
          orderBy: [asc(forumPost.createdAt)],
        }),
        ctx.drizzle
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(forumPost)
          .where(eq(forumPost.threadId, input.thread_id)),
      ]);
      const nextCursor = comments.length < input.limit ? null : currentCursor + 1;
      const totalComments = counts?.[0]?.count || 0;
      return {
        thread: thread,
        data: comments,
        nextCursor: nextCursor,
        totalComments: totalComments,
        totalPages: Math.ceil(totalComments / input.limit),
      };
    }),
  createForumComment: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(mutateCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, thread, sender] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchThread(ctx.drizzle, input.object_id),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
      ]);
      // Resolve effective poster (allow staff to post as AI)
      const effectiveUserId = resolveSenderId(user, sender);
      // Guard
      if (user.isBanned || user.isSilenced) {
        return errorResponse("You are banned");
      }
      if (!thread) {
        return errorResponse("Thread not found");
      }
      const moderationResult = await checkForBadWords(input.comment);
      if (!moderationResult.success) return moderationResult;
      // Mutate
      const sanitized = sanitize(input.comment);
      const createdId = nanoid();
      await Promise.all([
        moderateContent(ctx.drizzle, {
          content: sanitized,
          userId: ctx.userId,
          relationType: "forumPost",
          relationId: createdId,
          contextId: thread.id,
        }),
        ctx.drizzle.insert(forumPost).values({
          id: createdId,
          userId: effectiveUserId,
          threadId: thread.id,
          content: sanitized,
          authorId: ctx.userId,
        }),
        ctx.drizzle
          .update(forumThread)
          .set({ nPosts: sql`nPosts + 1` })
          .where(eq(forumThread.id, thread.id)),
      ]);
      return { success: true, message: "Comment posted" };
    }),
  editForumComment: protectedProcedure
    .input(mutateCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.forumPost.findFirst({
          where: and(
            eq(forumPost.id, input.object_id),
            eq(forumPost.userId, ctx.userId),
          ),
        }),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      const moderationResult = await checkForBadWords(input.comment);
      if (!moderationResult.success) return moderationResult;
      // Mutate
      const postId = input.object_id;
      const sanitized = sanitize(input.comment);
      await Promise.all([
        moderateContent(ctx.drizzle, {
          content: sanitized,
          userId: ctx.userId,
          relationType: "forumPost",
          relationId: postId,
        }),
        ctx.drizzle
          .update(forumPost)
          .set({ content: sanitized })
          .where(eq(forumPost.id, postId)),
      ]);
      return { success: true, message: "Comment edited" };
    }),
  deleteForumComment: protectedProcedure
    .input(deleteCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.forumPost.findFirst({
          where: and(eq(forumPost.id, input.id)),
        }),
      ]);
      // Guard
      if (!comment) return errorResponse("Comment not found");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!canDeleteComment(user, comment.userId)) {
        return errorResponse("You can only delete own comments");
      }
      // Mutate
      await ctx.drizzle.delete(forumPost).where(eq(forumPost.id, input.id));
      return { success: true, message: "Comment deleted" };
    }),
  /**
   * Conversation POSTS
   * Creating, editing, deleting and getting comments on forum threads
   */
  getUserConversations: protectedProcedure
    .input(z.object({ selectedConvo: z.string().nullish().optional() }))
    .query(async ({ ctx }) => {
      // Query
      const [data] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
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
        }),
        // Remove the counter of new conversations
        ctx.drizzle
          .update(userData)
          .set({ inboxNews: 0 })
          .where(eq(userData.userId, ctx.userId)),
      ]);
      // Filter off blacklisted conversations
      const filteredConverations = data?.conversations
        .filter(
          (c) =>
            c.conversation &&
            !c.conversation.users
              .filter((u) => u.userData)
              .every((u) =>
                data.creatorBlacklist.some(
                  (b) =>
                    b.targetUserId === u.userId && !canSeeSecretData(u.userData.role),
                ),
              ),
        )
        .map((c) => ({
          ...c.conversation,
          users: c.conversation!.users.filter((u) => u.userData),
        }))
        .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
      // Return filtered conversations
      return filteredConverations;
    }),
  createConversation: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(createConversationSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, sender] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
      ]);
      // Guard
      if (user.isBanned || user.isSilenced) {
        throw serverError("UNAUTHORIZED", "You are banned");
      }
      const effectiveUserId = resolveSenderId(user, sender);
      // Mutate
      const convoId = await createConvo({
        client: ctx.drizzle,
        authorUserId: ctx.userId,
        senderUserId: effectiveUserId,
        receiverUserIds: input.users,
        title: input.title,
        content: input.comment,
      });
      return { conversationId: convoId };
    }),
  exitConversation: protectedProcedure
    .input(z.object({ convo_id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, convo] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchConversation({
          client: ctx.drizzle,
          id: input.convo_id,
          userId: ctx.userId,
        }),
      ]);
      // Guard
      if (!convo) return errorResponse("Conversation not found");
      if (!canViewConversation(convo, ctx.userId, user.role)) {
        return errorResponse("You are not allowed to view this conversation");
      }
      // Mutate
      await ctx.drizzle
        .delete(user2conversation)
        .where(
          and(
            eq(user2conversation.conversationId, convo.id),
            eq(user2conversation.userId, ctx.userId),
          ),
        );
      if (convo.users.length === 1) {
        await ctx.drizzle.delete(conversation).where(eq(conversation.id, convo.id));
        await ctx.drizzle
          .delete(conversationComment)
          .where(eq(conversationComment.conversationId, convo.id));
      }
      return { success: true, message: "Conversation exited" };
    }),
  fetchConversationComment: protectedProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const posterUser = alias(userData, "posterUser");
      const readerUser = alias(userData, "readerUser");
      const posterBlacklist = alias(userBlackList, "posterBlacklist");
      const readerBlacklist = alias(userBlackList, "readerBlacklist");
      const comment = await ctx.drizzle
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
          customTitle: posterUser.customTitle,
          federalStatus: posterUser.federalStatus,
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
            or(isNull(readerBlacklist.id), inArray(posterUser.role, canModerateRoles)),
            isNull(posterBlacklist.id),
          ),
        );
      return comment?.[0] || null;
    }),
  getConversationComments: protectedProcedure
    .input(
      z
        .object({
          convo_id: z.string().optional(),
          convo_title: z.string().min(1).max(30).optional(),
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(100),
          refreshKey: z.number(),
          searchQuery: z.string().optional(),
        })
        .refine(
          (data) => !!data.convo_id || !!data.convo_title,
          "Either convo_id or convo_title is required",
        ),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      // Guard
      if (!input.convo_id && !input.convo_title) {
        throw serverError(
          "BAD_REQUEST",
          "Invalid request; must specify either ID or title",
        );
      }
      // Fetch data
      const [user, convo] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchConversation({
          client: ctx.drizzle,
          id: input.convo_id,
          title: input.convo_title,
          userId: ctx.userId,
        }),
      ]);
      // Guard
      if (!convo) {
        return {
          convo: null,
          data: [],
          nextCursor: null,
        };
      }
      if (!canViewConversation(convo, ctx.userId, user.role)) {
        return {
          convo: null,
          data: [],
          nextCursor: null,
        };
      }

      // Build aliases
      const posterBlacklist = alias(userBlackList, "posterBlacklist");
      const readerBlacklist = alias(userBlackList, "readerBlacklist");

      // Build where conditions
      let whereConditions = and(
        eq(conversationComment.conversationId, convo.id),
        or(isNull(readerBlacklist.id), inArray(userData.role, canModerateRoles)),
        isNull(posterBlacklist.id),
      );

      // Add search filter if searchQuery is provided
      if (input.searchQuery && input.searchQuery.trim() !== "") {
        whereConditions = and(
          whereConditions,
          or(
            sql`${conversationComment.content} LIKE ${`%${input.searchQuery}%`}`,
            sql`${userData.username} LIKE ${`%${input.searchQuery}%`}`,
          ),
        );
      }

      const [comments] = await Promise.all([
        ctx.drizzle
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
            customTitle: userData.customTitle,
            federalStatus: userData.federalStatus,
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
          .offset(skip),
        // Update last read
        ...(convo.isPublic
          ? []
          : [
              ctx.drizzle
                .update(user2conversation)
                .set({ lastReadAt: new Date() })
                .where(
                  and(
                    eq(user2conversation.userId, ctx.userId),
                    eq(user2conversation.conversationId, convo.id),
                  ),
                ),
            ]),
      ]);
      // Fetch
      const nextCursor = comments.length < input.limit ? null : currentCursor + 1;
      return {
        convo: convo,
        data: comments,
        nextCursor: nextCursor,
      };
    }),
  createConversationComment: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(mutateCommentSchema)
    .output(baseServerResponse.extend({ commentId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch data
      const [convo, user, quotes, sender] = await Promise.all([
        fetchConversation({
          client: ctx.drizzle,
          id: input.object_id,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchComments(ctx.drizzle, input.quoteIds || []),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
      ]);

      // Resolve effective poster (allow staff to post as AI)
      const effectiveUserId = resolveSenderId(user, sender);
      const effectiveUsername =
        sender && effectiveUserId === sender.userId ? sender.username : user.username;
      // Guard
      if (!convo) return errorResponse("Conversation not found");
      if ((user.isBanned || user.isSilenced) && !convo.isStaffAvailable) {
        return errorResponse("You are banned");
      }
      if (!canViewConversation(convo, ctx.userId, user.role)) {
        return errorResponse("You are not allowed to view this conversation");
      }
      // Check if conversation is disabled (for USER role only)
      if (!convo.isEnabled && user.role === "USER") {
        return errorResponse("This conversation is currently disabled.");
      }
      quotes.forEach((quote) => {
        if (quote.conversationId !== convo.id) {
          throw serverError("BAD_REQUEST", "Quote not found");
        }
      });

      // Update conversation & update user notifications
      const commentId = nanoid();
      const pusher = getServerPusher();

      // For staff accounts, verify the language is appropriate
      const moderationResult = await checkForBadWords(input.comment);
      if (!moderationResult.success) return moderationResult;

      // Create the content, santizied & with added quotes
      let content = input.comment;
      if (quotes.length > 0) {
        const quoteContent = quotes
          .map(
            (q) =>
              `<blockquote author="${q.user?.username || "Unknown"}" date="${format(q.createdAt, "MM/dd/yyyy")}">${q.content}</blockquote>`,
          )
          .join("");
        content = `${quoteContent}\n\n${content}`;
      }

      // Extract all mentioned usernames before sanitizing
      const { processedContent, mentionedUserNames } = processMentions(content);
      const sanitized = sanitize(processedContent);

      // Derived
      const usersIdsInConvo = convo.users.map((u) => u.userId);

      // Extract quoted user IDs - filter out null/undefined values
      const quotedUserIds = quotes
        .filter((q) => q.user?.userId)
        .map((q) => q.user?.userId)
        .filter((id): id is string => !!id);

      // Fetch users to notify about mentions and quotes
      const notifiedUserIds = await fetchUsersToNotify(
        ctx.drizzle,
        ctx.userId,
        mentionedUserNames,
        quotedUserIds,
      );

      // Database mutations first (must complete before Pusher notifications)
      await Promise.all([
        // Insert into DB
        ctx.drizzle.insert(conversationComment).values({
          id: commentId,
          content: sanitized,
          userId: effectiveUserId,
          authorId: ctx.userId,
          conversationId: convo.id,
        }),
        // Update conversation
        ctx.drizzle
          .update(conversation)
          .set({ updatedAt: new Date() })
          .where(eq(conversation.id, convo.id)),
        // Inbox news (database update)
        ...(usersIdsInConvo.length > 0 && !convo.isPublic
          ? [
              ctx.drizzle
                .update(userData)
                .set({ inboxNews: sql`${userData.inboxNews} + 1` })
                .where(inArray(userData.userId, usersIdsInConvo)),
            ]
          : []),
        // Auto-moderation and stats
        ...(convo.isPublic
          ? [
              moderateContent(ctx.drizzle, {
                content: sanitized,
                userId: ctx.userId,
                relationType: "comment",
                relationId: commentId,
                contextId: convo.id,
              }),
              ctx.drizzle
                .update(userData)
                .set({ tavernMessages: sql`${userData.tavernMessages} + 1` })
                .where(eq(userData.userId, effectiveUserId)),
            ]
          : []),
      ]);

      // Pusher notifications (fire after DB commit, don't await)
      void Promise.all([
        // Ping users (both mentioned and quoted, only those not in a blacklist relationship)
        ...notifiedUserIds.map(({ userId, type }) =>
          pusher.trigger(userId, "event", {
            type: "pinged",
            message: `${effectiveUsername} ${type === "mentioned" ? "pinged" : "quoted"} you in ${convo.title}`,
          }),
        ),
        // Trigger new comment event
        pusher.trigger(convo.id, "event", {
          message: "new",
          fromId: effectiveUserId,
          commentId: commentId,
        }),
        // Inbox news (pusher notifications)
        ...(usersIdsInConvo.length > 0 && !convo.isPublic
          ? usersIdsInConvo
              .filter((id) => id !== effectiveUserId)
              .map((userId) => pusher.trigger(userId, "event", { type: "newInbox" }))
          : []),
      ]);

      return { success: true, message: "Comment posted", commentId: commentId };
    }),
  reactConversationComment: protectedProcedure
    .input(z.object({ commentId: z.string(), emoji: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.conversationComment.findFirst({
          where: eq(conversationComment.id, input.commentId),
        }),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      // Figure out new reactions
      const newReactions = getNewReactions(
        comment.reactions,
        input.emoji,
        user.username,
      );
      // Update the conversation & mutate
      const pusher = getServerPusher();
      await Promise.all([
        ctx.drizzle
          .update(conversationComment)
          .set({ reactions: newReactions })
          .where(eq(conversationComment.id, input.commentId)),
        ...(comment?.conversationId
          ? [
              pusher.trigger(comment.conversationId, "event", {
                message: "reaction",
                fromId: ctx.userId,
                commentId: comment.id,
                emoji: input.emoji,
                username: user.username,
              }),
            ]
          : []),
      ]);
      return { success: true, message: "Reaction added" };
    }),
  sendTypingIndicator: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .use(ratelimitMiddleware)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) return errorResponse("You are not logged in");
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const pusher = getServerPusher();
      void pusher.trigger(input.conversationId, "event", {
        message: "typing",
        fromId: ctx.userId,
        username: user.username,
      });
      return { success: true };
    }),
  editConversationComment: protectedProcedure
    .input(mutateCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.conversationComment.findFirst({
          where: and(
            eq(conversationComment.id, input.object_id),
            eq(conversationComment.userId, ctx.userId),
          ),
        }),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      const moderationResult = await checkForBadWords(input.comment);
      if (!moderationResult.success) return moderationResult;
      // Mutate
      const commentId = input.object_id;
      const sanitized = sanitize(input.comment);
      await Promise.all([
        moderateContent(ctx.drizzle, {
          content: sanitized,
          userId: ctx.userId,
          relationType: "comment",
          relationId: commentId,
        }),
        ctx.drizzle
          .update(conversationComment)
          .set({ content: sanitized })
          .where(eq(conversationComment.id, commentId)),
      ]);
      return { success: true, message: "Comment edited" };
    }),
  deleteConversationComment: protectedProcedure
    .input(deleteCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.conversationComment.findFirst({
          where: eq(conversationComment.id, input.id),
        }),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      if (!canDeleteComment(user, comment.userId)) {
        return errorResponse("You can only delete own comments");
      }
      // Mutate
      await ctx.drizzle
        .delete(conversationComment)
        .where(eq(conversationComment.id, input.id));
      return { success: true, message: "Comment deleted" };
    }),
});

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

interface FetchConvoOptions {
  client: DrizzleClient;
  id?: string;
  title?: string;
  userId?: string;
}

/**
 * Fetches a conversation based on the provided options.
 * @param params - The options for fetching the conversation.
 * @returns The fetched conversation if it exists and the user is authorized, otherwise throws an error.
 * @throws {ServerError} If the request is invalid or the conversation is not found.
 */
export const fetchConversation = async (params: FetchConvoOptions) => {
  const { client, id, title } = params;
  const getConvo = async () => {
    if (id) {
      return await client.query.conversation.findFirst({
        where: eq(conversation.id, id),
        with: { users: true },
        orderBy: [desc(conversation.isPublic)],
      });
    } else if (title) {
      return await client.query.conversation.findFirst({
        where: eq(conversation.title, title),
        with: { users: true },
        orderBy: [desc(conversation.isPublic)],
      });
    } else {
      throw serverError("BAD_REQUEST", "Invalid request");
    }
  };
  const convo = await getConvo();
  if (convo) {
    return convo;
  } else {
    return null;
  }
};

/**
 * Creates a conversation with the given parameters and performs necessary database operations.
 * @param client - The DrizzleClient instance used for database operations.
 * @param senderUserId - The ID of the user who is creating the conversation.
 * @param receiverUserIds - An array of user IDs who will receive the conversation.
 * @param title - The title of the conversation.
 * @param content - The content of the first comment in the conversation.
 */
export const createConvo = async (info: {
  client: DrizzleClient;
  authorUserId: string;
  senderUserId: string;
  receiverUserIds: string[];
  title: string;
  content: string;
  isStaffAvailable?: boolean;
  convoId?: string;
  isPublic?: boolean;
}) => {
  const {
    client,
    authorUserId,
    senderUserId,
    receiverUserIds,
    title,
    content,
    convoId,
    isStaffAvailable = false,
    isPublic = false,
  } = info;
  // Push notifications early
  const pusher = getServerPusher();
  receiverUserIds.forEach(
    (userId) => void pusher.trigger(userId, "event", { type: "newInbox" }),
  );
  // Unique users to insert in conversation
  const uniqueUserIds = [...new Set([...receiverUserIds, senderUserId, authorUserId])];
  // Update DB concurrently
  const insertId = convoId ?? nanoid();
  const messageId = nanoid();
  const sanitized = sanitize(content);
  await Promise.all([
    client.insert(conversation).values({
      id: insertId,
      title: title,
      createdById: senderUserId,
      isPublic: isPublic,
      isLocked: false,
      isStaffAvailable: isStaffAvailable,
    }),
    ...uniqueUserIds.map((user) =>
      client.insert(user2conversation).values({
        conversationId: insertId,
        userId: user,
      }),
    ),
    ...(receiverUserIds.length > 0
      ? [
          client
            .update(userData)
            .set({ inboxNews: sql`${userData.inboxNews} + 1` })
            .where(inArray(userData.userId, receiverUserIds)),
        ]
      : []),
    client.insert(conversationComment).values({
      id: messageId,
      content: sanitized,
      userId: senderUserId,
      authorId: authorUserId,
      conversationId: insertId,
    }),
  ]);
  return insertId;
};

/**
 * Interface for users to be notified in comments
 */
interface NotifiedUser {
  userId: string;
  type: "mentioned" | "quoted";
}

/**
 * Fetches users to notify about mentions and quotes, checking for blacklists
 * @param options - The options for fetching users to notify
 * @returns Array of user IDs with notification types
 */
export const fetchUsersToNotify = async (
  client: DrizzleClient,
  currentUserId: string,
  mentionedUserNames: string[],
  quotedUserIds: string[],
) => {
  const notifiedUserIds: NotifiedUser[] = [];

  const hasMentions = mentionedUserNames.length > 0;
  const hasQuotes = quotedUserIds.length > 0;

  if (!hasMentions && !hasQuotes) {
    return notifiedUserIds;
  }

  // Build the query for fetching users
  const whereClause =
    hasQuotes && hasMentions
      ? or(
          inArray(userData.username, mentionedUserNames),
          inArray(userData.userId, quotedUserIds),
        )
      : hasMentions
        ? inArray(userData.username, mentionedUserNames)
        : inArray(userData.userId, quotedUserIds);

  // Execute the query with the appropriate where conditions
  const usersWithBlacklist = await client.query.userData.findMany({
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

  // Process results - filtering out those who have blacklisted the current user
  for (const user of usersWithBlacklist) {
    // Skip if user has blacklisted the sender or it's the current user
    if (user.creatorBlacklist.length > 0 || user.userId === currentUserId) {
      continue;
    }

    // Determine notification type (prioritize mentions over quotes if both apply)
    let type: "mentioned" | "quoted" = "quoted";

    // Check if user was mentioned by username
    if (mentionedUserNames.includes(user.username)) {
      type = "mentioned";
    }

    notifiedUserIds.push({ userId: user.userId, type });
  }

  return notifiedUserIds;
};
