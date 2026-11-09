import * as socials from "@/libs/socials";
import { reportsRouter } from "@/routers/reports";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  forumAlert,
  forumAudit,
  forumBoard,
  forumGrant,
  forumPost,
  forumReaction,
  forumRead,
  forumRestriction,
  forumRevision,
  forumSection,
  forumThread,
  forumWatch,
  userData,
  userReport,
  poll,
  pollOption,
  userPollVote,
  userUpload,
} from "@/drizzle/schema";
import {
  fetchForumPageData,
  fetchForumThreadPage,
  getForumContext,
  getInfiniteThreads,
} from "@/libs/forum";
import * as moderation from "@/libs/moderation/defer";
import { getVoteCountsForPolls } from "@/libs/poll";
import { commentsRouter } from "@/routers/comments";
import { forumRouter } from "@/routers/forum";
import { pollRouter } from "@/routers/poll";
import { listForumAudit } from "@/queries/forum";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";
import {
  beforeTransaction,
  inTransactions,
  failStatements,
} from "../../../setup/statements";

const playerId = "forum-player";
const adminId = "forum-admin";
const moderatorId = "forum-scoped-moderator";
const topicInput = (board_id = "general") => ({
  board_id,
  title: "Learning the shinobi arts",
  content: "<p>A useful game discussion.</p>",
  senderId: null,
  image: null,
});
const commentInput = (
  object_id: string,
  comment = "A useful answer to this question.",
) => ({ object_id, comment, senderId: null, quoteIds: null });
const client = async (id = playerId, database?: DrizzleClient) =>
  callerForDatabase(forumRouter, id, database ?? (await getTestDatabase()));
const comments = async (id = playerId, database?: DrizzleClient) =>
  callerForDatabase(commentsRouter, id, database ?? (await getTestDatabase()));
const create = async (boardId = "general", id = playerId) => {
  const result = await (await client(id)).createThread(topicInput(boardId));
  expect(result.success).toBe(true);
  if (!result.threadId) throw new Error("Expected a created topic");
  return result.threadId;
};

