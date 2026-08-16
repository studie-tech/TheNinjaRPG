// sum.test.js
import { expect, test } from "vitest";
import { RANKED_PVP_STATS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  calcLevel,
  calcLevelRequirements,
  canAttackBracket,
  getAssignedCombatStatTotal,
  getExpBracket,
  manuallyAssignUserStats,
  passesBracketFilter,
  scaleUserStats,
} from "@/libs/profile";

test("Confirm that level<->experience calculations are consistent", () => {
  for (const level of [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
  ]) {
    const exp = calcLevelRequirements(level);
    const lvl = calcLevel(exp);
    expect(lvl).toBe(level);
  }
});

test("getExpBracket returns correct bracket for boundary values", () => {
  expect(getExpBracket(-1)).toBe(1);
  expect(getExpBracket(-999_999)).toBe(1);
  expect(getExpBracket(0)).toBe(1);
  expect(getExpBracket(500_000)).toBe(1);
  expect(getExpBracket(500_001)).toBe(2);
  expect(getExpBracket(1_000_000)).toBe(2);
  expect(getExpBracket(1_000_001)).toBe(3);
  expect(getExpBracket(1_500_000)).toBe(3);
  expect(getExpBracket(1_500_001)).toBe(4);
  expect(getExpBracket(2_000_000)).toBe(4);
  expect(getExpBracket(2_000_001)).toBe(5);
  expect(getExpBracket(2_500_000)).toBe(5);
  expect(getExpBracket(2_500_001)).toBe(6);
  expect(getExpBracket(3_000_000)).toBe(6);
  expect(getExpBracket(3_000_001)).toBe(7);
  expect(getExpBracket(99_999_999)).toBe(7);
});

test("getExpBracket returns 0 for Academy students and Genin", () => {
  expect(getExpBracket(0, "STUDENT")).toBe(0);
  expect(getExpBracket(500_000, "STUDENT")).toBe(0);
  expect(getExpBracket(99_999_999, "STUDENT")).toBe(0);
  expect(getExpBracket(0, "GENIN")).toBe(0);
  expect(getExpBracket(1_000_001, "GENIN")).toBe(0);
  expect(getExpBracket(99_999_999, "GENIN")).toBe(0);
  expect(getExpBracket(500_001, "CHUNIN")).toBe(2);
  expect(getExpBracket(3_000_001, "JONIN")).toBe(7);
});

test("canAttackBracket allows same, higher, or one below", () => {
  expect(canAttackBracket(3, 3)).toBe(true);
  expect(canAttackBracket(3, 4)).toBe(true);
  expect(canAttackBracket(3, 7)).toBe(true);
  expect(canAttackBracket(3, 2)).toBe(true);
  expect(canAttackBracket(3, 1)).toBe(false);
  expect(canAttackBracket(3, 0)).toBe(false);
  expect(canAttackBracket(1, 0)).toBe(true);
  expect(canAttackBracket(2, 1)).toBe(true);
});

test("passesBracketFilter matches exact bracket only", () => {
  expect(passesBracketFilter({ experience: undefined, rank: "JONIN" }, 5)).toBe(false);
  expect(passesBracketFilter({ experience: null, rank: "JONIN" }, 5)).toBe(false);
  expect(passesBracketFilter({ experience: undefined, rank: "JONIN" }, -1)).toBe(true);
  expect(passesBracketFilter({ experience: 0, rank: "CHUNIN" }, 1)).toBe(true);
  expect(passesBracketFilter({ experience: 0, rank: "CHUNIN" }, 2)).toBe(false);
  expect(passesBracketFilter({ experience: 3_000_001, rank: "JONIN" }, 7)).toBe(true);
  expect(passesBracketFilter({ experience: 3_000_001, rank: "JONIN" }, 2)).toBe(false);
  expect(passesBracketFilter({ experience: 0, rank: "STUDENT" }, -1)).toBe(true);
  expect(passesBracketFilter({ experience: 0, rank: "STUDENT" }, 0)).toBe(true);
  expect(passesBracketFilter({ experience: 0, rank: "STUDENT" }, 1)).toBe(false);
});

test("getAssignedCombatStatTotal sums only combat stats", () => {
  expect(
    getAssignedCombatStatTotal({
      offence: 100,
      defence: 50,
      strength: 10,
      speed: 10,
      intelligence: 10,
      willpower: 20,
    }),
  ).toBe(200);
});

test("getAssignedCombatStatTotal rounds each combat stat before summing", () => {
  expect(
    getAssignedCombatStatTotal({
      offence: 10.006,
      defence: 10.006,
      strength: 10.006,
      speed: 10.006,
      intelligence: 10.006,
      willpower: 10.006,
    }),
  ).toBeCloseTo(60.06, 2);
});

test("manuallyAssignUserStats applies ranked mastery caps", () => {
  const user = {
    offence: 10,
    defence: 10,
    strength: 10,
    intelligence: 10,
    willpower: 10,
    speed: 10,
    ninjutsuMastery: 10,
    genjutsuMastery: 10,
    taijutsuMastery: 10,
    bukijutsuMastery: 10,
    bloodlineMastery: 10,
    sageMastery: 10,
  } as UserData;
  manuallyAssignUserStats(user, RANKED_PVP_STATS);
  expect(user.offence).toBe(RANKED_PVP_STATS.offence);
  expect(user.ninjutsuMastery).toBe(RANKED_PVP_STATS.ninjutsuMastery);
  expect(user.sageMastery).toBe(RANKED_PVP_STATS.sageMastery);
});

test("scaleUserStats keeps combat stats finite when the combat sum is zero", () => {
  const user = {
    level: 10,
    poolsMultiplier: 1,
    statsMultiplier: 1,
    curHealth: 0,
    maxHealth: 0,
    curStamina: 0,
    maxStamina: 0,
    curChakra: 0,
    maxChakra: 0,
    experience: 0,
    offence: 0,
    defence: 0,
    ninjutsuMastery: 0,
    genjutsuMastery: 0,
    taijutsuMastery: 0,
    bukijutsuMastery: 0,
    bloodlineMastery: 0,
    sageMastery: 0,
    strength: 0,
    intelligence: 0,
    willpower: 0,
    speed: 0,
  };
  scaleUserStats(user);
  expect(user.offence).toBe(10);
  expect(user.defence).toBe(10);
  expect(user.ninjutsuMastery).toBe(10);
  expect(Number.isFinite(user.offence)).toBe(true);
});
