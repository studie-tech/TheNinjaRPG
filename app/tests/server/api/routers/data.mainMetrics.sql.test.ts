import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import {
  historicalIp,
  item,
  jutsu,
  logRankedPicks,
  paypalTransaction,
  quest,
  questHistory,
  referralSource,
  userData,
  visitorLog,
} from "@/drizzle/schema";
import { dataRouter } from "@/server/api/routers/data";
import {
  insertItems,
  insertJutsus,
  insertQuestHistory,
  insertQuests,
  insertUsers,
  jutsuRow,
} from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const VISITED_AT = new Date("2026-01-01T00:00:00Z");
const SIGNED_UP_AT = new Date("2026-01-02T00:00:00Z");
const MOBILE_AGENT = "Mozilla/5.0 (Linux; Android 14) Mobile";
const DESKTOP_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

/** One cohort member per device plus accounts each metric must leave out. */
const seedCohort = async () => {
  const db = await getTestDatabase();
  await insertUsers([
    { userId: "analyst", role: "CODING-ADMIN", isAi: true },
    {
      userId: "mobile",
      username: "MobileRecruit",
      rank: "CHUNIN",
      pvpFights: 3,
      tutorialStep: TUTORIAL_STEPS_COUNT,
      createdAt: SIGNED_UP_AT,
    },
    {
      userId: "desktop",
      username: "DesktopRecruit",
      rank: "GENIN",
      tutorialStep: 7,
      tutorialOn: false,
      createdAt: SIGNED_UP_AT,
    },
    {
      userId: "unknown",
      username: "UnknownRecruit",
      tutorialStep: 2,
      createdAt: SIGNED_UP_AT,
    },
    // A disposable account: past the tutorial range, so signups skip it but rank metrics do not.
    {
      userId: "disposable",
      username: "Disposable",
      rank: "JONIN",
      pvpFights: 1,
      tutorialStep: 100,
      createdAt: SIGNED_UP_AT,
    },
    {
      userId: "early",
      username: "Early",
      rank: "JONIN",
      createdAt: new Date("2025-12-01T00:00:00Z"),
    },
    {
      userId: "ai",
      username: "Bot",
      rank: "JONIN",
      isAi: true,
      createdAt: SIGNED_UP_AT,
    },
  ]);
  await db.insert(visitorLog).values([
    {
      id: "v-mobile",
      ipHash: "mobile",
      utmSource: "discord",
      userAgent: MOBILE_AGENT,
      createdAt: VISITED_AT,
    },
    {
      id: "v-desktop",
      ipHash: "desktop",
      utmSource: "discord",
      userAgent: DESKTOP_AGENT,
      createdAt: VISITED_AT,
    },
    {
      id: "v-unknown",
      ipHash: "unknown",
      utmSource: "discord",
      userAgent: null,
      createdAt: VISITED_AT,
    },
    {
      id: "v-disposable",
      ipHash: "disposable",
      utmSource: "discord",
      userAgent: MOBILE_AGENT,
      createdAt: VISITED_AT,
    },
    {
      id: "v-early",
      ipHash: "early",
      utmSource: "discord",
      userAgent: MOBILE_AGENT,
      createdAt: VISITED_AT,
    },
    {
      id: "v-ai",
      ipHash: "ai",
      utmSource: "discord",
      userAgent: MOBILE_AGENT,
      createdAt: VISITED_AT,
    },
    {
      id: "v-other",
      ipHash: "other",
      utmSource: "reddit",
      userAgent: DESKTOP_AGENT,
      createdAt: VISITED_AT,
    },
    {
      id: "v-direct",
      ipHash: "direct",
      utmSource: "",
      userAgent: DESKTOP_AGENT,
      createdAt: VISITED_AT,
    },
  ]);
  await db.insert(historicalIp).values(
    ["mobile", "desktop", "unknown", "disposable", "early", "ai"].map((userId) => ({
      userId,
      ip: `ip-${userId}`,
      ipHash: userId,
    })),
  );
  await db.insert(referralSource).values(
    ["mobile", "desktop", "unknown", "disposable", "early", "ai"].map((userId) => ({
      id: `referral-${userId}`,
      userId,
      source: "discord",
    })),
  );
  await insertQuests([
    {
      id: "tier-1",
      name: "Tier one",
      description: "First",
      questType: "tier",
      tierLevel: 1,
    },
    {
      id: "tier-2",
      name: "Tier two",
      description: "Second",
      questType: "tier",
      tierLevel: 2,
    },
  ]);
  await db.insert(questHistory).values([
    {
      id: "done-1",
      userId: "mobile",
      questId: "tier-1",
      questType: "tier",
      completed: 1,
    },
    {
      id: "done-2",
      userId: "mobile",
      questId: "tier-2",
      questType: "tier",
      completed: 1,
    },
  ]);
};

