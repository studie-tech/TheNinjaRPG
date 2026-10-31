import { format } from "date-fns";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import {
  type Conversation,
  conversationComment,
  type UserData,
  user2conversation,
  userBlackList,
  userData,
} from "@/drizzle/schema";
import { resolveSenderId } from "@/libs/comments";
import { fetchForumThreadPage, getForumContext } from "@/libs/forum";
import { createForumReply, editForumPost, removeForumPost } from "@/libs/forumActions";
import { deferModeration } from "@/libs/moderation/defer";
import {
  conversationReadRestriction,
  privateConversationRestriction,
} from "@/libs/parentalControls";
import { getServerPusher } from "@/libs/pusher";
import { isRaidChatConversationId } from "@/libs/raids";
import { getStatusAfterComment } from "@/libs/support";
import {
  deleteConversationCommentForDeleteConversationComment,
  deleteConversationCommentForExitConversation,
  deleteConversationForExitConversation,
  deleteConversationMembership,
  fetchComments,
  fetchPrivateConversationSenders,
  findConversationCommentById,
  findConversationCommentForEditConversationComment,
  findConversationForGetConvo,
  findConversationForGetConvo2,
  findConversationForGetConvo3,
  findSupportTicketForCreateConversationComment,
  findSupportTicketForExitConversation,
  findSupportTicketForUpdateSupportTicketStatusAfterComment,
  findUserDataForGetUserConversations,
  findUserDataForSendTypingIndicator,
  insertConversationComment,
  insertConversationForCreateConvo,
  insertSupportTicketActivityForUpdateSupportTicketStatusAfterComment,
  insertUser2conversationForCreateConvo,
  insertUserReportCommentForCreateReportComment,
  listNotificationUserCandidates,
  listUserReportCommentForGetReportComments,
  selectConversationCommentForFetchConversationComment,
  selectConversationCommentForGetConversationComments,
  updateConversationCommentForEditConversationComment,
  updateConversationCommentForReactConversationComment,
  updateConversationForCreateConversationComment,
  updateSupportTicketForUpdateSupportTicketStatusAfterComment,
  updateUser2conversationForGetConversationComments,
  updateUserDataForCreateConversationComment,
  updateUserDataForCreateConversationComment2,
  updateUserDataForGetUserConversations,
} from "@/queries/comments";
import { fetchCommunicationPolicies } from "@/queries/parentalControls";
import { fetchUser } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  notifyConversationMentions,
  notifyPrivateConversation,
} from "@/server/utils/push/social";
import { fetchUserReport } from "@/server/utils/reports";
import { getNewReactions, processMentions } from "@/utils/chat";
import {
  canDeleteComment,
  canModerateRoles,
  canPostReportComment,
  canReplyToStaffConversationWhileRestricted,
  canSeeReport,
  canSeeSecretData,
  canViewConversation,
  getMessagingRestriction,
  isStaffRole,
  RESTRICTED_STAFF_CONVERSATION_MESSAGE,
  RESTRICTED_SUPPORT_TICKET_REPLY_MESSAGE,
} from "@/utils/permissions";
import { checkForBadWords, moderateUserText } from "@/utils/profanity";
import sanitize, { stripBlockquotes } from "@/utils/sanitize";
import {
  createConversationSchema,
  deleteCommentSchema,
  mutateCommentSchema,
} from "@/validators/comments";
import { reportCommentSchema } from "@/validators/reports";

