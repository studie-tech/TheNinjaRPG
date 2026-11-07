import { describe, expect, it } from "bun:test";
import { CLAN_BOOST_CONFIG, CLAN_BOOST_PERCENT_PER_LEVEL } from "@/drizzle/constants";
import { getClanBoost, getClanBoostCost, getClanBoostLevel } from "@/libs/clanBoost";

describe("getClanBoost", () => {
  const clan = { craftingExpBoost: 20 };

  it("reads the stored percentage as a fraction", () => {
    expect(getClanBoost({ isOutlaw: false, clan }, "craftingExpBoost")).toBe(0.2);
  });

  it("grants outlaw factions nothing", () => {
    expect(getClanBoost({ isOutlaw: true, clan }, "craftingExpBoost")).toBe(0);
  });

  it("is zero without a clan or a user", () => {
    expect(getClanBoost({ isOutlaw: false, clan: null }, "craftingExpBoost")).toBe(0);
    expect(getClanBoost(undefined, "craftingExpBoost")).toBe(0);
  });
});

describe("getClanBoostCost", () => {
  it("adds the per-level price for every purchased level", () => {
    const { baseCost, perLevelCost } = CLAN_BOOST_CONFIG.ryoBoost;
    const twoLevels = CLAN_BOOST_PERCENT_PER_LEVEL * 2;
    expect(getClanBoostLevel(twoLevels)).toBe(2);
    expect(getClanBoostCost("ryoBoost", 0)).toBe(baseCost);
    expect(getClanBoostCost("ryoBoost", twoLevels)).toBe(baseCost + 2 * perLevelCost);
  });
});
