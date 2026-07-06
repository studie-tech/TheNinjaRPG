import { describe, it, expect } from "vitest";
import {
  calculateLpEloChange,
  getRankedRadius,
  validateJutsuLoadout,
} from "@/libs/ranked_pvp";
import {
  JUTSU_MAX_FORBIDDEN_EQUIPPED,
  JUTSU_MAX_SHIELD_EQUIPPED,
  RANKED_MIN_LP_GAIN,
  RANKED_QUEUE_MAX_WAIT_SECS,
} from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";

describe("calculateLpEloChange", () => {
  it("floors a win to RANKED_MIN_LP_GAIN when the raw Elo gain is below it", () => {
    // High-rated player beats a far lower-rated opponent: raw gain rounds to ~0.
    const lp = calculateLpEloChange(
      { rankedLp: 900, rankedStreak: 0 },
      { rankedLp: 100 },
      true,
      [],
    );
    expect(lp).toBe(RANKED_MIN_LP_GAIN);
  });

  it("does not lower a win that already exceeds the floor", () => {
    // Low-rated player beats a far higher-rated opponent: large gain + rank bonus.
    const lp = calculateLpEloChange(
      { rankedLp: 100, rankedStreak: 0 },
      { rankedLp: 900 },
      true,
      [],
    );
    expect(lp).toBeGreaterThan(RANKED_MIN_LP_GAIN);
  });

  it("does not floor a loss (stays negative)", () => {
    const lp = calculateLpEloChange(
      { rankedLp: 900, rankedStreak: 0 },
      { rankedLp: 100 },
      false,
      [],
    );
    expect(lp).toBeLessThan(0);
  });
});

describe("getRankedRadius", () => {
  it("widens with wait time below the max wait", () => {
    expect(getRankedRadius(0)).toBe(50);
    expect(getRankedRadius(59)).toBe(50);
    expect(getRankedRadius(60)).toBe(100);
    expect(getRankedRadius(120)).toBe(150);
    expect(getRankedRadius(180)).toBe(200);
    expect(getRankedRadius(240)).toBe(250);
    expect(getRankedRadius(RANKED_QUEUE_MAX_WAIT_SECS - 1)).toBe(250);
  });

  it("ignores rank (Infinity radius) once the max wait is reached", () => {
    expect(getRankedRadius(RANKED_QUEUE_MAX_WAIT_SECS)).toBe(Infinity);
    expect(getRankedRadius(600)).toBe(Infinity);
    expect(getRankedRadius(5000)).toBe(Infinity);
  });
});

describe("validateJutsuLoadout", () => {
  it("rejects ranked loadouts with more than two shield jutsu", () => {
    const jutsus = Array.from({ length: JUTSU_MAX_SHIELD_EQUIPPED + 1 }, (_, i) =>
      ({
        id: `shield${i}`,
        jutsuType: "NORMAL",
        effects: [{ type: "shield" }],
      }) as Jutsu,
    );

    const result = validateJutsuLoadout(jutsus);

    expect(result.check).toBe(false);
    expect(result.message).toMatch(/up to 2 shield jutsu/);
  });

  it("rejects ranked loadouts with more than one forbidden jutsu", () => {
    const jutsus = Array.from({ length: JUTSU_MAX_FORBIDDEN_EQUIPPED + 1 }, (_, i) =>
      ({
        id: `forbidden${i}`,
        jutsuType: "FORBIDDEN",
        effects: [],
      }) as Jutsu,
    );

    const result = validateJutsuLoadout(jutsus);

    expect(JUTSU_MAX_FORBIDDEN_EQUIPPED).toBe(1);
    expect(result.check).toBe(false);
    expect(result.message).toMatch(/up to 1 forbidden jutsu/);
  });
});
