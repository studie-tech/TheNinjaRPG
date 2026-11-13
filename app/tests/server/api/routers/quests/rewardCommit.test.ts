import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq, type SQL } from "drizzle-orm";
import { MySqlDialect, QueryBuilder } from "drizzle-orm/mysql-core";
import {
  bankTransfers,
  quest,
  questHistory,
  userData,
  village,
} from "@/drizzle/schema";
import { calcHP } from "@/libs/profile";
import { getNewTrackers } from "@/libs/quest";
import { claimRewardChoiceTrackers } from "@/server/api/routers/quests";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { commitQuestObjectiveRewards } from "@/server/utils/questConsequences";
import { updateRewards } from "@/server/utils/questRewards";
import { IncreaseGatheringYield } from "@/validators/combat";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import { trackerQuest } from "../../../../setup/quest";
import { aroundStatements } from "../../../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const rewards = () => PostProcessedRewardSchema.parse({});

type CommitInput = Parameters<typeof commitQuestObjectiveRewards>[0];
/** Commit a resolved claim of `history` for `user` with the shared defaults; pass what a test varies. */
const commit = <User extends { userId: string }>(
  client: CommitInput["client"],
  user: User,
  history: object,
  overrides: Partial<CommitInput> = {},
) =>
  commitQuestObjectiveRewards({
    client,
    userId: user.userId,
    user: user as never,
    rewards: rewards(),
    trackers: [],
    userQuest: history as never,
    resolved: true,
    notifications: [],
    consequences: [],
    existingHistory: history as never,
    ...overrides,
  });

afterEach(() => vi.restoreAllMocks());

/** Builds the minimum hydrated user shape exercised by the shared reward commit path. */
const makeUser = (retryDelay: "none" | "daily" = "none") => {
  const mission = trackerQuest("mission-1", [], "mission", {
    name: "Mission",
    questRank: "D",
    retryDelay,
    maxAttempts: 10,
    maxCompletes: 1,
    requiredLevel: 1,
    maxLevel: 100,
    startsAt: null,
  });
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
      curEnergy: 30,
      money: 100,
      seichiSilver: 0,
      earnedExperience: 20,
      reputationPoints: 10,
      reputationPointsTotal: 10,
      villagePrestige: 5,
      missionsD: 0,
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
  const update = vi.fn((table?: unknown) =>
    table === village
      ? { set: () => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) }) }
      : {
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
        },
  );
  const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
  const queryBuilder = new QueryBuilder();
  const select = vi.fn(queryBuilder.select.bind(queryBuilder));
  const client = {
    update,
    delete: deleteFrom,
    insert: vi.fn(),
    select,
    execute: vi.fn(async () => {
      const result = updateResults[sets.length];
      if (!result) throw new Error("Unexpected joined completion claim");
      sets.push({ joinedCompletion: true });
      return result;
    }),
    query: {
      questHistory: {
        findFirst: vi.fn().mockResolvedValue(historyAfterLostCompletion),
      },
      // The carried stacks a delivery reads.
      userItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "user-item-1", itemId: "item-1", quantity: 1, equipped: "NONE" },
          ]),
      },
    },
  };
  return { client: client as never, sets, update, deleteFrom, deleteWhere, select };
};

/**
 * Client for the gathering payout: updateRewards fetches gatherable items, then writes the
 * dropped items and the userData row. Every other reward branch stays empty and issues no query.
 */
const makeGatheringClient = () => {
  const sets: Record<string, unknown>[] = [];
  const inserted: { itemId?: string; quantity?: number }[] = [];
  const update = vi.fn((table?: unknown) =>
    table === village
      ? { set: () => ({ where: vi.fn().mockResolvedValue({ rowsAffected: 0 }) }) }
      : {
          set: (value: Record<string, unknown>) => {
            sets.push(value);
            return { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
          },
        },
  );
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi
        .fn()
        .mockResolvedValue([{ id: "herb-1", name: "Herb", rarity: "COMMON" }]),
      // The player carries no stack the gathered herbs could join.
      leftJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn((rows: { itemId?: string; quantity?: number }[]) => {
      inserted.push(...rows);
      return { onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) };
    }),
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
    inserted,
  };
};

