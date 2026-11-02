import { describe, expect, it } from "bun:test";
import { CRAFTING_REQUIRED_EXP } from "@/drizzle/constants";
import {
  formatCraftingRank,
  getCraftingRank,
  getImbuementRankCapMessage,
  getMissingCraftingRank,
} from "@/libs/crafting";

describe("getMissingCraftingRank", () => {
  // Experience of the support-ticket player (Apprentice crafter)
  const apprentice = getCraftingRank(1_175_305);

  it("treats the ticket player as an Apprentice", () => {
    expect(apprentice).toBe("APPRENTICE");
  });

  it.each([
    { rarity: "EPIC", rank: "MASTER" },
    { rarity: "LEGENDARY", rank: "FORGEMASTER" },
  ] as const)("requires $rank for Apprentice $rarity gear", ({ rarity, rank }) => {
    expect(getMissingCraftingRank({ itemType: "ARMOR", rarity }, apprentice)).toBe(
      rank,
    );
    expect(getMissingCraftingRank({ itemType: "WEAPON", rarity }, apprentice)).toBe(
      rank,
    );
  });

  it.each(["COMMON", "RARE"] as const)("allows Apprentice %s gear", (rarity) => {
    expect(getMissingCraftingRank({ itemType: "WEAPON", rarity }, apprentice)).toBe(
      null,
    );
  });

  it("requires Apprentice for Novice rare items", () => {
    expect(
      getMissingCraftingRank({ itemType: "WEAPON", rarity: "RARE" }, "NOVICE"),
    ).toBe("APPRENTICE");
  });

  it("allows Forgemasters to craft every rarity", () => {
    const rank = getCraftingRank(CRAFTING_REQUIRED_EXP.FORGEMASTER);
    for (const rarity of ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const) {
      expect(getMissingCraftingRank({ itemType: "ARMOR", rarity }, rank)).toBe(null);
    }
  });

  it("applies the rarity gate to consumables", () => {
    expect(
      getMissingCraftingRank({ itemType: "CONSUMABLE", rarity: "EPIC" }, apprentice),
    ).toBe("MASTER");
    expect(
      getMissingCraftingRank({ itemType: "CONSUMABLE", rarity: "RARE" }, apprentice),
    ).toBe(null);
  });

  it("never gates meals by crafting rank", () => {
    expect(
      getMissingCraftingRank({ itemType: "MEAL", rarity: "LEGENDARY" }, "NOVICE"),
    ).toBe(null);
  });
});

describe("formatCraftingRank", () => {
  it("formats rank names for display", () => {
    expect(formatCraftingRank("FORGEMASTER")).toBe("Forgemaster");
    expect(formatCraftingRank("UNKNOWN")).toBe("Unknown");
  });
});

describe("getImbuementRankCapMessage", () => {
  it("explains the rank cap for an Apprentice on a 2-slot item (ticket BU927m7MVb)", () => {
    expect(getImbuementRankCapMessage("APPRENTICE", 2, 1)).toBe(
      "1/2 imbuements: your crafting rank (Apprentice) allows 1. Reach Master to add another.",
    );
  });

  it("points Novices to Apprentice", () => {
    expect(getImbuementRankCapMessage("NOVICE", 2, 0)).toBe(
      "0/2 imbuements: your crafting rank (Novice) allows 0. Reach Apprentice to add another.",
    );
  });

  it("names the next rank that actually allows another crystal", () => {
    expect(getImbuementRankCapMessage("MASTER", 3, 2)).toContain(
      "Reach Forgemaster to add another.",
    );
  });

  it("stays quiet while the rank still allows another crystal", () => {
    expect(getImbuementRankCapMessage("APPRENTICE", 2, 0)).toBeNull();
  });

  it("stays quiet when the item itself is full", () => {
    expect(getImbuementRankCapMessage("APPRENTICE", 1, 1)).toBeNull();
    expect(getImbuementRankCapMessage("FORGEMASTER", 2, 2)).toBeNull();
  });
});