describeWithDatabase("recruitment main metrics", () => {
  beforeEach(async () => {
    await resetTables(
      paypalTransaction,
      questHistory,
      quest,
      referralSource,
      historicalIp,
      visitorLog,
      userData,
    );
    await seedCohort();
  });

  const metrics = async (input: {
    utmSource?: string;
    deviceType?: ("mobile" | "desktop" | "unknown")[];
    includeTutorialDisabled?: boolean;
  }) => (await callerFor(dataRouter, "analyst")).getRecruitmentMainMetrics(input);

  it("reports every metric across all devices", async () => {
    const result = await metrics({ utmSource: "discord" });
    const {
      tutorialSteps,
      geninPathSteps,
      geninPathPlayers,
      storyChapters,
      ...scalars
    } = result;
    expect(scalars).toEqual({
      signupRate: 3 / 6,
      visitors: 6,
      visitorsByDevice: { mobile: 4, desktop: 1, unknown: 1 },
      signups: 3,
      signupsByDevice: { mobile: 1, desktop: 1, unknown: 1 },
      characterCreations: 3,
      characterCreationRate: 3 / 6,
      characterCreationsByDevice: { mobile: 1, desktop: 1, unknown: 1 },
      pvpSignups: 2,
      tutorialFinishedSignups: 1,
      tutorialFinishedByDevice: { mobile: 1, desktop: 0, unknown: 0 },
      signupValueUsd: 0,
      totalRevenueUsd: 0,
      geninPlusSignups: 3,
      chuninPlusSignups: 2,
      tierQuestCompletions: [
        { completedTiers: 2, deviceType: "mobile", username: "MobileRecruit" },
      ],
      tierQuestDescriptions: ["Tier one: First", "Tier two: Second"],
    });
    expect(storyChapters.every((entry) => entry.started === 0)).toBe(true);
    expect(geninPathPlayers).toEqual([
      {
        steps: geninPathSteps.length - 1,
        deviceType: "mobile",
        username: "MobileRecruit",
        isStalled: true,
      },
    ]);
    expect(tutorialSteps).toHaveLength(2);
    expect(tutorialSteps).toEqual(
      expect.arrayContaining([
        {
          steps: TUTORIAL_STEPS_COUNT,
          deviceType: "mobile",
          username: "MobileRecruit",
        },
        { steps: 2, deviceType: "unknown", username: "UnknownRecruit" },
      ]),
    );
  });

  it("restricts every device metric to the selected devices", async () => {
    const result = await metrics({
      utmSource: "discord",
      deviceType: ["desktop", "unknown"],
    });
    expect(result).toMatchObject({
      visitors: 2,
      visitorsByDevice: { mobile: 0, desktop: 1, unknown: 1 },
      signups: 2,
      signupsByDevice: { mobile: 0, desktop: 1, unknown: 1 },
      characterCreations: 2,
      characterCreationsByDevice: { mobile: 0, desktop: 1, unknown: 1 },
      pvpSignups: 0,
      tutorialFinishedSignups: 0,
      tutorialFinishedByDevice: { mobile: 0, desktop: 0, unknown: 0 },
      geninPlusSignups: 1,
      chuninPlusSignups: 0,
      tierQuestCompletions: [],
    });
    expect(result.signupRate).toBe(1);
    expect(result.tutorialSteps).toEqual([
      { steps: 2, deviceType: "unknown", username: "UnknownRecruit" },
    ]);
  });

  it("treats an empty device list as no filter", async () => {
    expect((await metrics({ utmSource: "discord", deviceType: [] })).visitors).toBe(6);
  });

  it("counts visitors from every tagged source without a source filter", async () => {
    const result = await metrics({});
    expect(result.visitors).toBe(7);
    expect(result.visitorsByDevice).toEqual({ mobile: 4, desktop: 2, unknown: 1 });
  });

  it("places graduates on the Genin path by level, exam progress and activity", async () => {
    const db = await getTestDatabase();
    await insertQuests([
      {
        id: TUTORIAL_GENIN_EXAM_QUEST_ID,
        questType: "starter",
        hidden: false,
        content: { objectives: [{ id: "lvl", task: "user_level", value: 5 }] as never },
      },
      {
        id: "chunin-exam",
        name: "The Chunin Exams",
        questType: "starter",
        hidden: false,
        requiredLevel: 27,
        content: {
          objectives: [
            { id: "e1", task: "dialog" },
            { id: "e2", task: "dialog" },
            { id: "e3", task: "win_quest" },
          ] as never,
          reward: { reward_rank: "CHUNIN" } as never,
        },
      },
      {
        id: "retired-exam",
        questType: "starter",
        hidden: true,
        requiredLevel: 1,
        content: { reward: { reward_rank: "CHUNIN" } as never },
      },
    ]);
    await db
      .update(userData)
      .set({
        rank: "GENIN",
        level: 28,
        lastActiveAt: new Date(),
        questData: [
          {
            id: "chunin-exam",
            startAt: VISITED_AT.toISOString(),
            goals: [
              { id: "e1", done: true },
              { id: "e2", done: true },
              { id: "e3", done: false },
            ],
          },
          // A hidden quest awarding Chunin is not the exam.
          {
            id: "retired-exam",
            startAt: VISITED_AT.toISOString(),
            goals: [{ id: "x", done: true }],
          },
        ] as never,
      })
      .where(eq(userData.userId, "mobile"));

    const { geninPathSteps, geninPathPlayers } = await metrics({
      utmSource: "discord",
    });
    // Levels 5-26, the exam-eligible level, three exam objectives, then Chunin.
    expect(geninPathSteps.map((step) => step.label)).toEqual([
      ...Array.from({ length: 22 }, (_, i) => `Lv ${i + 5}`),
      "Lv 27+",
      "Exam 1",
      "Exam 2",
      "Exam 3",
      "Chunin",
    ]);
    expect(geninPathPlayers).toEqual([
      { steps: 24, deviceType: "mobile", username: "MobileRecruit", isStalled: false },
    ]);
  });

  it("falls back to player-started quests when there is no recorded activity", async () => {
    await insertQuestHistory([
      { userId: "mobile", questId: "daily", questType: "daily", startedAt: new Date() },
      {
        userId: "mobile",
        questId: "mission",
        questType: "mission",
        startedAt: VISITED_AT,
      },
    ]);
    const stalled = (await metrics({ utmSource: "discord" })).geninPathPlayers;
    expect(stalled.map((player) => player.isStalled)).toEqual([true]);

    await insertQuestHistory([
      {
        userId: "mobile",
        questId: "errand",
        questType: "errand",
        startedAt: new Date(),
      },
    ]);
    const active = (await metrics({ utmSource: "discord" })).geninPathPlayers;
    expect(active.map((player) => player.isStalled)).toEqual([false]);
  });

  it("keeps tutorial-disabled signups only on request", async () => {
    const steps = (
      await metrics({ utmSource: "discord", includeTutorialDisabled: true })
    ).tutorialSteps;
    expect(steps.map((entry) => entry.username).sort()).toEqual([
      "DesktopRecruit",
      "MobileRecruit",
      "UnknownRecruit",
    ]);
  });
});