describe("quest reward commit", () => {
  it("grants gathering bonus units through the shared reward payout", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { user } = makeUser();
    const { client } = makeGatheringClient();
    const gatherer = {
      ...user,
      occupation: "GATHERING",
      bloodline: { effects: [IncreaseGatheringYield.parse({ power: 2 })] },
    };
    const result = await updateRewards({
      client,
      user: gatherer as never,
      questUser: gatherer as never,
      gatheringBonusQuantity: 2,
      reason: "Gathering reward",
      rewards: PostProcessedRewardSchema.parse({ reward_gathering_items: true }),
    });
    expect(result.items).toEqual(
      Array(3).fill({ id: "herb-1", name: "Herb", quantity: 1 }),
    );
  });
  it.each([
    { captured: 2, current: 0, expected: 3 },
    { captured: 2, current: 7, expected: 3 },
    { captured: 0, current: 2, expected: 1 },
    { captured: undefined, current: 2, expected: 1 },
  ])(
    "pays captured gathering yield $captured with claim-time bonus $current",
    async ({ captured, current, expected }) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { user, missionHistory } = makeUser();
      const { client, inserted } = makeGatheringClient();
      const gatheringHistory = {
        ...missionHistory,
        quest: {
          ...missionHistory.quest,
          questType: "gathering",
          content: {
            ...missionHistory.quest.content,
            objectives: [{ id: "collect", task: "collect_item" }],
          },
        },
      };
      const result = await commitQuestObjectiveRewards({
        client,
        userId: user.userId,
        user: {
          ...user,
          occupation: "GATHERING",
          bloodline: { effects: [IncreaseGatheringYield.parse({ power: current })] },
          userQuests: [gatheringHistory, ...user.userQuests.slice(1)],
        } as never,
        userQuest: gatheringHistory as never,
        trackers: [
          {
            id: missionHistory.questId,
            goals: [
              {
                id: "collect",
                done: true,
                collected: true,
                gatheringBonusQuantity: captured,
              },
            ],
          },
        ] as never,
        rewards: PostProcessedRewardSchema.parse({ reward_gathering_items: true }),
        resolved: true,
        notifications: [],
        consequences: [],
        existingHistory: missionHistory,
      });
      expect(result.outcome).toBe("claimed");
      expect(inserted.filter((row) => row.itemId === "herb-1")).toHaveLength(expected);
    },
  );
  it.each([true, false])(
    "commits a milestone level and all six stats only if the snapshot claim wins (%s)",
    async (wins) => {
      const fixture = makeUser();
      const history = {
        ...fixture.missionHistory,
        quest: {
          ...fixture.missionHistory.quest,
          questType: "starter",
          content: {
            ...fixture.missionHistory.quest.content,
            reward: { reward_level: 101, reward_stats: 20_000 },
          },
        },
      };
      const user = {
        ...fixture.user,
        rank: "ELITE JONIN",
        level: 100,
        offence: 1_300_000,
        defence: 1_300_000,
        strength: 400_000,
        speed: 400_000,
        intelligence: 400_000,
        willpower: 400_000,
        userQuests: [history, ...fixture.user.userQuests.slice(1)],
      };
      const { client, sets } = makeClient([
        { rowsAffected: 1 },
        { rowsAffected: wins ? 1 : 0 },
        { rowsAffected: 1 },
      ]);
      const result = await commit(client, user, history, {
        rewards: { ...rewards(), reward_level: 101, reward_stats: 20_000 },
      });
      expect(result.outcome).toBe(wins ? "claimed" : "state_changed");
      expect(sets[1]).toMatchObject({
        level: 101,
        offence: 1_320_000,
        strength: 420_000,
        maxHealth: calcHP(101),
      });
      expect(user.level).toBe(wins ? 101 : 100);
      if (wins) expect(result).toMatchObject({ userCacheEligible: false });
      else expect(sets.at(-1)).toMatchObject({ completed: 0 });
    },
  );
  it("rejects a stale milestone before consuming history or delivering any rewards", async () => {
    const { user, missionHistory } = makeUser();
    const { client, update } = makeClient([]);
    const result = await commit(
      client,
      { ...user, rank: "ELITE JONIN", level: 101 },
      missionHistory,
      { rewards: { ...rewards(), reward_level: 101, reward_stats: 20_000 } },
    );
    expect(result.outcome).toBe("state_changed");
    expect(update).not.toHaveBeenCalled();
  });

  it("pays the weekly-only PvP boost without reading the population average", async () => {
    const { user } = makeUser();
    const { client, sets, select } = makeClient([{ rowsAffected: 1 }]);
    const payout = PostProcessedRewardSchema.parse({ reward_money: 100 });
    await updateRewards({
      client,
      user: {
        ...user,
        pvpExperience: 0,
        weeklyPvpKills: 4,
        weeklyPvpKillsAt: new Date(),
      } as never,
      rewards: payout,
      reason: "QUEST",
    });
    expect(payout.reward_money).toBe(101);
    expect(new MySqlDialect().sqlToQuery(sets[0]!.money as SQL).params).toEqual([101]);
    expect(select).not.toHaveBeenCalled();
  });

  it("does not regenerate a completed repeatable mission tracker from its closed history", async () => {
    const { user, missionHistory } = makeUser();
    const history = {
      ...missionHistory,
      quest: { ...missionHistory.quest, maxCompletes: 3 },
    };
    const hydrated = { ...user, userQuests: [history, ...user.userQuests.slice(1)] };
    const { client } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 0 },
    ]);
    const result = await commit(client, hydrated, history);
    expect(result).toMatchObject({ outcome: "claimed", userCacheEligible: true });
    expect(hydrated.userQuests.some((entry) => entry.questId === history.questId)).toBe(
      false,
    );
    expect(
      getNewTrackers(hydrated as never, [{ task: "any" }]).trackers.some(
        (tracker) => tracker.id === history.questId,
      ),
    ).toBe(false);
  });

  it.each([0, 1])(
    "projects accepted completion and requires reconciliation when %s farm timers change",
    async (farmRows) => {
      const { user, missionHistory } = makeUser();
      const { client, sets } = makeClient([
        { rowsAffected: 1 },
        { rowsAffected: 1 },
        { rowsAffected: 1 },
        { rowsAffected: farmRows },
      ]);
      const claimRewards = PostProcessedRewardSchema.parse({
        reward_money: 50,
        reward_exp: 10,
      });
      const result = await commit(client, user, missionHistory, {
        rewards: claimRewards,
      });
      expect(result).toMatchObject({
        outcome: "claimed",
        userCacheEligible: farmRows === 0,
        userDelta: { money: 50, earnedExperience: 10 },
      });
      expect(user).toMatchObject({
        money: 150,
        earnedExperience: 30,
        curEnergy: 50,
        missionsD: 1,
        completedQuests: [
          { id: missionHistory.id, questId: "mission-1", completed: 1 },
        ],
      });
      expect(missionHistory).toMatchObject({
        completed: 1,
        endAt: expect.any(Date),
        previousCompletes: 1,
      });
      expect(sets).toHaveLength(4);
    },
  );

  it.each([
    ["mission", true, 20],
    ["battlepyramid", true, 100],
    ["story", true, 20],
    ["starter", true, 20],
    ["event", true, 100],
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
      const result = await commit(
        client,
        { ...user, userQuests: [history, ...user.userQuests.slice(1)] },
        history,
        { resolved },
      );
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
  it.each(["battlepyramid", "story", "event", "overworld"] as const)(
    "claims %s history and account state atomically before exposing completion credit",
    async (questType) => {
      const { user, missionHistory } = makeUser();
      const history = {
        ...missionHistory,
        quest: { ...missionHistory.quest, questType },
      };
      const { client, sets, update } = makeClient([{ rowsAffected: 0 }], {
        completed: 0,
      });
      const result = await commit(client, { ...user, userQuests: [history] }, history);
      expect(result.outcome).toBe("state_changed");
      expect(sets).toEqual([{ joinedCompletion: true }]);
      expect(update).not.toHaveBeenCalled();
      expect(user.completedQuests).toEqual([]);
    },
  );

  it("writes the completion, snapshot claim and payout in that order", async () => {
    const { user, missionHistory } = makeUser();
    const { client, sets } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
      { rowsAffected: 1 },
    ]);

    const result = await commit(client, user, missionHistory);

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
      postNotifications: [
        "Energy reward: 20 (restored up to capacity).",
        "Active crop growth times reduced by 1 minute.",
      ],
    });
  });

  it("does not pay twice when the completion compare-and-swap loses to a prior claim", async () => {
    const { user, missionHistory } = makeUser();
    const { client, sets, update } = makeClient([{ rowsAffected: 0 }], {
      completed: 1,
    });

    const result = await commit(client, user, missionHistory);

    expect(result).toEqual({ outcome: "already_completed" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(sets).toHaveLength(1);
  });

  it("rolls back both lifetime and period completion counters when snapshot claim loses", async () => {
    const { user, missionHistory } = makeUser("daily");
    const { client, sets } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 0 },
      { rowsAffected: 1 },
    ]);

    const result = await commit(client, user, missionHistory);

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
      items: [{ id: "user-item-1", itemId: "item-1", quantity: 1 }],
    };
    const { client, sets, deleteFrom, deleteWhere } = makeClient([
      { rowsAffected: 1 },
      { rowsAffected: 1 },
    ]);

    const result = await commit(client, hydratedUser, missionHistory, {
      resolved: false,
      consequences: [{ type: "remove_item", ids: ["item-1"] }],
    });

    expect(result.outcome).toBe("claimed");
    expect(deleteFrom).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
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

    const result = await commit(client, user, missionHistory, {
      trackers: [trackerForResolvedQuest] as never,
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

    const result = await commit(
      client,
      { ...user, occupation: "GATHERING" },
      missionHistory,
      {
        rewards: PostProcessedRewardSchema.parse({
          reward_gathering_items: true,
        }),
        trackers: [
          {
            id: missionHistory.questId,
            goals: [{ id: "obj-1", done: true, value: 1 }],
          },
        ] as never,
      },
    );

    expect(result.outcome).toBe("claimed");
    // The fold still runs (the tier quest keeps its tracker) — only the finished quest is gone.
    const payout = sets.find((set) => "money" in set);
    const persisted = (payout?.questData ?? []) as { id: string }[];
    expect(persisted.map((tracker) => tracker.id)).not.toContain(
      missionHistory.questId,
    );
    expect(persisted.length).toBeGreaterThan(0);
  });

  describe("reward choice", () => {
    const rewardChoice = {
      id: "offer-1",
      pickCount: 1,
      cards: [
        { id: "reward_money", field: "reward_money" as const, amount: 100 },
        { id: "reward_exp", field: "reward_exp" as const, amount: 50 },
      ],
    };

    it("stores the offer in the completion compare-and-swap", async () => {
      const { user, missionHistory } = makeUser();
      const { client, sets } = makeClient([
        { rowsAffected: 1 },
        { rowsAffected: 1 },
        { rowsAffected: 1 },
        { rowsAffected: 1 },
      ]);

      const result = await commit(client, user, missionHistory, { rewardChoice });

      expect(result).toMatchObject({ outcome: "claimed", rewardChoicePending: true });
      expect(sets[0]).toMatchObject({
        completed: 1,
        pendingRewardChoice: rewardChoice,
      });
    });

    it("never writes an offer for a non-terminal objective claim", async () => {
      const { user, missionHistory } = makeUser();
      const { client, sets } = makeClient([{ rowsAffected: 1 }, { rowsAffected: 1 }]);

      const result = await commit(client, user, missionHistory, {
        resolved: false,
        rewardChoice,
      });

      expect(result).toMatchObject({ outcome: "claimed", rewardChoicePending: false });
      expect(sets.some((set) => "pendingRewardChoice" in set)).toBe(false);
    });

    it("refuses to replace an earlier offer the player has not picked yet", async () => {
      const { user, missionHistory } = makeUser();
      const { client, sets } = makeClient([{ rowsAffected: 0 }], {
        completed: 0,
        pendingRewardChoice: { ...rewardChoice, id: "older-offer" },
      } as never);

      const result = await commit(client, user, missionHistory, { rewardChoice });

      expect(result).toEqual({ outcome: "choice_pending" });
      expect(sets).toHaveLength(1);
    });

    it("drops the offer together with the completion when the snapshot claim loses", async () => {
      const { user, missionHistory } = makeUser();
      const { client, sets } = makeClient([
        { rowsAffected: 1 },
        { rowsAffected: 0 },
        { rowsAffected: 1 },
      ]);

      const result = await commit(client, user, missionHistory, { rewardChoice });

      expect(result).toEqual({ outcome: "state_changed" });
      expect(sets[2]).toMatchObject({ completed: 0, pendingRewardChoice: null });
    });

    it("pays a pick without writing back the read rank, village or quest trackers", async () => {
      // A claim does not hold the user snapshot, so echoing these columns from its read would
      // revert a promotion, village change or tracker another request committed meanwhile.
      const { user } = makeUser();
      const { client, sets } = makeClient([{ rowsAffected: 1 }]);

      await updateRewards({
        client,
        user: user as never,
        rewards: PostProcessedRewardSchema.parse({ reward_money: 100 }),
        reason: "QUEST",
        persistQuestData: false,
      });

      expect(sets).toHaveLength(1);
      expect(sets[0]).toHaveProperty("money");
      expect(sets[0]).not.toHaveProperty("questData");
      expect(sets[0]).not.toHaveProperty("rank");
      expect(sets[0]).not.toHaveProperty("villageId");
    });

    it("still writes a rank the reward actually grants", async () => {
      const { user } = makeUser();
      const { client, sets } = makeClient([{ rowsAffected: 1 }]);

      await updateRewards({
        client,
        user: user as never,
        rewards: PostProcessedRewardSchema.parse({ reward_rank: "JONIN" }),
        reason: "QUEST",
      });

      expect(sets[0]).toMatchObject({ rank: "JONIN", questData: [] });
    });
  });

  describe("reward choice experience trackers", () => {
    const medicalQuest = {
      id: "medical-quest",
      name: "Medical",
      questType: "daily",
      hidden: false,
      consecutiveObjectives: false,
      maxAttempts: 10,
      maxCompletes: 10,
      content: {
        objectives: [
          {
            id: "heal",
            task: "medical_experience_gained",
            value: 100,
            description: "",
            successDescription: "",
          },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    };
    const userWith = (quests: (typeof medicalQuest)[]) => {
      const { user } = makeUser();
      return {
        ...user,
        sector: 1,
        village: { id: "village-1", sector: 1 },
        activeWars: [],
        userQuests: quests.map((q) => ({
          id: `history-${q.id}`,
          questId: q.id,
          questType: q.questType,
          completed: 0,
          endAt: null,
          quest: q,
        })),
      };
    };
    const medicalReward = PostProcessedRewardSchema.parse({
      reward_medical_experience: 30,
    });

    it("advances other quests' experience objectives under the user snapshot", async () => {
      const user = userWith([medicalQuest]);
      const { client, sets } = makeClient([{ rowsAffected: 1 }]);

      const saved = await claimRewardChoiceTrackers(
        client,
        user as never,
        medicalReward,
      );

      expect(saved).toBe(true);
      expect(sets).toHaveLength(1);
      expect(sets[0]).toMatchObject({
        updatedAt: expect.any(Date),
        questData: [{ id: "medical-quest", goals: [{ id: "heal", value: 30 }] }],
      });
    });

    it("reports a lost snapshot so the claim can hand the offer back", async () => {
      const user = userWith([medicalQuest]);
      const { client } = makeClient([{ rowsAffected: 0 }]);

      expect(
        await claimRewardChoiceTrackers(client, user as never, medicalReward),
      ).toBe(false);
    });

    it("skips the snapshot when no quest tracks the picked experience", async () => {
      const user = userWith([]);
      const { client, update } = makeClient([]);

      expect(
        await claimRewardChoiceTrackers(client, user as never, medicalReward),
      ).toBe(true);
      expect(update).not.toHaveBeenCalled();
    });
  });
});

