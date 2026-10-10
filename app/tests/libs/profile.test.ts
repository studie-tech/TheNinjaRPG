import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  getUserCaps,
  RANKED_PVP_STATS,
  SCALED_AI_STAT_BUDGET_SHARE,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  calcLevel,
  calcLevelRequirements,
  canAssignExperience,
  canAttackBracket,
  capUserStats,
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

test.each([
  [10.005, 10.01],
  [10.004999, 10],
  [10.015, 10.02],
  [100_000.005, 100_000.01],
])(
  "getAssignedCombatStatTotal rounds decimal boundary %s per stat",
  (value, rounded) => {
    expect(getAssignedCombatStatTotal(uniformCombatStats(value))).toBeCloseTo(
      rounded * 6,
      6,
    );
  },
);

test("manuallyAssignUserStats assigns the ranked combat stats and masteries", () => {
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

test.each([
  ["ai", 2_260],
  ["player", 4_510],
] as const)("scaleUserStats spreads the %s budget evenly over base stats", (statScale, expected) => {
  // A new AI or character: every stat at the base 10 and no experience.
  const fresh = makeScalableUser({ level: 10, ...uniformCombatStats(10) });
  scaleUserStats(fresh, statScale);
  expect(fresh.offence).toBe(expected);
  expect(fresh.speed).toBe(expected);
  expect(fresh.ninjutsuMastery).toBe(10);
});

test("scaleUserStats rounds tiny positive allocated points without producing NaN", () => {
  const user = makeScalableUser({
    level: 10,
    ...uniformCombatStats(10),
    offence: 10.000000001,
    defence: 1_000,
  });
  scaleUserStats(user, "ai");
  expect(user.offence).toBe(10);
  expect(user.defence).toBe(13_510);
});

test("scaleUserStats keeps stats finite when the combat sum is zero", () => {
  const user = makeScalableUser({ level: 10 });
  scaleUserStats(user, "ai");
  expect(Number.isFinite(user.offence)).toBe(true);
  expect(user.offence).toBe(user.defence);
  expect(user.ninjutsuMastery).toBe(10);
});

test("scaleUserStats keeps the seeded Clown of Chaos AI row as a fixed point", () => {
  // Row _m-X2hsSTRRqwmUZXI2mj in data/ai.sql.
  const clown = makeScalableUser({
    level: 100,
    poolsMultiplier: 3,
    statsMultiplier: 3,
    curHealth: 15_150,
    maxHealth: 15_150,
    curStamina: 15_150,
    maxStamina: 15_150,
    curChakra: 15_150,
    maxChakra: 15_150,
    experience: 3_339_000,
    ...uniformCombatStats(834_780),
    ninjutsuMastery: 834_780,
    genjutsuMastery: 834_780,
    taijutsuMastery: 834_780,
    bukijutsuMastery: 834_780,
    bloodlineMastery: 10,
    sageMastery: 10,
  });
  const stored = { ...clown };
  scaleUserStats(clown, "ai");
  expect(clown).toEqual(stored);
  scaleUserStats(clown, "ai");
  expect(clown).toEqual(stored);
});

test("scaleUserStats keeps every seeded AI row at its pre-#1277 values", () => {
  const rows = readSeededAiRows();
  expect(rows).toHaveLength(100);
  for (const row of rows) {
    const budget = calcLevelRequirements(row.level) - 500;
    const stored = { ...row };
    scaleUserStats(row, "ai");
    for (const stat of COMBAT_STATS) {
      if (stored.experience === budget) {
        // Saved at its level: a fixed point, up to the 2-decimal rounding of stat / multiplier.
        expect(Math.abs(row[stat] - stored[stat])).toBeLessThanOrEqual(
          0.005 * row.statsMultiplier + 1e-6,
        );
      } else {
        // Never saved: base stats spread like the 12-stat formula spread them.
        expect(stored[stat]).toBe(10);
        expect(row[stat]).toBe((10 + budget / 12) * row.statsMultiplier);
      }
    }
    const again = { ...row };
    scaleUserStats(again, "ai");
    expect(again).toEqual(row);
  }
});

test("scaleUserStats puts a new uneven AI on the AI budget and then keeps it", () => {
  const created = makeScalableUser({
    level: 50,
    offence: 3_000,
    defence: 1_000,
    strength: 500,
    intelligence: 10,
    willpower: 10,
    speed: 10,
  });
  scaleUserStats(created, "ai");
  const earned = COMBAT_STATS.reduce((sum, stat) => sum + created[stat] - 10, 0);
  const budget = calcLevelRequirements(50) - 500;
  expect(earned).toBeCloseTo(budget * SCALED_AI_STAT_BUDGET_SHARE, 1);
  const firstSave = { ...created };
  scaleUserStats(created, "ai");
  expect(created).toEqual(firstSave);
});

test("scaleUserStats keeps a player whose stats hold their experience", () => {
  // Every point of the level-20 experience assigned: the stats sum to it plus 10 each.
  const stats = {
    offence: 40_010,
    defence: 30_010,
    strength: 10_010,
    intelligence: 10_010,
    willpower: 7_260,
    speed: 7_260,
  };
  const experience = calcLevelRequirements(20) - 500;
  expect(Object.values(stats).reduce((a, b) => a + b, 0)).toBe(experience + 60);
  const user = makeScalableUser({ level: 20, experience, ...stats });
  scaleUserStats(user, "player");
  expect(user).toMatchObject(stats);
});

test("scaleUserStats scales a migrated veteran to at most their own stats", () => {
  // Level 100 with the experience of 8 x 450k per-type stats and 4 x 200k generals,
  // merged into one 450k offence and defence.
  const veteran = makeScalableUser({
    level: 100,
    experience: 8 * 450_000 + 4 * 200_000 - 120,
    offence: 450_000,
    defence: 450_000,
    strength: 200_000,
    intelligence: 200_000,
    willpower: 200_000,
    speed: 200_000,
    ninjutsuMastery: 450_000,
  });
  const stored = { ...veteran };
  scaleUserStats(veteran, "player");
  expect(veteran.offence).toBeLessThanOrEqual(stored.offence);
  expect(veteran.defence).toBeLessThanOrEqual(stored.defence);
  expect(veteran.strength).toBeLessThanOrEqual(stored.strength);
  // Masteries follow the combat stats by the same factor.
  const factor = veteran.offence / stored.offence;
  expect(veteran.ninjutsuMastery / stored.ninjutsuMastery).toBeCloseTo(factor, 3);
});

const COMBAT_STATS = [
  "offence",
  "defence",
  "strength",
  "intelligence",
  "willpower",
  "speed",
] as const;

/** A scaleUserStats input with every stat and pool at zero unless overridden. */
const makeScalableUser = (overrides: Partial<Parameters<typeof scaleUserStats>[0]>) => ({
  level: 1,
  poolsMultiplier: 1,
  statsMultiplier: 1,
  curHealth: 0,
  maxHealth: 0,
  curStamina: 0,
  maxStamina: 0,
  curChakra: 0,
  maxChakra: 0,
  experience: 0,
  ...uniformCombatStats(0),
  ninjutsuMastery: 0,
  genjutsuMastery: 0,
  taijutsuMastery: 0,
  bukijutsuMastery: 0,
  bloodlineMastery: 0,
  sageMastery: 0,
  ...overrides,
});

const uniformCombatStats = (value: number) => ({
  offence: value,
  defence: value,
  strength: value,
  intelligence: value,
  willpower: value,
  speed: value,
});

/** The UserData rows seeded by data/ai.sql, as scaleUserStats inputs. */
const readSeededAiRows = () => {
  const sql = readFileSync(join(import.meta.dirname, "../../data/ai.sql"), "utf8");
  const rows: ReturnType<typeof makeScalableUser>[] = [];
  let columns: string[] | null = null;
  for (const line of sql.split("\n")) {
    if (line.startsWith("INSERT INTO `UserData`")) {
      columns = [...line.matchAll(/`(\w+)`/g)].slice(1).map((match) => match[1] ?? "");
    } else if (columns && line.startsWith("\t(")) {
      const values = [...line.matchAll(/NULL|'(?:[^'\\]|\\.)*'/g)].map((match) =>
        match[0] === "NULL" ? null : match[0].slice(1, -1),
      );
      const row = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
      const numeric = Object.fromEntries(
        Object.keys(makeScalableUser({})).map((key) => [key, Number(row[key] ?? 0)]),
      );
      rows.push(makeScalableUser({ ...numeric, statsMultiplier: numeric.statsMultiplier || 1 }));
    } else if (columns && line.trim() === "") {
      columns = null;
    }
  }
  return rows;
};

test("capUserStats caps every stat at the given rank, the user's own by default", () => {
  const { stats_cap, gens_cap, mastery_cap } = getUserCaps("GENIN");
  const over = () =>
    ({
      rank: "GENIN",
      offence: stats_cap + 1000,
      defence: 10,
      strength: gens_cap + 1000,
      speed: 10,
      intelligence: 10,
      willpower: 10,
      ninjutsuMastery: mastery_cap + 1000,
      genjutsuMastery: 10,
      taijutsuMastery: 10,
      bukijutsuMastery: 10,
      bloodlineMastery: 10,
      sageMastery: 10,
    }) as UserData;

  const own = over();
  capUserStats(own);
  expect([own.offence, own.strength, own.ninjutsuMastery]).toEqual([
    stats_cap,
    gens_cap,
    mastery_cap,
  ]);

  // Ranked plays everyone as an ELITE JONIN
  const ranked = over();
  capUserStats(ranked, "ELITE JONIN");
  expect([ranked.offence, ranked.strength, ranked.ninjutsuMastery]).toEqual([
    stats_cap + 1000,
    gens_cap + 1000,
    mastery_cap + 1000,
  ]);
});

test("canAssignExperience stays true while any assignable mastery is below its cap", () => {
  const { stats_cap, gens_cap, mastery_cap } = getUserCaps("JONIN");
  const statCapped = {
    rank: "JONIN" as const,
    offence: stats_cap,
    defence: stats_cap,
    strength: gens_cap,
    speed: gens_cap,
    intelligence: gens_cap,
    willpower: gens_cap,
    ninjutsuMastery: 450_000,
    genjutsuMastery: 450_000,
    taijutsuMastery: 450_000,
    bukijutsuMastery: 450_000,
  };
  // Every combat stat capped, masteries still have room: the Assign XP notice must show
  expect(canAssignExperience(statCapped)).toBe(true);

  // Only one mastery left with room is enough
  const oneMasteryLeft = {
    ...statCapped,
    ninjutsuMastery: mastery_cap,
    genjutsuMastery: mastery_cap,
    taijutsuMastery: mastery_cap,
  };
  expect(canAssignExperience(oneMasteryLeft)).toBe(true);

  // Everything capped, including masteries: nowhere to put experience
  expect(
    canAssignExperience({ ...oneMasteryLeft, bukijutsuMastery: mastery_cap }),
  ).toBe(false);

  // A single uncapped combat stat is enough as well
  expect(
    canAssignExperience({
      ...oneMasteryLeft,
      bukijutsuMastery: mastery_cap,
      speed: gens_cap - 1,
    }),
  ).toBe(true);
});
