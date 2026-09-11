// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { actionLog, forumPost, userData, userReport } from "@/drizzle/schema";
import { createUserReport } from "@/server/api/routers/reports";
import type { DrizzleClient } from "@/server/db";
import type { UserReportSchema } from "@/validators/reports";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const REPORTER = "gap94-reporter";
const TARGET = "gap94-target";
const POST = "gap94-forum-post";

const input = (
  requestId: string,
  overrides: Partial<UserReportSchema> = {},
): UserReportSchema => ({
  system: "forum_comment",
  system_id: POST,
  reported_userId: TARGET,
  reason: "Gap94 focused report reason",
  requestId,
  ...overrides,
});

const moderation = vi.fn(async () => ({
  decision: { createReport: "UNVIEWED" as const, reasoning: "test" },
  aiInterpretation: "Gap94 moderation summary",
}));

describeWithDatabase("reports.create", () => {
  beforeEach(async () => {
    const database = await getTestDatabase();
    await resetTables(actionLog, userReport, forumPost, userData);
    await insertUsers([
      { userId: REPORTER, username: "Gap94 Reporter" },
      { userId: TARGET, username: "Gap94 Target" },
      { userId: "gap94-banned", username: "Gap94 Banned", isBanned: true },
    ]);
    await database.insert(forumPost).values({
      id: POST,
      content: "Gap94 reportable forum content",
      threadId: "gap94-thread",
      userId: TARGET,
      authorId: TARGET,
    });
    moderation.mockClear();
  });

  it("atomically claims content, inserts one report and audit receipt, and replays without remoderating", async () => {
    const database = await getTestDatabase();
    const request = input("94000000-0000-4000-8000-000000000001");

    const first = await createUserReport(database, REPORTER, request, moderation);
    const replay = await createUserReport(database, REPORTER, request, moderation);
    const post = await database.query.forumPost.findFirst({
      where: eq(forumPost.id, POST),
    });
    const reports = await database.query.userReport.findMany();
    const receipts = await database.query.actionLog.findMany({
      where: eq(
        actionLog.id,
        `create-report:${REPORTER}:${request.requestId as string}`,
      ),
    });

    expect(first).toMatchObject({
      success: true,
      requestId: request.requestId,
      system: request.system,
      systemId: POST,
      reportedUserId: TARGET,
      reportSubjectUserId: TARGET,
    });
    expect(first?.success && first.reportId.length).toBeGreaterThan(0);
    expect(replay).toEqual(first);
    expect(post?.isReported).toBe(true);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      id: first?.success ? first.reportId : undefined,
      reporterUserId: REPORTER,
      reportedUserId: TARGET,
      reason: request.reason,
    });
    expect(receipts).toHaveLength(1);
    expect(moderation).toHaveBeenCalledTimes(1);
  });

  it("serializes same-request concurrency and makes distinct requests single-winner", async () => {
    const database = await getTestDatabase();
    const same = input("94000000-0000-4000-8000-000000000002");
    const sameResults = await Promise.all([
      createUserReport(database, REPORTER, same, moderation),
      createUserReport(database, REPORTER, same, moderation),
    ]);
    expect(sameResults.every((result) => result?.success)).toBe(true);
    expect(sameResults[0]).toEqual(sameResults[1]);
    expect(await database.query.userReport.findMany()).toHaveLength(1);

    await database.delete(actionLog);
    await database.delete(userReport);
    await database
      .update(forumPost)
      .set({ isReported: false })
      .where(eq(forumPost.id, POST));
    const distinctResults = await Promise.all([
      createUserReport(
        database,
        REPORTER,
        input("94000000-0000-4000-8000-000000000003"),
        moderation,
      ),
      createUserReport(
        database,
        REPORTER,
        input("94000000-0000-4000-8000-000000000004"),
        moderation,
      ),
    ]);
    expect(distinctResults.map((result) => result?.success).sort()).toEqual([
      false,
      true,
    ]);
    expect(await database.query.userReport.findMany()).toHaveLength(1);
  });

  it("rejects changed replay identities, banned reporters, self reports, and stale targets", async () => {
    const database = await getTestDatabase();
    const request = input("94000000-0000-4000-8000-000000000005");
    await createUserReport(database, REPORTER, request, moderation);
    const changedReplay = await createUserReport(
      database,
      REPORTER,
      { ...request, reason: "A changed reason" },
      moderation,
    );
    const banned = await createUserReport(
      database,
      "gap94-banned",
      input("94000000-0000-4000-8000-000000000006"),
      moderation,
    );

    await database.delete(actionLog);
    await database.delete(userReport);
    await database
      .update(forumPost)
      .set({ isReported: false, authorId: REPORTER, userId: REPORTER })
      .where(eq(forumPost.id, POST));
    const self = await createUserReport(
      database,
      REPORTER,
      input("94000000-0000-4000-8000-000000000007", {
        reported_userId: REPORTER,
      }),
      moderation,
    );
    const missing = await createUserReport(
      database,
      REPORTER,
      input("94000000-0000-4000-8000-000000000008", {
        system_id: "missing-post",
      }),
      moderation,
    );

    expect(changedReplay).toEqual({
      success: false,
      message: "Invalid report request ID",
    });
    expect(banned?.message).toMatch(/banned/i);
    expect(self?.message).toMatch(/yourself/i);
    expect(missing?.message).toMatch(/not found/i);
  });

  it("rolls back the content claim and report when its receipt insert fails", async () => {
    const database = await getTestDatabase();
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return <T>(callback: (tx: DrizzleClient) => Promise<T>) =>
            target.transaction((tx) =>
              callback(failStatements(tx as unknown as DrizzleClient, actionLog)),
            );
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DrizzleClient;

    await expect(
      createUserReport(
        failingDatabase,
        REPORTER,
        input("94000000-0000-4000-8000-000000000009"),
        moderation,
      ),
    ).rejects.toThrow("Statement failed on purpose");

    const post = await database.query.forumPost.findFirst({
      where: eq(forumPost.id, POST),
    });
    expect(post?.isReported).toBe(false);
    expect(await database.query.userReport.findMany()).toHaveLength(0);
    expect(await database.query.actionLog.findMany()).toHaveLength(0);
  });

  it("rejects a content edit made while moderation is in flight without committing stale evidence", async () => {
    const database = await getTestDatabase();
    const changingModeration = vi.fn(async () => {
      await database
        .update(forumPost)
        .set({ content: "Gap94 edited after confirmation" })
        .where(eq(forumPost.id, POST));
      return {
        decision: { createReport: "UNVIEWED" as const, reasoning: "test" },
        aiInterpretation: "Gap94 moderation summary",
      };
    });

    const result = await createUserReport(
      database,
      REPORTER,
      input("94000000-0000-4000-8000-000000000010"),
      changingModeration,
    );
    const post = await database.query.forumPost.findFirst({
      where: eq(forumPost.id, POST),
    });
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/changed/i);
    expect(post?.isReported).toBe(false);
    expect(await database.query.userReport.findMany()).toHaveLength(0);
  });
});
