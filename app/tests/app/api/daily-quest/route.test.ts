import * as gameSettings from "@/libs/gamesettings";
import * as quests from "@/server/utils/questAssignment";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { GET } from "@/app/api/daily-quest/route";

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

const mocks: DailyQuestTestMocks = {
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

/** One D-rank GENIN in one village. */
const seedHappyPath = () => {
  mocks.findQuests.mockResolvedValue([daily]);
  mocks.findVillages.mockResolvedValue([
    { id: "village-1", type: "VILLAGE", sector: 1, structures: [] },
  ]);
  seedCombos([{ rank: "GENIN", villageId: "village-1", level: 10, count: 1 }]);
  mocks.update.mockImplementation(() => ({
    set: (value: Record<string, unknown>) => {
      mocks.updateSets.push(value);
      mocks.calls.push(`update:${Object.keys(value).join(",")}`);
      return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
    },
  }));
  mocks.upsertQuestEntries.mockImplementation(async () => {
    mocks.calls.push("upsertQuestEntries");
    return true;
  });
};

/** Replace the rank/village/level grouping with `rows`, keeping the rest of the happy path. */
const seedCombos = (
  rows: { rank: string; villageId: string; level: number; count: number }[],
) => {
  mocks.select.mockReset();
  mocks.select.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ groupBy: vi.fn().mockResolvedValue(rows) })),
    })),
  });
};

/** One daily per level band, sized so the bands are deliberately uneven. */
const bandDailies = [
  { ...daily, id: "band-low", requiredLevel: 1, maxLevel: 20 },
  { ...daily, id: "band-mid", requiredLevel: 21, maxLevel: 60 },
  { ...daily, id: "band-high", requiredLevel: 61, maxLevel: 100 },
];
const bandCombos = [
  { rank: "GENIN", villageId: "village-1", level: 10, count: 900 },
  { rank: "GENIN", villageId: "village-1", level: 40, count: 30 },
  { rank: "GENIN", villageId: "village-1", level: 80, count: 5 },
];

/** Quest ids in the order the route handed them to upsertQuestEntries. */
const assignedQuestIds = () =>
  mocks.upsertQuestEntries.mock.calls.map((call) => (call[1] as { id: string }).id);

const cronRequest = () => new Request("https://example.com/api/daily-quest");

const dayStart = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

