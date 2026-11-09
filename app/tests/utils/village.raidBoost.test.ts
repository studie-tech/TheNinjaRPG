import { describe, expect, it } from "bun:test";
import type { VillageStructure } from "@/drizzle/schema";
import { getRaidStructureMultiplier, getStrucBoost } from "@/utils/village";

const structure = (expiry: Date | null): VillageStructure =>
  ({
    level: 5,
    temporaryLevelBonus: 1,
    temporaryLevelBonusExpiresAt: new Date(Date.now() + 86400_000),
    raidBoostExpiresAt: expiry,
    trainBoostPerLvl: 2,
    itemDiscountPerLvl: 4,
    missionRewardPerLvl: 3,
    arenaRewardPerLvl: 1,
  }) as VillageStructure;

describe("raid structure bonuses", () => {
  it("increases every matching structure benefit by 20% alongside ordinary temporary levels", () => {
    const target = structure(new Date(Date.now() + 86400_000));
    for (const [attribute, expected] of [
      ["trainBoostPerLvl", 14.4],
      ["itemDiscountPerLvl", 28.8],
      ["missionRewardPerLvl", 21.6],
      ["arenaRewardPerLvl", 7.2],
    ] as const) {
      expect(getStrucBoost(attribute, [target])).toBeCloseTo(expected);
    }
  });
  it("ignores expired raid bonuses while retaining ordinary temporary levels", () => {
    const target = structure(new Date(Date.now() - 1));
    expect(getRaidStructureMultiplier(target)).toBe(1);
    expect(getStrucBoost("trainBoostPerLvl", [target])).toBe(12);
    expect(getStrucBoost("trainBoostPerLvl", [structure(null)])).toBe(12);
  });
});
