import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { Table } from "drizzle-orm";
import { FORUM_MIN_LEVEL, MESSAGING_MIN_LEVEL } from "@/drizzle/constants";
import {
  conversationComment,
  forumBoard,
  forumPost,
  forumThread,
  userNindo,
} from "@/drizzle/schema";
import * as moderation from "@/libs/moderation/defer";
import * as pusher from "@/libs/pusher";
import { commentsRouter } from "@/routers/comments";
import { forumRouter } from "@/routers/forum";
import { profileRouter, updateNindo } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { callerForDatabase } from "../../../setup/testDatabase";
import { deferred } from "../../../setup/deferred";

const user = {
  userId: "poster",
  username: "Poster",
  role: "USER",
  isBanned: false,
  isSilenced: false,
  level: Math.max(FORUM_MIN_LEVEL, MESSAGING_MIN_LEVEL),
};
const comment = {
  id: "post",
  authorId: user.userId,
  content: "A normal game conversation",
  isLocked: false,
  isApproved: true,
  deletedAt: null,
  userId: user.userId,
  threadId: "thread",
  conversationId: "conversation",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const input = {
  object_id: "post",
  comment: "A normal game conversation",
  quoteIds: null,
  senderId: null,
};
const trigger = vi.fn();
const defer = vi.fn();

const board = {
  id: "board",
  name: "Discussion",
  sectionId: "section",
  parentId: null,
  policy: {},
  archived: false,
  slowModeSeconds: 0,
  requireApproval: false,
  section: { id: "section", policy: {}, archived: false },
};
const thread = {
  id: "thread",
  boardId: "board",
  isLocked: false,
  isApproved: true,
  deletedAt: null,
};
const makeClient = (
  write: (table: Table) => Promise<unknown> = async () => ({ rowsAffected: 1 }),
  isPublic = true,
) => {
  const client = {
    query: {
      userData: { findFirst: async () => user },
      forumThread: { findFirst: async () => thread },
      forumBoard: { findFirst: async () => board, findMany: async () => [board] },
      forumSection: { findMany: async () => [board.section] },
      userBlackList: { findMany: async () => [] },
      forumGrant: { findMany: async () => [] },
      forumRestriction: { findMany: async () => [] },
      forumWatch: { findMany: async () => [] },
      forumPost: { findFirst: async () => comment },
      conversationComment: { findFirst: async () => comment },
      conversation: {
        findFirst: async () => ({
          id: "conversation",
          isPublic,
          isEnabled: true,
          isStaffAvailable: false,
          users: [{ userId: user.userId }],
        }),
      },
      parentalControl: { findMany: async () => [] },
      userNindo: { findFirst: async () => ({ userId: user.userId }) },
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(client),
    select: () => ({
      from: (table: Table) => ({
        innerJoin: () => ({
          where: () => ({ for: async () => [{ ...board, sectionArchived: false }] }),
        }),
        where: () => ({
          for: async () =>
            table === forumThread
              ? [thread]
              : table === forumBoard
                ? [board]
                : [{ id: "section", policy: {}, archived: false }],
        }),
      }),
    }),
    insert: (table: Table) => ({ values: () => write(table) }),
    update: (table: Table) => ({ set: () => ({ where: () => write(table) }) }),
    selectDistinct: () => ({
      from: () => ({ innerJoin: () => ({ where: async () => [] }) }),
    }),
  };
  return client as unknown as DrizzleClient;
};

const cases = [
  {
    name: "public conversation creation",
    table: conversationComment,
    relationType: "comment",
    run: (db: DrizzleClient, text = input.comment) =>
      callerForDatabase(commentsRouter, user.userId, db).createConversationComment({
        ...input,
        comment: text,
      }),
  },
  {
    name: "conversation editing",
    table: conversationComment,
    relationType: "comment",
    run: (db: DrizzleClient, text = input.comment) =>
      callerForDatabase(commentsRouter, user.userId, db).editConversationComment({
        ...input,
        comment: text,
      }),
  },
  {
    name: "forum comment creation",
    table: forumPost,
    relationType: "forumPost",
    run: (db: DrizzleClient, text = input.comment) =>
      callerForDatabase(commentsRouter, user.userId, db).createForumComment({
        ...input,
        comment: text,
      }),
  },
  {
    name: "forum comment editing",
    table: forumPost,
    relationType: "forumPost",
    run: (db: DrizzleClient, text = input.comment) =>
      callerForDatabase(commentsRouter, user.userId, db).editForumComment({
        ...input,
        comment: text,
      }),
  },
  {
    name: "forum thread creation",
    table: forumPost,
    relationType: "forumPost",
    run: (db: DrizzleClient, text = input.comment) =>
      callerForDatabase(forumRouter, user.userId, db).createThread({
        board_id: "board",
        title: "Game discussion",
        content: text,
        image: null,
        senderId: null,
      }),
  },
  {
    name: "profile nindo",
    table: userNindo,
    relationType: "userNindo",
    run: (db: DrizzleClient, text = input.comment) =>
      callerForDatabase(profileRouter, user.userId, db).updateNindo({
        userId: user.userId,
        content: text,
      }),
  },
];

beforeEach(() => {
  defer.mockReset();
  trigger.mockReset().mockResolvedValue(undefined);
  vi.spyOn(moderation, "deferModeration").mockImplementation(defer);
  vi.spyOn(pusher, "getServerPusher").mockReturnValue({
    trigger,
  } as unknown as ReturnType<typeof pusher.getServerPusher>);
  // Keep rate limiting active, but prevent external HTTP in caller tests.
  stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request" });
});
afterEach(() => vi.restoreAllMocks());

describe("posting moderation scheduling", () => {
  it.each(cases)(
    "returns from $name after storage without waiting for moderation",
    async ({ run, table, relationType }) => {
      let saved = false;
      const { promise: writing, resolve: started } = deferred<void>();
      const { promise: stored, resolve: release } = deferred<void>();
      const db = makeClient(async (target) => {
        if (target === table) {
          started();
          await stored;
          saved = true;
        }
        return { rowsAffected: 1 };
      });
      defer.mockImplementation(() => {
        expect(saved).toBe(true);
      });
      const request = run(db);
      await writing;
      expect(defer).not.toHaveBeenCalled();
      release();
      expect((await request).success).toBe(true);
      expect(defer).toHaveBeenCalledTimes(1);
      expect(defer.mock.calls[0]?.[1]).toMatchObject({
        content: input.comment,
        userId: user.userId,
        relationType,
      });
    },
  );

  it.each(cases)(
    "does not schedule a scan when the $name content write fails",
    async ({ run, table }) => {
      const db = makeClient(async (target) => {
        if (target === table) throw new Error("Content write failed");
        return { rowsAffected: 1 };
      });
      await expect(run(db)).rejects.toThrow("Content write failed");
      expect(defer).not.toHaveBeenCalled();
    },
  );

  it.each(cases.slice(0, 5))(
    "keeps the profanity gate before the $name write",
    async ({ run }) => {
      const writes = vi.fn().mockResolvedValue({ rowsAffected: 1 });
      const db = makeClient(writes);
      const result = await run(db, "This is shit");
      expect(result.success).toBe(false);
      expect(writes).not.toHaveBeenCalled();
      expect(defer).not.toHaveBeenCalled();
    },
  );

  it("broadcasts a public message before its moderation callback runs", async () => {
    expect((await cases[0]!.run(makeClient())).success).toBe(true);
    expect(trigger).toHaveBeenCalledWith(
      "conversation",
      "event",
      expect.objectContaining({ message: "new" }),
    );
    expect(defer).toHaveBeenCalledTimes(1);
  });

  it.each([cases[0]!])(
    "still schedules a scan for saved $name content when a counter write fails",
    async ({ run, table }) => {
      const db = makeClient(async (target) => {
        if (target !== table) throw new Error("Counter write failed");
        return { rowsAffected: 1 };
      });
      await expect(run(db)).rejects.toThrow("Counter write failed");
      expect(defer).toHaveBeenCalledTimes(1);
    },
  );

  it.each([cases[2]!, cases[4]!])(
    "does not schedule moderation when atomic $name storage fails",
    async ({ run, table }) => {
      const db = makeClient(async (target) => {
        if (target !== table) throw new Error("Counter write failed");
        return { rowsAffected: 1 };
      });
      await expect(run(db)).rejects.toThrow("Counter write failed");
      expect(defer).not.toHaveBeenCalled();
    },
  );

  it("keeps new private messages unscanned and private edits scanned", async () => {
    const db = makeClient(undefined, false);
    expect((await cases[0]!.run(db)).success).toBe(true);
    expect(defer).not.toHaveBeenCalled();
    expect((await cases[1]!.run(db)).success).toBe(true);
    expect(defer.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        relationType: "privateMessage",
        createdAt: comment.createdAt,
      }),
    );
  });

  it.each(["clanOrder", "anbuOrder", "kageOrder"] as const)(
    "defers shared %s Nindo updates",
    async (type) => {
      expect(
        (await updateNindo(makeClient(), user.userId, input.comment, type)).success,
      ).toBe(true);
      expect(defer.mock.calls[0]?.[1]).toMatchObject({
        relationType: type,
        relationId: user.userId,
      });
    },
  );
});
