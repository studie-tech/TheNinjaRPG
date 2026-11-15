import { expect, it } from "bun:test";
import { ItemValidator } from "@/validators/combat";
import { itemCreateSchema } from "@/validators/item";
import { FURNITURE_ITEM_DEFAULTS } from "@/validators/itemFurniture";

const cosmetic = {
  ...FURNITURE_ITEM_DEFAULTS,
  itemType: "COSMETIC",
  slot: "HAND",
  name: "Ceremonial blade",
  image: "https://example.com/blade.png",
  description: "A decorative blade whose appearance can be unlocked for a hand slot.",
  rarity: "COMMON",
  hidden: false,
  inShop: false,
  cost: 100,
  repsCost: 0,
  seichiSilverCost: 0,
  maxDurability: 1,
  maxImbueNumber: 1,
  furnitureData: null,
  expireFromStoreAt: null,
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
};

it("accepts dedicated cosmetic creation and a physical target slot", () => {
  expect(itemCreateSchema.parse({ type: "COSMETIC" })).toEqual({ type: "COSMETIC" });
  expect(ItemValidator.safeParse(cosmetic).success).toBe(true);
});

it("requires a target slot for a dedicated cosmetic", () => {
  const result = ItemValidator.safeParse({ ...cosmetic, slot: "NONE" });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["slot"],
        message: "Cosmetics require an item slot",
      }),
    );
});
