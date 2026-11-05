import { describe, expect, it } from "bun:test";
import { getCraftingExperienceGain } from "@/libs/crafting";

describe("getCraftingExperienceGain", () => {
  const clan = { craftingExpBoost: 10 };

  it("adds the clan and territory boosts together", () => {
    expect(getCraftingExperienceGain(100, { clan }, 0.2, 0)).toBe(130);
  });

  it("gives outlaws no clan boost", () => {
    expect(getCraftingExperienceGain(100, { clan, isOutlaw: true }, 0.2, 0)).toBe(120);
  });

  it("applies the PvP boost on top and rounds down", () => {
    expect(getCraftingExperienceGain(101, { clan }, 0, 10)).toBe(122);
  });

  it("handles a viewer without a loaded user", () => {
    expect(getCraftingExperienceGain(50, undefined, 0, 0)).toBe(50);
  });
});
