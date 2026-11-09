import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { STATS_PER_ENERGY } from "@/drizzle/constants";
import {
  calcMasteryTrainingAmount,
  settleEnergyTrainingQueue,
  settleMasteryTrainingQueue,
  trainingBoost,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { combatMasteryGains } from "@/libs/combat/mastery";
import { calcBattleResult } from "@/libs/combat/settlement";
import { getReward, postProcessRewards } from "@/libs/quest/rewards";
import { QuestValidator } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";

const NOW = new Date("2026-09-19T12:00:00Z");
const member = (days: number) => ({
  isOutlaw: false,
  villageId: "village-1",
  joinedVillageAt: new Date(NOW.getTime() - days * 86_400_000),
});

beforeEach(() => {
  setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  setSystemTime();
  vi.restoreAllMocks();
});

const questReward = (
  days: number,
  questType: "daily" | "mission",
  amount: number,
  extraReward: Record<string, number> = {},
  choice = false,
) => {
  const quest = {
    id: "quest-1",
    ...QuestValidator.parse({
      name: "Loyalty reward",
      description: null,
      successDescription: null,
      tierLevel: null,
      questType,
      hidden: false,
      consecutiveObjectives: false,
      startsAt: null,
      endsAt: null,
      content: {
        objectives: [0, 1, 2].map((id) => ({
          id: `goal-${id}`,
          task: "win_quest",
          description: "Complete",
          successDescription: "",
        })),
        reward: { reward_prestige: amount, ...extraReward },
        ...(choice ? { rewardMode: "choose", rewardPickCount: 1 } : {}),
      },
    }),
  };
  const user = {
    ...member(days),
    userId: "user-1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    sector: 1,
    village: { id: "village-1", sector: 1, structures: [], sectors: [] },
    activeWars: [],
    completedQuests: [],
    dailyMissions: 0,
    senseiId: null,
    questData: [
      {
        id: quest.id,
        goals: [0, 1, 2].map((id) => ({ id: `goal-${id}`, value: 0, done: true })),
      },
    ],
    userQuests: [
      {
        id: "history-1",
        questId: quest.id,
        completed: 0,
        previousAttempts: 0,
        previousCompletes: 0,
        quest,
      },
    ],
  } as unknown as Parameters<typeof getReward>[0];
  return getReward(user, quest.id);
};

describe("loyalty reward delivery", () => {
  it.each(["daily", "mission"] as const)(
    "keeps %s prestige penalties unchanged",
    (type) => {
      for (const days of [0, 14, 90]) {
        const result = questReward(days, type, -100);
        expect(result.resolved).toBe(true);
        expect(result.rewards.reward_prestige).toBe(-100);
      }
    },
  );

  it("keeps positive mission and village bonuses additive and applies them once", () => {
    expect(questReward(90, "daily", 1000).rewards.reward_prestige).toBe(1130);
    expect(questReward(90, "mission", 1000).rewards.reward_prestige).toBe(1180);
  });

  it("scales frozen reward-choice offers once with the same loyalty as direct rewards", () => {
    const result = questReward(90, "mission", 1000, { reward_money: 1000 }, true);
    expect(result.rewardChoice?.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "reward_prestige", amount: 1180 }),
        expect.objectContaining({ field: "reward_money", amount: 1050 }),
      ]),
    );
    expect(result.rewards.reward_prestige).toBe(0);
  });
  it("restricts mission loyalty to money, experience, mastery and village earnings", () => {
    const result = questReward(100, "mission", 1000, {
      reward_money: 1000,
      reward_exp: 1000,
      reward_ninjutsu_experience: 1000,
      reward_reputation: 1000,
      reward_clanpoints: 1000,
      reward_anbupoints: 1000,
      reward_seichi_silver: 1000,
      reward_medical_experience: 1000,
    });
    expect(result.rewards).toMatchObject({
      reward_money: 1050,
      reward_exp: 1050,
      reward_ninjutsu_experience: 1050,
      reward_prestige: 1180,
      reward_reputation: 1000,
      reward_clanpoints: 1000,
      reward_anbupoints: 1000,
      reward_seichi_silver: 1000,
      reward_medical_experience: 1000,
    });
  });
  it("normally rounds small positive loyalty awards", () => {
    expect(questReward(90, "daily", 5).rewards.reward_prestige).toBe(6);
    expect(
      postProcessRewards(ObjectiveReward.parse({ reward_tokens: 5 }), member(90))
        .reward_tokens,
    ).toBe(6);
  });

  it("rounds halfway configured village awards up consistently with quest rewards", () => {
    expect(
      postProcessRewards(
        ObjectiveReward.parse({ reward_tokens: 50, reward_prestige: 50 }),
        member(100),
      ),
    ).toMatchObject({ reward_tokens: 57, reward_prestige: 57 });
    expect(questReward(100, "daily", 50, { reward_tokens: 50 }).rewards).toMatchObject({
      reward_tokens: 57,
      reward_prestige: 57,
    });
  });

  it("preserves fractional penalties and payouts without active loyalty", () => {
    expect(
      postProcessRewards(ObjectiveReward.parse({ reward_prestige: -5.5 }), member(90))
        .reward_prestige,
    ).toBe(-5.5);
    expect(
      postProcessRewards(ObjectiveReward.parse({ reward_prestige: 5.5 }), member(0))
        .reward_prestige,
    ).toBe(5.5);
  });
  it("boosts unscaled configured payouts without changing penalties", () => {
    const rewards = ObjectiveReward.parse({
      reward_prestige: 1000,
      reward_tokens: 1000,
    });
    expect(postProcessRewards(rewards, member(90))).toMatchObject({
      reward_prestige: 1130,
      reward_tokens: 1130,
    });
    expect(postProcessRewards(rewards)).toMatchObject({
      reward_prestige: 1000,
      reward_tokens: 1000,
    });
    expect(
      postProcessRewards(ObjectiveReward.parse({ reward_prestige: -100 }), member(90))
        .reward_prestige,
    ).toBe(-100);
  });

  it("caps boosted PvP mastery awards against the unbuffed stored base", () => {
    const user = makeBattleUser("player", {
      ...member(30),
      ninjutsuMastery: 1800000,
      masteryRanks: { ninjutsuMastery: "MASTER" },
      usedMasteries: { ninjutsuMastery: 1 },
      baseStatsForModifiers: { ninjutsuMastery: 1499995 },
    });
    expect(
      combatMasteryGains(
        { battleType: "COMBAT", rewardScaling: 1 },
        user,
        [makeBattleUser("target")],
        "Won",
        0,
      ),
    ).toMatchObject({ ninjutsuMastery: 5 });
  });
  it("boosts only open-world PvP growth and experience, including loss participation", () => {
    const result = (
      days: number,
      battleType: "COMBAT" | "ARENA" | "RANKED_PVP",
      won = true,
    ) =>
      calcBattleResult(
        makeCompleteBattle({
          battleType,
          rewardScaling: 1,
          usersState: [
            makeBattleUser("player", {
              ...member(days),
              experience: 1000,
              direction: "left",
              pvpStreak: 0,
              ninjutsuMastery: 0,
              masteryRanks: { ninjutsuMastery: "NOVICE" },
              usedMasteries: { ninjutsuMastery: 1 },
              villageId: "village-1",
              curHealth: won ? 100 : 0,
              usedGenerals: { strength: 1, speed: 0, intelligence: 0, willpower: 0 },
            }),
            makeBattleUser("opponent", {
              direction: "right",
              villageId: "village-2",
              curHealth: won ? 0 : 100,
              experience: 1000,
              isAi: battleType === "ARENA",
            }),
          ],
        }),
        "player",
        [],
      )!;
    const base = result(0, "COMBAT");
    const loyal = result(30, "COMBAT");
    expect(base.strength).toBeGreaterThan(0);
    expect(base.pvpExperience).toBeGreaterThan(0);
    expect(loyal.strength).toBeCloseTo(base.strength * 1.05, 1);
    expect(loyal.pvpExperience).toBe((base.pvpExperience ?? 0) * 1.05);
    expect(result(30, "COMBAT", false).pvpExperience).toBe(
      (result(0, "COMBAT", false).pvpExperience ?? 0) * 1.05,
    );
    expect(result(70, "ARENA").strength).toBe(result(0, "ARENA").strength);
    expect(result(70, "RANKED_PVP").pvpExperience).toBe(
      result(0, "RANKED_PVP").pvpExperience,
    );
    expect(loyal.money).toBe(base.money);
    expect(loyal.masteryGains?.ninjutsuMastery).toBe(
      (base.masteryGains?.ninjutsuMastery ?? 0) * 1.05,
    );
    expect(result(30, "COMBAT", false).masteryGains?.ninjutsuMastery).toBe(
      (result(0, "COMBAT", false).masteryGains?.ninjutsuMastery ?? 0) * 1.05,
    );
  });
});

