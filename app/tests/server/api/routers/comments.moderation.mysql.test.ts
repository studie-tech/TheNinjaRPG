import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as next from "next/server";
import OpenAI from "openai";
import { FORUM_MIN_LEVEL } from "@/drizzle/constants";
import {
  forumBoard,
  forumSection,
  forumPost,
  forumThread,
  moderationScan,
  userData,
} from "@/drizzle/schema";
import { classifyNsfwImage, moderateContent } from "@/libs/moderator";
import { commentsRouter } from "@/server/api/routers/comments";
import { insertUsers } from "../../../setup/factories";
import { unflaggedModeration } from "../../../setup/moderation";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const providerError = (status: number) =>
  Response.json(
    { error: { message: "Provider unavailable" } },
    {
      status,
      headers: { "retry-after-ms": "1" },
    },
  );

const deferred: Array<() => unknown> = [];

describeWithDatabase("comment and image moderation provider recovery", () => {
  beforeEach(async () => {
    deferred.length = 0;
    vi.spyOn(next, "after").mockImplementation((callback) => {
      deferred.push(callback as () => unknown);
    });
    // Keep rate limiting active while isolating all HTTP from real services.
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in moderation tests",
    });
    const db = await getTestDatabase();
    await resetTables(
      moderationScan,
      forumPost,
      forumThread,
      forumBoard,
      forumSection,
      userData,
    );
    await insertUsers([{ userId: "poster", level: FORUM_MIN_LEVEL }]);
    await db
      .insert(forumSection)
      .values({ id: "section", name: "General", summary: "", policy: {} });
    await db
      .insert(forumBoard)
      .values({ id: "board", name: "Discussion", summary: "", sectionId: "section" });
    await db.insert(forumThread).values({
      id: "thread",
      title: "Game discussion",
      userId: "poster",
      boardId: "board",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([429, 503])(
    "posts once when moderation recovers from HTTP %i",
    async (status) => {
      // Stub HTTP responses, preserving the module's real SDK client and retry handling.
      const provider = vi
        .spyOn(OpenAI.prototype, "fetchWithTimeout")
        .mockResolvedValueOnce(providerError(status))
        .mockImplementation(async () => Response.json(unflaggedModeration()));
      const db = await getTestDatabase();
      const result = await callerForDatabase(
        commentsRouter,
        "poster",
        db,
      ).createForumComment({
        object_id: "thread",
        comment: "A normal game conversation",
        quoteIds: null,
        senderId: null,
      });
      expect(result.success).toBe(true);
      expect(provider).not.toHaveBeenCalled();
      expect(deferred).toHaveLength(2);
      await deferred[0]!();
      expect(provider).toHaveBeenCalledTimes(2);
      const posts = await db.query.forumPost.findMany();
      expect(posts).toHaveLength(1);
      expect(posts[0]?.content).toBe("A normal game conversation");
      expect((await db.query.forumThread.findFirst())?.nPosts).toBe(1);
      const scans = await db.query.moderationScan.findMany();
      expect(scans).toHaveLength(1);
      expect(scans[0]?.relationId).toBe(posts[0]?.id);
      expect(scans[0]?.outcome).toBe("GATE_CLEAR");
      expect(scans[0]?.flagged).toBe(false);
      expect(scans[0]?.completedAt).toBeInstanceOf(Date);
      expect(scans[0]?.errorStage).toBeNull();
    },
  );

  it("keeps a saved post successful when background moderation fails", async () => {
    vi.spyOn(OpenAI.prototype, "fetchWithTimeout").mockImplementation(async () =>
      providerError(400),
    );
    const capture = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    const db = await getTestDatabase();
    const result = await callerForDatabase(
      commentsRouter,
      "poster",
      db,
    ).createForumComment({
      object_id: "thread",
      comment: "A normal game conversation",
      quoteIds: null,
      senderId: null,
    });
    expect(result.success).toBe(true);
    await deferred[0]!();
    expect(await db.query.forumPost.findMany()).toHaveLength(1);
    const scan = await db.query.moderationScan.findFirst();
    expect(scan?.outcome).toBe("ERROR");
    expect(scan?.errorStage).toBe("gate");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 503, attempts: 3 },
    { status: 400, attempts: 1 },
  ])(
    "records and propagates a terminal HTTP $status gate failure",
    async ({ status, attempts }) => {
      const provider = vi
        .spyOn(OpenAI.prototype, "fetchWithTimeout")
        .mockImplementation(async () => providerError(status));
      const db = await getTestDatabase();
      await expect(
        moderateContent(db, {
          userId: "poster",
          relationId: "post",
          relationType: "forumPost",
          content: "Game discussion",
        }),
      ).rejects.toThrow("Provider unavailable");
      expect(provider).toHaveBeenCalledTimes(attempts);
      const scans = await db.query.moderationScan.findMany();
      expect(scans).toHaveLength(1);
      expect(scans[0]?.outcome).toBe("ERROR");
      expect(scans[0]?.errorStage).toBe("gate");
      expect(scans[0]?.flagged).toBeNull();
      expect(scans[0]?.completedAt).toBeInstanceOf(Date);
    },
  );

  it.each([{ isNsfw: false }, { isNsfw: true }])(
    "uses the recovered image decision (isNsfw=$isNsfw)",
    async ({ isNsfw }) => {
      const moderation = unflaggedModeration();
      moderation.results[0]!.categories.sexual = isNsfw;
      const provider = vi
        .spyOn(OpenAI.prototype, "fetchWithTimeout")
        .mockResolvedValueOnce(providerError(503))
        .mockImplementation(async () => Response.json(moderation));
      expect(
        (await classifyNsfwImage("https://example.invalid/image.png")).isNsfw,
      ).toBe(isNsfw);
      expect(provider).toHaveBeenCalledTimes(2);
    },
  );

  it("propagates an image provider failure after retries are exhausted", async () => {
    const provider = vi
      .spyOn(OpenAI.prototype, "fetchWithTimeout")
      .mockImplementation(async () => providerError(503));
    await expect(
      classifyNsfwImage("https://example.invalid/image.png"),
    ).rejects.toThrow("Provider unavailable");
    expect(provider).toHaveBeenCalledTimes(3);
  });
});