describeWithDatabase("quest reward claims", () => {
  beforeEach(async () => {
    await resetTables(bankTransfers, questHistory, quest, userData);
  });

  it.each([
    { studentXp: 600, senseiXp: 1400, kills: 0, bonus: 115 },
    { studentXp: 1400, senseiXp: 600, kills: 0, bonus: 100 },
    { studentXp: 600, senseiXp: 1400, kills: 5, bonus: 116 },
  ])(
    "uses the sensei's own PvP boost and records the integer bonus $bonus",
    async ({ studentXp, senseiXp, kills, bonus }) => {
      const client = await getTestDatabase();
      await insertUsers([
        {
          userId: "mission-sensei",
          pvpExperience: senseiXp,
          weeklyPvpKills: kills,
          weeklyPvpKillsAt: new Date(),
          money: 500,
        },
        {
          userId: "mission-student",
          rank: "GENIN",
          senseiId: "mission-sensei",
          pvpExperience: studentXp,
          money: 500,
        },
      ]);
      await insertQuests([
        { id: "sensei-mission", questType: "mission" },
        { id: "sensei-tier", questType: "tier" },
      ]);
      await insertQuestHistory([
        { userId: "mission-student", questId: "sensei-mission", questType: "mission" },
        { userId: "mission-student", questId: "sensei-tier", questType: "tier" },
      ]);
      const user = (await client.query.userData.findFirst({
        where: eq(userData.userId, "mission-student"),
        with: {
          userQuests: { with: { quest: true } },
          completedQuests: true,
          items: { with: { item: true } },
        },
      }))!;
      const history = user.userQuests.find((q) => q.questId === "sensei-mission")!;
      const claim = () => commit(client, user, history);
      expect((await claim()).outcome).toBe("claimed");
      expect(
        await client.query.userData.findFirst({
          where: eq(userData.userId, "mission-sensei"),
        }),
      ).toMatchObject({ money: 500 + bonus });
      expect(
        await client.query.userData.findFirst({
          where: eq(userData.userId, "mission-student"),
        }),
      ).toMatchObject({ money: 500 });
      expect(await client.query.bankTransfers.findMany()).toMatchObject([
        {
          senderId: "mission-student",
          receiverId: "mission-sensei",
          amount: bonus,
          type: "sensei",
        },
      ]);
      expect((await claim()).outcome).toBe("already_completed");
      expect(
        await client.query.userData.findFirst({
          where: eq(userData.userId, "mission-sensei"),
        }),
      ).toMatchObject({ money: 500 + bonus });
      expect(await client.query.bankTransfers.findMany()).toHaveLength(1);
    },
  );

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
    user.maxEnergy = 250;
    let stale: typeof userData.$inferSelect | undefined;
    const client = aroundStatements(
      database,
      userData,
      async (run) => {
        stale = await database.query.userData.findFirst({
          where: eq(userData.userId, user.userId),
        });
        return run();
      },
      { when: (set) => "curEnergy" in set },
    );
    const claim = await commit(client, user, history);
    expect(claim.outcome).toBe("claimed");
    if (claim.outcome === "claimed") {
      expect(claim.postNotifications).toContain(
        "Energy reward: 100 (restored up to capacity).",
      );
    }
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
    ).toMatchObject({ curEnergy: 195, maxEnergy: 250 });
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
    ).toBe(195);
  });
});
