import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import { FORUM_MIN_LEVEL, forumLevelMessage } from "@/drizzle/constants";
import { forumPost, type forumThread, poll } from "@/drizzle/schema";
import { resolveSenderId } from "@/libs/comments";
import {
  type ForumContext,
  forumPersonalState,
  forumWriteSnapshotMatches,
  getForumContext,
  getInfiniteThreads,
  resolveForumPost,
} from "@/libs/forum";
import { deferForumAlerts, editForumPost, removeForumPost } from "@/libs/forumActions";
import { forumMentionNames, hasForumContent } from "@/libs/forumContent";
import { deferModeration } from "@/libs/moderation/defer";
import { getVoteCountsForPolls, processPollWithVotes } from "@/libs/poll";
import {
  callDiscordNews,
  callFacebookNews,
  callInstagramNews,
  callRedditNews,
  callTwitterNews,
} from "@/libs/socials";
import * as q from "@/queries/forum";
import { fetchPoll, fetchUserVote, listPollForGetPolls } from "@/queries/poll";
import { fetchUser } from "@/queries/profile";
import { pollRouter } from "@/server/api/routers/poll";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { announcement, isPushEnabled, sendPushToUsers } from "@/server/utils/push";
import { processMentions } from "@/utils/chat";
import { checkForBadWords, moderateUserText } from "@/utils/profanity";
import { htmlToPlainText } from "@/utils/sanitize";
import { addDays } from "@/utils/time";
import {
  forumCapabilities,
  forumSectionSchema,
  forumStructureBoardSchema,
} from "@/validators/forum";

// Built-in game pages resolve these boards by name.
const gameDestinationBoards = new Set(["News", "History", "ANBU HQ"]);

/**
 * Serve discussions through effective board access, with scoped moderation and audited administration.
 * Expected access/state rejections return the mutation response contract before side effects.
 */
