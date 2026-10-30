import { describe, expect, it } from "bun:test";
import { anonymousSpriteAppearance, resolveItemSprite, resolveSpriteAppearance, resolveSpriteEquipment, withSpriteEquipment } from "@/libs/lpc/appearance";
import { spriteLayerSheets } from "@/libs/lpc/catalog";
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
      for (const layer of appearance.layers) {
        expect(spriteLayerSheets(appearance, layer).length).toBeGreaterThan(0);
        if (layer.profile.startsWith("hair-") || layer.profile.startsWith("beard-"))
          expect(layer.color).toBe(color.toLowerCase().replace("blonde", "yellow"));
      }
    }
  });
  it("keeps body style independent of gender and resolves legacy conflicting hair choices consistently", () => {
    const appearance = resolveSpriteAppearance({ gender: "Other", spriteBodyStyle: "female", attributes: ["Bald", "Long Hair", "Short Hair", "Long Beard", "Full Beard"] });
    expect(appearance.body).toBe("female");
    expect(appearance.layers.some((layer) => layer.profile.startsWith("hair-"))).toBe(false);
    expect(appearance.layers.filter((layer) => layer.profile.startsWith("beard-")).map((layer) => layer.profile)).toEqual(["beard-long"]);
  });
  it("uses only saved appearance fields and inherits each variant field independently", () => {
    const item = { id: "unmapped", name: "Crimson Crown Katana", lpcProfile: "katana", lpcColor: "blue" as const };
    expect(resolveItemSprite(item)).toEqual({ profile: "katana", color: "blue" });
    expect(resolveItemSprite(item, { name: "Emerald", lpcColor: "red" })).toEqual({ profile: "katana", color: "red" });
    expect(resolveItemSprite(item, { lpcProfile: "sword" })).toEqual({ profile: "sword", color: "blue" });
    expect(resolveItemSprite(item, { lpcProfile: "AUTO" })).toEqual({ profile: "katana", color: "blue" });
    expect(resolveItemSprite(item, { lpcProfile: "NONE" })).toEqual({ profile: "NONE", color: "blue" });
    expect(resolveItemSprite({ name: item.name, slot: "HAND", weaponType: "SWORD" })).toEqual({ profile: "NONE", color: "gray" });
    expect(resolveItemSprite({ ...item, id: "renamed", name: "Gold Ring" })).toEqual(resolveItemSprite(item));
  });
  it("keeps clothing under accessories and replaces it only with covering garments", () => {
    for (const [slot, profile] of [["CHEST", "necklace"], ["CHEST", "cloak"], ["LEGS", "gem"], ["LEGS", "legarmour"], ["WAIST", "skirt"], ["FEET", "bracelet"], ["HEAD", "glasses"]]) {
      const appearance = resolveSpriteAppearance({ items: [{ equipped: slot, item: { lpcProfile: profile, lpcColor: "blue" } }] });
      expect(appearance.layers).toEqual(expect.arrayContaining([
        expect.objectContaining({ slot: "shirt", profile: "shirt" }),
        expect.objectContaining({ slot: "legs", profile: "pants" }),
        expect.objectContaining({ slot: "feet", profile: "sandals" }),
        expect.objectContaining({ slot, profile }),
      ]));
    }
    const appearance = resolveSpriteAppearance({ items: [{ equipped: "ITEM_1", item: { lpcProfile: "robe", lpcColor: "red" } }] });
    expect(appearance.layers.filter((layer) => layer.slot === "shirt")).toEqual([{ slot: "shirt", profile: "robe", color: "red" }]);
  });
  it("shows saved thrown equipment only while an owned copy remains", () => {
    const owned = { id: "kunai", equipped: "THROWN", quantity: 1, item: { itemType: "CONSUMABLE", lpcProfile: "dagger", lpcColor: "silver" as const } };
    expect(Object.values(resolveSpriteEquipment([owned]))).toEqual([{ slot: "THROWN", profile: "dagger", color: "silver" }]);
    expect(resolveSpriteEquipment([{ ...owned, quantity: 0 }])).toEqual({});
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
