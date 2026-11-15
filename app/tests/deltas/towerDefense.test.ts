import { describe, expect, it } from "bun:test";
import {
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
