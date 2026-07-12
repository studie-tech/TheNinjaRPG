import { describe, expect, it } from "vitest";
import {
  getSageMasteryRank,
  getSageDailyCap,
  getActiveSageLevel,
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
});
