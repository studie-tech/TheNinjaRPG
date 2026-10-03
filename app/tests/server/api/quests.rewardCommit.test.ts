// @vitest-environment node

import { eq, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { commitQuestObjectiveRewards } from "../../../src/server/api/routers/quests";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const rewards = () => PostProcessedRewardSchema.parse({});

afterEach(() => vi.restoreAllMocks());

/** Builds the minimum hydrated user shape exercised by the shared reward commit path. */
const makeUser = (retryDelay: "none" | "daily" = "none") => {
  const mission = {
    id: "mission-1",
    name: "Mission",
    questType: "mission",
    questRank: "D",
    retryDelay,
    hidden: false,
    consecutiveObjectives: false,
    maxAttempts: 10,
    maxCompletes: 1,
    requiredVillage: null,
    requiredBloodlineId: null,
    prerequisiteQuestId: null,
    requiredLevel: 1,
    maxLevel: 100,
    medicalRank: null,
    huntingRank: null,
    gatheringRank: null,
    startsAt: null,
    endsAt: null,
    content: {
      objectives: [],
      reward: {},
      sceneBackground: "",
      sceneCharacters: [],
    },
  };
  const tier = { ...mission, id: "tier-1", questType: "tier", name: "Tier" };
  const missionHistory = {
    id: "history-1",
    questId: mission.id,
    questType: mission.questType,
    completed: 0,
    endAt: null,
    quest: mission,
  };
  return {
    user: {
      userId: "user-1",
      updatedAt: new Date("2026-08-15T10:00:00.000Z"),
      rank: "CHUNIN",
      role: "USER",
      level: 30,
      maxEnergy: 100,
      villageId: "village-1",
      clanId: null,
      anbuId: null,
      senseiId: null,
      recruiterId: null,
      bloodlineId: null,
      occupation: "NONE",
      medicalExperience: 0,
      huntingExperience: 0,
      gatheringExperience: 0,
      isOutlaw: false,
      items: [],
      completedQuests: [],
      questData: [],
      userQuests: [
        missionHistory,
        {
          id: "history-tier",
          questId: tier.id,
          questType: tier.questType,
          completed: 0,
          endAt: null,
          quest: tier,
        },
      ],
    },
    missionHistory,
  } as const;
};

/** Mock client whose UPDATE statements resolve in the supplied order and expose SET payloads. */
const makeClient = (
  updateResults: { rowsAffected: number }[],
  historyAfterLostCompletion?: { completed: number } | null,
) => {
  const sets: Record<string, unknown>[] = [];
  const update = vi.fn(() => ({
    set: (value: Record<string, unknown>) => {
      const result = updateResults[sets.length];
      if (!result) {
        throw new Error(
          `Unexpected update #${sets.length + 1}; list every write this path issues`,
        );
      }
      sets.push(value);
      return { where: vi.fn().mockResolvedValue(result) };
    },
  }));
  const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
  const client = {
    update,
    delete: deleteFrom,
    insert: vi.fn(),
    query: {
      questHistory: {
        findFirst: vi.fn().mockResolvedValue(historyAfterLostCompletion),
      },
    },
  };
  return { client: client as never, sets, update, deleteFrom, deleteWhere };
};

/**
 * Client for the gathering payout: updateRewards fetches gatherable items, then writes the
 * dropped items and the userData row. Every other reward branch stays empty and issues no query.
 */
const makeGatheringClient = () => {
  const sets: Record<string, unknown>[] = [];
  const update = vi.fn(() => ({
    set: (value: Record<string, unknown>) => {
      sets.push(value);
      return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
    },
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi
        .fn()
        .mockResolvedValue([{ id: "herb-1", name: "Herb", rarity: "COMMON" }]),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    })),
  }));
  return {
    client: {
      update,
      select,
      insert,
      delete: vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      })),
      query: { questHistory: { findFirst: vi.fn().mockResolvedValue(null) } },
    } as never,
    sets,
  };
};

