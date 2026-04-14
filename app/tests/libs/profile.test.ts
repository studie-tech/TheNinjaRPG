// sum.test.js
import { expect, test } from "vitest";
import { calcLevelRequirements, calcLevel, getExpBracket } from "@/libs/profile";

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
