import { describe, expect, it } from "bun:test";
import { ItemValidator } from "@/validators/combat";
import { itemCreateSchema } from "@/validators/item";
import {
  DEFAULT_FURNITURE_DATA,
  FURNITURE_ITEM_DEFAULTS,
  furnitureDataSchema,
  furnitureGeometrySchema,
  furnitureItemSchema,
  furnitureVariantDataSchema,
} from "@/validators/itemFurniture";

const furniture = {
  ...FURNITURE_ITEM_DEFAULTS,
  itemType: "FURNITURE",
  furnitureData: DEFAULT_FURNITURE_DATA,
  name: "Painted tea cabinet",
  image: "/images/home/furniture/table.webp",
  description: "A cabinet for the residence.",
  rarity: "COMMON",
  hidden: false,
  inShop: false,
  cost: 0,
  repsCost: 0,
  seichiSilverCost: 0,
  expireFromStoreAt: null,
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
};

describe("furniture item content", () => {
  it("validates visible art and floor footprints in normalized image coordinates", () => {
    const geometry = {
      aspectRatio: 0.75,
      visibleBounds: { x: 15, y: 10, width: 70, height: 80 },
      footprint: { x: 20, y: 70, width: 60, height: 20 },
    };
    expect(furnitureDataSchema.parse({ geometry }).geometry).toEqual(geometry);
    expect(furnitureVariantDataSchema.parse({ geometry }).geometry).toEqual(geometry);
    expect(
      furnitureDataSchema.parse({ views: { "90": { image: "/side.webp", geometry } } })
        .views["90"]?.geometry,
    ).toEqual(geometry);
    for (const invalid of [
      { ...geometry, aspectRatio: 0 },
      { ...geometry, visibleBounds: { ...geometry.visibleBounds, x: -1 } },
      { ...geometry, visibleBounds: { ...geometry.visibleBounds, width: 90 } },
      { ...geometry, footprint: { ...geometry.footprint, height: 31 } },
      { ...geometry, footprint: { ...geometry.footprint, width: 0 } },
      { ...geometry, footprint: { ...geometry.footprint, extra: true } },
    ])
      expect(furnitureGeometrySchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps directions optional while validating their images and per-view geometry", () => {
    const views = {
      "90": { image: "/furniture-90.webp", width: "18", groundAnchor: "85" },
    };
    expect(furnitureDataSchema.parse({ views }).views).toEqual({
      "90": { image: "/furniture-90.webp", width: 18, groundAnchor: 85 },
    });
    expect(furnitureVariantDataSchema.parse({})).toEqual({ views: {} });
    expect(
      furnitureVariantDataSchema.parse({ width: "18", groundAnchor: "85" }),
    ).toEqual({ width: 18, groundAnchor: 85, views: {} });
    for (const invalid of [
      { "90": { image: "" } },
      { "90": { image: "/piece.webp", width: 41 } },
      { "180": { image: "/piece.webp", groundAnchor: 0 } },
      { "45": { image: "/piece.webp" } },
    ])
      expect(furnitureDataSchema.safeParse({ views: invalid }).success).toBe(false);
    expect(
      furnitureVariantDataSchema.safeParse({ action: "sleep", views: {} }).success,
    ).toBe(false);
  });

  it("creates furniture through the standard item type input", () => {
    expect(itemCreateSchema.parse({ type: "FURNITURE" })).toEqual({
      type: "FURNITURE",
    });
  });

  it("permits free provided furniture and requires a price when offered in the shop", () => {
    expect(ItemValidator.safeParse(furniture).success).toBe(true);
    const forSale = ItemValidator.safeParse({ ...furniture, inShop: true });
    expect(forSale.success).toBe(false);
    if (!forSale.success)
      expect(forSale.error.issues).toContainEqual(
        expect.objectContaining({ path: ["cost"] }),
      );
    for (const currency of ["cost", "repsCost", "seichiSilverCost"]) {
      expect(
        ItemValidator.safeParse({ ...furniture, inShop: true, [currency]: 50 }).success,
      ).toBe(true);
    }
  });

  it.each([
    {
      effects: [
        {
          type: "increasemastery",
          masteryTypes: ["Ninjutsu"],
          calculation: "static",
          power: 10,
          powerPerLevel: 0,
        },
      ],
    },
    { slot: "ITEM" },
    { maxEquips: 1 },
    { preventBattleUsage: false },
    { canBeImbued: true },
    { maxImbueNumber: 1 },
    { maxDurability: 100 },
    { canStack: true },
    { stackSize: 2 },
    { chakraCost: 1 },
    { isFarmSeed: true, farmGrowTimeSeconds: 30 },
    { parentItemId: "weapon-parent" },
  ])("rejects gameplay configuration %j", (patch) => {
    expect(ItemValidator.safeParse({ ...furniture, ...patch }).success).toBe(false);
  });

  it("keeps zero-cost and zero-durability exceptions limited to furniture", () => {
    expect(
      ItemValidator.safeParse({ ...furniture, itemType: "MATERIAL" }).success,
    ).toBe(false);
  });

  it.each([
    { farmExtractSeedItemId: "rice-seed" },
    { farmExtractSeedCount: 5 },
    { farmExtractSeedItemId: "rice-seed", farmExtractSeedCount: 5 },
  ])("rejects seed extraction configuration %j", (patch) => {
    const parsed = ItemValidator.safeParse({ ...furniture, ...patch });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      for (const field of Object.keys(patch)) {
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({ path: [field] }),
        );
      }
    }
  });

  it("validates scene bounds and optional supported home actions", () => {
    expect(furnitureDataSchema.parse({ action: "" })).toEqual(DEFAULT_FURNITURE_DATA);
    expect(
      furnitureDataSchema.safeParse({ action: "storage", width: 6, groundAnchor: 1 })
        .success,
    ).toBe(true);
    expect(
      furnitureDataSchema.safeParse({ width: 40, groundAnchor: 100 }).success,
    ).toBe(true);
    expect(furnitureDataSchema.parse({ isFloor: true }).isFloor).toBe(true);
    for (const patch of [
      { width: 5 },
      { width: 41 },
      { groundAnchor: 0 },
      { groundAnchor: 101 },
      { action: "awardRyo" },
    ])
      expect(
        ItemValidator.safeParse({ ...furniture, furnitureData: patch }).success,
      ).toBe(false);
  });

  it("keeps typed scene configuration on furniture and null on other item types", () => {
    expect(furnitureItemSchema.parse({})).toEqual({ furnitureData: null });
    expect(ItemValidator.safeParse({ ...furniture, furnitureData: null }).success).toBe(
      false,
    );
    expect(
      ItemValidator.safeParse({ ...furniture, furnitureData: "not-an-object" }).success,
    ).toBe(false);
    expect(
      ItemValidator.parse({ ...furniture, furnitureData: {} }).furnitureData,
    ).toEqual(DEFAULT_FURNITURE_DATA);
    expect(
      ItemValidator.safeParse({
        ...furniture,
        itemType: "MATERIAL",
        cost: 1,
        maxDurability: 100,
        maxImbueNumber: 1,
      }).success,
    ).toBe(false);
    expect(
      ItemValidator.parse({
        ...furniture,
        itemType: "MATERIAL",
        cost: 1,
        maxDurability: 100,
        maxImbueNumber: 1,
        furnitureData: null,
      }).furnitureData,
    ).toBeNull();
  });
});