describeWithDatabase("ranked loadout statistics", () => {
  const seedPicks = async (
    picks: {
      type: "jutsu" | "item" | "consumable";
      contentId: string;
      count: number;
      battleType?: "ARENA" | "COMBAT";
    }[],
  ) =>
    (await getTestDatabase())
      .insert(logRankedPicks)
      .values(picks.map((pick) => ({ battleType: "ARENA" as const, ...pick })));

  afterEach(() => vi.restoreAllMocks());

  const statistics = async (input: {
    minCount?: number;
    limit?: number;
    types?: string[];
    name?: string;
  }) => {
    const rows = await (
      await callerFor(dataRouter, "analyst")
    ).getRankedLoadoutStatistics(input as never);
    return rows.map((row) => `${row.type}:${row.name}:${row.battleType}:${row.count}`);
  };

  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(logRankedPicks, jutsu, item, userData);
    await insertUsers([{ userId: "analyst", role: "CODING-ADMIN", isAi: true }]);
    await insertJutsus([
      jutsuRow("fireball", { name: "Fireball" }),
      jutsuRow("wave", { name: "Tidal Wave" }),
    ]);
    await insertItems([
      { id: "kunai", name: "Kunai" },
      { id: "elixir", name: "Fire Elixir" },
    ]);
    await seedPicks([
      { type: "jutsu", contentId: "fireball", count: 9 },
      { type: "jutsu", contentId: "wave", count: 2 },
      { type: "item", contentId: "kunai", count: 5 },
      { type: "consumable", contentId: "elixir", count: 5 },
      { type: "consumable", contentId: "kunai", count: 1 },
    ]);
  });

  it("merges every type by count and lists an item ahead of a consumable on a tie", async () => {
    expect(await statistics({})).toEqual([
      "jutsu:Fireball:ARENA:9",
      "item:Kunai:ARENA:5",
      "consumable:Fire Elixir:ARENA:5",
      "jutsu:Tidal Wave:ARENA:2",
      "consumable:Kunai:ARENA:1",
    ]);
  });

  it("returns only the requested types", async () => {
    expect(await statistics({ types: ["consumable"] })).toEqual([
      "consumable:Fire Elixir:ARENA:5",
      "consumable:Kunai:ARENA:1",
    ]);
    expect(await statistics({ types: ["jutsu", "item"] })).toEqual([
      "jutsu:Fireball:ARENA:9",
      "item:Kunai:ARENA:5",
      "jutsu:Tidal Wave:ARENA:2",
    ]);
  });

  it("treats an empty type list as every type", async () => {
    expect(await statistics({ types: [] })).toHaveLength(5);
  });

  it("matches names case-insensitively in every content table", async () => {
    expect(await statistics({ name: "fIrE" })).toEqual([
      "jutsu:Fireball:ARENA:9",
      "consumable:Fire Elixir:ARENA:5",
    ]);
  });

  it("applies the minimum count to summed battle types and the limit to the merged list", async () => {
    await seedPicks([
      { type: "jutsu", contentId: "wave", count: 4, battleType: "COMBAT" },
    ]);
    expect(await statistics({ minCount: 4 })).toEqual([
      "jutsu:Fireball:ARENA:9",
      "item:Kunai:ARENA:5",
      "consumable:Fire Elixir:ARENA:5",
      "jutsu:Tidal Wave:COMBAT:4",
    ]);
    expect(await statistics({ limit: 2 })).toEqual([
      "jutsu:Fireball:ARENA:9",
      "item:Kunai:ARENA:5",
    ]);
  });
});
