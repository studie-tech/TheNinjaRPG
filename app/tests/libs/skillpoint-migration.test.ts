import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0025_hot_ken_ellis.sql"),
  "utf8",
);

const pointsInRange = (level: number, firstLevel: number, count: number) =>
  Math.min(Math.max(level - firstLevel + 1, 0), count);

const newLevelingPoints = (level: number) => pointsInRange(level, 31, 20);
const preCapLevelingPoints = (level: number) => pointsInRange(level, 21, 20);
const postCapLevelingPoints = (level: number) => pointsInRange(level, 31, 10);

describe("skill-point migration", () => {
  it.each([
    { level: 20, expected: 0 },
    { level: 30, expected: -10 },
    { level: 40, expected: -10 },
    { level: 45, expected: -5 },
    { level: 50, expected: 0 },
    { level: 100, expected: 0 },
  ])(
    "replaces the pre-cap-change component at level $level",
    ({ level, expected }) => {
      expect(newLevelingPoints(level) - preCapLevelingPoints(level)).toBe(expected);
    },
  );

  it.each([
    { level: 30, expected: 0 },
    { level: 40, expected: 0 },
    { level: 41, expected: 1 },
    { level: 50, expected: 10 },
    { level: 100, expected: 10 },
  ])("adds only missing points for the post-cap-change cohort at level $level", ({
    level,
    expected,
  }) => {
    expect(newLevelingPoints(level) - postCapLevelingPoints(level)).toBe(expected);
  });

  it("uses promotion history and bounded non-zero update ranges", () => {
    expect(migration).toContain("qh.`endedAt` < '2026-04-22 11:32:34'");
    expect(migration).toContain("u.`level` BETWEEN 21 AND 49");
    expect(migration).toContain("u.`level` BETWEEN 41 AND 100");
    expect(migration).not.toContain("`level` >= 20");
  });
});
