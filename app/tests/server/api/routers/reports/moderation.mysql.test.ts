import { GET as runIndexer } from "@/app/api/indexer/route";
import * as gameSettings from "@/libs/gamesettings";
import * as reportSearch from "@/libs/moderation/reportSearch";
import { Moderations } from "openai/resources/moderations";
import { unflaggedModeration } from "../../../../setup/moderation";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { TERR_BOT_ID } from "@/drizzle/constants";
import {
  automatedModeration,
  forumBoard,
  forumGrant,
  forumSection,
  forumThread,
  forumPost,
  moderationScan,
  userData,
  userReport,
} from "@/drizzle/schema";
import * as moderator from "@/libs/moderator";
import { forumRouter } from "@/routers/forum";
import { reportsRouter } from "@/server/api/routers/reports";
import { insertUsers } from "../../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../../setup/serverModules";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const reportInput = {
  system: "forum_comment" as const,
  system_id: "target-post",
  reported_userId: "target",
  reason: "Reporter allegation, separate from the post.",
};

describeWithDatabase("moderation report evidence and dashboard", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(
      automatedModeration,
      moderationScan,
      userReport,
      forumGrant,
      forumPost,
      forumThread,
      forumBoard,
      forumSection,
      userData,
    );
    await insertUsers([
      { userId: "reporter" },
      { userId: "target" },
      { userId: "staff", role: "MODERATOR" },
    ]);
    await db
      .insert(forumSection)
      .values({ id: "section", name: "General", summary: "", policy: {} });
    await db
      .insert(forumBoard)
      .values({ id: "board", name: "Discussion", summary: "", sectionId: "section" });
    await db.insert(forumThread).values({
      id: "thread",
      boardId: "board",
      title: "Discussion",
      userId: "target",
    });
    await db.insert(forumPost).values([
      {
        id: "context-post",
        threadId: "thread",
        userId: "reporter",
        authorId: "staff",
        content: "Earlier conversation",
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        id: "target-post",
        threadId: "thread",
        userId: "target",
        authorId: "target",
        content: "The actual reported message",
        createdAt: new Date(Date.now() - 30_000),
      },
    ]);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("passes source evidence and full context, then stores an original prediction", async () => {
    const db = await getTestDatabase();
    const decide = vi.spyOn(moderator, "generateModerationDecision").mockResolvedValue({
      decision: {
        createReport: "REPORT_CLEARED",
        reasoning: "Ordinary conversation",
      },
      aiInterpretation: "Source summary",
    });
    expect(
      (await callerForDatabase(reportsRouter, "reporter", db).create(reportInput))
        .success,
    ).toBe(true);
    const evidence = decide.mock.calls[0]![1];
    expect(evidence.target.content).toBe("The actual reported message");
    expect(evidence.reporterAllegation).toBe(reportInput.reason);
    expect(evidence.conversation[0]?.content).toBe("Earlier conversation");
    expect(evidence.conversation[0]?.authorId).toBe("staff");
    expect(evidence.conversation[0]?.displayedSpeakerId).toBe("reporter");
    const stored = await db.query.userReport.findFirst();
    expect(stored?.predictedAt).toBeInstanceOf(Date);
    expect(stored?.predictionModel).toBe("gpt-4o-mini");
    expect(stored?.promptVersion).toBe("evidence-v1");
    expect(decide.mock.calls[0]![2]?.excludeReportId).toBe(stored?.id);
  });

  it("saves a human report before a failed provider, without inventing a prediction", async () => {
    const db = await getTestDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(moderator, "generateModerationDecision").mockImplementation(async () => {
      expect(await db.query.userReport.findFirst()).toBeDefined();
      throw new Error("provider unavailable");
    });
    expect(
      (await callerForDatabase(reportsRouter, "reporter", db).create(reportInput))
        .success,
    ).toBe(true);
    const stored = await db.query.userReport.findFirst();
    expect(stored?.predictedStatus).toBeNull();
    expect(stored?.predictedAt).toBeNull();
    expect(
      (await db.query.forumPost.findFirst({ where: eq(forumPost.id, "target-post") }))
        ?.isReported,
    ).toBe(true);
  });

  it("keeps automated and human forum reports in Reports rather than approvals and recovery", async () => {
    const db = await getTestDatabase();
    const gate = unflaggedModeration();
    gate.results[0]!.flagged = true;
    vi.spyOn(Moderations.prototype, "create").mockResolvedValue(gate);
    vi.spyOn(moderator, "generateModerationDecision").mockResolvedValue({
      decision: {
        createReport: "OFFICIAL_WARNING",
        reasoning: "Review this flagged message",
      },
      aiInterpretation: "Flagged forum message",
    });
    expect(
      (await callerForDatabase(reportsRouter, "reporter", db).create(reportInput))
        .success,
    ).toBe(true);
    await moderator.moderateContent(db, {
      userId: "target",
      relationId: "target-post",
      relationType: "forumPost",
      contextId: "thread",
      content: "The actual reported message",
    });
    const reports = await db.query.userReport.findMany();
    expect(reports.map((r) => r.system).sort()).toEqual(["forumPost", "forum_comment"]);
    await db.insert(forumGrant).values({
      id: "scoped-reviewer",
      userId: "reporter",
      scope: "BOARD",
      scopeId: "board",
      permissions: ["moderate"],
      denies: [],
    });
    const reviewer = callerForDatabase(forumRouter, "reporter", db);
    expect((await reviewer.administration({ query: "" }))?.posts).toEqual([]);
    expect(
      (await callerForDatabase(forumRouter, "staff", db).administration({ query: "" }))
        ?.posts,
    ).toEqual([]);
    const staff = callerForDatabase(reportsRouter, "staff", db);
    for (const report of reports)
      expect((await staff.get({ id: report.id }))?.report.id).toBe(report.id);
    expect(await db.query.userReport.findMany()).toEqual(reports);
  });

  it("records gate clears and missing-provider-result failures as different scan outcomes", async () => {
    const db = await getTestDatabase();
    const gate = vi
      .spyOn(Moderations.prototype, "create")
      .mockResolvedValue(unflaggedModeration());
    const input = {
      userId: "target",
      relationId: "target-post",
      relationType: "forumPost" as const,
      content: '<a href="https://example.com">Game guide</a>',
    };
    await moderator.moderateContent(db, input);
    expect(gate.mock.calls[0]![0].input).toContain("https://example.com");
    gate.mockResolvedValue({
      id: "test",
      model: "omni-moderation-latest",
      results: [],
    });
    await expect(moderator.moderateContent(db, input)).rejects.toThrow("no result");
    const rows = await db.query.moderationScan.findMany();
    expect(
      rows.find((row) => row.outcome === "GATE_CLEAR")?.completedAt,
    ).toBeInstanceOf(Date);
    expect(rows.find((row) => row.outcome === "ERROR")?.errorStage).toBe("gate");
  });

  it("backfills a summary without rewriting the historical prediction", async () => {
    const db = await getTestDatabase();
    stubCronAuth(() => null);
    vi.spyOn(gameSettings, "lockWithGameTimer").mockResolvedValue(false);
    vi.spyOn(gameSettings, "updateGameSetting").mockResolvedValue(undefined);
    vi.spyOn(reportSearch, "indexReportEmbeddings").mockResolvedValue(undefined);
    vi.spyOn(moderator, "generateAiSummary").mockResolvedValue(
      "Neutral source summary",
    );
    const decide = vi.spyOn(moderator, "generateModerationDecision");
    await db.insert(userReport).values({
      id: "backfill-case",
      reporterUserId: TERR_BOT_ID,
      reportedUserId: "target",
      system: "forumPost",
      infraction: { content: "Original post" },
      reason: "Old report",
      aiInterpretation: "",
      status: "OFFICIAL_WARNING",
      predictedStatus: "REPORT_CLEARED",
      additionalContext: [
        {
          userId: "reporter",
          username: "Reporter",
          avatar: null,
          level: 1,
          rank: "STUDENT",
          federalStatus: "NONE",
          isOutlaw: false,
          role: "USER",
          content: "Original context",
          createdAt: new Date(),
        },
      ],
    });
    expect((await runIndexer(new Request("http://localhost/api/indexer"))).status).toBe(
      200,
    );
    const stored = await db.query.userReport.findFirst({
      where: eq(userReport.id, "backfill-case"),
    });
    expect(stored?.aiInterpretation).toBe("Neutral source summary");
    expect(stored?.predictedStatus).toBe("REPORT_CLEARED");
    expect(stored?.predictedAt).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it("includes legacy bot clears and aggregates scan counts across outcomes and dates", async () => {
    const db = await getTestDatabase();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600_000);
    await db.insert(userReport).values({
      id: "legacy-bot",
      reporterUserId: TERR_BOT_ID,
      reportedUserId: "target",
      system: "forumPost",
      infraction: {},
      reason: "Legacy case",
      aiInterpretation: "Summary",
      status: "REPORT_CLEARED",
      predictedStatus: "REPORT_CLEARED",
    });
    await db.insert(moderationScan).values([
      {
        id: "gate-1",
        userId: "target",
        relationId: "post",
        relationType: "forumPost",
        gateModel: "omni-moderation-latest",
        decisionModel: "gpt-4o-mini",
        promptVersion: "evidence-v1",
        outcome: "GATE_CLEAR",
        flagged: false,
        createdAt: yesterday,
      },
      {
        id: "gate-2",
        userId: "target",
        relationId: "post",
        relationType: "forumPost",
        gateModel: "omni-moderation-latest",
        decisionModel: "gpt-4o-mini",
        promptVersion: "evidence-v1",
        outcome: "GATE_CLEAR",
        flagged: false,
        createdAt: yesterday,
      },
      {
        id: "error",
        userId: "target",
        relationId: "post",
        relationType: "comment",
        gateModel: "omni-moderation-latest",
        decisionModel: "gpt-4o-mini",
        promptVersion: "evidence-v1",
        outcome: "ERROR",
        flagged: null,
        createdAt: now,
      },
    ]);
    const data = await callerForDatabase(
      reportsRouter,
      "staff",
      db,
    ).getModBotPerformance({ days: 7, interval: "daily", surface: "all" });
    expect(data.summary.botTotal).toBe(1);
    expect(data.summary.botCleared).toBe(1);
    expect(data.summary.excludedPredictions).toBe(1);
    expect(data.summary.scans).toBe(3);
    expect(data.summary.GATE_CLEAR).toBe(2);
    expect(data.summary.ERROR).toBe(1);
    expect(
      data.trend.find((row) => row.date === yesterday.toISOString().slice(0, 10))
        ?.scans,
    ).toBe(2);
    await expect(
      callerForDatabase(reportsRouter, "reporter", db).getModBotPerformance({
        days: 7,
        interval: "daily",
        surface: "all",
      }),
    ).rejects.toThrow("Only staff");
  });
});
