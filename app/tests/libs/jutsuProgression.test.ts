import { describe, expect, it } from "bun:test";
import { getJutsuMaxLevel, getJutsuXpToLevel } from "@/libs/jutsuProgression";
import { calcJutsuTrainTime, inferJutsuTrainingStartedAt } from "@/libs/train";

describe("jutsu progression by required rank", () => {
  const elite = { requiredRank: "ELITE JONIN" as const, jutsuRank: "S" as const };
  const ordinary = { ...elite, requiredRank: "JONIN" as const };
  const owner = { rank: "ELITE JONIN" as const, senseiId: null };

  it("keeps ordinary techniques capped at 25 even for an Elite Jonin owner", () => {
    expect(getJutsuMaxLevel(ordinary)).toBe(25);
    expect(getJutsuMaxLevel(elite)).toBe(30);
    expect(getJutsuXpToLevel(ordinary, 24)).toBe(1000);
  });

  it("switches Elite Jonin XP requirements after reaching level 25", () => {
    for (const level of [0, 1, 20, 24])
      expect(getJutsuXpToLevel(elite, level)).toBe(5000);
    for (const level of [25, 26, 29])
      expect(getJutsuXpToLevel(elite, level)).toBe(10000);
  });

  it("multiplies each training duration and its cap by five", () => {
    expect(calcJutsuTrainTime(elite, 0, owner)).toBe(5 * 60_000);
    expect(calcJutsuTrainTime(elite, 2, owner)).toBe(115 * 60_000);
    expect(calcJutsuTrainTime(elite, 19, owner)).toBe(5 * 3_600_000);
    expect(calcJutsuTrainTime(ordinary, 19, owner)).toBe(3_600_000);
    const finish = new Date("2026-01-02T12:00:00Z");
    expect(inferJutsuTrainingStartedAt(finish, elite, 20, owner)).toEqual(
      new Date("2026-01-02T07:00:00Z"),
    );
  });
});
