import { describe, expect, it } from "vitest";
import { getSageMasteryRank, getSageDailyCap, getActiveSageLevel } from "@/libs/sageMode";

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