export const forumRouter = createTRPCRouter({
  /** List the signed-in account's managed attachments for reuse in forum composers. */
  uploads: protectedProcedure.query(({ ctx }) =>
    q.listForumUploads(ctx.drizzle, ctx.userId),
  ),
  /** Return a readable published topic's shared public poll and caller vote, or null when unavailable. */
  threadPoll: publicProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [context, thread] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.fetchThread(ctx.drizzle, input.threadId),
      ]);
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (
        !thread?.pollId ||
        !board?.permissions.read ||
        thread.deletedAt ||
        !thread.isApproved
      )
        return null;
      const [polls, counts, vote] = await Promise.all([
        listPollForGetPolls(ctx.drizzle, eq(poll.id, thread.pollId), 0, 1),
        getVoteCountsForPolls(ctx.drizzle, [thread.pollId]),
        ctx.userId ? fetchUserVote(ctx.drizzle, ctx.userId, thread.pollId) : null,
      ]);
      const found = polls[0];
      return found
        ? {
            ...processPollWithVotes(
              found,
              counts.optionVoteMap.get(found.id),
              counts.totalVoteMap.get(found.id) ?? 0,
            ),
            description: htmlToPlainText(found.description),
            userOptionId: vote?.optionId ?? null,
            canVote: !!context.actor && board.permissions.vote && !thread.isLocked,
          }
        : null;
    }),
  /** Apply topic voting access, then delegate to the poll's shared vote/retraction contract. */
  votePoll: protectedProcedure
    .input(z.object({ threadId: z.string(), optionId: z.string().nullable() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, thread] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.fetchThread(ctx.drizzle, input.threadId),
      ]);
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (
        !thread?.pollId ||
        !board?.permissions.vote ||
        thread.deletedAt ||
        !thread.isApproved ||
        thread.isLocked
      )
        return errorResponse("Voting is unavailable in this topic");
      const caller = pollRouter.createCaller(ctx);
      return input.optionId
        ? caller.vote({ pollId: thread.pollId, optionId: input.optionId })
        : caller.retractVote({ pollId: thread.pollId });
    }),
  /** Let board moderators link an existing shared poll and save a validated, audited summary. */
  saveTopicExtras: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        pollId: z.string().nullable(),
        summary: z.string().trim().max(2000),
        reason: z.string().trim().min(3).max(1000),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, thread, selectedPoll, summaryCheck] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.fetchThread(ctx.drizzle, input.threadId),
        input.pollId ? fetchPoll(ctx.drizzle, input.pollId) : null,
        checkForBadWords(input.summary),
      ]);
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (!thread || !board?.permissions.moderate || thread.deletedAt)
        return errorResponse("You cannot manage this topic");
      if (input.pollId && !selectedPoll) return errorResponse("Poll no longer exists");
      if (!summaryCheck.success) return summaryCheck;
      // MySQL UPDATE cannot append an audit event; metadata and its retained evidence need separate writes.
      return retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await q.lockForumSection(tx, board.sectionId);
          await q.lockForumBoard(tx, board.id);
          const [current] = await q.lockForumThread(tx, thread.id);
          if (
            !current ||
            current.deletedAt ||
            current.boardId !== board.id ||
            !(await forumWriteSnapshotMatches(tx, context, board.id))
          )
            return errorResponse("Topic or access changed. Refresh and try again.");
          const after = {
            pollId: input.pollId,
            summary: input.summary || null,
            summaryUpdatedAt: input.summary ? new Date() : null,
          };
          await q.updateForumThread(tx, thread.id, after);
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            boardId: board.id,
            targetId: thread.id,
            action: "topic.extras",
            reason: input.reason,
            before: { pollId: current.pollId, summary: current.summary },
            after,
          });
          return { success: true, message: "Poll and summary saved" };
        }),
      );
    }),
  /** Return activity and review metrics only for boards the caller moderates or manages. */
  analytics: protectedProcedure
    .input(
      z.object({
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      const boards = context.boards.filter(
        (b) => b.permissions.moderate || context.canManage,
      );
      if (!boards.length && !context.canManage) return null;
      const ids = boards.map((b) => b.id);
      const since = addDays(new Date(), -input.days);
      if (!ids.length) return { boards: [], daily: [], reviewers: [], since };
      const [participation, topics, posts, daily, reviewers] = await Promise.all([
        q.forumParticipation(ctx.drizzle, ids, since),
        q.forumTopicMetrics(ctx.drizzle, ids, since),
        q.forumPostMetrics(ctx.drizzle, ids),
        q.forumDailyActivity(ctx.drizzle, ids, since),
        q.forumReviewerWorkload(ctx.drizzle, ids, since),
      ]);
      return {
        since,
        daily,
        reviewers,
        boards: boards.map((board) => ({
          id: board.id,
          name: board.name,
          posts: 0,
          participants: 0,
          topics: 0,
          unanswered: 0,
          pending: 0,
          removed: 0,
          pendingPosts: 0,
          reported: 0,
          removedPosts: 0,
          ...participation.find((p) => p.boardId === board.id),
          ...topics.find((t) => t.boardId === board.id),
          ...posts.find((p) => p.boardId === board.id),
        })),
      };
    }),

  /** List boards the caller may discover, including boards whose content requires further access. */
  getAll: publicProcedure.query(async ({ ctx }) =>
    (await getForumContext(ctx.drizzle, ctx.userId)).boards.filter(
      (b) => b.permissions.view,
    ),
  ),
  /** Expose discoverable boards and effective staff capabilities for forum navigation. */
  getContext: publicProcedure.query(async ({ ctx }) => {
    const context = await getForumContext(ctx.drizzle, ctx.userId);
    return {
      boards: context.boards.filter((b) => b.permissions.view),
      canManage: context.canManage,
      canModerate: context.boards.some(
        (b) => b.permissions.moderate || b.permissions.approve,
      ),
    };
  }),
  readNews: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    await q.readNews(ctx.drizzle, ctx.userId);
    return { success: true, message: "News marked as read" };
  }),
  /** Page readable topics and personal views without exposing pending or removed content to readers. */
  getThreads: publicProcedure
    .input(
      z.object({
        boardId: z.string().optional(),
        boardName: z.string().optional(),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(100),
        query: z.string().trim().max(200).optional(),
        author: z.string().trim().max(100).optional(),
        since: z.date().optional(),
        until: z.date().optional(),
        tag: z.string().max(32).optional(),
        view: z.enum(["latest", "mine", "unread", "watched", "unanswered"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      getInfiniteThreads({
        client: ctx.drizzle,
        ...input,
        context: await getForumContext(ctx.drizzle, ctx.userId),
        highlightPinned: !!(input.boardId || input.boardName),
      }),
    ),
  /** Return only the caller's watch preferences and read positions. */
  personal: protectedProcedure.query(async ({ ctx }) =>
    forumPersonalState(ctx.drizzle, ctx.userId),
  ),
  /** Resolve an accessible visible post to its current board, topic and page, or null. */
  resolvePost: publicProcedure
    .input(z.object({ postId: z.string() }))
    .query(async ({ ctx, input }) =>
      resolveForumPost(
        ctx.drizzle,
        input.postId,
        await getForumContext(ctx.drizzle, ctx.userId),
      ),
    ),
  /** Advance the caller's read position and clear alerts through an accessible visible post. */
  markRead: protectedProcedure
    .input(z.object({ postId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      const resolved = await resolveForumPost(ctx.drizzle, input.postId, context);
      const post = resolved ? await q.findForumPost(ctx.drizzle, input.postId) : null;
      if (!post) return errorResponse("Post not found");
      await Promise.all([
        q.saveForumRead(ctx.drizzle, ctx.userId, post),
        q.readForumAlertsThrough(ctx.drizzle, ctx.userId, post),
      ]);
      return { success: true, message: "Reading position saved" };
    }),
  /** Save a readable discussion's watch preferences; callers may always remove their own watch. */
  watch: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["BOARD", "THREAD"]),
        scopeId: z.string(),
        active: z.boolean(),
        push: z.boolean().default(false),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, thread] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        input.scope === "THREAD" ? q.fetchThread(ctx.drizzle, input.scopeId) : null,
      ]);
      const boardId = input.scope === "BOARD" ? input.scopeId : thread?.boardId;
      if (
        input.active &&
        (!context.actor ||
          context.actor.isBanned ||
          !context.boards.find((b) => b.id === boardId)?.permissions.read ||
          (thread && (thread.deletedAt || !thread.isApproved)))
      )
        return errorResponse("You cannot watch this discussion");
      await (input.active
        ? q.saveForumWatch(ctx.drizzle, {
            userId: ctx.userId,
            scope: input.scope,
            scopeId: input.scopeId,
            push: input.push,
          })
        : q.deleteForumWatch(ctx.drizzle, ctx.userId, input.scope, input.scopeId));
      return {
        success: true,
        message: input.active ? "Watch preferences saved" : "Watch removed",
      };
    }),
  /** Return the caller's alerts only while their current board access permits reading. */
  alerts: protectedProcedure.query(async ({ ctx }) => {
    const [context, alerts] = await Promise.all([
      getForumContext(ctx.drizzle, ctx.userId),
      q.listForumAlerts(ctx.drizzle, ctx.userId),
    ]);
    return alerts.filter(
      (a) => context.boards.find((b) => b.id === a.boardId)?.permissions.read,
    );
  }),
  /** Mark only the caller's forum alerts as read. */
  readAlerts: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      await q.readForumAlerts(ctx.drizzle, ctx.userId);
      return { success: true, message: "Forum alerts marked as read" };
    }),
  /** Create a moderated opening post and topic together; pending topics return no navigable ID. */
  createThread: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.strictObject({
        board_id: z.string(),
        title: z.string().trim().min(4).max(88),
        content: z.string().min(4).max(10000),
        image: z.url().optional().nullable(),
        senderId: z.string().optional().nullable(),
        kind: z.enum(["DISCUSSION", "QUESTION", "ANNOUNCEMENT"]).optional(),
        tags: z.array(z.string().trim().min(1).max(32)).max(5).optional(),
      }),
    )
    .output(baseServerResponse.extend({ threadId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [context, user, sender, titleCheck, moderated] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        input.senderId ? fetchUser(ctx.drizzle, input.senderId) : null,
        checkForBadWords(input.title),
        moderateUserText(input.content),
      ]);
      const board = context.boards.find((b) => b.id === input.board_id);
      if (!board?.permissions.create)
        return errorResponse("You cannot create topics in this board");
      if (user.level < FORUM_MIN_LEVEL) return errorResponse(forumLevelMessage);
      if (
        input.kind === "ANNOUNCEMENT" &&
        !board.permissions.moderate &&
        !context.canManage
      )
        return errorResponse(
          "Announcement creation requires forum moderation permission",
        );
      if (!titleCheck.success) return titleCheck;
      if (!moderated.success) return moderated;
      if (!hasForumContent(moderated.sanitized))
        return errorResponse("Write a message or add an image before posting");
      if (
        !board.permissions.upload &&
        (input.image || /<(?:img|iframe|video|audio)\b/i.test(moderated.sanitized))
      )
        return errorResponse("Attachments are disabled in this board");
      const userId = resolveSenderId(user, sender);
      const threadId = nanoid();
      const postId = nanoid();
      const { processedContent: content } = processMentions(moderated.sanitized);
      // MySQL INSERT has one target: topic/opening-post creation and board/News UPDATEs need separate writes.
      const saved = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await q.lockForumSection(tx, board.sectionId);
          const [current] = await q.lockForumBoard(tx, board.id);
          if (
            !(await forumWriteSnapshotMatches(tx, context, board.id)) ||
            current?.archived ||
            current?.sectionArchived
          )
            return false;
          const isApproved = !board.requireApproval || board.permissions.approve;
          await q.insertForumThread(tx, {
            id: threadId,
            title: input.title,
            image: input.image,
            boardId: board.id,
            userId,
            nPosts: isApproved ? 1 : 0,
            lastPostId: isApproved ? postId : null,
            kind: board.name === "News" ? "ANNOUNCEMENT" : (input.kind ?? "DISCUSSION"),
            tags: [...new Set(input.tags ?? [])],
            isApproved,
          });
          await q.insertForumPost(tx, {
            id: postId,
            threadId,
            userId,
            authorId: ctx.userId,
            content,
            isApproved,
            publicationIntent: isApproved ? null : { threadId, opening: true },
          });
          await q.repairForumBoard(tx, board.id);
          if (board.name === "News" && board.publicRead && isApproved)
            await q.updateUserDataForCreateThread(tx, ctx);
          return true;
        }),
      );
      if (!saved) return errorResponse("This board changed. Refresh and try again.");
      deferModeration(ctx.drizzle, {
        content,
        userId: ctx.userId,
        relationType: "forumPost",
        relationId: postId,
        contextId: threadId,
      });
      if (!board.requireApproval || board.permissions.approve) {
        deferForumAlerts(ctx.drizzle, {
          boardId: board.id,
          threadId,
          postId,
          actorId: ctx.userId,
          mentionedUserNames: forumMentionNames(content),
        });
        if (board.name === "News" && board.publicRead) {
          deferNewsFanOut(ctx.drizzle, {
            title: input.title,
            content,
            avatar: user.avatar,
            image: input.image,
          });
        }
      }
      return {
        success: true,
        message:
          board.requireApproval && !board.permissions.approve
            ? "Topic submitted for staff approval"
            : "Topic created",
        threadId:
          board.requireApproval && !board.permissions.approve ? undefined : threadId,
      };
    }),
  pinThread: protectedProcedure
    .input(z.object({ thread_id: z.string(), status: z.boolean() }))
    .output(baseServerResponse)
    .mutation(({ ctx, input }) =>
      moderateForumThreads(ctx.drizzle, ctx.userId, {
        ids: [input.thread_id],
        action: input.status ? "PIN" : "UNPIN",
        reason: input.status ? "Pin topic" : "Unpin topic",
      }),
    ),
  lockThread: protectedProcedure
    .input(z.object({ thread_id: z.string(), status: z.boolean() }))
    .output(baseServerResponse)
    .mutation(({ ctx, input }) =>
      moderateForumThreads(ctx.drizzle, ctx.userId, {
        ids: [input.thread_id],
        action: input.status ? "LOCK" : "UNLOCK",
        reason: input.status ? "Lock topic" : "Unlock topic",
      }),
    ),
  deleteThread: protectedProcedure
    .input(z.object({ thread_id: z.string() }))
    .output(baseServerResponse)
    .mutation(({ ctx, input }) =>
      moderateForumThreads(ctx.drizzle, ctx.userId, {
        ids: [input.thread_id],
        action: "REMOVE",
        reason: "Moderator removal",
      }),
    ),
  /** Apply one audited change to at most 50 topics after checking every source and destination scope. */
  moderateThreads: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(50),
        action: z.enum([
          "PIN",
          "UNPIN",
          "LOCK",
          "UNLOCK",
          "REMOVE",
          "RESTORE",
          "APPROVE",
          "UPDATE",
        ]),
        title: z.string().trim().min(4).max(88).optional(),
        boardId: z.string().optional(),
        kind: z.enum(["DISCUSSION", "QUESTION", "ANNOUNCEMENT"]).optional(),
        tags: z.array(z.string().trim().min(1).max(32)).max(5).optional(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .output(baseServerResponse)
    .mutation(({ ctx, input }) => moderateForumThreads(ctx.drizzle, ctx.userId, input)),
  /** Edit as author or moderator through the shared revision/CAS contract, retaining actor identity. */
  editPost: protectedProcedure
    .input(
      z.object({
        object_id: z.string(),
        comment: z.string().min(4).max(10000),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .output(baseServerResponse)
    .mutation(({ ctx, input }) =>
      editForumPost(ctx.drizzle, ctx.userId, {
        ...input,
        senderId: null,
        quoteIds: null,
      }),
    ),
  /** Apply scoped post moderation with retained evidence and conditional first-publication delivery. */
  moderatePost: protectedProcedure
    .input(
      z.object({
        postId: z.string(),
        action: z.enum(["REMOVE", "RESTORE", "LOCK", "UNLOCK", "APPROVE"]),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (input.action === "REMOVE")
        return removeForumPost(ctx.drizzle, ctx.userId, input.postId, input.reason);
      const [context, post] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.findForumPost(ctx.drizzle, input.postId),
      ]);
      const thread = post ? await q.fetchThread(ctx.drizzle, post.threadId) : null;
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (
        !post ||
        !thread ||
        !board ||
        !(input.action === "APPROVE"
          ? board.permissions.approve
          : board.permissions.moderate)
      )
        return errorResponse("You cannot moderate this post");
      // MySQL cannot append audit INSERTs to flag UPDATEs; publication also rewinds readers with UPDATE/DELETE.
      const saved = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await q.lockForumSection(tx, board.sectionId);
          await q.lockForumBoard(tx, board.id);
          const [current] = await q.lockForumThread(tx, thread.id);
          if (
            !current ||
            current.boardId !== board.id ||
            !(await forumWriteSnapshotMatches(tx, context, board.id))
          )
            return errorResponse("Topic or access changed. Refresh before moderating.");
          const currentPost = await q.findForumPost(tx, post.id);
          if (!currentPost || currentPost.threadId !== thread.id)
            return errorResponse("This post moved. Refresh before moderating it.");
          if (
            input.action === "APPROVE" &&
            !board.permissions.moderate &&
            (current.deletedAt || currentPost.deletedAt)
          )
            return errorResponse(
              "This post is no longer available for approval. Refresh approvals and recovery.",
            );
          if (input.action === "APPROVE" && !current.isApproved)
            return errorResponse("Approve the topic to publish its opening post");
          if (input.action === "APPROVE" && currentPost.isApproved)
            return { success: true, message: "Post already approved" };
          if (input.action === "RESTORE" && !currentPost.deletedAt)
            return { success: true, message: "Post already restored" };
          const values =
            input.action === "RESTORE"
              ? { deletedAt: null, removedBy: null, removalReason: null }
              : input.action === "APPROVE"
                ? { isApproved: true }
                : { isLocked: input.action === "LOCK" };
          const updated = await q.updateForumPost(
            tx,
            post.id,
            values,
            eq(forumPost.threadId, thread.id),
          );
          if (!updated.rowsAffected)
            return errorResponse("This post moved. Refresh before moderating it.");
          const publication =
            input.action === "APPROVE" || input.action === "RESTORE"
              ? await prepareForumPublication(tx, current, board, post.id)
              : { approvedPosts: [], approvedNews: [] };
          if (input.action === "APPROVE" || input.action === "RESTORE") {
            await q.repairForumThread(tx, thread.id);
            await q.repairForumBoard(tx, board.id);
          }
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            boardId: board.id,
            action: `post.${input.action.toLowerCase()}`,
            targetId: post.id,
            reason: input.reason,
            before: currentPost,
            after: values,
          });
          return {
            success: true,
            message: "Post moderation saved",
            ...publication,
          };
        }),
      );
      if (!saved.success) return saved;
      if ("approvedPosts" in saved) deferForumPublication(ctx.drizzle, saved);
      return { success: true, message: saved.message };
    }),
  /** Return edit history to board moderators or the author of a still-readable, nonremoved post. */
  revisions: protectedProcedure
    .input(z.object({ postId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [context, post] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.findForumPost(ctx.drizzle, input.postId),
      ]);
      const thread = post ? await q.fetchThread(ctx.drizzle, post.threadId) : null;
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (
        !board?.permissions.read ||
        !post ||
        (!board.permissions.moderate &&
          (post.authorId !== ctx.userId || !!post.deletedAt || !!thread?.deletedAt))
      )
        return [];
      return q.listForumRevisions(ctx.drizzle, input.postId);
    }),
  /** Atomically select a visible same-topic answer for the question owner or a board moderator. */
  acceptAnswer: protectedProcedure
    .input(z.object({ threadId: z.string(), postId: z.string().nullable() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, thread, post] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.fetchThread(ctx.drizzle, input.threadId),
        input.postId ? q.findForumPost(ctx.drizzle, input.postId) : null,
      ]);
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (
        !thread ||
        thread.deletedAt ||
        !thread.isApproved ||
        thread.kind !== "QUESTION" ||
        !board?.permissions.read ||
        !context.actor ||
        context.actor.isBanned ||
        context.actor.isSilenced ||
        (thread.userId !== ctx.userId && !board.permissions.moderate)
      )
        return errorResponse("You cannot choose an answer for this topic");
      if (
        input.postId &&
        (!post || post.threadId !== thread.id || post.deletedAt || !post.isApproved)
      )
        return errorResponse("Answer not found");
      const result = await q.acceptForumAnswer(
        ctx.drizzle,
        thread.id,
        input.postId,
        thread.boardId,
      );
      if (!result.rowsAffected)
        return errorResponse("The topic or answer changed. Refresh and try again.");
      return {
        success: true,
        message: input.postId ? "Answer accepted" : "Accepted answer cleared",
      };
    }),
  /** Save the caller's idempotent reaction only when the visible post permits voting. */
  react: protectedProcedure
    .input(
      z.object({
        postId: z.string(),
        reaction: z.enum(["helpful", "❤️", "😂", "👏"]),
        active: z.boolean(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      const resolved = await resolveForumPost(ctx.drizzle, input.postId, context);
      if (
        !resolved ||
        !context.boards.find((b) => b.id === resolved.boardId)?.permissions.vote
      )
        return errorResponse("You cannot react to this post");
      await q.setForumReaction(
        ctx.drizzle,
        { userId: ctx.userId, postId: input.postId, reaction: input.reaction },
        input.active,
      );
      return { success: true, message: "Reaction saved" };
    }),
  /** Copy/merge up to 1,000 posts or split up to 100 with moderated destination access and consistent counts. */
  restructureTopic: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        action: z.enum(["COPY", "MERGE", "SPLIT"]),
        targetThreadId: z.string().optional(),
        boardId: z.string().optional(),
        postIds: z.array(z.string()).max(100).default([]),
        title: z.string().trim().min(4).max(88).optional(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .output(
      baseServerResponse.extend({
        threadId: z.string().optional(),
        boardId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [context, source, target, titleCheck] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.fetchThread(ctx.drizzle, input.threadId),
        input.targetThreadId ? q.fetchThread(ctx.drizzle, input.targetThreadId) : null,
        input.title ? checkForBadWords(input.title) : null,
      ]);
      if (titleCheck && !titleCheck.success) return titleCheck;
      if (
        !source ||
        source.deletedAt ||
        !source.isApproved ||
        !context.boards.find((b) => b.id === source.boardId)?.permissions.moderate
      )
        return errorResponse("You cannot restructure this topic");
      const destinationId =
        input.action === "MERGE" ? target?.boardId : (input.boardId ?? source.boardId);
      const destination = context.boards.find((b) => b.id === destinationId);
      if (!destination?.permissions.moderate || destination.permissions.archived)
        return errorResponse("You must moderate the destination board");
      if (
        input.action === "MERGE" &&
        (!target || target.id === source.id || target.deletedAt || !target.isApproved)
      )
        return errorResponse("Choose another active destination topic");
      if (input.action !== "MERGE" && !input.title)
        return errorResponse("A title is required for the new topic");
      const id = input.action === "MERGE" && target ? target.id : nanoid();
      // COPY/SPLIT need INSERT plus post writes; MERGE needs UPDATE and possible read DELETE.
      // MySQL cannot include the appended audit INSERT in those content statements.
      const result = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          for (const sectionId of [
            ...new Set(
              [
                context.boards.find((b) => b.id === source.boardId)?.sectionId,
                destination.sectionId,
              ].filter((id): id is string => !!id),
            ),
          ].sort())
            await q.lockForumSection(tx, sectionId);
          for (const boardId of [...new Set([source.boardId, destination.id])].sort()) {
            await q.lockForumBoard(tx, boardId);
            if (!(await forumWriteSnapshotMatches(tx, context, boardId)))
              return errorResponse(
                "Forum access changed. Refresh before restructuring.",
              );
          }
          for (const topicId of [source.id, ...(target ? [target.id] : [])].sort()) {
            const [current] = await q.lockForumThread(tx, topicId);
            if (
              !current ||
              current.deletedAt ||
              current.boardId !==
                (topicId === source.id ? source.boardId : target?.boardId)
            )
              return errorResponse(
                "A topic moved or changed. Refresh before restructuring.",
              );
          }
          // Post membership is loaded after locks; concurrent splits and new replies cannot escape the source scope.
          const posts = await q.listForumPosts(tx, source.id, 0, 1001, true);
          if (posts.length > 1000)
            return errorResponse(
              "This topic exceeds the 1,000-post restructuring limit. Move the whole topic instead.",
            );
          const selected =
            input.action === "SPLIT"
              ? posts.filter((p) => input.postIds.includes(p.id))
              : posts;
          if (
            input.action === "SPLIT" &&
            (!selected.length ||
              selected.length !== new Set(input.postIds).size ||
              selected.length >= posts.length)
          )
            return errorResponse(
              "Select posts from this topic and leave at least one post in the original",
            );
          if (input.action !== "MERGE")
            await q.insertForumThread(tx, {
              id,
              boardId: destination.id,
              title: input.title ?? source.title,
              userId: source.userId,
              kind: source.kind,
              tags: source.tags,
            });
          if (input.action === "COPY") {
            const visible = selected.filter((p) => !p.deletedAt && p.isApproved);
            if (visible.length)
              await q.insertForumPosts(
                tx,
                visible.map((p, i) => ({
                  id: `${id}:${String(i).padStart(8, "0")}`,
                  threadId: id,
                  userId: p.userId,
                  authorId: p.authorId,
                  content: p.content,
                  createdAt: p.createdAt,
                })),
              );
          } else {
            const postIds = selected.map((p) => p.id);
            const moved = await q.updateForumPosts(
              tx,
              postIds,
              { threadId: id },
              source.id,
            );
            if (moved.rowsAffected !== selected.length)
              throw new Error("Post membership changed during restructuring");
            await q.moveForumAlerts(tx, postIds, id);
            // A source topic's resume link must not follow a post into its split destination.
            if (input.action === "SPLIT")
              await q.clearSplitForumReads(tx, source.id, postIds);
            if (input.action === "MERGE") {
              const first = selected.find((p) => !p.deletedAt && p.isApproved);
              if (first) {
                const movedPost = { ...first, threadId: id };
                await q.rewindForumReads(
                  tx,
                  movedPost,
                  await q.previousVisibleForumPost(tx, movedPost),
                );
              }
              await q.updateForumThread(tx, source.id, { deletedAt: new Date() });
            }
            await q.repairForumThread(tx, source.id);
          }
          await q.repairForumThread(tx, id);
          const affectedBoards =
            input.action === "COPY"
              ? [destination.id]
              : [...new Set([source.boardId, destination.id])];
          for (const boardId of affectedBoards) await q.repairForumBoard(tx, boardId);
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            boardId: source.boardId,
            action: `topic.${input.action.toLowerCase()}`,
            targetId: source.id,
            reason: input.reason,
            before: { thread: source, postIds: selected.map((p) => p.id) },
            after: { threadId: id, boardId: destination.id },
          });
          return {
            success: true,
            message: "Topic restructured",
            threadId: id,
            boardId: destination.id,
          };
        }),
      );
      return result;
    }),
  /** Require explicit purge capability and exact title confirmation to erase a removed topic, retaining audit. */
  purgeTopic: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        confirmTitle: z.string(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, thread] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.fetchThread(ctx.drizzle, input.threadId),
      ]);
      const board = context.boards.find((b) => b.id === thread?.boardId);
      if (
        !thread?.deletedAt ||
        !board?.permissions.purge ||
        !board.permissions.moderate
      )
        return errorResponse(
          "Permanent purge requires a separate explicit capability and a removed topic",
        );
      if (input.confirmTitle !== thread.title)
        return errorResponse("Type the exact topic title to confirm permanent removal");
      // MySQL multi-table DELETE cannot recount the surviving board or INSERT retained purge evidence.
      return retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await q.lockForumSection(tx, board.sectionId);
          await q.lockForumBoard(tx, board.id);
          const [current] = await q.lockForumThread(tx, thread.id);
          if (
            !current?.deletedAt ||
            current.boardId !== board.id ||
            current.title !== input.confirmTitle ||
            !(await forumWriteSnapshotMatches(tx, context, board.id))
          )
            return errorResponse(
              "Topic or permissions changed. Refresh before purging.",
            );
          const removed = await q.purgeForumThread(tx, thread.id);
          if (!removed.rowsAffected) return errorResponse("Topic already purged");
          await Promise.all([
            q.purgeForumPostRevisions(tx, thread.id),
            q.purgeForumPostReactions(tx, thread.id),
            q.purgeForumThreadReads(tx, thread.id),
            q.purgeForumThreadWatches(tx, thread.id),
            q.purgeForumThreadAlerts(tx, thread.id),
          ]);
          await q.purgeForumThreadPosts(tx, thread.id);
          await q.repairForumBoard(tx, board.id);
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            boardId: board.id,
            action: "topic.purge",
            targetId: thread.id,
            reason: input.reason,
            before: { title: current.title, nPosts: current.nPosts },
            after: { purged: true },
          });
          return {
            success: true,
            message: "Topic permanently purged; audit record retained",
          };
        }),
      );
    }),
  /** Let forum managers inspect an existing account's effective board capabilities, or return null. */
  effectivePermissions: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [actor, target] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        getForumContext(ctx.drizzle, input.userId),
      ]);
      if (!actor.canManage || !target.actor) return null;
      return {
        username: target.actor.username,
        boards: target.boards.map((b) => ({
          id: b.id,
          name: b.name,
          permissions: b.permissions,
        })),
      };
    }),
  /** Return scoped pending/recoverable content and audit evidence; grants and structure remain manager-only. */
  administration: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().max(200).default(""),
        reviewPage: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      const ids = context.boards
        .filter((b) => b.permissions.moderate || b.permissions.approve)
        .map((b) => b.id);
      if (!context.canManage && !ids.length) return null;
      const reviewInput = {
        boardIds: ids,
        moderatedBoardIds: context.boards
          .filter((b) => b.permissions.moderate)
          .map((b) => b.id),
        offset: input.reviewPage * 100,
        limit: 101,
      };
      const [grants, restrictions, reviewThreads, reviewPosts, logs] =
        await Promise.all([
          context.canManage ? q.listForumGrants(ctx.drizzle) : [],
          q.listForumRestrictions(ctx.drizzle),
          ids.length ? q.listForumReviewThreads(ctx.drizzle, reviewInput) : [],
          ids.length ? q.listForumReviewPosts(ctx.drizzle, reviewInput) : [],
          q.listForumAudit(
            ctx.drizzle,
            context.canManage ? null : reviewInput.moderatedBoardIds,
            input.query,
            { actorId: ctx.userId, boardIds: ids },
          ),
        ]);
      const threads = reviewThreads.slice(0, 100);
      const posts = reviewPosts.slice(0, 100);
      return {
        sections: context.canManage ? context.sections : [],
        boards: context.boards.filter(
          (b) => b.permissions.moderate || b.permissions.approve || context.canManage,
        ),
        canManage: context.canManage,
        grants,
        hasMoreReviews: reviewThreads.length > 100 || reviewPosts.length > 100,
        restrictions: restrictions.filter(
          (r) =>
            context.canManage ||
            (!!r.boardId &&
              !!context.boards.find((b) => b.id === r.boardId)?.permissions.moderate),
        ),
        threads,
        posts,
        logs: logs.filter(
          (l) =>
            context.canManage ||
            (!!l.boardId &&
              !!context.boards.find((b) => b.id === l.boardId)?.permissions.moderate) ||
            (l.actorId === ctx.userId &&
              ["topic.approve", "post.approve"].includes(l.action)),
        ),
      };
    }),
  /** Let forum managers save section policy, ordering and archive state with attributable evidence. */
  saveSection: protectedProcedure
    .input(forumSectionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      if (!context.canManage)
        return errorResponse("Forum administration permission required");
      const { reason, ...values } = input;
      const id = input.id ?? nanoid();
      const before = context.sections.find((s) => s.id === id);
      // The section upsert and independent audit INSERT cannot share MySQL's single INSERT target.
      await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await q.saveForumSection(tx, { ...values, id });
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            action: "section.save",
            targetId: id,
            reason,
            before,
            after: values,
          });
        }),
      );
      return { success: true, message: "Section saved" };
    }),
  /** Save an acyclic same-section board hierarchy, preserving built-in game destinations and audit. */
  saveBoard: protectedProcedure
    .input(forumStructureBoardSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      if (!context.canManage)
        return errorResponse("Forum administration permission required");
      if (!context.sections.some((s) => s.id === input.sectionId))
        return errorResponse("Section not found");
      const id = input.id ?? nanoid();
      let parent = input.parentId;
      const visited = new Set([id]);
      while (parent) {
        if (visited.has(parent)) return errorResponse("Boards cannot contain a cycle");
        visited.add(parent);
        const ancestor = context.boards.find((b) => b.id === parent);
        if (!ancestor || ancestor.sectionId !== input.sectionId)
          return errorResponse("Parent board must belong to the same section");
        parent = ancestor.parentId;
      }
      if (context.boards.some((b) => b.id !== id && b.name === input.name))
        return errorResponse("A board with this name already exists");
      const { reason, ...values } = input;
      const before = context.boards.find((b) => b.id === id);
      if (
        before &&
        before.sectionId !== input.sectionId &&
        context.boards.some((b) => b.parentId === id)
      )
        return errorResponse("Move nested boards to the destination section first");
      try {
        // Section locks prevent concurrent reparenting cycles; MySQL board INSERT/UPDATE cannot append audit rows.
        return await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            for (const sectionId of [
              ...new Set(
                [input.sectionId, before?.sectionId].filter((id): id is string => !!id),
              ),
            ].sort()) {
              const [section] = await q.lockForumSection(tx, sectionId);
              if (!section)
                return errorResponse("Section changed. Refresh before saving.");
            }
            const currentBoards = await q.listForumBoards(tx);
            const current = currentBoards.find((b) => b.id === id);
            if (input.id && !current) return errorResponse("Board no longer exists");
            if (
              current &&
              gameDestinationBoards.has(current.name) &&
              input.name !== current.name
            )
              return errorResponse(
                "This board is linked to a game page and must keep its name",
              );
            if (current && current.sectionId !== before?.sectionId)
              return errorResponse("Board moved. Refresh before saving.");
            if (
              current &&
              current.sectionId !== input.sectionId &&
              currentBoards.some((b) => b.parentId === id)
            )
              return errorResponse(
                "Move nested boards to the destination section first",
              );
            let parentId = input.parentId;
            const seen = new Set([id]);
            while (parentId) {
              if (seen.has(parentId))
                return errorResponse("Boards cannot contain a cycle");
              seen.add(parentId);
              const parentBoard = currentBoards.find((b) => b.id === parentId);
              if (!parentBoard || parentBoard.sectionId !== input.sectionId)
                return errorResponse("Parent board must belong to the same section");
              parentId = parentBoard.parentId;
            }
            await q.saveForumBoard(tx, { ...values, id }, !!current);
            await q.insertForumAudit(tx, {
              actorId: ctx.userId,
              boardId: id,
              action: "board.save",
              targetId: id,
              reason,
              before: current,
              after: values,
            });
            return { success: true, message: "Board saved" };
          }),
        );
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("A board with this name already exists");
        throw error;
      }
    }),
  /** Remove an empty container or move its children to a validated destination, retaining removal evidence. */
  removeStructure: protectedProcedure
    .input(
      z.object({
        type: z.enum(["BOARD", "SECTION"]),
        id: z.string(),
        destinationId: z.string().optional(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      if (!context.canManage)
        return errorResponse("Forum administration permission required");
      const source =
        input.type === "BOARD"
          ? context.boards.find((b) => b.id === input.id)
          : context.sections.find((s) => s.id === input.id);
      if (!source || input.destinationId === input.id)
        return errorResponse("Choose a different destination");
      if (input.type === "BOARD" && context.boards.some((b) => b.parentId === input.id))
        return errorResponse("Move nested boards before removing their parent");
      if (
        input.destinationId &&
        !(input.type === "BOARD" ? context.boards : context.sections).some(
          (s) => s.id === input.destinationId,
        )
      )
        return errorResponse("Destination not found");
      // Child migration needs UPDATE then container DELETE; empty removals still need DELETE plus audit INSERT.
      // MySQL cannot express those writes as one guarded statement.
      try {
        return await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const sectionIds =
              input.type === "SECTION"
                ? [input.id, input.destinationId]
                : [
                    context.boards.find((b) => b.id === input.id)?.sectionId,
                    context.boards.find((b) => b.id === input.destinationId)?.sectionId,
                  ];
            for (const id of [
              ...new Set(sectionIds.filter((id): id is string => !!id)),
            ].sort()) {
              const [section] = await q.lockForumSection(tx, id);
              if (!section)
                return errorResponse("A section changed. Refresh before removing it.");
            }
            const currentBoards = await q.listForumBoards(tx);
            if (input.type === "BOARD") {
              const board = currentBoards.find((b) => b.id === input.id);
              if (
                !board ||
                board.sectionId !==
                  context.boards.find((b) => b.id === input.id)?.sectionId
              )
                return errorResponse("Board moved. Refresh and try again.");
              if (gameDestinationBoards.has(board.name))
                return errorResponse(
                  "This board is linked to a game page and cannot be removed; archive it instead",
                );
              if (currentBoards.some((b) => b.parentId === input.id))
                return errorResponse("Move nested boards before removing their parent");
              if (
                input.destinationId &&
                !currentBoards.some((b) => b.id === input.destinationId)
              )
                return errorResponse("Destination no longer exists");
              for (const id of [input.id, input.destinationId]
                .filter((id): id is string => !!id)
                .sort())
                await q.lockForumBoard(tx, id);
              if (
                !input.destinationId &&
                (await q.countForumBoardThreads(tx, input.id))[0]?.count
              )
                return errorResponse(
                  "Choose a destination or archive this populated board",
                );
              if (input.destinationId) {
                await q.moveForumThreads(tx, input.id, input.destinationId);
                await q.repairForumBoard(tx, input.destinationId);
              }
            } else {
              if (
                !input.destinationId &&
                currentBoards.some((b) => b.sectionId === input.id)
              )
                return errorResponse(
                  "Choose a destination or archive this populated section",
                );
              if (input.destinationId)
                await q.moveForumBoards(tx, input.id, input.destinationId);
            }
            const result = await (input.type === "BOARD"
              ? q.deleteEmptyForumBoard(tx, input.id)
              : q.deleteEmptyForumSection(tx, input.id));
            if (!result.rowsAffected) throw new Error("FORUM_CONTAINER_CHANGED");
            await q.insertForumAudit(tx, {
              actorId: ctx.userId,
              action: `${input.type.toLowerCase()}.remove`,
              targetId: input.id,
              reason: input.reason,
              before: source,
              after: { destinationId: input.destinationId },
            });
            return { success: true, message: "Container removed; content preserved" };
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.message === "FORUM_CONTAINER_CHANGED")
          return errorResponse("Container changed. Refresh before removing it.");
        throw error;
      }
    }),
  /** Let managers grant or deny capabilities; administration and purge require global scope. */
  saveGrant: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        userId: z.string(),
        scope: z.enum(["GLOBAL", "SECTION", "BOARD"]),
        scopeId: z.string(),
        permissions: z.array(z.enum(forumCapabilities)),
        denies: z.array(z.enum(forumCapabilities)),
        reason: z.string().trim().min(3).max(500),
        remove: z.boolean().default(false),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, target] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        q.findForumActor(ctx.drizzle, input.userId),
      ]);
      if (!context.canManage)
        return errorResponse("Forum administration permission required");
      if (!target) return errorResponse("Player not found");
      if (
        input.scope !== "GLOBAL" &&
        (input.permissions.includes("manage") || input.permissions.includes("purge"))
      )
        return errorResponse("Administration and purge grants require global scope");
      if (
        input.scope !== "GLOBAL" &&
        !(input.scope === "BOARD" ? context.boards : context.sections).some(
          (b) => b.id === input.scopeId,
        )
      )
        return errorResponse("Scope not found");
      const id = input.id ?? nanoid();
      // MySQL grant upsert has one INSERT target; revocation DELETE cannot also INSERT retained evidence.
      await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await (input.remove
            ? q.deleteForumGrant(tx, id)
            : q.saveForumGrant(tx, {
                id,
                userId: input.userId,
                scope: input.scope,
                scopeId: input.scope === "GLOBAL" ? "*" : input.scopeId,
                permissions: input.permissions,
                denies: input.denies,
              }));
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            action: "grant.save",
            targetId: input.userId,
            reason: input.reason,
            after: input,
          });
        }),
      );
      return { success: true, message: "Forum permissions saved" };
    }),
  /** Change forum-only posting restrictions after authorizing both stored and requested scopes. */
  restrict: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        userId: z.string(),
        boardId: z.string().nullable(),
        expiresAt: z.date(),
        reason: z.string().trim().min(3).max(500),
        remove: z.boolean().default(false),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [context, existing] = await Promise.all([
        getForumContext(ctx.drizzle, ctx.userId),
        input.id ? q.findForumRestriction(ctx.drizzle, input.id) : null,
      ]);
      if (
        input.id &&
        (!existing ||
          !(existing.boardId
            ? context.boards.find((b) => b.id === existing.boardId)?.permissions
                .moderate
            : context.canManage))
      )
        return errorResponse("You cannot change this restriction");
      if (
        !(input.boardId
          ? context.boards.find((b) => b.id === input.boardId)?.permissions.moderate
          : context.canManage)
      )
        return errorResponse("You cannot restrict posting in this scope");
      if (
        !input.remove &&
        (input.expiresAt <= new Date() ||
          input.expiresAt.getTime() > Date.now() + 90 * 86400000)
      )
        return errorResponse("Choose an expiry within the next 90 days");
      const id = input.id ?? nanoid();
      // Restriction upsert cannot INSERT into both its row and audit target; revocation needs DELETE plus INSERT.
      await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await (input.remove
            ? q.deleteForumRestriction(tx, id)
            : q.saveForumRestriction(tx, {
                id,
                userId: input.userId,
                boardId: input.boardId,
                expiresAt: input.expiresAt,
                reason: input.reason,
              }));
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            boardId: input.boardId,
            action: input.remove ? "restriction.remove" : "restriction.save",
            targetId: input.userId,
            reason: input.reason,
            after: input,
          });
        }),
      );
      return { success: true, message: "Forum restriction saved" };
    }),
  /** Let managers rebuild visible counts/activity and accepted-answer validity with an audit event. */
  repairCounters: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const context = await getForumContext(ctx.drizzle, ctx.userId);
      if (!context.canManage)
        return errorResponse("Forum administration permission required");
      // The board lock excludes posting during dependent recounts; their UPDATEs cannot append the audit INSERT.
      await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await q.lockForumBoard(tx, input.boardId);
          await q.repairForumBoardThreads(tx, input.boardId);
          await q.repairForumBoard(tx, input.boardId);
          await q.insertForumAudit(tx, {
            actorId: ctx.userId,
            boardId: input.boardId,
            action: "board.repair",
            targetId: input.boardId,
            reason: "Recount visible topics and posts",
          });
        }),
      );
      return { success: true, message: "Forum counters repaired" };
    }),
});