describe("commitQuestObjectiveRewards compatibility", () => {
  it.each([
    ["mission", true, 1],
    ["battlepyramid", true, 1],
    ["story", true, 1],
    ["starter", true, 1],
    ["event", true, 10],
    ["daily", true, 0],
    ["overworld", true, 0],
    ["mission", false, 0],
    ["event", false, 0],
  ] as const)(
    "restores %s Energy only on qualifying terminal claims (resolved=%s)",
    async (questType, resolved, amount) => {
      const { user, missionHistory } = makeUser();
      const history = {
        ...missionHistory,
        quest: { ...missionHistory.quest, questType },
      };
      const { client, sets } = makeClient(
        Array.from({ length: 4 }, () => ({ rowsAffected: 1 })),
      );
      const result = await commitQuestObjectiveRewards({
        client,
        userId: user.userId,
        user: { ...user, userQuests: [history, ...user.userQuests.slice(1)] } as never,
        rewards: rewards(),
        trackers: [],
        userQuest: history as never,
        resolved,
        notifications: [],
        consequences: [],
        existingHistory: history,
      });
      expect(result.outcome).toBe("claimed");
      const payout = sets.find((set) => "money" in set)!;
      if (amount) {
        expect(new MySqlDialect().sqlToQuery(payout.curEnergy as SQL).params).toEqual([
          user.maxEnergy,
          amount,
        ]);
        expect(payout.updatedAt).toBeDefined();
      } else expect(payout).not.toHaveProperty("curEnergy");
    },
  );
  it("keeps completion, snapshot claim, and payout in the legacy order", async () => {
    const { user, missionHistory } = makeUser();
    const { client, sets } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
    ]);

    const result = await commitQuestObjectiveRewards({
      client,
      userId: user.userId,
      user: user as never,
      rewards: rewards(),
      trackers: [],
      userQuest: missionHistory as never,
      resolved: true,
      notifications: [],
      consequences: [],
      existingHistory: missionHistory,
    });

    expect(result.outcome).toBe("claimed");
    expect(sets[0]).toMatchObject({ completed: 1, endAt: expect.any(Date) });
    expect(sets[1]).toMatchObject({ questData: [] });
    expect(sets[2]).toMatchObject({
      questData: [],
      activeNpcQuestId: expect.anything(),
    });
    expect(sets[3]).toMatchObject({
      finishAt: expect.anything(),
      updatedAt: expect.any(Date),
    });
    expect(result).toMatchObject({
      postNotifications: ["Active crop growth times reduced by 1 minute."],
    });
  });

  it("does not pay twice when the completion compare-and-swap loses to a prior claim", async () => {
    const { user, missionHistory } = makeUser();
    const { client, sets, update } = makeClient([{ rowsAffected: 0 }], {
      completed: 1,
    });

    const result = await commitQuestObjectiveRewards({
      client,
      userId: user.userId,
      user: user as never,
      rewards: rewards(),
      trackers: [],
      userQuest: missionHistory as never,
      resolved: true,
      notifications: [],
      consequences: [],
      existingHistory: missionHistory,
    });

    expect(result).toEqual({ outcome: "already_completed" });
    expect(update).toHaveBeenCalledOnce();
    expect(sets).toHaveLength(1);
  });

  it("rolls back both lifetime and period completion counters when snapshot claim loses", async () => {
    const { user, missionHistory } = makeUser("daily");
    const { client, sets } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 0 },
      { rowsAffected: 1 },
    ]);

    const result = await commitQuestObjectiveRewards({
      client,
      userId: user.userId,
      user: user as never,
      rewards: rewards(),
      trackers: [],
      userQuest: missionHistory as never,
      resolved: true,
      notifications: [],
      consequences: [],
      existingHistory: missionHistory,
    });

    expect(result).toEqual({ outcome: "state_changed" });
    expect(sets).toHaveLength(3);
    expect(sets[2]).toMatchObject({
      completed: 0,
      previousCompletes: expect.anything(),
      periodCompletes: expect.anything(),
      endAt: null,
    });
  });

  it("consumes the concrete inventory row for a delivered item", async () => {
    const { user, missionHistory } = makeUser();
    const hydratedUser = {
      ...user,
      items: [{ id: "user-item-1", itemId: "item-1" }],
    };
    const { client, sets, deleteFrom, deleteWhere } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 1 },
    ]);

    const result = await commitQuestObjectiveRewards({
      client,
      userId: hydratedUser.userId,
      user: hydratedUser as never,
      rewards: rewards(),
      trackers: [],
      userQuest: missionHistory as never,
      resolved: false,
      notifications: [],
      consequences: [{ type: "remove_item", ids: ["item-1"] }],
      existingHistory: missionHistory,
    });

    expect(result.outcome).toBe("claimed");
    expect(deleteFrom).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(sets).toHaveLength(2);
  });

  it("drops the resolved quest tracker so replayed assignments start with fresh objectives", async () => {
    const { user, missionHistory } = makeUser();
    const { client, sets } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
    ]);
    const trackerForResolvedQuest = {
      id: missionHistory.questId,
      goals: [{ id: "obj-1", done: true, value: 1 }],
      startAt: new Date().toISOString(),
    };

    const result = await commitQuestObjectiveRewards({
      client,
      userId: user.userId,
      user: user as never,
      rewards: rewards(),
      trackers: [trackerForResolvedQuest] as never,
      userQuest: missionHistory as never,
      resolved: true,
      notifications: [],
      consequences: [],
      existingHistory: missionHistory,
    });

    expect(result.outcome).toBe("claimed");
    expect(sets[1]).toMatchObject({ questData: [] });
    expect(sets[2]).toMatchObject({ questData: [] });
  });

  it("keeps the resolved tracker dropped when the payout also folds in gathering drops", async () => {
    // The user snapshot still reads the quest as active (the completion CAS only touched the
    // DB row), so updateRewards' herbs_gathered fold would otherwise rebuild the tracker that
    // was just removed and hand the replayed quest a head start.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { user, missionHistory } = makeUser();
    const { client, sets } = makeGatheringClient();

    const result = await commitQuestObjectiveRewards({
      client,
      userId: user.userId,
      user: { ...user, occupation: "GATHERING" } as never,
      rewards: PostProcessedRewardSchema.parse({
        reward_gathering_items: true,
      }),
      trackers: [
        {
          id: missionHistory.questId,
          goals: [{ id: "obj-1", done: true, value: 1 }],
        },
      ] as never,
      userQuest: missionHistory as never,
      resolved: true,
      notifications: [],
      consequences: [],
      existingHistory: missionHistory,
    });

    expect(result.outcome).toBe("claimed");
    // The fold still runs (the tier quest keeps its tracker) — only the finished quest is gone.
    const payout = sets.find((set) => "money" in set);
    const persisted = (payout?.questData ?? []) as { id: string }[];
    expect(persisted.map((tracker) => tracker.id)).not.toContain(
      missionHistory.questId,
    );
    expect(persisted.length).toBeGreaterThan(0);
  });
});