export const commentsRouter = createTRPCRouter({
  /**
   * USER REPORTS
   * Creating, editing, deleting and getting comments on user reports
   */
  getReportComments: protectedProcedure
    .meta({ mcp: { description: "Get comments on a user report" } })
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
      if (!report) throw serverError("NOT_FOUND", "Report not found");
      // Get comments
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const comments = await listUserReportCommentForGetReportComments(
        ctx.drizzle,
        skip,
        input,
        report,
      );
      const nextCursor = comments.length < input.limit ? null : currentCursor + 1;
      // If not able to see secret data, hide reporter
      if (!canSeeSecretData(user.role)) maskStaffReportCommentAuthors(comments);
      return {
        data: comments,
        nextCursor: nextCursor,
      };
    }),
  createReportComment: protectedProcedure
    .meta({ mcp: { description: "Add a comment to a user report" } })
    .use(ratelimitMiddleware)
    .output(baseServerResponse)
    .input(reportCommentSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, report] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReport(ctx.drizzle, input.object_id, ctx.userId),
      ]);
      // Guard
      if (!report) return errorResponse("Report not found");
      if (!canPostReportComment(report)) return errorResponse("Already resolved");
      if (!canSeeReport(user, report)) return errorResponse("No access to report");
      // Update
      await insertUserReportCommentForCreateReportComment(ctx.drizzle, ctx, input);
      return { success: true, message: "Comment posted" };
    }),
  /**
   * FORUM POSTS
   * Creating, editing, deleting and getting comments on forum threads
   */
  getForumComments: publicProcedure
    .meta({ mcp: { description: "Get comments on a forum thread" } })
    .input(
      z.object({
        thread_id: z.string(),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await fetchForumThreadPage(
        ctx.drizzle,
        input,
        await getForumContext(ctx.drizzle, ctx.userId),
      );
    }),
  createForumComment: protectedProcedure
    .use(ratelimitMiddleware)
    .input(mutateCommentSchema)
    .output(baseServerResponse)
    .mutation(({ ctx, input }) => createForumReply(ctx.drizzle, ctx.userId, input)),
  editForumComment: protectedProcedure
    .input(mutateCommentSchema)
    .output(baseServerResponse)
    .mutation(({ ctx, input }) => editForumPost(ctx.drizzle, ctx.userId, input)),
  deleteForumComment: protectedProcedure
    .input(deleteCommentSchema)
    .output(baseServerResponse)
    .mutation(({ ctx, input }) => removeForumPost(ctx.drizzle, ctx.userId, input.id)),
  /**
   * Conversation POSTS
   * Creating, editing, deleting and getting comments on forum threads
   */
  getUserConversations: protectedProcedure
    .meta({ mcp: { description: "Get user's conversations" } })
    .input(z.object({ selectedConvo: z.string().nullish().optional() }))
    .query(async ({ ctx }) => {
      // Query
      const [data, policies, senders] = await Promise.all([
        findUserDataForGetUserConversations(ctx.drizzle, ctx),
        fetchCommunicationPolicies(ctx.drizzle, [ctx.userId]),
        fetchPrivateConversationSenders(ctx.drizzle, ctx.userId),
        // Remove the counter of new conversations
        updateUserDataForGetUserConversations(ctx.drizzle, ctx),
      ]);
      // Filter off blacklisted conversations
      const filteredConverations = data?.conversations
        .filter(
          (c) =>
            c.conversation &&
            !conversationReadRestriction(
              policies[0],
              c.conversation,
              senders
                .filter((sender) => sender.conversationId === c.conversation.id)
                .map((sender) => sender.userId),
            ) &&
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
          // Unread when the conversation changed after this player last read it.
          lastReadAt: c.lastReadAt,
          users: c.conversation?.users.filter((u) => u.userData),
        }))
        .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
      // Return filtered conversations
      return filteredConverations ?? [];
    }),
  createConversation: protectedProcedure
    .meta({ mcp: { description: "Create a new private conversation" } })
    .use(ratelimitMiddleware)
    .input(createConversationSchema)
    .output(baseServerResponse.extend({ conversationId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, sender, titleCheck, moderationResult, policies] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
        checkForBadWords(input.title),
        checkForBadWords(input.comment),
        fetchCommunicationPolicies(ctx.drizzle, [
          ctx.userId,
          ...input.users,
          ...(input.senderId ? [input.senderId] : []),
        ]),
      ]);
      // Guard
      const messagingRestriction = getMessagingRestriction(user);
      if (messagingRestriction) return errorResponse(messagingRestriction);
      const effectiveUserId = resolveSenderId(user, sender);
      const parentalRestriction = privateConversationRestriction(policies, [
        ...new Set([ctx.userId, effectiveUserId, ...input.users]),
      ]);
      if (parentalRestriction) return errorResponse(parentalRestriction);
      if (!titleCheck.success) return titleCheck;
      if (!moderationResult.success) return moderationResult;
      const { processedContent } = processMentions(input.comment);
      // Mutate
      const convoId = await createConvo({
        client: ctx.drizzle,
        authorUserId: ctx.userId,
        senderUserId: effectiveUserId,
        receiverUserIds: input.users,
        title: input.title,
        content: processedContent,
      });
      return { success: true, message: "Message sent.", conversationId: convoId };
    }),
  exitConversation: protectedProcedure
    .meta({ mcp: { description: "Leave a conversation" } })
    .input(z.object({ convo_id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (isRaidChatConversationId(input.convo_id)) {
        return errorResponse("Raid chat membership is managed by the raid queue");
      }
      const [user, convo, linkedSupportTicket] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchConversation({
          client: ctx.drizzle,
          id: input.convo_id,
          userId: ctx.userId,
        }),
        findSupportTicketForExitConversation(ctx.drizzle, input),
      ]);
      // Guard
      if (!convo) return errorResponse("Conversation not found");
      if (!canViewConversation(convo, ctx.userId, user.role)) {
        return errorResponse("You are not allowed to view this conversation");
      }
      // Mutate
      const membershipDeleteResult = await deleteConversationMembership(
        ctx.drizzle,
        convo.id,
        ctx.userId,
      );

      // A support ticket's conversation is its message history with staff, and
      // its creator is its only member, so it must outlive the membership.
      if (membershipDeleteResult.rowsAffected === 1 && !linkedSupportTicket) {
        // Both cleanup deletes only need to know that no membership rows remain,
        // which the awaited membership delete above already settled. Guarding
        // each one on that condition keeps a concurrent exit from wiping a
        // conversation someone still belongs to, without serializing them.
        const noMembersLeft = sql`NOT EXISTS (SELECT 1 FROM ${user2conversation} WHERE ${user2conversation.conversationId} = ${convo.id})`;
        await Promise.all([
          deleteConversationForExitConversation(ctx.drizzle, convo, noMembersLeft),
          deleteConversationCommentForExitConversation(
            ctx.drizzle,
            convo,
            noMembersLeft,
          ),
        ]);
      }
      return { success: true, message: "Conversation exited" };
    }),
  fetchConversationComment: protectedProcedure
    .meta({
      mcp: { description: "Fetch a single conversation comment" },
    })
    .input(
      z.object({
        commentId: z.string(),
        conversationId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [comment, initialConvo] = await Promise.all([
        selectConversationCommentForFetchConversationComment(ctx.drizzle, ctx, input),
        input.conversationId
          ? fetchConversation({
              client: ctx.drizzle,
              id: input.conversationId,
              userId: ctx.userId,
            })
          : undefined,
      ]);
      const found = comment?.[0];
      if (
        !found?.conversationId ||
        (input.conversationId && found.conversationId !== input.conversationId)
      )
        return null;
      // Open tabs may still send only the comment ID; preserve their authorized read path.
      const convo = input.conversationId
        ? initialConvo
        : await fetchConversation({
            client: ctx.drizzle,
            id: found.conversationId,
            userId: ctx.userId,
          });
      if (
        !convo ||
        convo.readRestriction ||
        !canViewConversation(convo, ctx.userId, found.readerRole)
      )
        return null;
      const { readerRole: _readerRole, ...result } = found;
      return result;
    }),
  getConversationComments: protectedProcedure
    .meta({ mcp: { description: "Get messages in a conversation" } })
    .input(
      z
        .object({
          convo_id: z.string().optional(),
          convo_title: z.string().min(1).max(30).optional(),
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(100),
          refreshKey: z.number().optional(),
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
          restrictionMessage: null,
          convo: null,
          data: [],
          nextCursor: null,
        };
      }
      if (!canViewConversation(convo, ctx.userId, user.role)) {
        return {
          restrictionMessage: null,
          convo: null,
          data: [],
          nextCursor: null,
        };
      }

      if (convo.readRestriction) {
        return {
          convo: null,
          data: [],
          nextCursor: null,
          restrictionMessage: convo.readRestriction,
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
        selectConversationCommentForGetConversationComments(
          ctx.drizzle,
          user,
          ctx,
          whereConditions,
          input,
          skip,
        ),
        // Update last read
        ...(convo.isPublic
          ? []
          : [
              updateUser2conversationForGetConversationComments(
                ctx.drizzle,
                ctx,
                convo,
              ),
            ]),
      ]);
      // Fetch
      const nextCursor = comments.length < input.limit ? null : currentCursor + 1;
      return {
        restrictionMessage: null,
        convo: convo,
        data: comments,
        nextCursor: nextCursor,
      };
    }),
  createConversationComment: protectedProcedure
    .meta({ mcp: { description: "Send a message in a conversation" } })
    .use(ratelimitMiddleware)
    .input(mutateCommentSchema)
    .output(baseServerResponse.extend({ commentId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch data
      const [convo, user, quotes, sender, moderationResult] = await Promise.all([
        fetchConversation({
          client: ctx.drizzle,
          id: input.object_id,
          userId: ctx.userId,
        }),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchComments(ctx.drizzle, input.quoteIds || []),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
        checkForBadWords(input.comment),
      ]);

      // Resolve effective poster (allow staff to post as AI)
      const effectiveUserId = resolveSenderId(user, sender);
      const effectiveUsername =
        sender && effectiveUserId === sender.userId ? sender.username : user.username;
      // Guard
      if (!convo) return errorResponse("Conversation not found");
      if (convo.sendRestriction) return errorResponse(convo.sendRestriction);
      const messagingRestriction = getMessagingRestriction(user);
      if (messagingRestriction) {
        // Only banned/silenced users may post in staff conversations (own help tickets).
        // Other restrictions (e.g. level gate) are never bypassed.
        const isBannedOrSilenced = user.isBanned || user.isSilenced;
        if (!isBannedOrSilenced || !convo.isStaffAvailable) {
          return errorResponse(messagingRestriction);
        }
        const linkedSupportTicket = await findSupportTicketForCreateConversationComment(
          ctx.drizzle,
          convo,
        );
        if (
          !canReplyToStaffConversationWhileRestricted(
            user,
            linkedSupportTicket?.createdByUserId,
          )
        ) {
          return errorResponse(
            linkedSupportTicket
              ? RESTRICTED_SUPPORT_TICKET_REPLY_MESSAGE
              : RESTRICTED_STAFF_CONVERSATION_MESSAGE,
          );
        }
      }
      if (!canViewConversation(convo, ctx.userId, user.role)) {
        return errorResponse("You are not allowed to view this conversation");
      }
      // Check if conversation is disabled (for USER role only)
      if (!convo.isEnabled && user.role === "USER") {
        return errorResponse("This conversation is currently disabled.");
      }
      if (quotes.some((quote) => quote.conversationId !== convo.id)) {
        return errorResponse("Quote not found");
      }
      if (
        !convo.isPublic &&
        !convo.isStaffAvailable &&
        effectiveUserId !== ctx.userId
      ) {
        // The history guard has passed; an authorized AI reply also needs approval
        // from current participants before its new sender enters retained history.
        const participantIds = [
          ...new Set([ctx.userId, ...convo.users.map((u) => u.userId)]),
        ];
        const policies = await fetchCommunicationPolicies(ctx.drizzle, participantIds);
        const restriction = privateConversationRestriction(policies, [
          ...participantIds,
          effectiveUserId,
        ]);
        if (restriction) return errorResponse(restriction);
      }

      // Update conversation & update user notifications
      const commentId = nanoid();
      const pusher = getServerPusher();

      // For staff accounts, verify the language is appropriate
      if (!moderationResult.success) return moderationResult;

      // Create the content, santizied & with added quotes
      let content = input.comment;
      if (quotes.length > 0) {
        const quoteContent = quotes
          .map(
            (q) =>
              `<blockquote author="${q.user?.username || "Unknown"}" date="${format(q.createdAt, "MM/dd/yyyy")}">${stripBlockquotes(q.content)}</blockquote>`,
          )
          .join("");
        content = `${quoteContent}\n\n${content}`;
      }

      // Link visible mentions and collect notification recipients.
      const { processedContent, mentionedUserNames } = processMentions(content);
      const sanitized = sanitize(processedContent);

      // Derived
      const usersIdsInConvo = convo.users.map((u) => u.userId);
      // Raid-chat conversations use user2conversation only for read scoping;
      // messages are ephemeral team coordination and must not bump teammates'
      // inboxNews counter or fan out `newInbox` pusher events.
      const skipInboxNotifications = isRaidChatConversationId(convo.id);

      // Extract quoted user IDs - filter out null/undefined values
      const quotedUserIds = quotes
        .filter((q) => q.user?.userId)
        .map((q) => q.user?.userId)
        .filter((id): id is string => !!id);

      const [notifiedUserIds] = await Promise.all([
        fetchUsersToNotify(
          ctx.drizzle,
          ctx.userId,
          mentionedUserNames,
          quotedUserIds,
          convo,
        ),
        // Insert into DB
        insertConversationComment(
          ctx.drizzle,
          commentId,
          sanitized,
          effectiveUserId,
          ctx.userId,
          convo.id,
        ).then(() => {
          if (convo.isPublic) {
            deferModeration(ctx.drizzle, {
              content: sanitized,
              userId: ctx.userId,
              relationType: "comment",
              relationId: commentId,
              contextId: convo.id,
            });
          }
        }),
        // Update conversation
        updateConversationForCreateConversationComment(ctx.drizzle, convo),
        // Inbox news (database update)
        ...(usersIdsInConvo.length > 0 && !convo.isPublic && !skipInboxNotifications
          ? [
              updateUserDataForCreateConversationComment(
                ctx.drizzle,
                usersIdsInConvo,
                convo.id,
              ),
            ]
          : []),
        // Public conversation stats
        ...(convo.isPublic
          ? [updateUserDataForCreateConversationComment2(ctx.drizzle, effectiveUserId)]
          : []),
      ]);

      // A reply on a support ticket moves it along the staff/creator workflow
      if (convo.isStaffAvailable) {
        await updateSupportTicketStatusAfterComment(ctx.drizzle, {
          conversationId: convo.id,
          userId: ctx.userId,
          isStaff: isStaffRole(user.role),
        });
      }

      // Pusher notifications (fire after DB commit, don't await)
      notifyPrivateConversation(ctx.drizzle, {
        conversationId: convo.id,
        isPublic: convo.isPublic,
        senderId: effectiveUserId,
        authorId: ctx.userId,
        recipientIds: usersIdsInConvo,
      });
      notifyConversationMentions(ctx.drizzle, {
        conversationId: convo.id,
        isPublic: convo.isPublic,
        senderId: effectiveUserId,
        authorId: ctx.userId,
        recipientIds: notifiedUserIds
          .filter(({ type }) => type === "mentioned")
          .map(({ userId }) => userId),
      });
      void Promise.all([
        // Ping users (both mentioned and quoted, only those not in a blacklist relationship)
        ...notifiedUserIds.map(({ userId, type }) =>
          pusher.trigger(userId, "event", {
            type: "pinged",
            conversationId: convo.id,
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
        ...(usersIdsInConvo.length > 0 && !convo.isPublic && !skipInboxNotifications
          ? usersIdsInConvo
              .filter((id) => id !== effectiveUserId)
              .map((userId) =>
                pusher.trigger(userId, "event", {
                  type: "newInbox",
                  conversationId: convo.id,
                }),
              )
          : []),
      ]);

      return { success: true, message: "Comment posted", commentId: commentId };
    }),
  reactConversationComment: protectedProcedure
    .meta({ mcp: { description: "Add emoji reaction to a message" } })
    .input(z.object({ commentId: z.string(), emoji: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findConversationCommentById(ctx.drizzle, input.commentId),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      const convo = comment.conversationId
        ? await fetchConversation({
            client: ctx.drizzle,
            id: comment.conversationId,
            userId: ctx.userId,
          })
        : null;
      if (!convo || !canViewConversation(convo, ctx.userId, user.role))
        return errorResponse("Conversation not found");
      if (convo.sendRestriction) return errorResponse(convo.sendRestriction);
      // Figure out new reactions
      const newReactions = getNewReactions(
        comment.reactions,
        input.emoji,
        user.username,
      );
      // Update the conversation & mutate
      const pusher = getServerPusher();
      await Promise.all([
        updateConversationCommentForReactConversationComment(
          ctx.drizzle,
          newReactions,
          input,
        ),
        pusher.trigger(convo.id, "event", {
          message: "reaction",
          fromId: ctx.userId,
          commentId: comment.id,
          emoji: input.emoji,
          username: user.username,
        }),
      ]);
      return { success: true, message: "Reaction added" };
    }),
  sendTypingIndicator: protectedProcedure
    .meta({
      mcp: { description: "Send typing indicator to conversation" },
    })
    .input(z.object({ conversationId: z.string() }))
    .use(ratelimitMiddleware)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) return errorResponse("You are not logged in");
      const [user, convo] = await Promise.all([
        findUserDataForSendTypingIndicator(ctx.drizzle, ctx),
        fetchConversation({
          client: ctx.drizzle,
          id: input.conversationId,
          userId: ctx.userId,
        }),
      ]);
      if (!user || !convo || !canViewConversation(convo, ctx.userId, user.role))
        return errorResponse("Conversation not found");
      if (convo.sendRestriction) return errorResponse(convo.sendRestriction);
      const pusher = getServerPusher();
      void pusher.trigger(input.conversationId, "event", {
        message: "typing",
        fromId: ctx.userId,
        username: user.username,
      });
      return { success: true };
    }),
  editConversationComment: protectedProcedure
    .meta({ mcp: { description: "Edit your conversation message" } })
    .input(mutateCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment, moderated] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findConversationCommentForEditConversationComment(ctx.drizzle, input, ctx),
        moderateUserText(input.comment),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      const convo = comment.conversationId
        ? await fetchConversation({
            client: ctx.drizzle,
            id: comment.conversationId,
            userId: ctx.userId,
          })
        : null;
      if (!convo || !canViewConversation(convo, ctx.userId, user.role))
        return errorResponse("Conversation not found");
      if (convo.sendRestriction) return errorResponse(convo.sendRestriction);
      if (!moderated.success) return moderated;
      // Mutate
      const commentId = input.object_id;
      const sanitized = moderated.sanitized;
      await updateConversationCommentForEditConversationComment(
        ctx.drizzle,
        sanitized,
        commentId,
      );
      deferModeration(ctx.drizzle, {
        content: sanitized,
        userId: ctx.userId,
        relationType: convo.isPublic ? "comment" : "privateMessage",
        relationId: commentId,
        contextId: comment.conversationId ?? undefined,
        createdAt: comment.createdAt,
      });
      return { success: true, message: "Comment edited" };
    }),
  deleteConversationComment: protectedProcedure
    .meta({ mcp: { description: "Delete your conversation message" } })
    .input(deleteCommentSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, comment] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findConversationCommentById(ctx.drizzle, input.id),
      ]);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (!comment) return errorResponse("Comment not found");
      if (!canDeleteComment(user, comment.userId)) {
        return errorResponse("You can only delete own comments");
      }
      // Mutate
      await deleteConversationCommentForDeleteConversationComment(ctx.drizzle, input);
      return { success: true, message: "Comment deleted" };
    }),
});

