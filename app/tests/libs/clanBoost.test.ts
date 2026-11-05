import { describe, expect, it } from "bun:test";
import { getClanBoost } from "@/libs/clanBoost";

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
