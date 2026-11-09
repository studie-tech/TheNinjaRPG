import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CombatStatNames,
  getUserCaps,
  MAX_MASTERY_CAP,
  MAX_STORED_POOL,
  RANKED_PVP_STATS,
  SCALED_AI_STAT_BUDGET_SHARE,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  calcActiveUserRegen,
  calcLevel,
  calcLevelRequirements,
  canAssignExperience,
  canAttackBracket,
  capUserStats,
  clampStoredPools,
  experienceToNextLevel,
  formatPvpWinRate,
  getAssignedCombatStatTotal,
  getExpBracket,
  getPvpWinRate,
  getScoutingUsers,
  levelExperienceProgress,
  manuallyAssignUserStats,
  passesBracketFilter,
  scaleUserStats,
  unassignedExperienceTowardLevel,
} from "@/libs/profile";
import type { SectorUser } from "@/libs/sector-map/world-types";

test("calcLevel lags stored level: the experience that leaves level L still derives L", () => {
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

describe("getScoutingUsers", () => {
  type ScoutingUser = Pick<
    SectorUser,
    "userId" | "username" | "experience" | "rank" | "status" | "isNpc" | "level"
  >;
  const makeUser = (
    username: string,
    level: number,
    patch: Partial<ScoutingUser> = {},
  ): ScoutingUser => ({
    userId: username,
    username,
    experience: calcLevelRequirements(level),
    level,
    rank: "JONIN",
    status: "AWAKE",
    ...patch,
  });

  it("sorts exact displayed levels ascending when the bracket filter is off", () => {
    const users = [
      makeUser("First", 50),
      makeUser("Last", 10, { level: 100 }),
      makeUser("Middle", 31),
      makeUser("Lower", 30),
    ];

    expect(getScoutingUsers(users, "self", -1).map((user) => user.username)).toEqual([
      "Last",
      "Lower",
      "Middle",
      "First",
    ]);
  });

  it("orders equal levels by username rather than their experience", () => {
    const users = [
      makeUser("Zeta", 30),
      makeUser("Alpha", 30, { experience: calcLevelRequirements(30) + 1 }),
    ];

    expect(getScoutingUsers(users, "self", -1).map((user) => user.username)).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });

  it("retains the awake-player and exact-bracket filters", () => {
    const users = [
      makeUser("High", 90),
      makeUser("Low", 10),
      makeUser("self", 1),
      makeUser("Sleeping", 1, { status: "ASLEEP" }),
      makeUser("Fighting", 1, { status: "BATTLE" }),
      makeUser("Npc", 1, { isNpc: true }),
      makeUser("Unknown", 1, { experience: undefined }),
      makeUser("Other bracket", 1, { experience: 500_001 }),
    ];

    expect(getScoutingUsers(users, "self", 1).map((user) => user.username)).toEqual([
      "Low",
    ]);
  });

  it("retains rank-restricted bracket zero", () => {
    const users = [
      makeUser("Jonin", 10),
      makeUser("Genin", 10, { rank: "GENIN" }),
      makeUser("Student", 1, { rank: "STUDENT" }),
    ];

    expect(getScoutingUsers(users, "self", 0).map((user) => user.username)).toEqual([
      "Student",
      "Genin",
    ]);
  });

  it("places unknown levels last and sorts them by username", () => {
    const users = [
      makeUser("Unknown Z", 1, { experience: undefined }),
      makeUser("Known", 100),
      makeUser("Unknown A", 1, { experience: undefined }),
    ];

    expect(getScoutingUsers(users, "self", -1).map((user) => user.username)).toEqual([
      "Known",
      "Unknown A",
      "Unknown Z",
    ]);
  });

  it("preserves the source array and player objects", () => {
    const high = Object.freeze(makeUser("High", 50));
    const low = Object.freeze(makeUser("Low", 10));
    const users = Object.freeze([high, low]);

    const sorted = getScoutingUsers(users, "self", -1);

    expect(sorted).toEqual([low, high]);
    expect(users).toEqual([high, low]);
    expect(sorted[0]).toBe(low);
    expect(sorted[1]).toBe(high);
    expect(getScoutingUsers([], "self", -1)).toEqual([]);
  });
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
] as const)(
  "scaleUserStats spreads the %s budget evenly over base stats",
  (statScale, expected) => {
    // A new AI or character: every stat at the base 10 and no experience.
    const fresh = makeScalableUser({ level: 10, ...uniformCombatStats(10) });
    scaleUserStats(fresh, statScale);
    expect(fresh.offence).toBe(expected);
    expect(fresh.speed).toBe(expected);
    expect(fresh.ninjutsuMastery).toBe(10);
  },
);

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

test("scaleUserStats keeps saved seeded AI rows fixed and spreads unsaved ones over the AI budget", () => {
  const rows = readSeededAiRows();
  expect(rows).toHaveLength(100);
  for (const row of rows) {
    const budget = calcLevelRequirements(row.level) - 500;
    const stored = { ...row };
    scaleUserStats(row, "ai");
    for (const stat of CombatStatNames) {
      if (stored.experience === budget) {
        // Saved at its level: a fixed point, up to the 2-decimal rounding of stat / multiplier.
        expect(Math.abs(row[stat] - stored[stat])).toBeLessThanOrEqual(
          0.005 * row.statsMultiplier + 1e-6,
        );
      } else {
        // Never saved: the AI budget share spread evenly over the six combat stats.
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
  const earned = CombatStatNames.reduce((sum, stat) => sum + created[stat] - 10, 0);
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

test("capUserStats caps every stat at the given rank, the user's own by default", () => {
  const { stats_cap, gens_cap } = getUserCaps("GENIN");
  const over = () =>
    ({
      rank: "GENIN",
      offence: stats_cap + 1000,
      defence: 10,
      strength: gens_cap + 1000,
      speed: 10,
      intelligence: 10,
      willpower: 10,
      ninjutsuMastery: MAX_MASTERY_CAP + 1000,
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
    MAX_MASTERY_CAP,
  ]);

  // Ranked plays everyone as an ELITE JONIN
  const ranked = over();
  capUserStats(ranked, "ELITE JONIN");
  expect([ranked.offence, ranked.strength, ranked.ninjutsuMastery]).toEqual([
    stats_cap + 1000,
    gens_cap + 1000,
    MAX_MASTERY_CAP,
  ]);
});

test("canAssignExperience stays true while any assignable mastery is below its cap", () => {
  const { stats_cap, gens_cap } = getUserCaps("JONIN");
  const statCapped = {
    rank: "JONIN" as const,
    bloodlineMastery: 0,
    sageMastery: 0,
    masteryRanks: {},
    offence: stats_cap,
    defence: stats_cap,
    strength: gens_cap,
    speed: gens_cap,
    intelligence: gens_cap,
    willpower: gens_cap,
    ninjutsuMastery: 300_000,
    genjutsuMastery: 300_000,
    taijutsuMastery: 300_000,
    bukijutsuMastery: 300_000,
  };
  // Every combat stat capped, masteries still have room: the Assign XP notice must show
  expect(canAssignExperience(statCapped)).toBe(true);

  // Only one mastery left with room is enough
  const oneMasteryLeft = {
    ...statCapped,
    ninjutsuMastery: 375_000,
    genjutsuMastery: 375_000,
    taijutsuMastery: 375_000,
  };
  expect(canAssignExperience(oneMasteryLeft)).toBe(true);

  // Everything capped, including masteries: nowhere to put experience
  expect(canAssignExperience({ ...oneMasteryLeft, bukijutsuMastery: 375_000 })).toBe(
    false,
  );

  // A single uncapped combat stat is enough as well
  expect(
    canAssignExperience({
      ...oneMasteryLeft,
      bukijutsuMastery: 375_000,
      speed: gens_cap - 1,
    }),
  ).toBe(true);
});

describe("levelExperienceProgress", () => {
  const start = calcLevelRequirements(4);
  const span = calcLevelRequirements(5) - start;

  it("measures from the start of the level", () => {
    expect(levelExperienceProgress({ level: 5, experience: start + span / 2 })).toEqual(
      { earned: span / 2, required: span, percent: 50 },
    );
  });

  it("starts level 1 at zero experience", () => {
    expect(levelExperienceProgress({ level: 1, experience: 0 })).toEqual({
      earned: 0,
      required: calcLevelRequirements(1),
      percent: 0,
    });
  });

  it("stays inside the level when stored level and experience disagree", () => {
    expect(levelExperienceProgress({ level: 5, experience: start - 1 }).percent).toBe(
      0,
    );
    expect(levelExperienceProgress({ level: 5, experience: start + span * 2 })).toEqual(
      { earned: span, required: span, percent: 100 },
    );
  });

  it("leaves the same experience to go as the level-up rule", () => {
    const user = { level: 5, experience: start + 10 };
    const { earned, required } = levelExperienceProgress(user);
    expect(required - earned).toBe(experienceToNextLevel(user));
  });
});

describe("unassignedExperienceTowardLevel", () => {
  const user = {
    rank: "GENIN" as const,
    level: 12,
    experience: calcLevelRequirements(12) - 1,
    earnedExperience: 1234.5,
    village: { name: "Akikaze" },
    masteryRanks: {},
    offence: 100,
    defence: 100,
    strength: 100,
    speed: 100,
    intelligence: 100,
    willpower: 100,
    ninjutsuMastery: 0,
    genjutsuMastery: 0,
    taijutsuMastery: 0,
    bukijutsuMastery: 0,
    bloodlineMastery: 0,
    sageMastery: 0,
  };

  test("returns whole points while the bar still has room", () => {
    expect(unassignedExperienceTowardLevel(user)).toBe(1234);
  });

  test("is zero without unassigned experience", () => {
    expect(unassignedExperienceTowardLevel({ ...user, earnedExperience: 0 })).toBe(0);
  });

  test("is zero once the level is already reachable", () => {
    expect(
      unassignedExperienceTowardLevel({
        ...user,
        experience: calcLevelRequirements(12),
      }),
    ).toBe(0);
  });

  test("is zero when assigning cannot lead to a level", () => {
    const { lvl_cap } = getUserCaps("GENIN");
    const atRankCap = {
      ...user,
      level: lvl_cap,
      experience: calcLevelRequirements(lvl_cap) - 1,
    };
    expect(unassignedExperienceTowardLevel(atRankCap)).toBe(0);
    expect(
      unassignedExperienceTowardLevel({ ...user, village: { name: "Horizon" } }),
    ).toBe(0);
    expect(unassignedExperienceTowardLevel({ ...user, rank: "ELITE JONIN" })).toBe(0);
  });
});

describe("PvP win rate", () => {
  it("is a percentage of fights, or 0 before the first fight", () => {
    expect(getPvpWinRate(3, 1)).toBe(75);
    expect(getPvpWinRate(0, 0)).toBe(0);
  });

  it("shows one decimal, or a bare 0 before the first fight", () => {
    expect(formatPvpWinRate(1, 2)).toBe("33.3");
    expect(formatPvpWinRate(3, 1)).toBe("75.0");
    expect(formatPvpWinRate(0, 0)).toBe("0");
    expect(formatPvpWinRate(0, 5)).toBe("0.0");
  });
});

/** A scaleUserStats input with every stat and pool at zero unless overridden. */
const makeScalableUser = (
  overrides: Partial<Parameters<typeof scaleUserStats>[0]>,
) => ({
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
      rows.push(
        makeScalableUser({ ...numeric, statsMultiplier: numeric.statsMultiplier || 1 }),
      );
    } else if (columns && line.trim() === "") {
      columns = null;
    }
  }
  return rows;
};

test("clampStoredPools caps the six pool fields and leaves lower values", () => {
  const over = MAX_STORED_POOL + 1;
  const user = {
    curHealth: over,
    maxHealth: over,
    curStamina: over,
    maxStamina: over,
    curChakra: 5,
    maxChakra: over,
  } as UserData;
  clampStoredPools(user);
  expect(user).toEqual({
    curHealth: MAX_STORED_POOL,
    maxHealth: MAX_STORED_POOL,
    curStamina: MAX_STORED_POOL,
    maxStamina: MAX_STORED_POOL,
    curChakra: 5,
    maxChakra: MAX_STORED_POOL,
  } as UserData);
});

describe("calcActiveUserRegen clan boost", () => {
  const maxBoost = CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL;
  const regen = (clan: { regenBoost: number } | null, isOutlaw = false) =>
    calcActiveUserRegen(
      {
        regeneration: 100,
        status: "AWAKE",
        homeType: "NONE",
        isOutlaw,
        rank: "STUDENT",
        joinedVillageAt: new Date(0),
        clan,
      } as unknown as Parameters<typeof calcActiveUserRegen>[0],
      [],
    );

  it("applies a boost within the clan's maximum to members only", () => {
    expect(regen({ regenBoost: maxBoost })).toBeCloseTo(100 + maxBoost);
    expect(regen({ regenBoost: maxBoost }, true)).toBe(100);
  });

  it.each([
    [null],
    [{ regenBoost: 0 }],
    [{ regenBoost: -1 }],
    [{ regenBoost: maxBoost + 1 }],
  ])("ignores %j", (clan) => {
    expect(regen(clan)).toBe(100);
  });
});