describeWithDatabase(
  "forum authorization, administration and discussion lifecycle",
  () => {
    beforeEach(async () => {
      const db = await getTestDatabase();
      await resetTables(
        userPollVote,
        pollOption,
        poll,
        userUpload,
        userReport,
        forumAlert,
        forumAudit,
        forumGrant,
        forumReaction,
        forumRead,
        forumRestriction,
        forumRevision,
        forumWatch,
        forumPost,
        forumThread,
        forumBoard,
        forumSection,
        userData,
      );
      await insertUsers([
        { userId: playerId, username: "ForumPlayer", level: 50 },
        { userId: adminId, username: "ForumAdmin", level: 50, role: "MODERATOR-ADMIN" },
        { userId: moderatorId, username: "ForumModerator", level: 50 },
      ]);
      await db.insert(forumSection).values([
        { id: "public", name: "Community", summary: "", policy: {} },
        {
          id: "private",
          name: "Staff",
          summary: "",
          policy: { view: "STAFF", read: "STAFF", create: "STAFF" },
        },
      ]);
      await db.insert(forumBoard).values([
        { id: "general", name: "General discussion", summary: "", sectionId: "public" },
        { id: "other", name: "Other board", summary: "", sectionId: "public" },
        {
          id: "private-board",
          name: "Private discussions",
          summary: "",
          sectionId: "private",
        },
        {
          id: "news",
          name: "News",
          summary: "",
          sectionId: "public",
          policy: { create: "STAFF" },
        },
      ]);
      await db.insert(forumGrant).values({
        id: "scoped",
        userId: moderatorId,
        scope: "BOARD",
        scopeId: "general",
        permissions: ["moderate", "approve"],
        denies: [],
      });
      vi.spyOn(moderation, "deferModeration").mockImplementation(() => {});
      stubRateLimitTransport({
        unexpectedRequestMessage: "Unexpected external request in forum tests",
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it("rejects banned, silenced and low-level posting before any topic, post or counter write", async () => {
      const db = await getTestDatabase();
      for (const values of [
        { isBanned: true },
        { isBanned: false, isSilenced: true },
        { isSilenced: false, level: 1 },
      ]) {
        await db.update(userData).set(values).where(eq(userData.userId, playerId));
        expect((await (await client()).createThread(topicInput())).success).toBe(false);
      }
      expect(await db.query.forumThread.findMany()).toHaveLength(0);
      expect(await db.query.forumPost.findMany()).toHaveLength(0);
      expect(
        (await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }))
          ?.nThreads,
      ).toBe(0);
    });
    it("sanitizes opening posts and edits, records revisions, and rejects player News creation", async () => {
      const result = await (await client()).createThread({
        ...topicInput(),
        content:
          '<p>Useful strategy</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
      });
      expect(result.success).toBe(true);
      const db = await getTestDatabase();
      const post = (await db.query.forumPost.findMany())[0]!;
      expect(post.content).not.toContain("<script");
      expect(post.content).not.toContain("onerror");
      expect(
        (
          await (
            await comments()
          ).editForumComment(
            commentInput(post.id, "<p>Updated strategy</p><script>bad()</script>"),
          )
        ).success,
      ).toBe(true);
      expect(await db.query.forumRevision.findMany()).toHaveLength(1);
      expect((await db.query.forumPost.findFirst())?.content).not.toContain("<script");
      expect((await (await client()).createThread(topicInput("news"))).success).toBe(
        false,
      );
    });
    it("enforces topic locks and archived sections on direct reply calls", async () => {
      const id = await create();
      await (await client(moderatorId)).lockThread({ thread_id: id, status: true });
      expect(
        (await (await comments()).createForumComment(commentInput(id))).success,
      ).toBe(false);
      await (await client(moderatorId)).lockThread({ thread_id: id, status: false });
      const db = await getTestDatabase();
      await db
        .update(forumSection)
        .set({ archived: true })
        .where(eq(forumSection.id, "public"));
      expect(
        (await (await comments()).createForumComment(commentInput(id))).success,
      ).toBe(false);
      expect(await db.query.forumPost.findMany()).toHaveLength(1);
    });
    it("rolls topic and opening post back if a counter statement fails", async () => {
      const db = await getTestDatabase();
      const failing = inTransactions(db, (tx) =>
        failStatements(tx, forumBoard, 1, { operations: ["update"] }),
      );
      await expect(
        (await client(playerId, failing)).createThread(topicInput()),
      ).rejects.toThrow("Statement failed on purpose");
      expect(await db.query.forumThread.findMany()).toHaveLength(0);
      expect(await db.query.forumPost.findMany()).toHaveLength(0);
      expect(moderation.deferModeration).not.toHaveBeenCalled();
    });
    it("keeps counts and latest activity correct with concurrent replies and recoverable removal", async () => {
      const id = await create();
      const api = await comments();
      await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          api.createForumComment(commentInput(id, `Parallel reply number ${index}`)),
        ),
      );
      const db = await getTestDatabase();
      const thread = await db.query.forumThread.findFirst();
      const board = await db.query.forumBoard.findFirst({
        where: eq(forumBoard.id, "general"),
      });
      expect(thread?.nPosts).toBe(5);
      expect(board?.nPosts).toBe(5);
      expect(board?.nThreads).toBe(1);
      const post = (await db.query.forumPost.findMany())[0]!;
      expect((await api.deleteForumComment({ id: post.id })).success).toBe(true);
      expect((await db.query.forumThread.findFirst())?.nPosts).toBe(4);
      expect(
        (
          await (
            await client(moderatorId)
          ).moderatePost({
            postId: post.id,
            action: "RESTORE",
            reason: "Restore review evidence",
          })
        ).success,
      ).toBe(true);
      expect((await db.query.forumThread.findFirst())?.nPosts).toBe(5);
      expect(
        (await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }))
          ?.deletedAt,
      ).toBeNull();
    });
    it.each(["LOCK", "UNLOCK"] as const)(
      "audits post %s without recounting unchanged visibility",
      async (action) => {
        const id = await create();
        const db = await getTestDatabase();
        await (await comments()).createForumComment(commentInput(id));
        const post = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
        ).at(-1)!;
        await db
          .update(forumPost)
          .set({ isLocked: action === "UNLOCK", isReported: true })
          .where(eq(forumPost.id, post.id));
        const [before, thread, board] = await Promise.all([
          db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }),
          db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }),
          db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
        ]);
        expect(thread?.nPosts).toBe(2);
        expect(board).toMatchObject({ nThreads: 1, nPosts: 2 });
        const api = await client(moderatorId);
        const reason = "Review this post flag";
        const { result, statements } = await recordQueries(() =>
          api.moderatePost({ postId: post.id, action, reason }),
        );
        expect(result.success).toBe(true);
        expect(
          statements.filter((s) => /^update `Forum(?:Thread|Board)` /i.test(s)),
        ).toEqual([]);
        const values = { isLocked: action === "LOCK" };
        expect(
          await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }),
        ).toEqual({ ...before!, ...values });
        expect(
          await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }),
        ).toEqual(thread);
        expect(
          await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
        ).toEqual(board);
        const audit = await db.query.forumAudit.findMany();
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          actorId: moderatorId,
          boardId: "general",
          targetId: post.id,
          action: `post.${action.toLowerCase()}`,
          reason,
          before: { id: post.id, isLocked: action === "UNLOCK", isReported: true },
          after: values,
        });
      },
    );
    it.each(["PIN", "UNPIN", "LOCK", "UNLOCK", "UPDATE"] as const)(
      "audits bulk topic %s without recounting unchanged visibility",
      async (action) => {
        const db = await getTestDatabase();
        const player = await client();
        const ids: string[] = [];
        for (let i = 0; i < 2; i++) {
          const created = await player.createThread({
            ...topicInput(),
            kind: "QUESTION",
            tags: ["healing"],
          });
          expect(created.success).toBe(true);
          const id = created.threadId!;
          ids.push(id);
          await (await comments(moderatorId)).createForumComment(commentInput(id));
          const reply = (
            await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
          ).find((p) => p.authorId === moderatorId)!;
          expect(
            (await player.acceptAnswer({ threadId: id, postId: reply.id })).success,
          ).toBe(true);
          await db
            .update(forumThread)
            .set({ isPinned: action === "UNPIN", isLocked: action === "UNLOCK" })
            .where(eq(forumThread.id, id));
        }
        const [threads, board] = await Promise.all([
          db.query.forumThread.findMany(),
          db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
        ]);
        expect(threads.every((t) => t.nPosts === 2 && !!t.acceptedPostId)).toBe(true);
        expect(board).toMatchObject({ nThreads: 2, nPosts: 4 });
        const api = await client(moderatorId);
        const reason = "Organize reviewed topics";
        const metadata = {
          title: "Reviewed healing discussion",
          kind: "DISCUSSION" as const,
          tags: ["strategy"],
        };
        const { result, statements } = await recordQueries(() =>
          api.moderateThreads({
            ids,
            action,
            reason,
            ...(action === "UPDATE" ? metadata : {}),
          }),
        );
        expect(result.success).toBe(true);
        expect(statements.filter((s) => /^update `ForumBoard` /i.test(s))).toEqual([]);
        expect(
          statements.filter((s) => /^update `ForumThread` /i.test(s)),
        ).toHaveLength(ids.length);
        const values =
          action === "UPDATE"
            ? { ...metadata, acceptedPostId: null }
            : action === "PIN" || action === "UNPIN"
              ? { isPinned: action === "PIN" }
              : { isLocked: action === "LOCK" };
        for (const thread of threads)
          expect(
            await db.query.forumThread.findFirst({
              where: eq(forumThread.id, thread.id),
            }),
          ).toEqual({ ...thread, ...values });
        expect(
          await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
        ).toEqual(board);
        const audit = await db.query.forumAudit.findMany();
        expect(audit).toHaveLength(ids.length);
        for (const thread of threads)
          expect(audit.find((a) => a.targetId === thread.id)).toMatchObject({
            actorId: moderatorId,
            boardId: "general",
            action: `topic.${action.toLowerCase()}`,
            reason,
            before: {
              id: thread.id,
              acceptedPostId: thread.acceptedPostId,
              kind: "QUESTION",
              tags: ["healing"],
            },
            after: values,
          });
      },
    );
    it("keeps private content out of listings, search, direct posts and server-rendered guest payloads", async () => {
      const id = await create("private-board", adminId);
      const db = await getTestDatabase();
      const post = (await db.query.forumPost.findMany())[0]!;
      expect(
        (await (await client()).getAll()).some((b) => b.id === "private-board"),
      ).toBe(false);
      expect(
        (await (await client()).getThreads({ query: "shinobi", limit: 20 })).threads,
      ).toHaveLength(0);
      expect(
        (await (await comments()).getForumComments({ thread_id: id, limit: 20 }))
          .thread,
      ).toBeNull();
      expect(await (await client()).resolvePost({ postId: post.id })).toBeNull();
      expect(
        (await fetchForumThreadPage(db, { thread_id: id, limit: 20 })).thread,
      ).toBeNull();
      expect(
        (await getInfiniteThreads({ client: db, boardId: "private-board", limit: 20 }))
          .board,
      ).toBeNull();
      expect(
        (await getForumContext(db)).boards.find((b) => b.id === "private-board")
          ?.publicRead,
      ).toBe(false);
    });
    it("fails closed for boards missing their section", async () => {
      const db = await getTestDatabase();
      await db.delete(forumSection).where(eq(forumSection.id, "public"));
      expect((await (await client()).getAll()).some((b) => b.id === "general")).toBe(
        false,
      );
    });
    it("limits scoped moderators to content in their boards and checks stored restriction scope", async () => {
      const otherId = await create("other");
      const api = await client(moderatorId);
      expect((await api.lockThread({ thread_id: otherId, status: true })).success).toBe(
        false,
      );
      const id = await create();
      expect(
        (
          await api.moderateThreads({
            ids: [id],
            action: "UPDATE",
            boardId: "other",
            reason: "Try cross-scope move",
          })
        ).success,
      ).toBe(false);
      const db = await getTestDatabase();
      await db.insert(forumRestriction).values({
        id: "global-restriction",
        userId: playerId,
        boardId: null,
        expiresAt: new Date(Date.now() + 60000),
        reason: "Global restriction",
      });
      expect(
        (
          await api.restrict({
            id: "global-restriction",
            userId: playerId,
            boardId: "general",
            expiresAt: new Date(Date.now() + 60000),
            reason: "Attempt scope replacement",
            remove: true,
          })
        ).success,
      ).toBe(false);
      expect(await db.query.forumRestriction.findMany()).toHaveLength(1);
      expect(
        (
          await api.saveSection({
            name: "Unauthorized section",
            summary: "",
            position: 0,
            archived: false,
            policy: {},
            reason: "Attempt structural edit",
          })
        ).success,
      ).toBe(false);
    });
    it("does not replace board identifiers on a case-insensitive duplicate name", async () => {
      const api = await client(adminId);
      const result = await api.saveBoard({
        name: "GENERAL DISCUSSION",
        summary: "",
        sectionId: "public",
        parentId: null,
        position: 0,
        archived: false,
        rules: "",
        policy: {},
        slowModeSeconds: 0,
        requireApproval: false,
        reason: "Create duplicate board",
      });
      expect(result.success).toBe(false);
      const db = await getTestDatabase();
      expect(
        (
          await db.query.forumBoard.findFirst({
            where: eq(forumBoard.name, "General discussion"),
          })
        )?.id,
      ).toBe("general");
    });
    it("holds topics and replies for approval and supports slow mode", async () => {
      const db = await getTestDatabase();
      await db
        .update(forumBoard)
        .set({ requireApproval: true })
        .where(eq(forumBoard.id, "general"));
      const result = await (await client()).createThread(topicInput());
      expect(result.success).toBe(true);
      expect(result.threadId).toBeUndefined();
      const thread = (await db.query.forumThread.findMany())[0]!;
      expect(
        (await (await client()).getThreads({ boardId: "general", limit: 20 })).threads,
      ).toHaveLength(0);
      expect(
        (
          await (
            await client(moderatorId)
          ).moderateThreads({
            ids: [thread.id],
            action: "APPROVE",
            reason: "Reviewed opening post",
          })
        ).success,
      ).toBe(true);
      await db
        .update(forumBoard)
        .set({ slowModeSeconds: 3600, requireApproval: false })
        .where(eq(forumBoard.id, "general"));
      expect(
        (await (await comments()).createForumComment(commentInput(thread.id))).success,
      ).toBe(false);
      expect((await db.query.forumThread.findFirst())?.nPosts).toBe(1);
    });
    it("tracks unread state, stable post positions, reactions, accepted answers and watches", async () => {
      const api = await client();
      const result = await api.createThread({
        ...topicInput(),
        kind: "QUESTION",
        tags: ["strategy"],
      });
      const id = result.threadId!;
      await (await client(moderatorId)).watch({
        scope: "THREAD",
        scopeId: id,
        active: true,
        push: false,
      });
      expect(
        (await (await comments()).createForumComment(commentInput(id))).success,
      ).toBe(true);
      const db = await getTestDatabase();
      const posts = await db.query.forumPost.findMany({
        orderBy: [forumPost.createdAt, forumPost.id],
      });
      const last = posts.at(-1)!;
      expect(await (await client(moderatorId)).alerts()).toHaveLength(1);
      expect(
        (await api.getThreads({ view: "unread", limit: 20 })).threads,
      ).toHaveLength(1);
      expect((await api.resolvePost({ postId: last.id }))?.threadId).toBe(id);
      await api.markRead({ postId: last.id });
      expect(
        (await api.getThreads({ view: "unread", limit: 20 })).threads,
      ).toHaveLength(0);
      await api.markRead({ postId: posts[0]!.id });
      expect((await db.query.forumRead.findFirst())?.postId).toBe(last.id);
      expect(
        (await api.react({ postId: last.id, reaction: "helpful", active: true }))
          .success,
      ).toBe(true);
      await api.react({ postId: last.id, reaction: "helpful", active: true });
      expect(await db.query.forumReaction.findMany()).toHaveLength(1);
      expect((await api.acceptAnswer({ threadId: id, postId: last.id })).success).toBe(
        true,
      );
      await (await comments()).deleteForumComment({ id: last.id });
      expect((await db.query.forumThread.findFirst())?.acceptedPostId).toBeNull();
      expect((await api.acceptAnswer({ threadId: id, postId: last.id })).success).toBe(
        false,
      );
    });
    it("moves, copies and splits topics with intact counters and direct post links", async () => {
      const id = await create();
      await (await comments()).createForumComment(commentInput(id));
      const api = await client(adminId);
      const copy = await api.restructureTopic({
        threadId: id,
        action: "COPY",
        boardId: "other",
        title: "Copied guide discussion",
        reason: "Share a reviewed guide",
        postIds: [],
      });
      expect(copy.success).toBe(true);
      const db = await getTestDatabase();
      const posts = await db.query.forumPost.findMany({
        where: eq(forumPost.threadId, id),
      });
      const split = await api.restructureTopic({
        threadId: id,
        action: "SPLIT",
        boardId: "other",
        title: "Follow-up guide discussion",
        reason: "Keep replies on topic",
        postIds: [posts[1]!.id],
      });
      expect(split.success).toBe(true);
      expect((await api.resolvePost({ postId: posts[1]!.id }))?.threadId).toBe(
        split.threadId,
      );
      expect(
        (await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "other") }))
          ?.nPosts,
      ).toBe(3);
      expect(
        (
          await api.restructureTopic({
            threadId: id,
            action: "MERGE",
            targetThreadId: copy.threadId,
            reason: "Merge duplicate guide",
            postIds: [],
          })
        ).success,
      ).toBe(true);
      expect(
        (await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }))
          ?.deletedAt,
      ).toBeInstanceOf(Date);
    });
    it.each(["general", "other"])(
      "copies visible content into %s without recounting unchanged source state",
      async (boardId) => {
        const id = await create();
        const db = await getTestDatabase();
        const admin = await client(adminId);
        await (await comments(moderatorId)).createForumComment(commentInput(id));
        const visible = await db.query.forumPost.findMany({
          where: eq(forumPost.threadId, id),
          orderBy: [forumPost.createdAt, forumPost.id],
        });
        const answer = visible.find((p) => p.authorId === moderatorId)!;
        await db
          .update(forumThread)
          .set({
            kind: "QUESTION",
            acceptedPostId: answer.id,
            tags: ["strategy"],
            summary: "Reviewed guidance",
          })
          .where(eq(forumThread.id, id));
        await db.insert(forumPost).values([
          {
            id: "copy-removed",
            threadId: id,
            userId: playerId,
            authorId: playerId,
            content: "Removed evidence",
            deletedAt: new Date(),
          },
          {
            id: "copy-pending",
            threadId: id,
            userId: playerId,
            authorId: playerId,
            content: "Pending advice",
            isApproved: false,
            publicationIntent: { threadId: id, opening: false },
          },
        ]);
        await admin.markRead({ postId: answer.id });
        await admin.react({ postId: answer.id, reaction: "helpful", active: true });
        const [source, posts, reads, reactions, sourceBoard] = await Promise.all([
          db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }),
          db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }),
          db.query.forumRead.findMany(),
          db.query.forumReaction.findMany(),
          db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
        ]);
        const { result, statements } = await recordQueries(() =>
          admin.restructureTopic({
            threadId: id,
            action: "COPY",
            boardId,
            title: "Copied guidance",
            reason: "Share reviewed guidance",
            postIds: [],
          }),
        );
        expect(result.success).toBe(true);
        expect(
          await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }),
        ).toEqual(source);
        expect(
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) }),
        ).toEqual(posts);
        expect(await db.query.forumRead.findMany()).toEqual(reads);
        expect(await db.query.forumReaction.findMany()).toEqual(reactions);
        const copied = await db.query.forumThread.findFirst({
          where: eq(forumThread.id, result.threadId!),
        });
        expect(copied).toEqual(
          expect.objectContaining({
            boardId,
            nPosts: 2,
            kind: "QUESTION",
            tags: ["strategy"],
            acceptedPostId: null,
            updatedAt: source!.updatedAt,
          }),
        );
        const copiedPosts = await db.query.forumPost.findMany({
          where: eq(forumPost.threadId, result.threadId!),
          orderBy: [forumPost.createdAt, forumPost.id],
        });
        expect(copied?.lastPostId).toBe(copiedPosts.at(-1)?.id);
        expect(
          copiedPosts.map((p) => [p.userId, p.authorId, p.content, p.createdAt]),
        ).toEqual(visible.map((p) => [p.userId, p.authorId, p.content, p.createdAt]));
        expect(
          copiedPosts.every(
            (p) => p.isApproved && !p.deletedAt && !p.publicationIntent,
          ),
        ).toBe(true);
        expect(
          await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, boardId) }),
        ).toEqual(
          expect.objectContaining({
            nThreads: boardId === "general" ? 2 : 1,
            nPosts: boardId === "general" ? 4 : 2,
            updatedAt: source!.updatedAt,
          }),
        );
        if (boardId !== "general")
          expect(
            await db.query.forumBoard.findFirst({
              where: eq(forumBoard.id, "general"),
            }),
          ).toEqual(sourceBoard);
        const audits = await db.query.forumAudit.findMany({
          where: eq(forumAudit.action, "topic.copy"),
        });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          actorId: adminId,
          boardId: "general",
          targetId: id,
          reason: "Share reviewed guidance",
          before: {
            thread: {
              id,
              acceptedPostId: answer.id,
              tags: ["strategy"],
              summary: "Reviewed guidance",
            },
            postIds: expect.arrayContaining(posts.map((p) => p.id)),
          },
          after: { threadId: result.threadId, boardId },
        });
        expect(
          statements.filter((s) => /^update `ForumThread` /i.test(s)),
        ).toHaveLength(1);
        expect(statements.filter((s) => /^update `ForumBoard` /i.test(s))).toHaveLength(
          1,
        );
      },
    );
    it.each(["SPLIT", "MERGE"] as const)(
      "keeps existing alerts and read state with their posts after %s",
      async (action) => {
        const db = await getTestDatabase();
        const source = await create();
        const target = await create("other");
        const reader = await client(moderatorId);
        const admin = await client(adminId);
        const author = await comments();
        await reader.watch({
          scope: "THREAD",
          scopeId: source,
          active: true,
          push: false,
        });
        await author.createForumComment(commentInput(source));
        const first = (await reader.alerts())[0]!;
        await reader.markRead({ postId: first.postId });
        await author.createForumComment(
          commentInput(source, "A second useful answer for the reader."),
        );
        const before = await db.query.forumAlert.findMany();
        const postIds = before.map((a) => a.postId);
        expect(before.filter((a) => a.readAt)).toHaveLength(1);
        expect(
          (
            await admin.restructureTopic({
              threadId: source,
              action: "COPY",
              boardId: "other",
              title: "Copied answers",
              reason: "Share the useful answers",
              postIds: [],
            })
          ).success,
        ).toBe(true);
        expect(await db.query.forumAlert.findMany()).toEqual(before);
        const moved = await admin.restructureTopic({
          threadId: source,
          action,
          boardId: "other",
          targetThreadId: target,
          title: "Related answers",
          reason: "Group related answers",
          postIds,
        });
        expect(moved.success).toBe(true);
        const threadId = moved.threadId;
        if (!threadId) throw new Error("Expected a destination topic");
        expect(await db.query.forumAlert.findMany()).toEqual(
          before.map((a) => ({ ...a, threadId })),
        );
        expect(await reader.alerts()).toHaveLength(2);
        for (const alert of await reader.alerts()) {
          expect(alert).toMatchObject({ threadId, boardId: "other" });
          expect((await reader.resolvePost({ postId: alert.postId }))?.threadId).toBe(
            threadId,
          );
        }
        await db
          .update(forumBoard)
          .set({ sectionId: "private" })
          .where(eq(forumBoard.id, "other"));
        expect(await reader.alerts()).toEqual([]);
        await db
          .update(forumBoard)
          .set({ sectionId: "public" })
          .where(eq(forumBoard.id, "other"));
        const unread = (await reader.alerts()).find((a) => !a.readAt)!;
        expect((await reader.markRead({ postId: unread.postId })).success).toBe(true);
        expect((await reader.alerts()).every((a) => a.readAt instanceof Date)).toBe(
          true,
        );
        expect(
          (await db.query.forumAlert.findFirst({ where: eq(forumAlert.id, first.id) }))
            ?.readAt,
        ).toEqual(before.find((a) => a.id === first.id)!.readAt);
        await admin.moderatePost({
          postId: unread.postId,
          action: "REMOVE",
          reason: "Retain this answer for review",
        });
        expect(await reader.alerts()).toHaveLength(1);
        await admin.moderatePost({
          postId: unread.postId,
          action: "RESTORE",
          reason: "Restore this reviewed answer",
        });
        expect(await reader.alerts()).toHaveLength(2);
      },
    );
    it.each([1000, 2500, 3000, 4000])(
      "keeps merged contributions discoverable at timestamp %d",
      async (sourceTime) => {
        const db = await getTestDatabase();
        const source = await create();
        const target = await create();
        const other = await create("other");
        const sourcePost = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, source) })
        )[0]!;
        const targetPost = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, target) })
        )[0]!;
        await db
          .update(forumPost)
          .set({ id: "m-merge-source", createdAt: new Date(sourceTime) })
          .where(eq(forumPost.id, sourcePost.id));
        await db
          .update(forumPost)
          .set({ createdAt: new Date(2000) })
          .where(eq(forumPost.id, targetPost.id));
        await db.insert(forumPost).values([
          {
            id: "z-target-latest",
            threadId: target,
            userId: playerId,
            authorId: playerId,
            content: "Destination reply already read",
            createdAt: new Date(3000),
          },
          {
            id: "merge-removed",
            threadId: source,
            userId: playerId,
            authorId: playerId,
            content: "Removed source post",
            createdAt: new Date(500),
            deletedAt: new Date(),
          },
          {
            id: "merge-pending",
            threadId: source,
            userId: playerId,
            authorId: playerId,
            content: "Pending source post",
            createdAt: new Date(700),
            isApproved: false,
          },
        ]);
        const reader = await client();
        const behind = await client(moderatorId);
        const admin = await client(adminId);
        await admin.repairCounters({ boardId: "general" });
        await reader.markRead({ postId: "z-target-latest" });
        await behind.markRead({ postId: targetPost.id });
        const otherPost = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) })
        )[0]!;
        await reader.markRead({ postId: otherPost.id });
        const otherRead = (await reader.personal()).reads.find(
          (r) => r.threadId === other,
        );
        const merge = () =>
          admin.restructureTopic({
            threadId: source,
            action: "MERGE",
            targetThreadId: target,
            postIds: [],
            reason: "Combine related discussions",
          });
        expect((await merge()).success).toBe(true);
        const resumed = (
          await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })
        ).threads.find((t) => t.id === target)!;
        expect(resumed).toMatchObject({
          nPosts: 3,
          unread: true,
          resumePostId:
            sourceTime < 2000
              ? null
              : sourceTime <= 3000
                ? targetPost.id
                : "z-target-latest",
        });
        expect(
          (await behind.personal()).reads.find((r) => r.threadId === target)?.postId,
        ).toBe(sourceTime < 2000 ? undefined : targetPost.id);
        expect(
          (await reader.personal()).reads.find((r) => r.threadId === other),
        ).toEqual(otherRead);
        expect((await reader.resolvePost({ postId: "m-merge-source" }))?.threadId).toBe(
          target,
        );
        expect(
          (await reader.getThreads({ boardId: "general", limit: 20 })).threads.some(
            (t) => t.id === source,
          ),
        ).toBe(false);
        if (resumed.resumePostId)
          expect(
            (await reader.resolvePost({ postId: resumed.resumePostId }))?.threadId,
          ).toBe(target);
        await reader.markRead({
          postId: sourceTime > 3000 ? "m-merge-source" : "z-target-latest",
        });
        const reads = (await reader.personal()).reads;
        expect((await merge()).success).toBe(false);
        expect((await reader.personal()).reads).toEqual(reads);
        expect(
          (
            await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })
          ).threads.some((t) => t.id === target),
        ).toBe(false);
      },
    );
    it.each(["staff", "author"])(
      "preserves usable reading positions after %s removes a saved cursor",
      async (path) => {
        const db = await getTestDatabase();
        const id = await create();
        const other = await create("other");
        const opening = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
        )[0]!;
        await db
          .update(forumPost)
          .set({ createdAt: new Date(1000) })
          .where(eq(forumPost.id, opening.id));
        await db.insert(forumPost).values(
          Array.from({ length: 44 }, (_, i) => ({
            id: `cursor-${String(i + 2).padStart(2, "0")}`,
            threadId: id,
            userId: playerId,
            authorId: playerId,
            content: `Discussion chapter ${i + 2}`,
            createdAt: new Date((i + 2 === 28 || i + 2 === 29 ? 30 : i + 2) * 1000),
            isApproved: i + 2 !== 29,
          })),
        );
        await db
          .update(forumPost)
          .set({ deletedAt: new Date() })
          .where(eq(forumPost.id, "cursor-27"));
        const reader = await client();
        const admin = await client(adminId);
        const behind = await client(moderatorId);
        await admin.repairCounters({ boardId: "general" });
        await reader.markRead({ postId: "cursor-30" });
        await admin.markRead({ postId: "cursor-45" });
        await behind.markRead({ postId: opening.id });
        const otherPost = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) })
        )[0]!;
        await reader.markRead({ postId: otherPost.id });
        const unaffected = (await db.query.forumRead.findMany()).filter(
          (r) => r.threadId !== id || r.userId !== playerId,
        );
        expect((await reader.resolvePost({ postId: "cursor-30" }))?.page).toBe(2);
        const remove = (postId: string) =>
          path === "staff"
            ? admin.moderatePost({
                postId,
                action: "REMOVE",
                reason: "Remove an off-topic message",
              })
            : comments().then((api) => api.deleteForumComment({ id: postId }));
        expect((await remove("cursor-30")).success).toBe(true);
        const resumed = (
          await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })
        ).threads.find((t) => t.id === id)!;
        expect(resumed).toMatchObject({ unread: true, resumePostId: "cursor-28" });
        expect(
          await reader.resolvePost({ postId: resumed.resumePostId! }),
        ).toMatchObject({ threadId: id, page: 2 });
        expect(await reader.resolvePost({ postId: "cursor-30" })).toBeNull();
        expect(
          (await db.query.forumRead.findMany()).filter(
            (r) => r.threadId !== id || r.userId !== playerId,
          ),
        ).toEqual(unaffected);
        expect(
          (
            await admin.getThreads({ boardId: "general", view: "unread", limit: 20 })
          ).threads.some((t) => t.id === id),
        ).toBe(false);
        await reader.markRead({ postId: "cursor-45" });
        await reader.markRead({ postId: "cursor-28" });
        expect(
          (await reader.personal()).reads.find((r) => r.threadId === id)?.postId,
        ).toBe("cursor-45");
        expect((await remove(opening.id)).success).toBe(true);
        expect((await behind.personal()).reads.some((r) => r.threadId === id)).toBe(
          false,
        );
        expect(
          (
            await behind.getThreads({ boardId: "general", view: "unread", limit: 20 })
          ).threads.find((t) => t.id === id),
        ).toMatchObject({ unread: true, resumePostId: null });
      },
    );
    it("clears only source reading positions moved by a split and preserves direct post links", async () => {
      const db = await getTestDatabase();
      const id = await create();
      const other = await create("other");
      const opening = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
      )[0]!;
      await db
        .update(forumPost)
        .set({ createdAt: new Date(1000) })
        .where(eq(forumPost.id, opening.id));
      await db.insert(forumPost).values([
        {
          id: "split-middle",
          threadId: id,
          userId: playerId,
          authorId: playerId,
          content: "A tangent to separate",
          createdAt: new Date(2000),
        },
        {
          id: "split-last",
          threadId: id,
          userId: playerId,
          authorId: playerId,
          content: "Later advice in the original discussion",
          createdAt: new Date(3000),
        },
      ]);
      const reader = await client();
      const admin = await client(adminId);
      const behind = await client(moderatorId);
      await reader.markRead({ postId: "split-middle" });
      await admin.markRead({ postId: "split-last" });
      await behind.markRead({ postId: opening.id });
      const otherPost = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) })
      )[0]!;
      await reader.markRead({ postId: otherPost.id });
      const before = await db.query.forumRead.findMany();
      expect(
        (
          await admin.restructureTopic({
            threadId: id,
            action: "COPY",
            title: "Copied discussion",
            reason: "Share this discussion",
            postIds: [],
          })
        ).success,
      ).toBe(true);
      expect(await db.query.forumRead.findMany()).toEqual(before);
      const split = await admin.restructureTopic({
        threadId: id,
        action: "SPLIT",
        title: "Separate tangent",
        reason: "Keep the original discussion focused",
        postIds: ["split-middle"],
      });
      expect(split.success).toBe(true);
      expect(await db.query.forumRead.findMany()).toEqual(
        before.filter((r) => r.threadId !== id || r.userId !== playerId),
      );
      expect(
        (
          await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })
        ).threads.find((t) => t.id === id),
      ).toMatchObject({ unread: true, resumePostId: null });
      expect((await reader.resolvePost({ postId: "split-middle" }))?.threadId).toBe(
        split.threadId,
      );
      await reader.markRead({ postId: opening.id });
      const resumed = (
        await reader.getThreads({ boardId: "general", limit: 20 })
      ).threads.find((t) => t.id === id)!;
      expect(resumed).toMatchObject({ unread: true, resumePostId: opening.id });
      expect(
        (await reader.resolvePost({ postId: resumed.resumePostId! }))?.threadId,
      ).toBe(id);
      await reader.markRead({ postId: "split-last" });
      await reader.markRead({ postId: opening.id });
      expect(
        (
          await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })
        ).threads.some((t) => t.id === id),
      ).toBe(false);
    });
    it("rejects private forum evidence through the report integration", async () => {
      const id = await create("private-board", adminId);
      const db = await getTestDatabase();
      const post = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
      )[0]!;
      const result = await callerForDatabase(reportsRouter, playerId, db).create({
        system: "forum_comment",
        system_id: post.id,
        reported_userId: adminId,
        reason: "Attempt to report a private source",
      });
      expect(result.success).toBe(false);
      expect(await db.query.userReport.findMany()).toHaveLength(0);
    });
    it("applies parent archives to editing and voting and keeps orphaned moderation private", async () => {
      const id = await create();
      const db = await getTestDatabase();
      const post = (await db.query.forumPost.findMany())[0]!;
      await db
        .update(forumBoard)
        .set({ parentId: "other" })
        .where(eq(forumBoard.id, "general"));
      await db
        .update(forumBoard)
        .set({ archived: true })
        .where(eq(forumBoard.id, "other"));
      expect(
        (
          await (
            await comments()
          ).editForumComment(commentInput(post.id, "Attempt an archived edit"))
        ).success,
      ).toBe(false);
      expect(
        (
          await (
            await client()
          ).react({ postId: post.id, reaction: "helpful", active: true })
        ).success,
      ).toBe(false);
      await db
        .update(forumPost)
        .set({ isReported: true })
        .where(eq(forumPost.id, post.id));
      await db.delete(forumSection).where(eq(forumSection.id, "public"));
      expect(
        await (await client(moderatorId)).administration({ query: "" }),
      ).toBeNull();
    });
    it("preserves searchable administrator audit history after removing a board without widening scoped staff access", async () => {
      const db = await getTestDatabase();
      const id = await create();
      const admin = await client(adminId);
      const moderator = await client(moderatorId);
      expect((await admin.lockThread({ thread_id: id, status: true })).success).toBe(
        true,
      );
      expect(
        (await moderator.administration({ query: id }))?.logs.some(
          (log) => log.action === "topic.lock",
        ),
      ).toBe(true);
      expect(
        (
          await admin.removeStructure({
            type: "BOARD",
            id: "general",
            destinationId: "other",
            reason: "Consolidate related discussions",
          })
        ).success,
      ).toBe(true);
      expect(
        (await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }))
          ?.boardId,
      ).toBe("other");
      expect(
        (await db.query.forumAudit.findMany()).some(
          (log) =>
            log.action === "topic.lock" &&
            log.targetId === id &&
            log.boardId === "general",
        ),
      ).toBe(true);
      expect(
        (await admin.administration({ query: id }))?.logs.some(
          (log) => log.action === "topic.lock" && log.boardId === "general",
        ),
      ).toBe(true);
      expect(await moderator.administration({ query: id })).toBeNull();
      await db
        .update(forumGrant)
        .set({ scopeId: "other" })
        .where(eq(forumGrant.id, "scoped"));
      expect((await moderator.administration({ query: id }))?.logs).toEqual([]);
      expect(await listForumAudit(db, [], id)).toEqual([]);
    });
    it.each(["global", "approval-only"])(
      "keeps visible scoped audit history ahead of unrelated %s events",
      async (scope) => {
        const db = await getTestDatabase();
        const moderator = await client(moderatorId);
        const admin = await client(adminId);
        const id = await create();
        expect(
          (await moderator.lockThread({ thread_id: id, status: true })).success,
        ).toBe(true);
        await db.insert(forumGrant).values({
          id: "approval-scope",
          userId: moderatorId,
          scope: "BOARD",
          scopeId: "other",
          permissions: ["approve"],
          denies: [],
        });
        await db
          .update(forumBoard)
          .set({ requireApproval: true })
          .where(eq(forumBoard.id, "other"));
        expect((await (await client()).createThread(topicInput("other"))).success).toBe(
          true,
        );
        const pending = (
          await db.query.forumThread.findMany({
            where: eq(forumThread.boardId, "other"),
          })
        )[0]!;
        expect(
          (
            await moderator.moderateThreads({
              ids: [pending.id],
              action: "APPROVE",
              reason: "Review pending discussion",
            })
          ).success,
        ).toBe(true);
        const visible = (await moderator.administration({ query: "" }))!.logs
          .map((log) => log.id)
          .sort();
        expect(visible).toHaveLength(2);
        for (let i = 0; i < 100; i++) {
          const result =
            scope === "global"
              ? await admin.saveGrant({
                  userId: playerId,
                  scope: "GLOBAL",
                  scopeId: "*",
                  permissions: [],
                  denies: [],
                  reason: `Update player capabilities ${i}`,
                })
              : await admin.lockThread({ thread_id: pending.id, status: i % 2 === 0 });
          expect(result.success).toBe(true);
        }
        expect((await moderator.administration({ query: id }))?.logs).toHaveLength(1);
        expect(
          (await moderator.administration({ query: "" }))?.logs
            .map((log) => log.id)
            .sort(),
        ).toEqual(visible);
        expect((await admin.administration({ query: "" }))?.logs).toHaveLength(100);
        expect(await listForumAudit(db, [], "")).toEqual([]);
        await db
          .update(forumGrant)
          .set({ permissions: [] })
          .where(eq(forumGrant.id, "scoped"));
        expect(
          (await moderator.administration({ query: "" }))?.logs.map(
            (log) => log.action,
          ),
        ).toEqual(["topic.approve"]);
      },
    );
    it("searches reply content by its author and sends mention alerts without requiring a watch", async () => {
      const id = await create();
      await (await comments(moderatorId)).createForumComment(
        commentInput(id, "A unique healing strategy for new players."),
      );
      const result = await (await client()).getThreads({
        author: "ForumModerator",
        query: "healing",
        limit: 20,
      });
      expect(result.threads.map((t) => t.id)).toEqual([id]);
      await (await comments()).createForumComment(
        commentInput(id, "Thanks @ForumModerator for the useful explanation."),
      );
      expect(await (await client(moderatorId)).alerts()).toHaveLength(1);
    });
    it("requires an explicit purge grant", async () => {
      const id = await create();
      const db = await getTestDatabase();
      const post = (await db.query.forumPost.findMany())[0]!;
      await db
        .update(forumPost)
        .set({ isReported: true })
        .where(eq(forumPost.id, post.id));
      const moderator = await client(moderatorId);
      await moderator.deleteThread({ thread_id: id });
      const admin = await client(adminId);
      expect(
        (
          await admin.purgeTopic({
            threadId: id,
            confirmTitle: topicInput().title,
            reason: "Purge disposable fixture",
          })
        ).success,
      ).toBe(false);
      await db.insert(forumGrant).values({
        id: "purge-grant",
        userId: adminId,
        scope: "GLOBAL",
        scopeId: "*",
        permissions: ["purge"],
        denies: [],
      });
      expect(
        (
          await admin.purgeTopic({
            threadId: id,
            confirmTitle: topicInput().title,
            reason: "Purge disposable fixture",
          })
        ).success,
      ).toBe(true);
      expect(await db.query.forumPost.findMany()).toHaveLength(0);
      expect(await db.query.forumThread.findMany()).toHaveLength(0);
      expect(
        (await db.query.forumAudit.findMany()).some((a) => a.action === "topic.purge"),
      ).toBe(true);
    });
    it("recounts a whole board with a set-based update", async () => {
      await create();
      const db = await getTestDatabase();
      await db.update(forumThread).set({ nPosts: 100 });
      await db.update(forumBoard).set({ nPosts: 100 });
      expect(
        (await (await client(adminId)).repairCounters({ boardId: "general" })).success,
      ).toBe(true);
      expect((await db.query.forumThread.findFirst())?.nPosts).toBe(1);
      expect(
        (await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }))
          ?.nPosts,
      ).toBe(1);
    });

    it("aggregates shared poll votes once, retaining missing-option totals and empty poll defaults", async () => {
      const db = await getTestDatabase();
      await insertUsers([{ userId: "poll-voter", username: "PollVoter" }]);
      await db.insert(poll).values(
        ["active", "closed", "empty"].map((id) => ({
          id,
          title: id,
          description: "",
          createdByUserId: adminId,
          isActive: id !== "closed",
        })),
      );
      await db.insert(pollOption).values(
        ["one", "two", "zero", "closed-option"].map((id) => ({
          id,
          pollId: id === "closed-option" ? "closed" : "active",
          text: id,
          createdByUserId: adminId,
        })),
      );
      await db.insert(userPollVote).values([
        { id: "vote-one", pollId: "active", optionId: "one", userId: playerId },
        { id: "vote-two", pollId: "active", optionId: "one", userId: adminId },
        { id: "vote-three", pollId: "active", optionId: "two", userId: moderatorId },
        {
          id: "vote-orphan",
          pollId: "active",
          optionId: "missing-option",
          userId: "poll-voter",
        },
        {
          id: "vote-closed",
          pollId: "closed",
          optionId: "closed-option",
          userId: playerId,
        },
      ]);
      const queryCounts: number[] = [];
      for (const ids of [
        [],
        ["missing"],
        ["empty"],
        ["active"],
        ["closed"],
        ["active", "active"],
        ["active", "closed", "empty", "missing"],
      ]) {
        const { result, statements } = await recordQueries(() =>
          getVoteCountsForPolls(db, ids),
        );
        queryCounts.push(statements.length);
        expect(result.optionVoteMap.get("active")).toEqual(
          ids.includes("active")
            ? new Map([
                ["one", 2],
                ["two", 1],
                ["missing-option", 1],
              ])
            : undefined,
        );
        expect(result.optionVoteMap.get("closed")).toEqual(
          ids.includes("closed") ? new Map([["closed-option", 1]]) : undefined,
        );
        expect(result.optionVoteMap.size).toBe(
          Number(ids.includes("active")) + Number(ids.includes("closed")),
        );
        expect(result.totalVoteMap).toEqual(
          new Map([
            ...(ids.includes("active") ? [["active", 4] as const] : []),
            ...(ids.includes("closed") ? [["closed", 1] as const] : []),
          ]),
        );
      }
      const listed = await callerForDatabase(pollRouter, playerId, db).getPolls({
        includeInactive: true,
        limit: 10,
      });
      expect(listed.data.find((p) => p.id === "active")).toMatchObject({
        totalVotes: 4,
        options: [
          { id: "one", voteCount: 2, percentage: 50 },
          { id: "two", voteCount: 1, percentage: 25 },
          { id: "zero", voteCount: 0, percentage: 0 },
        ],
      });
      expect(listed.data.find((p) => p.id === "closed")).toMatchObject({
        totalVotes: 1,
        options: [{ id: "closed-option", voteCount: 1, percentage: 100 }],
      });
      expect(listed.data.find((p) => p.id === "empty")).toMatchObject({
        totalVotes: 0,
        options: [],
      });
      expect(queryCounts).toEqual([1, 1, 1, 1, 1, 1, 1]);
    });
    it("embeds live polls with shared votes, checks board voting permissions and records summaries", async () => {
      const db = await getTestDatabase();
      const id = await create();
      await db
        .update(userData)
        .set({ rank: "JONIN" })
        .where(eq(userData.userId, playerId));
      await db.insert(poll).values({
        id: "community-poll",
        title: "Next community guide",
        description: "<p>Choose a useful guide.</p>",
        createdByUserId: adminId,
      });
      await db.insert(pollOption).values([
        {
          id: "healing",
          pollId: "community-poll",
          text: "Healing",
          createdByUserId: adminId,
        },
        {
          id: "raids",
          pollId: "community-poll",
          text: "Raids",
          createdByUserId: adminId,
        },
      ]);
      const admin = await client(adminId);
      const player = await client();
      const extras = {
        threadId: id,
        pollId: "community-poll",
        summary:
          "Community advice: focus on one role and keep resources for equipment.",
        reason: "Summarize useful answers and link our public poll",
      };
      expect((await player.saveTopicExtras(extras)).success).toBe(false);
      expect((await admin.saveTopicExtras(extras)).success).toBe(true);
      expect((await db.query.forumThread.findFirst())?.summary).toBe(extras.summary);
      expect(
        (await player.votePoll({ threadId: id, optionId: "healing" })).success,
      ).toBe(true);
      let embedded = await player.threadPoll({ threadId: id });
      expect(embedded?.totalVotes).toBe(1);
      expect(embedded?.userOptionId).toBe("healing");
      expect(embedded?.description).not.toContain("<p>");
      expect((await player.votePoll({ threadId: id, optionId: "raids" })).success).toBe(
        true,
      );
      embedded = await player.threadPoll({ threadId: id });
      expect(embedded?.totalVotes).toBe(1);
      expect(embedded?.userOptionId).toBe("raids");
      expect((await player.votePoll({ threadId: id, optionId: null })).success).toBe(
        true,
      );
      expect((await player.threadPoll({ threadId: id }))?.totalVotes).toBe(0);
      await db
        .update(forumBoard)
        .set({ policy: { vote: "NONE" } })
        .where(eq(forumBoard.id, "general"));
      expect(
        (await player.votePoll({ threadId: id, optionId: "healing" })).success,
      ).toBe(false);
      await db
        .update(forumBoard)
        .set({ sectionId: "private" })
        .where(eq(forumBoard.id, "general"));
      expect(await player.threadPoll({ threadId: id })).toBeNull();
    });
    it("scopes attachment libraries and analytics to the viewer's account and boards", async () => {
      const db = await getTestDatabase();
      await db.insert(userUpload).values([
        { id: "own-image", userId: playerId, imageUrl: "https://example.com/own.png" },
        {
          id: "other-image",
          userId: adminId,
          imageUrl: "https://example.com/other.png",
        },
      ]);
      const player = await client();
      expect((await player.uploads()).map((upload) => upload.id)).toEqual([
        "own-image",
      ]);
      expect(await player.analytics({ days: 30 })).toBeNull();
      const id = await create();
      await (await comments()).createForumComment(commentInput(id));
      await create("private-board", adminId);
      const opening = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
      )[0]!;
      expect(
        (
          await (
            await comments()
          ).editForumComment(commentInput(opening.id, "Updated author advice."))
        ).success,
      ).toBe(true);
      await (await client(moderatorId)).lockThread({ thread_id: id, status: true });
      const scoped = await (await client(moderatorId)).analytics({ days: 7 });
      expect(scoped?.boards.map((b) => b.id)).toEqual(["general"]);
      expect(scoped?.boards[0]).toMatchObject({ topics: 1, posts: 2, participants: 1 });
      expect(scoped?.daily.reduce((n, d) => n + d.posts, 0)).toBe(2);
      expect(scoped?.reviewers[0]?.actions).toBe(1);
      expect(scoped?.reviewers.some((r) => r.actorId === playerId)).toBe(false);
      const all = await (await client(adminId)).analytics({ days: 30 });
      expect(all?.boards.find((b) => b.id === "private-board")?.posts).toBe(1);
    });
    it("keeps delegated moderation usable while a forum posting restriction blocks contributions", async () => {
      const id = await create();
      const db = await getTestDatabase();
      await db.insert(forumRestriction).values({
        id: "moderator-posting-restriction",
        userId: moderatorId,
        boardId: "general",
        reason: "Posting paused independently of review work",
        expiresAt: new Date(Date.now() + 60_000),
      });
      const moderator = await client(moderatorId);
      expect(
        (await moderator.lockThread({ thread_id: id, status: true })).success,
      ).toBe(true);
      expect(
        (
          await moderator.saveTopicExtras({
            threadId: id,
            pollId: null,
            summary: "A reviewed topic summary",
            reason: "Maintain the existing review responsibility",
          })
        ).success,
      ).toBe(true);
      expect((await moderator.createThread(topicInput())).success).toBe(false);
      expect(
        (await (await comments(moderatorId)).createForumComment(commentInput(id)))
          .success,
      ).toBe(false);
    });
    it("attributes a staff removal through the comments endpoint correctly", async () => {
      await create();
      const db = await getTestDatabase();
      const post = (await db.query.forumPost.findMany())[0]!;
      expect(
        (await (await comments(moderatorId)).deleteForumComment({ id: post.id }))
          .success,
      ).toBe(true);
      expect((await db.query.forumPost.findFirst())?.removalReason).toBe(
        "Moderator removal",
      );
      const audit = (await db.query.forumAudit.findMany()).find(
        (a) => a.action === "post.moderator-remove",
      );
      expect(audit?.reason).toBe("Moderator removal");
    });
    it.each(["News", "History", "ANBU HQ"])(
      "preserves the %s game destination through supported structure edits",
      async (name) => {
        const db = await getTestDatabase();
        const admin = await client(adminId);
        if (name !== "News")
          await db
            .insert(forumBoard)
            .values({ id: "game-destination", name, summary: "", sectionId: "public" });
        const board = (await fetchForumPageData(db, name, adminId)).initialThreads
          .board!;
        const {
          permissions: _,
          publicRead: _publicRead,
          ...values
        } = (await getForumContext(db, adminId)).boards.find((b) => b.id === board.id)!;
        const save = { ...values, reason: "Update the game discussion destination" };
        const before = await db.query.forumAudit.findMany();
        for (const renamed of [`Renamed ${name}`, name.toLowerCase()]) {
          expect(await admin.saveBoard({ ...save, name: renamed })).toMatchObject({
            success: false,
            message: expect.stringContaining("game page"),
          });
          expect(
            (await fetchForumPageData(db, name, adminId)).initialThreads.board?.id,
          ).toBe(board.id);
        }
        expect(
          (
            await admin.removeStructure({
              type: "BOARD",
              id: board.id,
              destinationId: "other",
              reason: "Consolidate this game destination",
            })
          ).success,
        ).toBe(false);
        expect(await db.query.forumAudit.findMany()).toEqual(before);
        expect((await (await client()).saveBoard(save)).success).toBe(false);
        expect(
          (
            await admin.saveBoard({
              ...save,
              summary: "Updated destination summary",
              parentId: "other",
              archived: true,
            })
          ).success,
        ).toBe(true);
        expect(
          (
            await admin.removeStructure({
              type: "BOARD",
              id: "other",
              destinationId: "general",
              reason: "Remove the destination ancestor",
            })
          ).success,
        ).toBe(false);
        expect(
          (
            await admin.removeStructure({
              type: "SECTION",
              id: "public",
              reason: "Remove the populated section",
            })
          ).success,
        ).toBe(false);
        expect(
          (
            await admin.removeStructure({
              type: "SECTION",
              id: "public",
              destinationId: "private",
              reason: "Move boards while removing their section",
            })
          ).success,
        ).toBe(true);
        expect(
          (await fetchForumPageData(db, name, adminId)).initialThreads.board?.id,
        ).toBe(board.id);
        expect(
          (await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, board.id) }))
            ?.sectionId,
        ).toBe("private");
        expect(
          (
            await admin.saveBoard({
              ...save,
              sectionId: "private",
              parentId: null,
              archived: false,
            })
          ).success,
        ).toBe(true);
        expect(
          (
            await admin.saveBoard({
              ...save,
              sectionId: "private",
              parentId: null,
              name: "Replacement destination",
            })
          ).success,
        ).toBe(false);
        expect(
          (
            await admin.removeStructure({
              type: "BOARD",
              id: board.id,
              reason: "Remove an empty game destination",
            })
          ).success,
        ).toBe(false);
      },
    );
    it("rejects stale public News publication after its guest access changes", async () => {
      const db = await getTestDatabase();
      const stale = beforeTransaction(db, () =>
        db
          .update(forumBoard)
          .set({ policy: { read: "STAFF", create: "STAFF" } })
          .where(eq(forumBoard.id, "news")),
      );
      expect(
        (await (await client(adminId, stale)).createThread(topicInput("news"))).success,
      ).toBe(false);
      expect(await db.query.forumThread.findMany()).toHaveLength(0);
    });
    it("publishes approved public News once and keeps private News private", async () => {
      const db = await getTestDatabase();
      const broadcasts = [
        "callDiscordNews",
        "callFacebookNews",
        "callRedditNews",
        "callTwitterNews",
        "callInstagramNews",
      ].map((name) =>
        vi
          .spyOn(socials, name as "callDiscordNews")
          .mockResolvedValue(undefined as never),
      );
      await db
        .update(forumBoard)
        .set({ requireApproval: true, policy: { create: "MEMBERS" } })
        .where(eq(forumBoard.id, "news"));
      expect((await (await client()).createThread(topicInput("news"))).success).toBe(
        true,
      );
      const topic = (await db.query.forumThread.findMany())[0]!;
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))
          ?.unreadNews,
      ).toBe(0);
      const admin = await client(adminId);
      await admin.moderateThreads({
        ids: [topic.id],
        action: "APPROVE",
        reason: "Publish reviewed announcement",
      });
      await admin.moderateThreads({
        ids: [topic.id],
        action: "APPROVE",
        reason: "Repeated approval",
      });
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))
          ?.unreadNews,
      ).toBe(1);
      expect(broadcasts[0]).toHaveBeenCalledTimes(1);
      await db
        .update(forumBoard)
        .set({ policy: { view: "MEMBERS", read: "MEMBERS", create: "MEMBERS" } })
        .where(eq(forumBoard.id, "news"));
      await (await client()).createThread(topicInput("news"));
      const pending = (await db.query.forumThread.findMany()).find(
        (t) => !t.isApproved,
      )!;
      await admin.moderateThreads({
        ids: [pending.id],
        action: "APPROVE",
        reason: "Private announcement",
      });
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))
          ?.unreadNews,
      ).toBe(1);
      expect(broadcasts[0]).toHaveBeenCalledTimes(1);
    });
    it.each(["topic", "post", "topic-private", "post-private"])(
      "defers News publication until %s restoration and delivers it once",
      async (path) => {
        const db = await getTestDatabase();
        const privateNews = path.endsWith("private");
        const postPath = path.startsWith("post");
        const broadcasts = [
          "callDiscordNews",
          "callFacebookNews",
          "callRedditNews",
          "callTwitterNews",
          "callInstagramNews",
        ].map((name) =>
          vi
            .spyOn(socials, name as "callDiscordNews")
            .mockResolvedValue(undefined as never),
        );
        await db
          .update(forumBoard)
          .set({
            requireApproval: true,
            policy: {
              create: "MEMBERS",
              ...(privateNews ? { view: "MEMBERS", read: "MEMBERS" } : {}),
            },
          })
          .where(eq(forumBoard.id, "news"));
        const reader = await client(moderatorId);
        const admin = await client(adminId);
        await reader.watch({
          scope: "BOARD",
          scopeId: "news",
          active: true,
          push: false,
        });
        expect((await (await client()).createThread(topicInput("news"))).success).toBe(
          true,
        );
        const topic = (await db.query.forumThread.findMany())[0]!;
        const opening = (await db.query.forumPost.findMany())[0]!;
        const moderate = (action: "REMOVE" | "RESTORE") =>
          postPath
            ? admin.moderatePost({
                postId: opening.id,
                action,
                reason: "Review the retained announcement",
              })
            : admin.moderateThreads({
                ids: [topic.id],
                action,
                reason: "Review the retained announcement",
              });
        expect((await moderate("REMOVE")).success).toBe(true);
        for (let i = 0; i < 2; i++)
          expect(
            (
              await admin.moderateThreads({
                ids: [topic.id],
                action: "APPROVE",
                reason: "Approve while announcement stays hidden",
              })
            ).success,
          ).toBe(true);
        expect(await reader.alerts()).toHaveLength(0);
        expect(await db.query.forumAlert.findMany()).toHaveLength(0);
        expect(broadcasts[0]).not.toHaveBeenCalled();
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, moderatorId),
            })
          )?.unreadNews,
        ).toBe(0);
        expect(await (await client()).resolvePost({ postId: opening.id })).toBeNull();
        expect((await moderate("RESTORE")).success).toBe(true);
        expect(await reader.alerts()).toHaveLength(1);
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, moderatorId),
            })
          )?.unreadNews,
        ).toBe(privateNews ? 0 : 1);
        expect(broadcasts[0]).toHaveBeenCalledTimes(privateNews ? 0 : 1);
        await moderate("RESTORE");
        await moderate("REMOVE");
        await moderate("RESTORE");
        expect(await reader.alerts()).toHaveLength(1);
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, moderatorId),
            })
          )?.unreadNews,
        ).toBe(privateNews ? 0 : 1);
        expect(broadcasts[0]).toHaveBeenCalledTimes(privateNews ? 0 : 1);
      },
    );
    it("publishes all deferred News replies without rebroadcasting the announcement", async () => {
      const db = await getTestDatabase();
      const broadcasts = [
        "callDiscordNews",
        "callFacebookNews",
        "callRedditNews",
        "callTwitterNews",
        "callInstagramNews",
      ].map((name) =>
        vi
          .spyOn(socials, name as "callDiscordNews")
          .mockResolvedValue(undefined as never),
      );
      const id = await create("news", adminId);
      const admin = await client(adminId);
      const reader = await client(moderatorId);
      await reader.watch({ scope: "THREAD", scopeId: id, active: true, push: false });
      await db.insert(forumPost).values(
        ["news-reply-1", "news-reply-2"].map((postId) => ({
          id: postId,
          threadId: id,
          userId: playerId,
          authorId: playerId,
          content: "Reply awaiting review",
          isApproved: false,
          publicationIntent: { threadId: id, opening: false },
        })),
      );
      await admin.moderateThreads({
        ids: [id],
        action: "REMOVE",
        reason: "Retain the announcement",
      });
      for (const postId of ["news-reply-1", "news-reply-2"])
        await admin.moderatePost({
          postId,
          action: "APPROVE",
          reason: "Approve the retained reply",
        });
      expect(await reader.alerts()).toHaveLength(0);
      await admin.moderateThreads({
        ids: [id],
        action: "RESTORE",
        reason: "Restore the announcement",
      });
      expect(await reader.alerts()).toHaveLength(2);
      expect(
        (await db.query.forumPost.findMany()).every((p) => !p.publicationIntent),
      ).toBe(true);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, moderatorId) }))
          ?.unreadNews,
      ).toBe(1);
      expect(broadcasts[0]).toHaveBeenCalledTimes(1);
    });
    it.each(["foreign", "news"])(
      "keeps original News opening identity when the deferred %s opening is restored after merging",
      async (deferred) => {
        const db = await getTestDatabase();
        const admin = await client(adminId);
        const reader = await client(moderatorId);
        const broadcasts = [
          "callDiscordNews",
          "callFacebookNews",
          "callRedditNews",
          "callTwitterNews",
          "callInstagramNews",
        ].map((name) =>
          vi
            .spyOn(socials, name as "callDiscordNews")
            .mockResolvedValue(undefined as never),
        );
        await db
          .update(forumBoard)
          .set({ requireApproval: true, policy: { create: "MEMBERS" } })
          .where(eq(forumBoard.id, deferred === "foreign" ? "general" : "news"));
        expect(
          (
            await (
              await client(deferred === "foreign" ? playerId : adminId)
            ).createThread(topicInput("general"))
          ).success,
        ).toBe(true);
        const sourceId = (await db.query.forumThread.findMany())[0]!.id;
        const sourceOpening = (await db.query.forumPost.findMany())[0]!;
        await db
          .update(forumPost)
          .set({ createdAt: new Date(1000) })
          .where(eq(forumPost.id, sourceOpening.id));
        const hold = async (threadId: string, postId: string) => {
          expect(
            (
              await admin.moderatePost({
                postId,
                action: "REMOVE",
                reason: "Retain the pending opening",
              })
            ).success,
          ).toBe(true);
          expect(
            (
              await admin.moderateThreads({
                ids: [threadId],
                action: "APPROVE",
                reason: "Approve while the opening remains hidden",
              })
            ).success,
          ).toBe(true);
        };
        if (deferred === "foreign") await hold(sourceId, sourceOpening.id);
        const newsResult = await (
          await client(deferred === "news" ? playerId : adminId)
        ).createThread({
          ...topicInput("news"),
          title: "Original News announcement",
          content: "The original News opening body.",
        });
        expect(newsResult.success).toBe(true);
        const news = {
          threadId: (await db.query.forumThread.findMany()).find(
            (t) => t.boardId === "news",
          )!.id,
        };
        const newsOpening = (await db.query.forumPost.findMany()).find(
          (p) => p.threadId === news.threadId,
        )!;
        await db
          .update(forumPost)
          .set({ createdAt: new Date(2000) })
          .where(eq(forumPost.id, newsOpening.id));
        if (deferred === "news") await hold(news.threadId!, newsOpening.id);
        expect(broadcasts[0]).toHaveBeenCalledTimes(deferred === "news" ? 0 : 1);
        await reader.watch({
          scope: "THREAD",
          scopeId: news.threadId!,
          active: true,
          push: false,
        });
        if (deferred === "foreign") await reader.markRead({ postId: newsOpening.id });
        expect(
          (
            await admin.restructureTopic({
              threadId: sourceId,
              action: "MERGE",
              targetThreadId: news.threadId,
              reason: "Merge the related context",
              postIds: [],
            })
          ).success,
        ).toBe(true);
        const held = deferred === "foreign" ? sourceOpening : newsOpening;
        expect(
          (await db.query.forumPost.findFirst({ where: eq(forumPost.id, held.id) }))
            ?.publicationIntent,
        ).toEqual({
          threadId: deferred === "foreign" ? sourceId : news.threadId,
          opening: true,
        });
        for (let i = 0; i < 2; i++)
          expect(
            (
              await admin.moderateThreads({
                ids: [news.threadId!],
                action: "APPROVE",
                reason: "Repeated review keeps opening intent",
              })
            ).success,
          ).toBe(true);
        expect(
          (
            await admin.moderatePost({
              postId: held.id,
              action: "RESTORE",
              reason: "Publish the reviewed opening",
            })
          ).success,
        ).toBe(true);
        expect(await reader.resolvePost({ postId: held.id })).toMatchObject({
          threadId: news.threadId,
        });
        expect(await reader.alerts()).toHaveLength(1);
        expect(
          (
            await reader.getThreads({ boardId: "news", view: "unread", limit: 20 })
          ).threads.map((t) => t.id),
        ).toContain(news.threadId!);
        expect(broadcasts[0]).toHaveBeenCalledTimes(1);
        expect(broadcasts[0]!.mock.calls[0]?.slice(0, 2)).toEqual([
          "Original News announcement",
          "The original News opening body.",
        ]);
        expect(
          (
            await db.query.userData.findFirst({
              where: eq(userData.userId, moderatorId),
            })
          )?.unreadNews,
        ).toBe(1);
        await admin.moderatePost({
          postId: held.id,
          action: "REMOVE",
          reason: "Retain the published opening",
        });
        await admin.moderatePost({
          postId: held.id,
          action: "RESTORE",
          reason: "Restore the published opening",
        });
        expect(broadcasts[0]).toHaveBeenCalledTimes(1);
        expect(await reader.alerts()).toHaveLength(1);
      },
    );
    it("supports approval-only staff and notifies watchers and mentions once after approval", async () => {
      const db = await getTestDatabase();
      await db
        .update(forumGrant)
        .set({ permissions: ["approve"] })
        .where(eq(forumGrant.id, "scoped"));
      await db
        .update(forumBoard)
        .set({ requireApproval: true })
        .where(eq(forumBoard.id, "general"));
      const admin = await client(adminId);
      const approver = await client(moderatorId);
      await admin.watch({
        scope: "BOARD",
        scopeId: "general",
        active: true,
        push: false,
      });
      expect(
        (
          await (
            await client()
          ).createThread({
            ...topicInput(),
            content: "A question for @ForumModerator and @ForumAdmin.",
          })
        ).success,
      ).toBe(true);
      const topic = (await db.query.forumThread.findMany())[0]!;
      expect(await admin.alerts()).toHaveLength(0);
      const workspace = await approver.administration({ query: "" });
      expect(workspace?.threads.map((t) => t.id)).toEqual([topic.id]);
      expect(
        (await approver.lockThread({ thread_id: topic.id, status: true })).success,
      ).toBe(false);
      expect(
        (
          await approver.moderateThreads({
            ids: [topic.id],
            action: "APPROVE",
            reason: "Opening post reviewed",
          })
        ).success,
      ).toBe(true);
      expect(await admin.alerts()).toHaveLength(1);
      expect(await approver.alerts()).toHaveLength(1);
      await approver.moderateThreads({
        ids: [topic.id],
        action: "APPROVE",
        reason: "Repeated approval is harmless",
      });
      expect(await admin.alerts()).toHaveLength(1);
      await (await comments()).createForumComment(
        commentInput(topic.id, "Another question for @ForumAdmin."),
      );
      const pending = (await db.query.forumPost.findMany()).find((p) => !p.isApproved)!;
      expect(await admin.alerts()).toHaveLength(1);
      expect(
        (
          await approver.moderatePost({
            postId: pending.id,
            action: "APPROVE",
            reason: "Reply reviewed",
          })
        ).success,
      ).toBe(true);
      expect(await admin.alerts()).toHaveLength(2);
    });
    it.each(["post", "topic", "parent"])(
      "rejects approval-only access to a removed %s before changing content or evidence",
      async (target) => {
        const db = await getTestDatabase();
        const id = await create();
        const post = (await db.query.forumPost.findMany())[0]!;
        await db
          .update(forumGrant)
          .set({ permissions: ["approve"] })
          .where(eq(forumGrant.id, "scoped"));
        await db
          .update(forumPost)
          .set({
            isApproved: false,
            publicationIntent: { threadId: id, opening: true },
          })
          .where(eq(forumPost.id, post.id));
        if (target === "topic")
          await db
            .update(forumThread)
            .set({ isApproved: false })
            .where(eq(forumThread.id, id));
        const admin = await client(adminId);
        const approver = await client(moderatorId);
        const remove = () =>
          target === "post"
            ? admin.moderatePost({
                postId: post.id,
                action: "REMOVE",
                reason: "Retain declined content for moderators",
              })
            : admin.moderateThreads({
                ids: [id],
                action: "REMOVE",
                reason: "Retain declined topic for moderators",
              });
        const approve = (api: typeof approver) =>
          target === "topic"
            ? api.moderateThreads({
                ids: [id],
                action: "APPROVE",
                reason: "Review the selected topic",
              })
            : api.moderatePost({
                postId: post.id,
                action: "APPROVE",
                reason: "Review the selected post",
              });
        for (const stale of [false, true]) {
          await remove();
          const snapshot = () =>
            Promise.all([
              db.query.forumPost.findMany(),
              db.query.forumThread.findMany(),
              db.query.forumBoard.findMany(),
              db.query.forumAudit.findMany(),
              db.query.forumAlert.findMany(),
              db.query.forumRead.findMany(),
            ]);
          const before = await snapshot();
          // Removal after preload must be checked using the locked resource, too.
          if (stale) {
            await db
              .update(forumPost)
              .set({ deletedAt: null })
              .where(eq(forumPost.id, post.id));
            await db
              .update(forumThread)
              .set({ deletedAt: null })
              .where(eq(forumThread.id, id));
          }
          const database = stale
            ? beforeTransaction(db, async () => {
                const removedPost = before[0].find((p) => p.id === post.id)!;
                const removedThread = before[1].find((t) => t.id === id)!;
                await db
                  .update(forumPost)
                  .set({ deletedAt: removedPost.deletedAt })
                  .where(eq(forumPost.id, post.id));
                await db
                  .update(forumThread)
                  .set({ deletedAt: removedThread.deletedAt })
                  .where(eq(forumThread.id, id));
              })
            : db;
          const result = await approve(await client(moderatorId, database));
          expect(result).toMatchObject({
            success: false,
            message: expect.stringContaining("Refresh"),
          });
          expect(await snapshot()).toEqual(before);
          const workspace = await approver.administration({ query: "" });
          expect(workspace?.posts).toHaveLength(0);
          expect(workspace?.threads).toHaveLength(0);
          expect(workspace?.logs).toHaveLength(0);
          expect(await approver.revisions({ postId: post.id })).toEqual([]);
        }
        expect((await approve(admin)).success).toBe(true);
        expect((await db.query.forumPost.findFirst())?.isApproved).toBe(true);
        expect(
          (await db.query.forumAudit.findMany()).some(
            (a) => a.action === (target === "topic" ? "topic.approve" : "post.approve"),
          ),
        ).toBe(true);
      },
    );
    it.each([
      ["topic", false],
      ["topic", true],
      ["opening", false],
      ["opening", true],
    ] as const)(
      "rejects an entire approval batch containing a removed %s, removed first %s",
      async (target, removedFirst) => {
        const db = await getTestDatabase();
        await db
          .update(forumBoard)
          .set({ requireApproval: true })
          .where(eq(forumBoard.id, "general"));
        const author = await client();
        for (let i = 0; i < 2; i++)
          expect((await author.createThread(topicInput())).success).toBe(true);
        const pending = await db.query.forumThread.findMany();
        const live = pending[0]!.id;
        const removed = pending[1]!.id;
        await db
          .update(forumGrant)
          .set({ permissions: ["approve"] })
          .where(eq(forumGrant.id, "scoped"));
        const admin = await client(adminId);
        const approver = await client(moderatorId);
        const opening = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, removed) })
        )[0]!;
        if (target === "topic")
          await admin.moderateThreads({
            ids: [removed],
            action: "REMOVE",
            reason: "Decline the second pending topic",
          });
        else
          await admin.moderatePost({
            postId: opening.id,
            action: "REMOVE",
            reason: "Decline the second pending opening",
          });
        const snapshot = () =>
          Promise.all([
            db.query.forumPost.findMany(),
            db.query.forumThread.findMany(),
            db.query.forumBoard.findMany(),
            db.query.forumAudit.findMany(),
            db.query.forumAlert.findMany(),
          ]);
        const before = await snapshot();
        const result = await approver.moderateThreads({
          ids: removedFirst ? [removed, live] : [live, removed],
          action: "APPROVE",
          reason: "Review selected pending topics",
        });
        expect(result).toMatchObject({
          success: false,
          message: expect.stringContaining("Refresh"),
        });
        expect(await snapshot()).toEqual(before);
        expect(
          (
            await approver.moderateThreads({
              ids: [live],
              action: "APPROVE",
              reason: "Publish the available topic",
            })
          ).success,
        ).toBe(true);
        expect(
          (await db.query.forumThread.findFirst({ where: eq(forumThread.id, live) }))
            ?.isApproved,
        ).toBe(true);
        expect(
          (
            await admin.moderateThreads({
              ids: [removed],
              action: "APPROVE",
              reason: "Review retained moderator evidence",
            })
          ).success,
        ).toBe(true);
      },
    );
    it.each([false, true])(
      "checks the originating opening after an older removed opening is merged, own removed %s",
      async (removed) => {
        const db = await getTestDatabase();
        const admin = await client(adminId);
        const approver = await client(moderatorId);
        await db
          .update(forumGrant)
          .set({ permissions: ["approve"] })
          .where(eq(forumGrant.id, "scoped"));
        await db
          .update(forumBoard)
          .set({ requireApproval: true })
          .where(eq(forumBoard.id, "general"));
        const author = await client();
        for (let i = 0; i < 2; i++)
          expect((await author.createThread(topicInput())).success).toBe(true);
        const pending = await db.query.forumThread.findMany();
        const source = pending[0]!.id;
        const target = pending[1]!.id;
        const sourceOpening = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, source) })
        )[0]!;
        const targetOpening = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, target) })
        )[0]!;
        await db
          .update(forumPost)
          .set({ createdAt: new Date(1000) })
          .where(eq(forumPost.id, sourceOpening.id));
        await admin.moderatePost({
          postId: sourceOpening.id,
          action: "REMOVE",
          reason: "Retain the foreign opening",
        });
        if (removed)
          await admin.moderatePost({
            postId: targetOpening.id,
            action: "REMOVE",
            reason: "Retain the originating opening",
          });
        await admin.moderateThreads({
          ids: [source, target],
          action: "APPROVE",
          reason: "Moderators may approve retained openings",
        });
        expect(
          (
            await admin.restructureTopic({
              threadId: source,
              action: "MERGE",
              targetThreadId: target,
              reason: "Combine related retained discussions",
              postIds: [],
            })
          ).success,
        ).toBe(true);
        const result = await approver.moderateThreads({
          ids: [target],
          action: "APPROVE",
          reason: "Review the originating discussion",
        });
        expect(result.success).toBe(!removed);
        expect(
          (
            await approver.moderateThreads({
              ids: [target],
              action: "APPROVE",
              reason: "Repeat the same review",
            })
          ).success,
        ).toBe(!removed);
      },
    );
    it.each([false, true])(
      "rewinds only readers past a newly approved reply, including timestamp ties (%s)",
      async (sameTime) => {
        const db = await getTestDatabase();
        const id = await create();
        const other = await create("other");
        const opening = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
        )[0]!;
        await db
          .update(forumPost)
          .set({ createdAt: new Date(1000) })
          .where(eq(forumPost.id, opening.id));
        const priorAt = new Date(2000);
        const pendingAt = new Date(sameTime ? 2000 : 3000);
        const latestAt = new Date(sameTime ? 2000 : 4000);
        await db.insert(forumPost).values([
          {
            id: sameTime ? "a-prior" : "zz-prior",
            threadId: id,
            userId: adminId,
            authorId: adminId,
            content: "Already published advice",
            createdAt: priorAt,
          },
          {
            id: "m-pending",
            threadId: id,
            userId: playerId,
            authorId: playerId,
            content: "Pending advice submitted before the staff reply",
            createdAt: pendingAt,
            isApproved: false,
            publicationIntent: { threadId: id, opening: false },
          },
          {
            id: "z-latest",
            threadId: id,
            userId: adminId,
            authorId: adminId,
            content: "Later published staff reply",
            createdAt: latestAt,
          },
        ]);
        await db
          .update(forumThread)
          .set({ nPosts: 3, lastPostId: "z-latest", updatedAt: latestAt })
          .where(eq(forumThread.id, id));
        const reader = await client(moderatorId);
        const behind = await client();
        const admin = await client(adminId);
        await reader.markRead({ postId: "z-latest" });
        await behind.markRead({ postId: opening.id });
        const otherPost = (
          await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) })
        )[0]!;
        await reader.markRead({ postId: otherPost.id });
        const unaffected = (await db.query.forumRead.findMany()).filter(
          (r) => r.threadId === other || r.userId === playerId,
        );
        expect(
          (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 }))
            .threads,
        ).toHaveLength(0);
        expect(
          (
            await admin.moderatePost({
              postId: "m-pending",
              action: "APPROVE",
              reason: "Publish reviewed advice",
            })
          ).success,
        ).toBe(true);
        const unread = await reader.getThreads({
          boardId: "general",
          view: "unread",
          limit: 20,
        });
        expect(unread.threads[0]).toEqual(
          expect.objectContaining({
            id,
            unread: true,
            resumePostId: sameTime ? "a-prior" : "zz-prior",
            updatedAt: latestAt,
            lastPostId: "z-latest",
          }),
        );
        expect(
          (await reader.resolvePost({ postId: unread.threads[0]!.resumePostId! }))
            ?.threadId,
        ).toBe(id);
        expect(
          (await db.query.forumRead.findMany()).filter(
            (r) => r.threadId === other || r.userId === playerId,
          ),
        ).toEqual(unaffected);
        expect(
          (await db.query.forumPost.findFirst({ where: eq(forumPost.id, "m-pending") }))
            ?.createdAt,
        ).toEqual(pendingAt);
        await reader.markRead({ postId: "z-latest" });
        await admin.moderatePost({
          postId: "m-pending",
          action: "APPROVE",
          reason: "Repeated approval",
        });
        expect(
          (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 }))
            .threads,
        ).toHaveLength(0);
        expect(
          (await reader.personal()).reads.find((r) => r.threadId === id)?.postId,
        ).toBe("z-latest");
      },
    );
    it.each(["post", "topic"])(
      "recovers unread opening posts through %s approval without a previous visible post",
      async (path) => {
        const db = await getTestDatabase();
        const id = await create();
        const reader = await client(moderatorId);
        const admin = await client(adminId);
        const opening = (await db.query.forumPost.findMany())[0]!;
        await (await comments(adminId)).createForumComment(
          commentInput(id, "A later staff reply already read by this reader"),
        );
        const latest = (await db.query.forumPost.findMany()).find(
          (p) => p.id !== opening.id,
        )!;
        await reader.markRead({ postId: latest.id });
        await db
          .update(forumPost)
          .set({
            isApproved: false,
            publicationIntent: { threadId: id, opening: true },
          })
          .where(eq(forumPost.id, opening.id));
        const approve = () =>
          path === "post"
            ? admin.moderatePost({
                postId: opening.id,
                action: "APPROVE",
                reason: "Publish the opening post",
              })
            : admin.moderateThreads({
                ids: [id],
                action: "APPROVE",
                reason: "Publish the opening post",
              });
        expect((await approve()).success).toBe(true);
        expect(
          (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 }))
            .threads[0],
        ).toMatchObject({ id, unread: true, resumePostId: null });
        await reader.markRead({ postId: latest.id });
        await approve();
        expect(
          (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 }))
            .threads,
        ).toHaveLength(0);
        expect(
          (await db.query.forumPost.findFirst({ where: eq(forumPost.id, opening.id) }))
            ?.createdAt,
        ).toEqual(opening.createdAt);
      },
    );
    it.each([
      "post",
      "topic",
      "post-seen",
      "topic-seen",
      "post-then-topic",
      "topic-then-post",
    ])("publishes hidden approvals once through %s restoration", async (path) => {
      const seen = path.endsWith("seen");
      const postFirst = path.startsWith("post");
      const nested = path.includes("then");
      const db = await getTestDatabase();
      const id = await create();
      const other = await create("other");
      const opening = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, id) })
      )[0]!;
      await db
        .update(forumPost)
        .set({ createdAt: new Date(1000) })
        .where(eq(forumPost.id, opening.id));
      await db.insert(forumPost).values([
        {
          id: "pending-restore",
          threadId: id,
          userId: adminId,
          authorId: adminId,
          content: "Advice approved while hidden",
          createdAt: new Date(2000),
          isApproved: seen,
          publicationIntent: seen ? null : { threadId: id, opening: false },
        },
        {
          id: "latest-restore",
          threadId: id,
          userId: adminId,
          authorId: adminId,
          content: "Later reply already read",
          createdAt: new Date(3000),
        },
      ]);
      const reader = await client();
      const behind = await client(moderatorId);
      const admin = await client(adminId);
      await admin.repairCounters({ boardId: "general" });
      await reader.markRead({ postId: "latest-restore" });
      await behind.markRead({ postId: opening.id });
      const otherPost = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, other) })
      )[0]!;
      await reader.markRead({ postId: otherPost.id });
      const before = await db.query.forumRead.findMany();
      const unaffected = before.filter(
        (r) => r.threadId === other || r.userId === moderatorId,
      );
      await reader.watch({ scope: "THREAD", scopeId: id, active: true, push: false });
      const remove = (post: boolean) =>
        post
          ? admin.moderatePost({
              postId: "pending-restore",
              action: "REMOVE",
              reason: "Retain content for review",
            })
          : admin.moderateThreads({
              ids: [id],
              action: "REMOVE",
              reason: "Retain the topic for review",
            });
      const restore = (post: boolean) =>
        post
          ? admin.moderatePost({
              postId: "pending-restore",
              action: "RESTORE",
              reason: "Restore reviewed content",
            })
          : admin.moderateThreads({
              ids: [id],
              action: "RESTORE",
              reason: "Restore the reviewed topic",
            });
      expect((await remove(nested || postFirst)).success).toBe(true);
      if (nested) expect((await remove(false)).success).toBe(true);
      for (let i = 0; i < 2; i++)
        expect(
          (
            await admin.moderatePost({
              postId: "pending-restore",
              action: "APPROVE",
              reason: "Approve retained advice",
            })
          ).success,
        ).toBe(true);
      expect(await db.query.forumRead.findMany()).toEqual(before);
      expect(await reader.alerts()).toHaveLength(0);
      expect(await db.query.forumAlert.findMany()).toHaveLength(0);
      expect(await reader.resolvePost({ postId: "pending-restore" })).toBeNull();
      await db
        .update(forumGrant)
        .set({ permissions: ["approve"] })
        .where(eq(forumGrant.id, "scoped"));
      const approver = await client(moderatorId);
      expect(
        (
          await approver.moderatePost({
            postId: "pending-restore",
            action: "RESTORE",
            reason: "Try approval-only restoration",
          })
        ).success,
      ).toBe(false);
      expect(
        (
          await approver.moderateThreads({
            ids: [id],
            action: "RESTORE",
            reason: "Try approval-only restoration",
          })
        ).success,
      ).toBe(false);
      expect((await restore(postFirst)).success).toBe(true);
      if (nested) {
        expect(await db.query.forumRead.findMany()).toEqual(before);
        expect(await reader.alerts()).toHaveLength(0);
        expect(await reader.resolvePost({ postId: "pending-restore" })).toBeNull();
        expect((await restore(!postFirst)).success).toBe(true);
      }
      const thread = (await reader.getThreads({ boardId: "general", limit: 20 }))
        .threads[0]!;
      expect(thread).toMatchObject({
        id,
        nPosts: 3,
        unread: !seen,
        resumePostId: seen ? "latest-restore" : opening.id,
      });
      expect(
        (
          await reader.getThreads({ boardId: "general", view: "unread", limit: 20 })
        ).threads.map((t) => t.id),
      ).toEqual(seen ? [] : [id]);
      expect(await reader.resolvePost({ postId: "pending-restore" })).toMatchObject({
        threadId: id,
      });
      expect(await reader.alerts()).toHaveLength(seen ? 0 : 1);
      expect(
        (await db.query.forumRead.findMany()).filter(
          (r) => r.threadId === other || r.userId === moderatorId,
        ),
      ).toEqual(unaffected);
      await reader.markRead({ postId: "latest-restore" });
      const read = await db.query.forumRead.findMany();
      expect((await restore(postFirst)).success).toBe(true);
      expect((await remove(postFirst)).success).toBe(true);
      expect((await restore(postFirst)).success).toBe(true);
      expect(await db.query.forumRead.findMany()).toEqual(read);
      expect(
        (await reader.getThreads({ boardId: "general", view: "unread", limit: 20 }))
          .threads,
      ).toHaveLength(0);
      expect(await reader.alerts()).toHaveLength(seen ? 0 : 1);
    });
    it.each(["COPY", "SPLIT", "MERGE"] as const)(
      "retains deferred publication through %s without exposing hidden posts",
      async (action) => {
        const db = await getTestDatabase();
        const id = await create();
        const destination = await create();
        const admin = await client(adminId);
        await db.insert(forumPost).values({
          id: "restructure-pending",
          threadId: id,
          userId: playerId,
          authorId: playerId,
          content: "Deferred advice",
          isApproved: false,
          publicationIntent: { threadId: id, opening: false },
        });
        await admin.moderatePost({
          postId: "restructure-pending",
          action: "REMOVE",
          reason: "Retain pending advice",
        });
        await admin.moderatePost({
          postId: "restructure-pending",
          action: "APPROVE",
          reason: "Approve hidden advice",
        });
        const result = await admin.restructureTopic({
          threadId: id,
          action,
          boardId: "general",
          targetThreadId: destination,
          title: "Restructured discussion",
          reason: "Reorganize related advice",
          postIds: ["restructure-pending"],
        });
        expect(result.success).toBe(true);
        const pending = await db.query.forumPost.findFirst({
          where: eq(forumPost.id, "restructure-pending"),
        });
        expect(pending).toMatchObject({
          threadId: action === "COPY" ? id : result.threadId,
          publicationIntent: { threadId: id, opening: false },
          deletedAt: expect.any(Date),
        });
        expect(
          await (await client()).resolvePost({ postId: "restructure-pending" }),
        ).toBeNull();
        if (action === "COPY")
          expect(
            (
              await db.query.forumPost.findMany({
                where: eq(forumPost.threadId, result.threadId!),
              })
            ).every((p) => !p.publicationIntent && !p.deletedAt),
          ).toBe(true);
        expect(
          (
            await admin.moderatePost({
              postId: "restructure-pending",
              action: "RESTORE",
              reason: "Publish the reviewed advice",
            })
          ).success,
        ).toBe(true);
        expect(
          (
            await db.query.forumPost.findFirst({
              where: eq(forumPost.id, "restructure-pending"),
            })
          )?.publicationIntent,
        ).toBeNull();
        expect(
          await (await client()).resolvePost({ postId: "restructure-pending" }),
        ).not.toBeNull();
      },
    );
    it("keeps reading positions when approval does not publish removed content", async () => {
      const id = await create();
      const db = await getTestDatabase();
      const reader = await client(moderatorId);
      const admin = await client(adminId);
      const post = (await db.query.forumPost.findMany())[0]!;
      await reader.markRead({ postId: post.id });
      const before = await db.query.forumRead.findMany();
      await db
        .update(forumPost)
        .set({
          isApproved: false,
          deletedAt: new Date(),
          publicationIntent: { threadId: id, opening: true },
        })
        .where(eq(forumPost.id, post.id));
      await admin.moderatePost({
        postId: post.id,
        action: "APPROVE",
        reason: "Approve while removed",
      });
      expect(await db.query.forumRead.findMany()).toEqual(before);
      await db
        .update(forumPost)
        .set({
          isApproved: false,
          deletedAt: null,
          publicationIntent: { threadId: id, opening: true },
        })
        .where(eq(forumPost.id, post.id));
      await db
        .update(forumThread)
        .set({ deletedAt: new Date() })
        .where(eq(forumThread.id, id));
      await admin.moderatePost({
        postId: post.id,
        action: "APPROVE",
        reason: "Approve in a removed topic",
      });
      expect(await db.query.forumRead.findMany()).toEqual(before);
      await db
        .update(forumPost)
        .set({ isApproved: false, publicationIntent: { threadId: id, opening: true } })
        .where(eq(forumPost.id, post.id));
      await admin.moderateThreads({
        ids: [id],
        action: "APPROVE",
        reason: "Approve a removed topic",
      });
      expect(await db.query.forumRead.findMany()).toEqual(before);
    });
    it("lists only pending and removed posts, leaving reported-only content to Reports", async () => {
      const id = await create();
      const db = await getTestDatabase();
      const opening = (await db.query.forumPost.findFirst())!;
      await db
        .update(forumPost)
        .set({ isReported: true })
        .where(eq(forumPost.id, opening.id));
      await db.insert(forumPost).values([
        {
          id: "pending-reported",
          threadId: id,
          userId: playerId,
          authorId: playerId,
          content: "Pending publication",
          isApproved: false,
          isReported: true,
        },
        {
          id: "removed-reported",
          threadId: id,
          userId: playerId,
          authorId: playerId,
          content: "Recoverable content",
          deletedAt: new Date(),
          isReported: true,
        },
      ]);
      const administration = await (await client(adminId)).administration({
        query: "",
      });
      expect(administration?.threads).toEqual([]);
      expect(administration?.posts.map((p) => p.post.id).sort()).toEqual([
        "pending-reported",
        "removed-reported",
      ]);
      expect(administration?.hasMoreReviews).toBe(false);
      expect(
        (await db.query.forumPost.findFirst({ where: eq(forumPost.id, opening.id) }))
          ?.isReported,
      ).toBe(true);
      await db
        .update(forumGrant)
        .set({ permissions: ["approve"] })
        .where(eq(forumGrant.id, "scoped"));
      expect(
        (await (await client(moderatorId)).administration({ query: "" }))?.posts.map(
          (p) => p.post.id,
        ),
      ).toEqual(["pending-reported"]);
    });
    it("keeps older pending reviews reachable without exposing recovery records to approvers", async () => {
      const db = await getTestDatabase();
      await db
        .update(forumGrant)
        .set({ permissions: ["approve"] })
        .where(eq(forumGrant.id, "scoped"));
      await db.insert(forumThread).values({
        id: "pending",
        boardId: "general",
        title: "Pending discussion",
        userId: playerId,
        isApproved: false,
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
      });
      await db.insert(forumPost).values({
        id: "pending-post",
        threadId: "pending",
        userId: playerId,
        authorId: playerId,
        content: "Opening post awaiting approval",
        isApproved: false,
        createdAt: new Date(1000),
      });
      await db.insert(forumThread).values(
        Array.from({ length: 100 }, (_, i) => ({
          id: `removed-${i}`,
          boardId: "general",
          title: "Removed discussion",
          userId: playerId,
          deletedAt: new Date(2000),
          createdAt: new Date(2000),
          updatedAt: new Date(2000),
        })),
      );
      await db.insert(forumPost).values(
        Array.from({ length: 100 }, (_, i) => ({
          id: `removed-post-${i}`,
          threadId: `removed-${i}`,
          userId: playerId,
          authorId: playerId,
          content: "Retained removed content",
          deletedAt: new Date(2000),
          createdAt: new Date(2000),
        })),
      );
      await db.insert(forumPost).values({
        id: "removed-topic-pending-post",
        threadId: "removed-0",
        userId: playerId,
        authorId: playerId,
        content: "Pending content in a removed topic",
        isApproved: false,
        createdAt: new Date(2000),
      });
      const approver = await (await client(moderatorId)).administration({ query: "" });
      expect(approver?.threads.map((t) => t.id)).toEqual(["pending"]);
      expect(approver?.posts.map((p) => p.post.id)).toEqual(["pending-post"]);
      expect(approver?.hasMoreReviews).toBe(false);
      const admin = await client(adminId);
      const first = await admin.administration({ query: "" });
      expect(first?.threads).toHaveLength(100);
      expect(first?.posts).toHaveLength(100);
      expect(first?.hasMoreReviews).toBe(true);
      const second = await admin.administration({ query: "", reviewPage: 1 });
      expect(second?.threads.map((t) => t.id)).toEqual(["pending"]);
      expect(second?.posts.some((p) => p.post.id === "pending-post")).toBe(true);
      expect(second?.hasMoreReviews).toBe(false);
      expect(
        second?.posts.some((p) =>
          first?.posts.some((firstPost) => firstPost.post.id === p.post.id),
        ),
      ).toBe(false);
    });
    it("paginates approval-only queues after board scope and recovery visibility", async () => {
      const db = await getTestDatabase();
      await db
        .update(forumGrant)
        .set({ permissions: ["approve"] })
        .where(eq(forumGrant.id, "scoped"));
      await db.insert(forumThread).values(
        Array.from({ length: 102 }, (_, i) => ({
          id: `pending-${i}`,
          boardId: i === 101 ? "private-board" : "general",
          title: "Pending discussion",
          userId: playerId,
          isApproved: false,
          updatedAt: new Date(1000),
        })),
      );
      await db.insert(forumPost).values(
        Array.from({ length: 102 }, (_, i) => ({
          id: `pending-post-${i}`,
          threadId: `pending-${i}`,
          userId: playerId,
          authorId: playerId,
          content: "Pending reply",
          isApproved: false,
          createdAt: new Date(1000),
        })),
      );
      const approver = await client(moderatorId);
      const first = await approver.administration({ query: "" });
      const second = await approver.administration({ query: "", reviewPage: 1 });
      expect(first?.threads).toHaveLength(100);
      expect(first?.posts).toHaveLength(100);
      expect(first?.hasMoreReviews).toBe(true);
      expect(second?.threads).toHaveLength(1);
      expect(second?.posts).toHaveLength(1);
      expect(second?.hasMoreReviews).toBe(false);
      const topics = [...first!.threads, ...second!.threads];
      const posts = [...first!.posts, ...second!.posts];
      expect(new Set(topics.map((t) => t.id)).size).toBe(101);
      expect(new Set(posts.map((p) => p.post.id)).size).toBe(101);
      expect(topics.every((t) => t.boardId === "general")).toBe(true);
      expect(posts.every((p) => p.thread.boardId === "general")).toBe(true);
    });
    it("rejects a post moved after preload and an author removal after a post lock", async () => {
      const topicId = await create();
      const privateId = await create("private-board", adminId);
      const db = await getTestDatabase();
      const post = (
        await db.query.forumPost.findMany({ where: eq(forumPost.threadId, topicId) })
      )[0]!;
      const moved = beforeTransaction(db, () =>
        db
          .update(forumPost)
          .set({ threadId: privateId })
          .where(eq(forumPost.id, post.id)),
      );
      expect(
        (
          await (
            await client(moderatorId, moved)
          ).moderatePost({
            postId: post.id,
            action: "LOCK",
            reason: "Stale scope must reject",
          })
        ).success,
      ).toBe(false);
      expect(
        (await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }))
          ?.isLocked,
      ).toBe(false);
      await db
        .update(forumPost)
        .set({ threadId: topicId })
        .where(eq(forumPost.id, post.id));
      const locked = beforeTransaction(db, () =>
        db.update(forumPost).set({ isLocked: true }).where(eq(forumPost.id, post.id)),
      );
      expect(
        (await (await comments(playerId, locked)).deleteForumComment({ id: post.id }))
          .success,
      ).toBe(false);
      expect(
        (await db.query.forumPost.findFirst({ where: eq(forumPost.id, post.id) }))
          ?.deletedAt,
      ).toBeNull();
    });
    it.each(["author removal", "moderator removal"] as const)(
      "rejects stale board permissions for %s without changing discussion state",
      async (action) => {
        const id = await create();
        const db = await getTestDatabase();
        const post = (await db.query.forumPost.findFirst())!;
        await db
          .update(forumPost)
          .set({ isReported: true })
          .where(eq(forumPost.id, post.id));
        await db
          .update(forumThread)
          .set({ acceptedPostId: post.id })
          .where(eq(forumThread.id, id));
        await db.insert(forumRead).values({
          userId: moderatorId,
          threadId: id,
          postId: post.id,
          readAt: post.createdAt,
        });
        const discussionState = () =>
          Promise.all([
            db.query.forumPost.findMany(),
            db.query.forumThread.findMany(),
            db.query.forumRead.findMany(),
          ]);
        const [before, board, audit] = await Promise.all([
          discussionState(),
          db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
          db.query.forumAudit.findMany(),
        ]);
        const actorId = action === "author removal" ? playerId : moderatorId;
        const policy =
          action === "author removal"
            ? { deleteOwn: false }
            : { read: "STAFF" as const };
        const stale = beforeTransaction(db, async () => {
          expect(
            (
              await (
                await client(adminId)
              ).saveBoard({
                ...board!,
                policy,
                reason: "Restrict access to this discussion",
              })
            ).success,
          ).toBe(true);
        });
        const result = await (await comments(actorId, stale)).deleteForumComment({
          id: post.id,
        });
        const permissions = (await getForumContext(db, actorId)).boards.find(
          (b) => b.id === "general",
        )!.permissions;
        expect(
          action === "author removal" ? permissions.remove : permissions.moderate,
        ).toBe(false);
        expect(result.success).toBe(false);
        expect(result.message).toContain("Refresh");
        expect(await discussionState()).toEqual(before);
        expect(
          await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
        ).toEqual({ ...board!, policy });
        const afterAudit = await db.query.forumAudit.findMany();
        expect(afterAudit.filter((a) => a.action !== "board.save")).toEqual(audit);
        expect(afterAudit.filter((a) => a.action === "board.save")).toHaveLength(1);
      },
    );
    it("preserves type, tags and accepted answers when moving a topic without metadata edits", async () => {
      const player = await client();
      const result = await player.createThread({
        ...topicInput(),
        kind: "QUESTION",
        tags: ["healing"],
      });
      const id = result.threadId!;
      await (await comments(moderatorId)).createForumComment(commentInput(id));
      const db = await getTestDatabase();
      const reply = (await db.query.forumPost.findMany()).find(
        (p) => p.authorId === moderatorId,
      )!;
      await player.acceptAnswer({ threadId: id, postId: reply.id });
      expect(
        (
          await (
            await client(adminId)
          ).moderateThreads({
            ids: [id],
            action: "UPDATE",
            boardId: "other",
            reason: "Move without changing topic metadata",
          })
        ).success,
      ).toBe(true);
      expect(
        await db.query.forumThread.findFirst({ where: eq(forumThread.id, id) }),
      ).toMatchObject({
        boardId: "other",
        kind: "QUESTION",
        tags: ["healing"],
        acceptedPostId: reply.id,
      });
      expect(
        await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "general") }),
      ).toMatchObject({ nThreads: 0, nPosts: 0 });
      expect(
        await db.query.forumBoard.findFirst({ where: eq(forumBoard.id, "other") }),
      ).toMatchObject({ nThreads: 1, nPosts: 2 });
    });
  },
);