interface FetchConvoOptions {
  client: DrizzleClient;
  id?: string;
  title?: string;
  userId: string;
}

/**
 * Replaces staff authors of report comments with an anonymous moderator profile.
 * Comments whose author has no user row (deleted accounts, system bots) have a null
 * `user` and are left unchanged; the report UI renders them without an author.
 */
export const maskStaffReportCommentAuthors = (
  comments: {
    user: Pick<
      UserData,
      "username" | "avatar" | "rank" | "isOutlaw" | "level" | "role" | "federalStatus"
    > | null;
  }[],
) => {
  for (const comment of comments) {
    if (!comment.user || comment.user.role === "USER") continue;
    comment.user.username = "moderator";
    comment.user.avatar = IMG_AVATAR_DEFAULT;
    comment.user.rank = "STUDENT";
    comment.user.isOutlaw = false;
    comment.user.level = 0;
    comment.user.role = "MODERATOR";
    comment.user.federalStatus = "NONE";
  }
};

/**
 * Loads a conversation with the requesting account's read and participant-wide send restrictions.
 * Callers still enforce conversation membership or staff authorization before returning data.
 * Returns undefined when absent; throws BAD_REQUEST when neither an ID nor a title is supplied.
 */
export const fetchConversation = async (params: FetchConvoOptions) => {
  const { client, id, title, userId } = params;
  const getConvo = async () => {
    if (id) {
      return await findConversationForGetConvo(client, id);
    } else if (title) {
      // First try to find a public conversation with this title
      const publicConvo = await findConversationForGetConvo2(client, title);
      if (publicConvo) return publicConvo;
      // Fallback to any conversation with this title (for private convos)
      return await findConversationForGetConvo3(client, title);
    } else {
      throw serverError("BAD_REQUEST", "Invalid request");
    }
  };
  // The reader is known before either lookup, including public title lookups.
  const [convo, initialPolicies] = await Promise.all([
    getConvo(),
    fetchCommunicationPolicies(client, [userId]),
  ]);
  if (!convo) return undefined;
  const participantIds = [...new Set([userId, ...convo.users.map((u) => u.userId)])];
  // Only private, non-staff send restrictions need the other participants' policies.
  const otherParticipantIds =
    convo.isPublic || convo.isStaffAvailable
      ? []
      : participantIds.filter((participantId) => participantId !== userId);
  // A support ticket's creator keeps access to its conversation through the
  // ticket after leaving it, so only non-members of private staff threads need
  // the lookup.
  const needsTicketLookup =
    convo.isStaffAvailable &&
    !convo.isPublic &&
    !convo.users.some((u) => u.userId === userId);
  const [participantPolicies, senders, linkedSupportTicket] = await Promise.all([
    otherParticipantIds.length > 0
      ? fetchCommunicationPolicies(client, otherParticipantIds)
      : [],
    convo.isPublic || convo.isStaffAvailable
      ? []
      : fetchPrivateConversationSenders(client, userId, convo.id),
    needsTicketLookup
      ? findSupportTicketForCreateConversationComment(client, convo)
      : undefined,
  ]);
  const policies = [...initialPolicies, ...participantPolicies];
  const senderIds = senders.map((sender) => sender.userId);
  const readRestriction = conversationReadRestriction(
    policies.find((p) => p.userId === userId),
    convo,
    senderIds,
  );
  const sendRestriction =
    convo.isPublic || convo.isStaffAvailable
      ? readRestriction
      : privateConversationRestriction(policies, [...participantIds, ...senderIds]);
  return {
    ...convo,
    readRestriction,
    sendRestriction,
    supportTicketCreatorId: linkedSupportTicket?.createdByUserId ?? null,
  };
};