const trainee = (days: number) =>
  ({
    ...makeBattleUser("trainee"),
    ...member(days),
    rank: "GENIN",
    status: "AWAKE",
    isBanned: false,
    village: null,
    clan: null,
    dailyTrainings: 0,
    trainingSpeed: "15min",
    currentlyTrainingMastery: "ninjutsuMastery",
    masteryTrainingStartedAt: new Date(NOW.getTime() - 900_000),
    ninjutsuMastery: 0,
    elementalMastery: {},
    curEnergy: 100,
    maxEnergy: 100,
    strength: 0,
  }) as unknown as NonNullable<UserWithRelations>;

describe("loyalty training integration", () => {
  it("shares stat bonuses between direct and queued Energy training", () => {
    const user = trainee(70);
    expect(trainingBoost(user, [])).toBeCloseTo(trainingBoost(trainee(14), []) * 1.15);
    const result = settleEnergyTrainingQueue(
      user,
      [{ stat: "strength", energy: 10 }],
      [],
      0,
    );
    expect(result.gains.strength).toBeCloseTo(
      10 * STATS_PER_ENERGY * trainingBoost(user, []),
    );
  });
  it("uses mastery bonuses for timed training and queued collection", () => {
    const base = calcMasteryTrainingAmount(trainee(14), [], 900);
    const user = trainee(100.1);
    expect(calcMasteryTrainingAmount(user, [], 900)).toBeCloseTo(base * 1.3);
    expect(
      settleMasteryTrainingQueue(user, [], [], NOW).gains.ninjutsuMastery,
    ).toBeCloseTo(base * 1.3);
  });
  it("uses the completion date when offline collection crosses a loyalty milestone", () => {
    const user = trainee(100);
    user.masteryTrainingStartedAt = new Date(NOW.getTime() - 1_800_000);
    const base = calcMasteryTrainingAmount(trainee(14), [], 900);
    expect(
      settleMasteryTrainingQueue(user, [], [], NOW).gains.ninjutsuMastery,
    ).toBeCloseTo(base * 1.15);
  });
});
