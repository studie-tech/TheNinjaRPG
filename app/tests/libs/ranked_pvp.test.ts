import { rankedCaps } from "../setup/jutsuEquipLimits";
import { describe, it, expect } from "bun:test";
import {
  calculateLpEloChange,
  getRankedRadius,
  getRankedRank,
  validateItemLoadout,
  validateJutsuLoadout as validateJutsuLoadoutWithCaps,
} from "@/libs/ranked_pvp";
import type { Item, Jutsu } from "@/drizzle/schema";
import {
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_LOSS_PROTECTION_RANK_GAP,
  RANKED_MIN_LP_GAIN,
  RANKED_QUEUE_MAX_WAIT_SECS,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";

const sanninThreshold = 950;
const sanninTopPlayersLP = [
  2000,
  1800,
  1600,
  1400,
  1300,
  1200,
  1100,
  1050,
  1000,
  sanninThreshold,
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

  it("adds the upset bonus per rank when a lower rank wins", () => {
    // Wood beats Master: Elo 37.2 plus two ranks of upset bonus
    expect(
      calculateLpEloChange(
        { rankedLp: 150, rankedStreak: 0 },
        { rankedLp: 600 },
        true,
        [],
      ),
    ).toBe(57);
  });

  describe("loss protection", () => {
    const loss = (playerLp: number, opponentLp: number) =>
      calculateLpEloChange(
        { rankedLp: playerLp, rankedStreak: 0 },
        { rankedLp: opponentLp },
        false,
        [],
      );

    it("softens a loss to an opponent exactly the protection gap above the loser", () => {
      expect(RANKED_LOSS_PROTECTION_RANK_GAP).toBe(2);
      // Wood loses to Master: Elo -6.0 halved
      expect(loss(299, 600)).toBe(-3);
      // Adept loses to Legend: Elo -4.8 halved
      expect(loss(599, 900)).toBe(-2);
    });

    it("softens a loss to an opponent more than the protection gap above the loser", () => {
      // Unranked loses to Master: Elo -2.8 halved
      expect(loss(149, 600)).toBe(-1);
    });

    it("keeps the full loss to an opponent one rank above the loser", () => {
      // Wood loses to Adept, Adept loses to Master
      expect(loss(299, 300)).toBe(-20);
      expect(loss(300, 600)).toBe(-5);
    });

    it("keeps the full loss to an opponent ranked below the loser", () => {
      // Master loses to Adept (one rank below) and to Wood (two ranks below)
      expect(loss(600, 300)).toBe(-20);
      expect(loss(600, 299)).toBe(-20);
    });
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

  it("keeps step boundaries and the smallest radius for a skewed negative wait", () => {
    expect(getRankedRadius(119)).toBe(100);
    expect(getRankedRadius(239)).toBe(200);
    expect(getRankedRadius(-1)).toBe(50);
    expect(getRankedRadius(-120)).toBe(50);
  });

  it("ignores rank (Infinity radius) once the max wait is reached", () => {
    expect(getRankedRadius(RANKED_QUEUE_MAX_WAIT_SECS)).toBe(Infinity);
    expect(getRankedRadius(600)).toBe(Infinity);
    expect(getRankedRadius(5000)).toBe(Infinity);
  });
});

describe("ranked jutsu category caps", () => {
  it("allows one Parry jutsu and rejects a second", () => {
    const parryJutsus = ["first", "second"].map(
      (name) =>
        ({
          name,
          jutsuType: "NORMAL",
          effects: [{ type: "parry" }],
        }) as Jutsu,
    );

    expect(validateJutsuLoadout(parryJutsus.slice(0, 1))).toEqual({
      check: true,
      message: "",
    });
    expect(validateJutsuLoadout(parryJutsus)).toEqual({
      check: false,
      message: "You can only equip up to 1 parry jutsu in ranked PvP",
    });
  });
});

describe("ranked skill-tree restrictions", () => {
  it("rejects furniture selected through a crafted ranked loadout", () => {
    const result = validateItemLoadout([
      { name: "Chair", itemType: "FURNITURE", effects: [] } as unknown as Item,
    ]);
    expect(result.check).toBe(false);
    expect(result.message).toMatch(/Chair.*cannot be equipped in ranked PvP/);
  });

  it("rejects any jutsu with a required skill, even when that skill is active", () => {
    const result = validateJutsuLoadout([
      { name: "Skill Jutsu", requiredSkillId: "skill-1" } as Jutsu,
    ]);

    expect(result.check).toBe(false);
    expect(result.message).toMatch(/requires a skill tree entry/);
  });

  it("rejects any item with a required skill", () => {
    const result = validateItemLoadout([
      { name: "Skill Item", requiredSkillId: "skill-1" } as Item,
    ]);

    expect(result.check).toBe(false);
    expect(result.message).toMatch(/requires a skill tree entry/);
  });

  it("rejects any item with a bloodline requirement", () => {
    const result = validateItemLoadout([
      { name: "Bloodline Item", bloodlineId: "bl-1" } as Item,
    ]);

    expect(result.check).toBe(false);
    expect(result.message).toMatch(/requires a bloodline/);
  });

  it("rejects any PVE-only jutsu", () => {
    const result = validateJutsuLoadout([
      { name: "PVE Jutsu", battleUsageType: "PVE" } as Jutsu,
    ]);

    expect(result.check).toBe(false);
    expect(result.message).toMatch(/PVE-only/);
  });

  it("rejects any village-gated jutsu", () => {
    const result = validateJutsuLoadout([
      { name: "Village Jutsu", villageId: "village-1" } as Jutsu,
    ]);

    expect(result.check).toBe(false);
    expect(result.message).toMatch(/requires a village/);
  });
});

const validateJutsuLoadout = (
  jutsus: Parameters<typeof validateJutsuLoadoutWithCaps>[0],
) => validateJutsuLoadoutWithCaps(jutsus, rankedCaps);
