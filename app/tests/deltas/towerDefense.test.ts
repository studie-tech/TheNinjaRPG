import { describe, expect, it } from "bun:test";
import {
  getDailyDutyUserUpdate,
  getDojoPurchaseUpdate,
  getRunClaimUpdate,
  type TowerDefenseProgress,
} from "@/deltas/towerDefense";

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
  const reward = { ryo: 15_000, prestige: 150, villageTokens: 200, experience: 0 };

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

  it("adds the experience a Genin's duty pays", () => {
    expect(
      getDailyDutyUserUpdate({
        reward: { ...reward, experience: 500 },
        villageId: null,
        paidAt,
      }).userDelta,
    ).toEqual({ money: 15_000, villagePrestige: 150, earnedExperience: 500 });
  });

  it("leaves the profile alone when the claim paid no duty", () => {
    expect(getDailyDutyUserUpdate({ reward: null, villageId: "v1", paidAt })).toEqual({
      userDelta: {},
    });
  });
});
