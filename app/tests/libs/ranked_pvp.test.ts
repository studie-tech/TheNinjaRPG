import { describe, it, expect } from "vitest";
import {
  calculateLpEloChange,
  getRankedRadius,
  getRankedRank,
} from "@/libs/ranked_pvp";
import {
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_MIN_LP_GAIN,
  RANKED_QUEUE_MAX_WAIT_SECS,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";

const sanninThreshold = 950;
const sanninTopPlayersLP = [
  2000, 1800, 1600, 1400, 1300, 1200, 1100, 1050, 1000, sanninThreshold,
];

describe("getRankedRank", () => {
  it("requires a full Legend top-10 set before awarding Sannin", () => {
    expect(getRankedRank(2000, [])).toBe("Legend");
    expect(
      getRankedRank(2000, sanninTopPlayersLP.slice(0, RANKED_SANNIN_TOP_PLAYERS - 1)),
    ).toBe("Legend");
  });

  it("awards Sannin only to Legends at or above the 10th Legend LP", () => {
    expect(getRankedRank(sanninThreshold, sanninTopPlayersLP)).toBe("Sannin");
    expect(getRankedRank(sanninThreshold - 1, sanninTopPlayersLP)).toBe("Legend");
    expect(getRankedRank(RANKED_LEGEND_LP_REQUIREMENT - 1, sanninTopPlayersLP)).toBe(
      "Master",
    );
  });
});

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

  it("applies rank-diff LP when a Legend beats a Sannin", () => {
    const withoutSanninContext = calculateLpEloChange(
      { rankedLp: RANKED_LEGEND_LP_REQUIREMENT, rankedStreak: 0 },
      { rankedLp: 2000 },
      true,
      [],
    );
    const withSanninContext = calculateLpEloChange(
      { rankedLp: RANKED_LEGEND_LP_REQUIREMENT, rankedStreak: 0 },
      { rankedLp: 2000 },
      true,
      sanninTopPlayersLP,
    );
    expect(withoutSanninContext).toBe(RANKED_MIN_LP_GAIN);
    expect(withSanninContext).toBeGreaterThan(withoutSanninContext);
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
