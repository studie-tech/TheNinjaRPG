import { describe, expect, it } from "bun:test";
import { CRAFTING_REQUIRED_EXP } from "@/drizzle/constants";
import {
  formatCraftingRank,
  getCraftingRank,
  getImbueBlockedMessage,
  getImbuementRankCapMessage,
  getMissingCraftingRank,
} from "@/libs/crafting";

describe("getMissingCraftingRank", () => {
  // Crafting experience at the Apprentice rank
  const apprentice = getCraftingRank(1_175_305);

  it("treats 1,175,305 crafting experience as Apprentice", () => {
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
  it("explains the rank cap for an Apprentice on a 2-slot item", () => {
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

describe("getImbueBlockedMessage", () => {
  it("names the Apprentice rank and its experience for Novices", () => {
    const message = getImbueBlockedMessage("NOVICE", 2, 2, 2);
    expect(message).toContain("Apprentice rank");
    expect(message).toContain(
      CRAFTING_REQUIRED_EXP.APPRENTICE.toLocaleString("en-US"),
    );
  });

  it("points at the Can be Imbued property when no owned item has it", () => {
    expect(getImbueBlockedMessage("APPRENTICE", 0, 0, 2)).toContain("Can be Imbued");
  });

  it("reports the crystal cap ahead of missing crystals", () => {
    expect(getImbueBlockedMessage("APPRENTICE", 3, 0, 0)).toContain("crystal cap");
  });

  it("reports missing crystals when an item can still take one", () => {
    expect(getImbueBlockedMessage("APPRENTICE", 3, 1, 0)).toContain("no crystals");
  });

  it("stays silent when an item and a crystal are available", () => {
    expect(getImbueBlockedMessage("APPRENTICE", 3, 1, 1)).toBeNull();
  });
});