/**
 * Sets the status of the support ticket on a conversation after a comment; see
 * `getStatusAfterComment`. Done here rather than by the client because the creator
 * may not edit a ticket staff has picked up.
 */
const updateSupportTicketStatusAfterComment = async (
  client: DrizzleClient,
  input: { conversationId: string; userId: string; isStaff: boolean },
) => {
  const ticket = await findSupportTicketForUpdateSupportTicketStatusAfterComment(
    client,
    input,
  );
  if (!ticket) return;
  const nextStatus = getStatusAfterComment(ticket.status, {
    isCreator: ticket.createdByUserId === input.userId,
    isStaff: input.isStaff,
  });
  if (!nextStatus) return;
  // Guard on the status read so a concurrent staff change is not overwritten
  const result = await updateSupportTicketForUpdateSupportTicketStatusAfterComment(
    client,
    nextStatus,
    ticket,
  );
  if (result.rowsAffected === 0) return;
  await insertSupportTicketActivityForUpdateSupportTicketStatusAfterComment(
    client,
    ticket,
    input,
    nextStatus,
  );
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
  const insertId = convoId ?? nanoid();
  // Push notifications early
  const pusher = getServerPusher();
  receiverUserIds.forEach(
    (userId) =>
      void pusher.trigger(userId, "event", {
        type: "newInbox",
        conversationId: insertId,
      }),
  );
  // Unique users to insert in conversation
  const uniqueUserIds = [...new Set([...receiverUserIds, senderUserId, authorUserId])];
  // Update DB concurrently
  const messageId = nanoid();
  const sanitized = sanitize(content);
  await Promise.all([
    insertConversationForCreateConvo(
      client,
      insertId,
      title,
      senderUserId,
      isPublic,
      isStaffAvailable,
    ),
    ...uniqueUserIds.map((user) =>
      insertUser2conversationForCreateConvo(client, insertId, user),
    ),
    ...(receiverUserIds.length > 0
      ? [updateUserDataForCreateConversationComment(client, receiverUserIds, insertId)]
      : []),
    insertConversationComment(
      client,
      messageId,
      sanitized,
      senderUserId,
      authorUserId,
      insertId,
    ),
  ]);
  notifyPrivateConversation(client, {
    conversationId: insertId,
    isPublic,
    senderId: senderUserId,
    authorId: authorUserId,
    recipientIds: receiverUserIds,
  });
  return insertId;
};