describe("daily-quest cron", () => {
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(gameSettings, "lockWithDailyTimer").mockImplementation(mocks.lock);
    vi.spyOn(gameSettings, "handleEndpointError").mockImplementation(mocks.handleError);
    vi.spyOn(quests, "upsertQuestEntries").mockImplementation(mocks.upsertQuestEntries);
    stubCronAuth(() => null);
    stubDatabase({
      query: {
        quest: { findMany: mocks.findQuests },
        village: { findMany: mocks.findVillages },
      },
      select: mocks.select,
      update: mocks.update,
    });
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
    mocks.lock.mockResolvedValue({
      release: mocks.rollback,
      update: mocks.rollback,
      isClaimed: true, isNewDay: true,
      prevTime: 1,
    });
  });

  it("closes every open daily before any quest is reassigned", async () => {
    // upsertQuestEntries reopens the chosen daily and clears its tracker while the quest is
    // shut. If the close has not landed first, a quest can be active with last run's
    // fully-done tracker, which getReward reads as resolved and pays out again.
    seedHappyPath();

    await GET(cronRequest());

    const closeIndex = mocks.calls.indexOf("update:completed,endAt");
    const assignIndex = mocks.calls.indexOf("upsertQuestEntries");
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(assignIndex).toBeGreaterThan(closeIndex);
    expect(mocks.updateSets[0]).toMatchObject({ completed: 0 });
  });

  it("closes only dailies that are still open, leaving earlier days' rows untouched", async () => {
    // Closed attempts already carry their endedAt; the nightly close touches only open
    // dailies so earlier attempts keep their end dates.
    seedHappyPath();
    const wheres: SQL[] = [];
    mocks.update.mockImplementation(() => ({
      set: (value: Record<string, unknown>) => {
        mocks.updateSets.push(value);
        return {
          where: vi.fn(async (where: SQL) => {
            wheres.push(where);
            return { rowsAffected: 1 };
          }),
        };
      },
    }));

    await GET(cronRequest());

    const close = new MySqlDialect().sqlToQuery(wheres[0]!);
    expect(close.sql).toContain("`QuestHistory`.`questType` = ?");
    expect(close.sql).toContain("`QuestHistory`.`completed` = ?");
    expect(close.sql).toContain("`QuestHistory`.`endedAt` is null");
  });

  it("assigns one daily per rank/village/level combo without changing tutorial preferences", async () => {
    seedHappyPath();

    const response = await GET(cronRequest());

    expect(await response.json()).toBe("OK");
    expect(mocks.upsertQuestEntries).toHaveBeenCalledTimes(1);
    expect(mocks.upsertQuestEntries.mock.calls[0]?.[1]).toMatchObject({ id: daily.id });
    expect(mocks.updateSets.some((set) => "tutorialOn" in set)).toBe(false);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it("gives each rank/village/level combo only its own daily", async () => {
    // Two levels inside one quest's level range must not both receive both picks: each
    // combo's selector is pinned to the level it was counted for, and to players only.
    const second = { ...daily, id: "daily-2" };
    seedHappyPath();
    mocks.findQuests.mockResolvedValue([daily, second]);
    seedCombos([
      { rank: "GENIN", villageId: "village-1", level: 10, count: 1 },
      { rank: "GENIN", villageId: "village-1", level: 12, count: 1 },
    ]);

    await GET(cronRequest());

    const dialect = new MySqlDialect();
    const selectors = mocks.upsertQuestEntries.mock.calls.map((call) =>
      dialect.sqlToQuery(call[2] as SQL),
    );
    const levelParams = selectors.flatMap((query) =>
      query.params.filter((param) => param === 10 || param === 12),
    );
    expect(levelParams.sort()).toEqual([10, 12]);
    for (const query of selectors) {
      expect(query.sql).toContain("`UserData`.`isAi` = ?");
      expect(query.sql).toContain("`UserData`.`level` = ?");
      expect(query.sql).not.toContain("`UserData`.`level` >=");
    }
  });

  it("retries closing the open dailies when it loses a deadlock", async () => {
    seedHappyPath();
    let attempts = 0;
    mocks.update.mockImplementation(() => ({
      set: (value: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error("Deadlock found when trying to get lock (errno 1213)");
          }
          mocks.updateSets.push(value);
          return { rowsAffected: 1 };
        }),
      }),
    }));

    const response = await GET(cronRequest());

    expect(await response.json()).toBe("OK");
    expect(attempts).toBe(2);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it("skips the reset when the daily timer says it is not a new day", async () => {
    mocks.lock.mockResolvedValue({ isClaimed: false, isNewDay: false, response: new Response("locked") });

    await GET(cronRequest());

    expect(mocks.findQuests).not.toHaveBeenCalled();
    expect(mocks.upsertQuestEntries).not.toHaveBeenCalled();
  });

  it("assigns the smallest quest first and still reaches every level band", async () => {
    // Every input order must end with each band assigned once, smallest first, so one huge
    // bracket can never use up the run before the others are handed out.
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [2, 0, 1],
    ];
    for (const order of orders) {
      mocks.upsertQuestEntries.mockReset();
      mocks.rollback.mockReset();
      seedHappyPath();
      mocks.findQuests.mockResolvedValue(order.map((i) => bandDailies[i]));
      seedCombos(order.map((i) => bandCombos[i]!));

      const response = await GET(cronRequest());

      expect(await response.json()).toBe("OK");
      expect(assignedQuestIds()).toEqual(["band-high", "band-mid", "band-low"]);
      expect(mocks.rollback).not.toHaveBeenCalled();
    }
  });

  it("only assigns recently active players and skips anyone already holding today's daily", async () => {
    seedHappyPath();

    await GET(cronRequest());

    const dialect = new MySqlDialect();
    const selector = dialect.sqlToQuery(
      mocks.upsertQuestEntries.mock.calls[0]?.[2] as SQL,
    );
    expect(selector.sql).toContain("`UserData`.`updatedAt` >= ?");
    expect(selector.sql).toContain("NOT EXISTS");
    expect(selector.sql).toContain("assignedDaily.startedAt >= ?");
  });

  it("stops at the deadline and resumes on the next tick without closing dailies again", async () => {
    let now = Date.UTC(2026, 9, 20, 0, 0, 6);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      seedHappyPath();
      mocks.findQuests.mockResolvedValue(bandDailies);
      seedCombos(bandCombos);
      // The first (smallest) quest uses up the whole budget.
      mocks.upsertQuestEntries.mockImplementation(async () => {
        mocks.calls.push("upsertQuestEntries");
        now += 241_000;
        return true;
      });

      const first = await GET(cronRequest());

      expect(first.status).toBe(202);
      expect(assignedQuestIds()).toEqual(["band-high"]);
      expect(mocks.calls.filter((c) => c === "update:completed,endAt")).toHaveLength(1);
      expect(mocks.rollback).toHaveBeenCalledTimes(1);
      const [value, time] = mocks.rollback.mock.calls[0] as [number, Date];
      expect(value).toBe(1);
      expect(time.getTime()).toBe(dayStart(new Date().getTime()) - 1);

      // Next tick: the lock hands back the resume marker the first call wrote.
      mocks.upsertQuestEntries.mockReset();
      mocks.rollback.mockReset();
      mocks.calls.length = 0;
      seedHappyPath();
      mocks.findQuests.mockResolvedValue(bandDailies);
      seedCombos(bandCombos);
      mocks.lock.mockResolvedValue({
        release: mocks.rollback,
        update: mocks.rollback,
        isClaimed: true, isNewDay: true,
        prevTime: time,
        prevValue: value,
      });

      const second = await GET(cronRequest());

      expect(await second.json()).toBe("OK");
      expect(mocks.calls).not.toContain("update:completed,endAt");
      // Every band is offered again; the SQL guard skips players the first call already served.
      expect(assignedQuestIds()).toEqual(["band-high", "band-mid", "band-low"]);
      expect(mocks.rollback).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("leaves a resume marker when a quest's batches run out of budget", async () => {
    seedHappyPath();
    mocks.upsertQuestEntries.mockResolvedValue(false);

    const response = await GET(cronRequest());

    expect(response.status).toBe(202);
    expect(mocks.upsertQuestEntries.mock.calls[0]?.[3]).toBeNumber();
    expect(mocks.rollback.mock.calls[0]?.[0]).toBe(1);
  });

  it("starts over with a full close when the resume marker is from an earlier day", async () => {
    seedHappyPath();
    mocks.lock.mockResolvedValue({
      release: mocks.rollback,
      update: mocks.rollback,
      isClaimed: true, isNewDay: true,
      prevTime: new Date(Date.UTC(2020, 0, 1) - 1),
      prevValue: 1,
    });

    await GET(cronRequest());

    expect(mocks.calls).toContain("update:completed,endAt");
  });

  it("rolls the timer back when reassignment throws", async () => {
    seedHappyPath();
    mocks.upsertQuestEntries.mockRejectedValue(new Error("reset failed"));
    mocks.handleError.mockResolvedValue(new Response("error", { status: 500 }));

    await GET(cronRequest());

    expect(mocks.rollback).toHaveBeenCalledTimes(1);
    expect(mocks.rollback).toHaveBeenCalledWith();
    expect(mocks.handleError).toHaveBeenCalledTimes(1);
  });
});
