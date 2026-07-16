import { describe, expect, it } from "vitest";
import {
  getSageMasteryRank,
  getSageMasteryDisplayRank,
  getSageDailyCap,
  getActiveSageLevel,
  getSageModeActivationCost,
  getSageModePityRolls,
} from "@/libs/sageMode";
import { PITY_SAGE_MODE_ROLLS } from "@/drizzle/constants";

describe("getSageMasteryRank", () => {
  it("maps sage mastery experience to the correct rank at each threshold", () => {
    expect(getSageMasteryRank(0)).toBe("INITIATE");
    expect(getSageMasteryRank(49_999)).toBe("INITIATE");
    expect(getSageMasteryRank(50_000)).toBe("ADEPT");
    expect(getSageMasteryRank(149_999)).toBe("ADEPT");
    expect(getSageMasteryRank(150_000)).toBe("MASTER");
    expect(getSageMasteryRank(399_999)).toBe("MASTER");
    expect(getSageMasteryRank(400_000)).toBe("LEGENDARY");
  });
});

describe("getSageMasteryDisplayRank", () => {
  it("is NONE until a sage mode is attained, regardless of experience", () => {
    expect(getSageMasteryDisplayRank(0, false)).toBe("NONE");
    expect(getSageMasteryDisplayRank(400_000, false)).toBe("NONE");
  });
  it("shows the earned rank once a sage mode is equipped", () => {
    expect(getSageMasteryDisplayRank(0, true)).toBe("INITIATE");
    expect(getSageMasteryDisplayRank(49_999, true)).toBe("INITIATE");
    expect(getSageMasteryDisplayRank(50_000, true)).toBe("ADEPT");
    expect(getSageMasteryDisplayRank(400_000, true)).toBe("LEGENDARY");
  });
});

describe("getSageDailyCap", () => {
  it("maps sage mastery experience to the daily activation cap", () => {
    expect(getSageDailyCap(0)).toBe(10);
    expect(getSageDailyCap(50_000)).toBe(12);
    expect(getSageDailyCap(150_000)).toBe(15);
    expect(getSageDailyCap(400_000)).toBe(20);
  });
});

describe("getActiveSageLevel", () => {
  it("is level 1 when no threshold is defined", () => {
    expect(getActiveSageLevel(999_999, { requiredSageMastery: 0 })).toBe(1);
  });
  it("unlocks level 2 at/above the threshold", () => {
    expect(getActiveSageLevel(49_999, { requiredSageMastery: 50_000 })).toBe(1);
    expect(getActiveSageLevel(50_000, { requiredSageMastery: 50_000 })).toBe(2);
  });
});

describe("getSageModeActivationCost", () => {
  it("derives flat chakra/stamina cost from max pools and percentages", () => {
    expect(
      getSageModeActivationCost({ chakraCostPerc: 20, staminaCostPerc: 25 }, 1000, 800),
    ).toEqual({ cpCost: 200, spCost: 200 });
  });
  it("floors fractional costs", () => {
    expect(
      getSageModeActivationCost({ chakraCostPerc: 33, staminaCostPerc: 10 }, 100, 95),
    ).toEqual({ cpCost: 33, spCost: 9 });
  });
  it("is zero when percentages are zero", () => {
    expect(
      getSageModeActivationCost({ chakraCostPerc: 0, staminaCostPerc: 0 }, 1000, 1000),
    ).toEqual({ cpCost: 0, spCost: 0 });
  });
});

describe("getSageModePityRolls", () => {
  const T = PITY_SAGE_MODE_ROLLS;
  it("returns 0 below the threshold", () => {
    expect(getSageModePityRolls({ used: 0, pityRolls: 0 })).toBe(0);
    expect(getSageModePityRolls({ used: T - 1, pityRolls: 0 })).toBe(0);
  });
  it("grants one pity roll at the threshold", () => {
    expect(getSageModePityRolls({ used: T, pityRolls: 0 })).toBe(1);
  });
  it("grants multiple pity rolls at multiples of the threshold", () => {
    expect(getSageModePityRolls({ used: T * 2, pityRolls: 0 })).toBe(2);
  });
  it("subtracts already-claimed pity rolls", () => {
    expect(getSageModePityRolls({ used: T * 2, pityRolls: 1 })).toBe(1);
  });
  it("does not over-grant when pityRolls pushes the numerator across a threshold", () => {
    // used = 2*PITY - 1 earns exactly ONE credit total, regardless of pityRolls claimed.
    const used = 2 * T - 1;
    expect(getSageModePityRolls({ used, pityRolls: 0 })).toBe(1);
    expect(getSageModePityRolls({ used, pityRolls: 1 })).toBe(0);
  });
});