/**
 * Returns mention/quote recipients allowed by their blacklist and parental policy.
 * Staff conversations preserve support access; mentions take priority over quotes.
 */
export const fetchUsersToNotify = async (
  client: DrizzleClient,
  currentUserId: string,
  mentionedUserNames: string[],
  quotedUserIds: string[],
  convo: Pick<Conversation, "isPublic" | "isStaffAvailable">,
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
  const usersWithBlacklist = await listNotificationUserCandidates(
    client,
    whereClause,
    currentUserId,
  );

  // Policy reads depend on candidate IDs; skip that round trip when no users matched.
  const policies = usersWithBlacklist.length
    ? await fetchCommunicationPolicies(
        client,
        usersWithBlacklist.map((u) => u.userId),
      )
    : [];
  // Process results - filtering out those who have blacklisted the current user
  for (const user of usersWithBlacklist) {
    // Skip if user has blacklisted the sender or it's the current user
    if (user.creatorBlacklist.length > 0 || user.userId === currentUserId) {
      continue;
    }

    const policy = policies.find((p) => p.userId === user.userId);
    if (
      conversationReadRestriction(policy, {
        ...convo,
        users: [{ userId: currentUserId }, { userId: user.userId }],
      })
    )
      continue;
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

/**
 * Interface for users to be notified in comments
 */
interface NotifiedUser {
  userId: string;
  type: "mentioned" | "quoted";
}
