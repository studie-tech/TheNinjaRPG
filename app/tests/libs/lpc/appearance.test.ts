import { describe, expect, it } from "bun:test";
import { ItemSlotTypes, WeaponTypes } from "@/drizzle/constants";
import { anonymousSpriteAppearance, inferItemProfile, resolveItemSprite, resolveSpriteAppearance, resolveSpriteEquipment, withSpriteEquipment } from "@/libs/lpc/appearance";
import { spriteLayerSheets } from "@/libs/lpc/catalog";
import mappings from "@/libs/lpc/content.json";
import { attributes, colors, skin_colors } from "@/validators/register";
import { lpcColors, lpcEquipmentProfiles } from "@/validators/lpc";

describe("character appearances", () => {
  it("bundles every silhouette and palette offered by the equipment editors", () => {
    for (const profile of lpcEquipmentProfiles) {
      if (profile === "AUTO" || profile === "NONE") continue;
      for (const body of ["male", "female"] as const) for (const color of lpcColors)
        expect(spriteLayerSheets({ version: 1, body, layers: [] }, { profile, color }).length).toBeGreaterThan(0);
    }
  });
  it("covers every persisted creation trait and colour on both body styles", () => {
    for (const spriteBodyStyle of ["male", "female"] as const) for (const trait of attributes) for (const color of colors) for (const skin of skin_colors) {
      const appearance = resolveSpriteAppearance({ spriteBodyStyle, attributes: [trait, `${color} Hair`, `${color} Eyes`, `${skin} Skin`] });
      for (const layer of appearance.layers) expect(spriteLayerSheets(appearance, layer).length).toBeGreaterThan(0);
    }
  });
  it("keeps body style independent of gender and resolves legacy conflicting hair choices consistently", () => {
    const appearance = resolveSpriteAppearance({ gender: "Other", spriteBodyStyle: "female", attributes: ["Bald", "Long Hair", "Short Hair", "Long Beard", "Full Beard"] });
    expect(appearance.body).toBe("female");
    expect(appearance.layers.some((layer) => layer.profile.startsWith("hair-"))).toBe(false);
    expect(appearance.layers.filter((layer) => layer.profile.startsWith("beard-")).map((layer) => layer.profile)).toEqual(["beard-long"]);
  });
  it("maps the complete content catalogue to bundled art or an explicit non-wearable result", () => {
    expect(Object.keys(mappings).length).toBe(602);
    for (const [id, entry] of Object.entries(mappings)) {
      const visual = resolveItemSprite({ id });
      expect(visual.profile).toBe(entry.profile);
      if (visual.profile === "NONE") continue;
      for (const body of ["male", "female"] as const) expect(spriteLayerSheets({ version: 1, body, layers: [] }, visual).length).toBeGreaterThan(0);
    }
  });
  it("defines all weapon families and catalog slots for newly authored content", () => {
    for (const weaponType of WeaponTypes) expect(inferItemProfile({ itemType: "WEAPON", slot: "HAND", weaponType })).not.toBe("NONE");
    for (const slot of ItemSlotTypes) expect(inferItemProfile({ itemType: "ARMOR", slot })).toBeTruthy();
    expect(inferItemProfile({ itemType: "FURNITURE", slot: "CHEST" })).toBe("NONE");
  });
  it("uses selected variants and staff overrides, and restores creation clothing after unequipping", () => {
    const item = { id: "custom", itemType: "ARMOR", slot: "CHEST", lpcProfile: "plate", lpcColor: "blue" as const, variants: [{ id: "red", name: "Crimson", lpcProfile: "leather", lpcColor: "red" as const }] };
    const gear = [{ id: "copy", item, equipped: "CHEST", activeVariantId: "red", quantity: 1 }];
    const base = resolveSpriteAppearance({ attributes: ["Long Hair"] });
    const equipment = resolveSpriteEquipment(gear);
    const dressed = withSpriteEquipment(base, Object.values(equipment));
    expect(dressed.layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "leather", color: "red" });
    expect(withSpriteEquipment(base, []).layers.find((layer) => layer.slot === "shirt")?.profile).toBe("shirt");
    expect(resolveSpriteAppearance({ items: gear.map((row) => ({ ...row, equipped: "NONE" })) })).toEqual(resolveSpriteAppearance({}));
    expect(resolveSpriteAppearance({ items: gear.map((row) => ({ ...row, quantity: 0 })) })).toEqual(resolveSpriteAppearance({}));
    expect(resolveSpriteAppearance({ items: gear.map((row) => ({ ...row, isInAuction: true })) })).toEqual(resolveSpriteAppearance({}));
  });
  it("gives anonymous fighters a uniform independent of their own attributes and equipment", () => {
    expect(anonymousSpriteAppearance()).not.toEqual(anonymousSpriteAppearance(true));
    for (const appearance of [anonymousSpriteAppearance(), anonymousSpriteAppearance(true)]) {
      expect(appearance.layers.some((layer) => layer.profile.startsWith("hair-") || layer.mirror)).toBe(false);
      for (const layer of appearance.layers) expect(spriteLayerSheets(appearance, layer).length).toBeGreaterThan(0);
    }
  });
});