describeWithDatabase("quest Energy reward snapshots", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userData);
  });

  it("invalidates regeneration read between the quest claim and Energy payout", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      {
        userId: "energy-claim",
        username: "energy-claim",
        rank: "CHUNIN",
        level: 2,
        isOutlaw: true,
        curEnergy: 95,
        maxEnergy: 100,
      },
    ]);
    await insertQuests([{ id: "energy-event", questType: "event" }]);
    await insertQuestHistory([
      { userId: "energy-claim", questId: "energy-event", questType: "event" },
    ]);
    const user = (await database.query.userData.findFirst({
      where: eq(userData.userId, "energy-claim"),
      with: {
        userQuests: { with: { quest: true } },
        completedQuests: true,
        items: { with: { item: true } },
      },
    }))!;
    const history = user.userQuests[0]!;
    // The hydrated capacity may be newer than its throttled persisted value.
    user.maxEnergy = 150;
    let stale: typeof userData.$inferSelect | undefined;
    const client = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof database.update>[0]) => {
          if (table !== userData) return database.update(table);
          return {
            set: (
              values: Parameters<ReturnType<typeof database.update>["set"]>[0],
            ) => ({
              where: async (
                condition: Parameters<
                  ReturnType<ReturnType<typeof database.update>["set"]>["where"]
                >[0],
              ) => {
                if ("curEnergy" in values)
                  stale = await database.query.userData.findFirst({
                    where: eq(userData.userId, user.userId),
                  });
                return database.update(userData).set(values).where(condition);
              },
            }),
          };
        };
      },
    });
    const claim = await commitQuestObjectiveRewards({
      client,
      userId: user.userId,
      user: user as never,
      rewards: rewards(),
      trackers: [],
      userQuest: history as never,
      resolved: true,
      notifications: [],
      consequences: [],
      existingHistory: history,
    });
    expect(claim.outcome).toBe("claimed");
    expect(stale?.curEnergy).toBe(95);
    expect(
      (
        await claimUserSnapshot({
          client: database,
          userId: user.userId,
          updatedAt: stale!.updatedAt,
          set: { curEnergy: stale!.curEnergy },
        })
      ).success,
    ).toBe(false);
    expect(
      await database.query.userData.findFirst({
        where: eq(userData.userId, user.userId),
      }),
    ).toMatchObject({ curEnergy: 105, maxEnergy: 150 });
    expect(
      (
        await commitQuestObjectiveRewards({
          client: database,
          userId: user.userId,
          user: user as never,
          rewards: rewards(),
          trackers: [],
          userQuest: history as never,
          resolved: true,
          notifications: [],
          consequences: [],
          existingHistory: history,
        })
      ).outcome,
    ).toBe("already_completed");
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, user.userId),
        })
      )?.curEnergy,
    ).toBe(105);
  });
});