/**
 * Revalidate every selected topic under sorted section/board/topic locks before applying audited changes.
 * Visibility and board moves repair activity; committed publication claims alone trigger delivery.
 */
async function moderateForumThreads(
  db: DrizzleClient,
  userId: string,
  input: {
    ids: string[];
    action:
      | "PIN"
      | "UNPIN"
      | "LOCK"
      | "UNLOCK"
      | "REMOVE"
      | "RESTORE"
      | "APPROVE"
      | "UPDATE";
    title?: string;
    boardId?: string;
    kind?: "DISCUSSION" | "QUESTION" | "ANNOUNCEMENT";
    tags?: string[];
    reason: string;
  },
) {
  const [context, threads, titleCheck] = await Promise.all([
    getForumContext(db, userId),
    Promise.all([...new Set(input.ids)].map((id) => q.fetchThread(db, id))),
    input.title ? checkForBadWords(input.title) : null,
  ]);
  if (titleCheck && !titleCheck.success) return titleCheck;
  for (const thread of threads) {
    const board = context.boards.find((b) => b.id === thread?.boardId);
    if (
      !thread ||
      !(input.action === "APPROVE"
        ? board?.permissions.approve
        : board?.permissions.moderate)
    )
      return errorResponse("You cannot moderate every selected topic");
    if (
      input.boardId &&
      !context.boards.find((b) => b.id === input.boardId)?.permissions.moderate
    )
      return errorResponse("You must moderate both source and destination boards");
  }
  const selected = threads.filter((t): t is NonNullable<typeof t> => !!t);
  const boardIds = [
    ...new Set([
      ...selected.map((t) => t.boardId),
      ...(input.boardId ? [input.boardId] : []),
    ]),
  ].sort();
  if (
    input.action === "UPDATE" &&
    !input.title &&
    !input.boardId &&
    !input.kind &&
    !input.tags
  )
    return errorResponse("Choose a change to apply");
  const needsRecount =
    input.action === "REMOVE" ||
    input.action === "RESTORE" ||
    input.action === "APPROVE" ||
    (input.action === "UPDATE" && !!input.boardId);
  // A bulk MySQL UPDATE can change existing topics but cannot INSERT their per-topic audit events.
  const saved = await retryOnDeadlock(() =>
    db.transaction(async (tx) => {
      const approvedPosts: Parameters<typeof deferForumAlerts>[1][] = [];
      const approvedNews: {
        title: string;
        content: string;
        avatar: string | null;
        image: string | null;
      }[] = [];
      for (const sectionId of [
        ...new Set(
          boardIds
            .map((id) => context.boards.find((b) => b.id === id)?.sectionId)
            .filter((id): id is string => !!id),
        ),
      ].sort())
        await q.lockForumSection(tx, sectionId);
      for (const id of boardIds) {
        await q.lockForumBoard(tx, id);
        if (!(await forumWriteSnapshotMatches(tx, context, id)))
          return errorResponse("Forum access changed. Refresh before moderating.");
      }
      const currentRows = [];
      for (const thread of [...selected].sort((a, b) => a.id.localeCompare(b.id))) {
        const [current] = await q.lockForumThread(
          tx,
          thread.id,
          input.action === "APPROVE" &&
            !context.boards.find((b) => b.id === thread.boardId)?.permissions.moderate,
        );
        if (!current || current.boardId !== thread.boardId)
          return errorResponse(
            "A selected topic moved or is no longer available. Refresh before moderating it.",
          );
        currentRows.push(current);
      }
      for (const thread of selected) {
        const values =
          input.action === "PIN" || input.action === "UNPIN"
            ? { isPinned: input.action === "PIN" }
            : input.action === "LOCK" || input.action === "UNLOCK"
              ? { isLocked: input.action === "LOCK" }
              : input.action === "REMOVE" || input.action === "RESTORE"
                ? { deletedAt: input.action === "REMOVE" ? new Date() : null }
                : input.action === "APPROVE"
                  ? { isApproved: true }
                  : {
                      title: input.title,
                      boardId: input.boardId,
                      kind: input.kind,
                      tags: input.tags,
                      ...(input.kind && input.kind !== "QUESTION"
                        ? { acceptedPostId: null }
                        : {}),
                    };
        await q.updateForumThread(tx, thread.id, values);
        if (input.action === "APPROVE") {
          await q.approveForumOpening(tx, thread.id);
        }
        if (input.action === "APPROVE" || input.action === "RESTORE") {
          const current = currentRows.find((t) => t.id === thread.id)!;
          const publication = await prepareForumPublication(
            tx,
            {
              ...current,
              isApproved: input.action === "APPROVE" || current.isApproved,
              deletedAt: input.action === "RESTORE" ? null : current.deletedAt,
            },
            context.boards.find((b) => b.id === current.boardId)!,
          );
          approvedPosts.push(...publication.approvedPosts);
          approvedNews.push(...publication.approvedNews);
        }
        if (needsRecount) await q.repairForumThread(tx, thread.id);
        await q.insertForumAudit(tx, {
          actorId: userId,
          boardId: thread.boardId,
          action: `topic.${input.action.toLowerCase()}`,
          targetId: thread.id,
          reason: input.reason,
          before: currentRows.find((t) => t.id === thread.id),
          after: values,
        });
      }
      if (needsRecount) for (const id of boardIds) await q.repairForumBoard(tx, id);
      return {
        success: true,
        message: "Topic changes saved",
        approvedPosts,
        approvedNews,
      };
    }),
  );
  if (!saved.success) return saved;
  if ("approvedPosts" in saved) deferForumPublication(db, saved);
  return { success: true, message: saved.message };
}

