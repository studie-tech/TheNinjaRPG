import { describe, expect, it } from "bun:test";
import {
  PVP_EXPERIENCE_AVERAGE_SETTING,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import type { GameSetting } from "@/drizzle/schema";
import {
  boostPvpGain,
  boostPvpRewards,
  getPvpBoost,
  pvpExperienceReward,
} from "@/libs/pvpExperience";
import { trainingBoost } from "@/libs/train";
import { calcActiveUserRegen } from "@/libs/profile";
import { getReward } from "@/libs/quest/rewards";
import { combatMasteryGains } from "@/libs/combat/mastery";
import { calcBattleResult } from "@/libs/combat/settlement";
import { makeUser, makeCompleteBattle } from "../setup/combat";

const now = new Date("2026-10-11T12:00:00Z");
const settings: GameSetting[] = [
  { id: "avg", name: PVP_EXPERIENCE_AVERAGE_SETTING, value: 1000, time: now },
];

describe("PvP experience tiers and weekly boosts", () => {
  it.each([
    [0, 0],
    [799.99, 0],
    [800, 2],
    [1000, 2],
    [1199.99, 2],
    [1200, 5],
    [1300, 10],
    [1400, 15],
    [2000, 15],
  ])("%s XP gives %s%% base boost", (xp, boost) => {
    expect(getPvpBoost({ pvpExperience: xp }, settings, now).basePercent).toBe(boost);
  });
  it("does not grant free boosts for a zero average or AI templates", () => {
    expect(getPvpBoost({ pvpExperience: 0 }, [], now).totalPercent).toBe(0);
    expect(getPvpBoost({ pvpExperience: 1000 }, [], now).totalPercent).toBe(0);
    expect(
      getPvpBoost(
        { pvpExperience: 2000, isAi: true, weeklyPvpKills: 100, weeklyPvpKillsAt: now },
        settings,
        now,
      ).totalPercent,
    ).toBe(0);
  });
  it("caps the weekly bonus and expires it at the UTC Monday boundary, including year changes", () => {
    const user = { pvpExperience: 1400, weeklyPvpKills: 100, weeklyPvpKillsAt: now };
    expect(getPvpBoost(user, settings, now)).toMatchObject({
      basePercent: 15,
      weeklyPercent: 20,
      totalPercent: 35,
    });
    expect(getPvpBoost(user, settings, new Date("2026-10-12T00:00:00Z"))).toMatchObject(
      { weeklyKills: 0, totalPercent: 15 },
    );
    expect(
      getPvpBoost(
        { weeklyPvpKills: 4, weeklyPvpKillsAt: new Date("2026-12-31T12:00:00Z") },
        [],
        new Date("2027-01-01T12:00:00Z"),
      ).weeklyPercent,
    ).toBe(1);
  });
  it("scales participation and wins for repeated opponents, without rewarding fleeing", () => {
    expect(pvpExperienceReward("Won", 1)).toBe(250);
    expect(pvpExperienceReward("Lost", 1)).toBe(100);
    expect(pvpExperienceReward("Draw", 1)).toBe(100);
    expect(pvpExperienceReward("Won", 1 / 3)).toBe(83.33);
    expect(pvpExperienceReward("Fled", 1)).toBe(0);
    expect(pvpExperienceReward("Won", 0)).toBe(0);
    expect(boostPvpGain(-100, 35)).toBe(-100);
  });
});

describe("PvP boost reward integration", () => {
  it("preserves exact integer gains and floors integer-backed payouts", () => {
    expect(Math.floor(boostPvpGain(100, 15))).toBe(115);
    const rewards = {
      reward_money: 100,
      reward_prestige: 100,
      reward_ninjutsu_experience: 100,
    };
    boostPvpRewards(rewards, 2.25, true);
    expect(rewards).toEqual({
      reward_money: 102,
      reward_prestige: 102.25,
      reward_ninjutsu_experience: 102.25,
    });
    const hero = makeUser({
      rank: "JONIN",
      masteryRanks: { ninjutsuMastery: "MASTER" },
      ninjutsuMastery: 100,
      usedMasteries: { ninjutsuMastery: 1 },
      pvpBoostPercent: 15,
    });
    expect(
      combatMasteryGains(
        { battleType: "COMBAT", rewardScaling: 1 },
        hero,
        [makeUser({ userId: "foe" })],
        "Won",
        0,
      ).ninjutsuMastery,
    ).toBe(230);
  });
  it("boosts training and regeneration once with other bonuses", () => {
    const user = {
      ...makeUser(),
      homeType: "NONE",
      regeneration: 60,
      joinedVillageAt: new Date(0),
      village: null,
      clan: null,
    } as unknown as Parameters<typeof trainingBoost>[0];
    const baseTrain = trainingBoost(user, settings);
    const baseRegen = calcActiveUserRegen(user, settings);
    const boosted = { ...user, pvpExperience: 1400 };
    expect(trainingBoost(boosted, settings)).toBeCloseTo(baseTrain * 1.15);
    expect(calcActiveUserRegen(boosted, settings)).toBeCloseTo(baseRegen * 1.15);
  });
  it("boosts the specified quest gains without increasing silver or unrelated currencies", () => {
    const reward = {
      reward_money: 100,
      reward_exp: 100,
      reward_tokens: 100,
      reward_prestige: 100,
      reward_clanpoints: 100,
      reward_hunting_experience: 100,
      reward_gathering_experience: 100,
      reward_crafting_experience: 100,
      reward_ninjutsu_experience: 100,
      reward_seichi_silver: 100,
      reward_anbupoints: 100,
    };
    const quest = {
      id: "quest",
      questType: "errand",
      name: "Test",
      content: { objectives: [], reward },
      consecutiveObjectives: false,
    };
    const user = {
      ...makeUser(),
      pvpExperience: 1400,
      dailyMissions: 0,
      questData: [],
      completedQuests: [],
      userQuests: [{ quest, questId: quest.id, completed: 0 }],
    } as unknown as Parameters<typeof getReward>[0];
    const result = getReward(user, quest.id, undefined, settings);
    for (const field of [
      "reward_money",
      "reward_exp",
      "reward_tokens",
      "reward_prestige",
      "reward_clanpoints",
      "reward_hunting_experience",
      "reward_gathering_experience",
      "reward_crafting_experience",
    ] as const)
      expect(result.rewards[field]).toBe(115);
    expect(result.rewards.reward_ninjutsu_experience).toBe(115);
    expect(result.rewards.reward_seichi_silver).toBe(100);
    expect(result.rewards.reward_anbupoints).toBe(100);
  });
  it("earns XP and a weekly kill on a human win but excludes AI, sparring and friendly farming", () => {
    for (const [battleType, isAi, sameVillage, xp] of [
      ["COMBAT", false, false, 250],
      ["COMBAT", true, false, 0],
      ["SPARRING", false, false, 0],
      ["COMBAT", false, true, 0],
    ] as const) {
      const hero = makeUser({
        userId: "hero",
        direction: "left",
        villageId: "a",
        curHealth: 100,
      });
      const foe = makeUser({
        userId: "foe",
        villageId: sameVillage ? "a" : "b",
        isAi,
        curHealth: 0,
      });
      const battle = makeCompleteBattle({
        battleType,
        rewardScaling: 1,
        usersState: [hero, foe],
      });
      const result = calcBattleResult(battle, hero.userId);
      expect(result?.pvpExperience).toBe(xp);
      expect(result?.weeklyPvpKills).toBe(xp > 0 ? 1 : 0);
    }
  });
  it("cannot turn war-torn losses into positive rewards when ryo was stolen", () => {
    const hero = makeUser({
      userId: "hero",
      direction: "left",
      villageId: "a",
      curHealth: 0,
      sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
      money: 100,
      moneyStolen: -500,
      pvpBoostPercent: 35,
    });
    const foe = makeUser({ userId: "foe", villageId: "b", curHealth: 100 });
    const result = calcBattleResult(
      makeCompleteBattle({ rewardScaling: 1, usersState: [hero, foe] }),
      "hero",
    );
    expect(result?.money).toBe(-100);
    expect(result?.pvpExperience).toBe(100);
    expect(result?.weeklyPvpKills).toBe(0);
  });
  it("matches integer combat payouts while preserving fractional prestige and stat XP", () => {
    const hero = makeUser({
      userId: "hero",
      direction: "left",
      villageId: "a",
      isAggressor: true,
      curHealth: 100,
      pvpBoostPercent: 15.25,
      pvpStreak: 0,
      rank: "JONIN",
      offence: 0,
      defence: 0,
      strength: 0,
      intelligence: 0,
      willpower: 0,
      speed: 0,
    });
    const foe = makeUser({ userId: "foe", villageId: "b", curHealth: 0 });
    const result = calcBattleResult(
      makeCompleteBattle({ rewardScaling: 1, usersState: [hero, foe] }),
      "hero",
    );
    expect(result?.villageTokens).toBe(346);
    expect(result?.villagePrestige).toBe(172.875);
    expect(Number.isInteger(result?.money)).toBe(true);
    expect(result?.experience).toBeGreaterThan(0);
    expect(Number.isInteger(result?.offence)).toBe(false);

    const ranked = calcBattleResult(
      makeCompleteBattle({
        battleType: "RANKED_PVP",
        rewardScaling: 1,
        usersState: [{ ...hero, leftBattle: false }, foe],
      }),
      "hero",
    );
    expect(ranked?.money).toBe(3458);
    const clan = calcBattleResult(
      makeCompleteBattle({
        battleType: "CLAN_BATTLE",
        rewardScaling: 1,
        usersState: [{ ...hero, leftBattle: false, clanId: "clan" }, foe],
      }),
      "hero",
    );
    // The shared clan victory is credited once by the battle queue claim.
    expect(clan?.clanPoints).toBe(0);
  });
});
