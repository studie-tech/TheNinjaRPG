
import { describe, expect, it } from "bun:test";
import { CombatStatNames, SCALED_AI_STAT_BUDGET_SHARE } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { calcLevelRequirements } from "@/libs/profile";
import { scaleEditedAi } from "../../../src/server/api/routers/profile";

// Row _-LABA3r7vwogsQ4O3ALq in data/ai.sql: a specialist whose six stats hold more than
// half its experience.
const makeLaba = () =>
  ({
    level: 63,
    experience: 1_007_500,
    statsMultiplier: 1,
    poolsMultiplier: 1,
    offence: 213_047.69,
    defence: 80_531.41,
    strength: 83_596.86,
    intelligence: 76_001.42,
    willpower: 83_596.86,
    speed: 76_001.42,
    ninjutsuMastery: 213_047.69,
    genjutsuMastery: 80_531.41,
    taijutsuMastery: 80_531.41,
    bukijutsuMastery: 80_531.41,
    bloodlineMastery: 10,
    sageMastery: 10,
  }) as UserData;

// Row _m-X2hsSTRRqwmUZXI2mj in data/ai.sql.
const makeClown = () =>
  ({
    level: 100,
    experience: 3_339_000,
    statsMultiplier: 3,
    poolsMultiplier: 3,
    offence: 834_780,
    defence: 834_780,
    strength: 834_780,
    intelligence: 834_780,
    willpower: 834_780,
    speed: 834_780,
    ninjutsuMastery: 834_780,
    genjutsuMastery: 834_780,
    taijutsuMastery: 834_780,
    bukijutsuMastery: 834_780,
    bloodlineMastery: 10,
    sageMastery: 10,
  }) as UserData;

const pick = (user: UserData) =>
  Object.fromEntries(
    [...CombatStatNames, "ninjutsuMastery", "bukijutsuMastery"].map((k) => [
      k,
      user[k as keyof UserData],
    ]),
  );

describe("scaleEditedAi", () => {
  it("leaves a specialist's stats untouched when only its name changes", () => {
    const stored = makeLaba();
    const edited = { ...makeLaba(), username: "Renamed" } as UserData;
    scaleEditedAi(stored, edited);
    expect(pick(edited)).toEqual(pick(stored));
  });

  it("spreads the whole AI budget by the typed weights when a stat is edited", () => {
    const stored = makeClown();
    const edited = { ...makeClown(), offence: 1_669_560 } as UserData;
    scaleEditedAi(stored, edited);

    const budget = SCALED_AI_STAT_BUDGET_SHARE * (calcLevelRequirements(100) - 500);
    const points = (stat: number) => stat / 3 - 10;
    const earned = CombatStatNames.reduce((sum, stat) => sum + points(edited[stat]), 0);
    expect(earned).toBeCloseTo(budget, 1);
    // Offence was typed with twice the points of every other stat.
    const offenceWeight = 1_669_560 / 3 - 10;
    const otherWeight = 834_780 / 3 - 10;
    const weights = offenceWeight + 5 * otherWeight;
    expect(points(edited.offence)).toBeCloseTo((offenceWeight / weights) * budget, 1);
    expect(points(edited.speed)).toBeCloseTo((otherWeight / weights) * budget, 1);
    // Masteries are not weights: they stay as stored at the same level.
    expect(edited.ninjutsuMastery).toBe(834_780);
  });

  it("rescales every stat proportionally when only the level changes", () => {
    const stored = makeLaba();
    const edited = { ...makeLaba(), level: 80 } as UserData;
    scaleEditedAi(stored, edited);

    const ratio = (calcLevelRequirements(80) - 500) / (calcLevelRequirements(63) - 500);
    for (const stat of CombatStatNames) {
      expect(edited[stat] - 10).toBeCloseTo((stored[stat] - 10) * ratio, 1);
    }
    expect(edited.ninjutsuMastery).toBeCloseTo(stored.ninjutsuMastery * ratio, 1);
  });

  it("applies a new stats multiplier to untouched stats", () => {
    const stored = makeClown();
    const edited = { ...makeClown(), statsMultiplier: 6 } as UserData;
    scaleEditedAi(stored, edited);
    for (const stat of CombatStatNames) expect(edited[stat]).toBe(1_669_560);
  });
});
