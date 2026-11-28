import { describe, expect, it } from "bun:test";
import { type LpcCatalog, spriteBodyPartMasks } from "@/libs/lpc/catalog";
import type { SpriteLayer } from "@/validators/lpc";
import { lpcBodyParts } from "@/validators/lpcAsset";

const design = (
  category: LpcCatalog["designs"][string]["category"],
  replacesBodyParts: (typeof lpcBodyParts)[number][],
): LpcCatalog["designs"][string] => ({
  category,
  replacesBodyParts,
  replacementSlots: [],
  defaultColor: "gray",
  defaultEyes: "blue",
});
const catalog: LpcCatalog = {
  entries: {},
  layouts: [],
  designs: {
    body: design("body", [...lpcBodyParts]),
    pants: design("equipment", ["hips", "legs"]),
    legarmour: design("equipment", ["legs"]),
    shirt: design("equipment", ["torso", "upper-arms", "lower-arms"]),
    plate: design("equipment", ["torso", "upper-arms", "lower-arms"]),
    bracers: design("equipment", ["lower-arms"]),
    belt: design("equipment", []),
  },
};
const selection = (profile: string, slot?: string): SpriteLayer => ({
  profile,
  color: "gray",
  ...(slot ? { slot } : {}),
});

describe("modular body sections", () => {
  it("replaces pants legs with armour while retaining their hips and the body's uncovered hands", () => {
    const body = selection("body"),
      pants = selection("pants", "legs"),
      armour = selection("legarmour");
    const masks = spriteBodyPartMasks(catalog, [body, pants, armour]);
    expect([...masks.get(body)!]).toEqual([5, 6]);
    expect(masks.get(pants)?.has(5)).toBe(false);
    expect(masks.get(pants)?.has(6)).toBe(true);
    expect(masks.get(armour)?.has(6)).toBe(false);
    expect(masks.get(body)?.has(4)).toBe(false);
  });
  it("keeps specific worn bracers over a full upper outfit regardless of their order", () => {
    const body = selection("body"),
      plate = selection("plate"),
      bracers = selection("bracers");
    for (const layers of [
      [body, plate, bracers],
      [bracers, body, plate],
    ]) {
      const masks = spriteBodyPartMasks(catalog, layers);
      expect(masks.get(plate)?.has(3)).toBe(true);
      expect(masks.get(plate)?.has(1)).toBe(false);
      expect(masks.get(bracers)?.has(3)).toBe(false);
    }
  });
  it("keeps worn outfits above default clothing and leaves accessories outside the replacement rules", () => {
    const plate = selection("plate"),
      shirt = selection("shirt", "shirt"),
      belt = selection("belt");
    const masks = spriteBodyPartMasks(catalog, [plate, shirt, belt]);
    expect([...masks.get(shirt)!]).toEqual([1, 2, 3]);
    expect(masks.get(plate)?.has(1)).toBe(false);
    expect(masks.get(belt)?.has(0)).toBe(false);
  });
});
