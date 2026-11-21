import { describe, expect, it } from "bun:test";
import {
  getChallengeQuestUserUpdate,
  getDailyDutyUserUpdate,
  getDojoPurchaseUpdate,
  getRunClaimUpdate,
  type TowerDefenseProgress,
} from "@/deltas/towerDefense";
import { QuestTracker } from "@/validators/objectives";

const progress: TowerDefenseProgress = { points: 900, bestWave: 40, dojo: { dmg: 2 } };

describe("tower defense progress deltas", () => {
  it("deducts a purchase from the cached balance and sets the new level", () => {
    expect(
      getDojoPurchaseUpdate("dmg", { level: 3, pointsSpent: 250 })(progress),
    ).toEqual({ points: 650, bestWave: 40, dojo: { dmg: 3 } });
    expect(
      getDojoPurchaseUpdate("hp", { level: 1, pointsSpent: 10 })(progress),
    ).toEqual({
      points: 890,
      bestWave: 40,
      dojo: { dmg: 2, hp: 1 },
    });
  });

  it("adds a claim's scrolls and only ever raises the best wave", () => {
    expect(getRunClaimUpdate({ pointsEarned: 100, wave: 55 })(progress)).toMatchObject({
      points: 1000,
      bestWave: 55,
    });
    expect(getRunClaimUpdate({ pointsEarned: 0, wave: 12 })(progress)).toMatchObject({
      points: 900,
      bestWave: 40,
    });
  });
});

describe("tower defense daily duty delta", () => {
  const reward = { ryo: 15_000, prestige: 150, villageTokens: 200 };

  const paidAt = new Date("2026-11-17T09:00:00Z");

  it("pays the player and their village and records when", () => {
    expect(getDailyDutyUserUpdate({ reward, villageId: "v1", paidAt })).toEqual({
      userDelta: {
        money: 15_000,
        villagePrestige: 150,
        village: { id: "v1", tokens: 200 },
      },
      userPatch: { towerDefenseDutyAt: paidAt },
    });
    expect(getDailyDutyUserUpdate({ reward, villageId: null, paidAt })).toEqual({
      userDelta: { money: 15_000, villagePrestige: 150 },
      userPatch: { towerDefenseDutyAt: paidAt },
    });
  });

  it("leaves the profile alone when the claim paid no duty", () => {
    expect(getDailyDutyUserUpdate({ reward: null, villageId: "v1", paidAt })).toEqual({
      userDelta: {},
    });
  });
});

describe("tower defense challenge delta", () => {
  it("patches the quest trackers once the objective is done", () => {
    const questData = [
      QuestTracker.parse({
        id: "q1",
        goals: [{ id: "g1", done: true }],
      }),
    ];
    const update = getChallengeQuestUserUpdate({
      questData,
      sector: 1,
      role: "USER",
      playsAsPlayer: true,
      userQuests: [],
    });
    expect(update).toEqual({ userDelta: {}, userPatch: { questData } });
    expect(update.userPatch?.questData).not.toBe(questData);
    // A following objective that started a battle travels with the same patch.
    const withBattle = getChallengeQuestUserUpdate(
      { questData, sector: 1, role: "USER", playsAsPlayer: true, userQuests: [] },
      { userDelta: {}, userPatch: { status: "BATTLE", battleId: "battle-1" } },
    );
    expect(withBattle.userPatch).toEqual({
      status: "BATTLE",
      battleId: "battle-1",
      questData,
    });
  });

  it("confirms an unchanged profile when the objective is not done", () => {
    expect(getChallengeQuestUserUpdate(undefined)).toEqual({ userDelta: {} });
  });
});