/** Called under the topic lock so only its first visible publication rewinds and notifies. */
async function prepareForumPublication(
  db: Parameters<typeof q.rewindForumReads>[0],
  thread: Pick<
    typeof forumThread.$inferSelect,
    "id" | "isApproved" | "deletedAt" | "title" | "image"
  >,
  board: Pick<ForumContext["boards"][number], "id" | "name" | "publicRead">,
  postId?: string,
) {
  const approvedPosts: Parameters<typeof deferForumAlerts>[1][] = [];
  const approvedNews: {
    title: string;
    content: string;
    avatar: string | null;
    image: string | null;
  }[] = [];
  if (!thread.isApproved || thread.deletedAt) return { approvedPosts, approvedNews };
  const posts = await q.listPendingForumPublications(db, thread.id, postId);
  const first = posts[0];
  if (!first) return { approvedPosts, approvedNews };
  const claimed = await q.claimForumPublications(
    db,
    thread.id,
    posts.map((post) => post.id),
  );
  if (claimed.rowsAffected !== posts.length)
    throw new Error("Forum publication changed during moderation");
  await q.rewindForumReads(db, first, await q.previousVisibleForumPost(db, first));
  for (const post of posts)
    approvedPosts.push({
      boardId: board.id,
      threadId: thread.id,
      postId: post.id,
      actorId: post.authorId,
      mentionedUserNames: forumMentionNames(post.content),
    });
  if (board.name === "News" && board.publicRead) {
    const opening = posts.find(
      (post) =>
        post.publicationIntent?.opening &&
        post.publicationIntent.threadId === thread.id,
    );
    if (opening) {
      await q.updateUserDataForCreateThread(db, { userId: opening.authorId });
      approvedNews.push({
        title: thread.title,
        image: thread.image,
        content: opening.content,
        avatar: opening.user?.avatar ?? null,
      });
    }
  }
  return { approvedPosts, approvedNews };
}

