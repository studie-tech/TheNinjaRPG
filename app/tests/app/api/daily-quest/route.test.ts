// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

type DailyQuestTestMocks = {
  lock: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  handleError: ReturnType<typeof vi.fn>;
  findQuests: ReturnType<typeof vi.fn>;
  findVillages: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsertQuestEntries: ReturnType<typeof vi.fn>;
  calls: string[];
  updateSets: Record<string, unknown>[];
};

/** Returns Bun-compatible module mocks shared by the hoisted route factories. */
function getDailyQuestTestMocks(): DailyQuestTestMocks {
  const globals = globalThis as unknown as { __dailyQuestTestMocks?: DailyQuestTestMocks };
  globals.__dailyQuestTestMocks ??= {
    lock: vi.fn(),
    rollback: vi.fn(),
    handleError: vi.fn(),
    findQuests: vi.fn(),
    findVillages: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    upsertQuestEntries: vi.fn(),
    calls: [],
    updateSets: [],
  };
  return globals.__dailyQuestTestMocks;
}

const mocks = getDailyQuestTestMocks();

vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/libs/gamesettings", () => ({
  lockWithDailyTimer: getDailyQuestTestMocks().lock,
  updateGameSetting: getDailyQuestTestMocks().rollback,
  handleEndpointError: getDailyQuestTestMocks().handleError,
}));
vi.mock("@/routers/quests", () => ({
  upsertQuestEntries: getDailyQuestTestMocks().upsertQuestEntries,
}));
vi.mock("@/server/db", () => ({
  drizzleDB: {
    query: {
      quest: { findMany: getDailyQuestTestMocks().findQuests },
      village: { findMany: getDailyQuestTestMocks().findVillages },
    },
    select: getDailyQuestTestMocks().select,
    update: getDailyQuestTestMocks().update,
  },
}));

import { GET } from "@/app/api/daily-quest/route";

const daily = {
  id: "daily-1",
  name: "Daily",
  questType: "daily",
  questRank: "D",
  requiredLevel: 1,
  maxLevel: 100,
  requiredVillage: null,
  content: { objectives: [], reward: {} },
};

/** One D-rank GENIN in one village, plus one player holding an open tier quest. */
const seedHappyPath = () => {
  mocks.findQuests.mockResolvedValue([daily]);
  mocks.findVillages.mockResolvedValue([
    { id: "village-1", type: "VILLAGE", sector: 1, structures: [] },
  ]);
  // 1st select: rank/village/level aggregate. 2nd: users holding an open tier quest.
  mocks.select
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          groupBy: vi
            .fn()
            .mockResolvedValue([
              { rank: "GENIN", villageId: "village-1", level: 10, count: 1 },
            ]),
        })),
      })),
    })
    .mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ userId: "user-1" }]),
      })),
    });
  mocks.update.mockImplementation(() => ({
    set: (value: Record<string, unknown>) => {
      mocks.updateSets.push(value);
      mocks.calls.push(`update:${Object.keys(value).join(",")}`);
      return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
    },
  }));
  mocks.upsertQuestEntries.mockImplementation(async () => {
    mocks.calls.push("upsertQuestEntries");
  });
};

describe("daily-quest cron", () => {
  beforeEach(() => {
    for (const mock of [
      mocks.lock,
      mocks.rollback,
      mocks.handleError,
      mocks.findQuests,
      mocks.findVillages,
      mocks.select,
      mocks.update,
      mocks.upsertQuestEntries,
    ]) {
      mock.mockReset();
    }
    mocks.calls.length = 0;
    mocks.updateSets.length = 0;
    mocks.lock.mockResolvedValue({ isNewDay: true, prevTime: 1 });
  });

  it("closes every open daily before any quest is reassigned", async () => {
    // upsertQuestEntries reopens the chosen daily and clears its tracker while the quest is
    // shut. If the close has not landed first, a quest can be active with last run's
    // fully-done tracker, which getReward reads as resolved and pays out again.
    seedHappyPath();

    await GET();

    const closeIndex = mocks.calls.indexOf("update:completed,endAt");
    const assignIndex = mocks.calls.indexOf("upsertQuestEntries");
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(assignIndex).toBeGreaterThan(closeIndex);
    expect(mocks.updateSets[0]).toMatchObject({ completed: 0 });
  });

  it("assigns one daily per rank/village/level combo and re-enables tier tutorials", async () => {
    seedHappyPath();

    const response = await GET();

    expect(await response.json()).toBe("OK");
    expect(mocks.upsertQuestEntries).toHaveBeenCalledOnce();
    expect(mocks.upsertQuestEntries.mock.calls[0]?.[1]).toMatchObject({ id: daily.id });
    // The tier lookup moved into the opening Promise.all; its result must still drive this write.
    expect(mocks.updateSets.some((set) => set.tutorialOn === true)).toBe(true);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it("skips the reset when the daily timer says it is not a new day", async () => {
    mocks.lock.mockResolvedValue({ isNewDay: false, response: new Response("locked") });

    await GET();

    expect(mocks.findQuests).not.toHaveBeenCalled();
    expect(mocks.upsertQuestEntries).not.toHaveBeenCalled();
  });

  it("rolls the timer back when reassignment throws", async () => {
    seedHappyPath();
    mocks.upsertQuestEntries.mockRejectedValue(new Error("reset failed"));
    mocks.handleError.mockResolvedValue(new Response("error", { status: 500 }));

    await GET();

    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.rollback.mock.calls[0]?.[3]).toBe(1);
    expect(mocks.handleError).toHaveBeenCalledOnce();
  });
});