/** Deliver only transaction-committed publication claims; public News additionally reaches social/push subscribers. */
function deferForumPublication(
  db: DrizzleClient,
  publication: Awaited<ReturnType<typeof prepareForumPublication>>,
) {
  for (const post of publication.approvedPosts) deferForumAlerts(db, post);
  for (const news of publication.approvedNews) deferNewsFanOut(db, news);
}

/** Post public News to social media and push subscribers once the response is sent. */
function deferNewsFanOut(
  db: DrizzleClient,
  news: {
    title: string;
    content: string;
    avatar: string | null;
    image?: string | null;
  },
) {
  after(() =>
    Promise.allSettled([
      ...publishNewsToSocialMedia(news.title, news.content, news.avatar, news.image),
      notifyNewsSubscribers(db, news.content),
    ]),
  );
}

/** Push the news announcement to every registered device; sendPushToUsers never throws. */
const notifyNewsSubscribers = async (client: DrizzleClient, content: string) => {
  if (!isPushEnabled()) return;
  const devices = await q.selectDistinctUserDeviceForNotifyNewsSubscribers(client);
  const userIds = devices.map((device) => device.userId);
  if (userIds.length === 0) return;
  await sendPushToUsers(client, userIds, announcement(content));
};

/**
 * Publish news post to social media platforms.
 * Posts to Discord, Facebook, Reddit, Twitter, and optionally Instagram (if image provided).
 */
function publishNewsToSocialMedia(
  title: string,
  content: string,
  avatar: string | null,
  image?: string | null,
) {
  const promises: Promise<unknown>[] = [];

  promises.push(callDiscordNews(title, content, avatar));
  promises.push(callFacebookNews(title, content));
  promises.push(callRedditNews(title, content));
  promises.push(callTwitterNews(title, content));

  // Only post to Instagram if an image is attached
  if (image) {
    promises.push(callInstagramNews(title, content, image));
  }

  return promises;
}
