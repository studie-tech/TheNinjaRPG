import { describe, expect, it } from "bun:test";
import { farmShopPurchaseInputSchema } from "@/validators/farming";

describe("farmShopPurchaseInputSchema", () => {
  it("defaults the quantity to one", () => {
    expect(
      farmShopPurchaseInputSchema.parse({ type: "SEED", itemId: "seed-1" }),
    ).toEqual({ type: "SEED", itemId: "seed-1", quantity: 1 });
  });

  it("accepts bounded consumable quantities", () => {
    expect(
      farmShopPurchaseInputSchema.parse({
        type: "FERTILIZER",
        itemId: "fertilizer-1",
        quantity: 25,
      }).quantity,
    ).toBe(25);
    expect(
      farmShopPurchaseInputSchema.safeParse({
        type: "SEED",
        itemId: "seed-1",
        quantity: 100,
      }).success,
    ).toBe(false);
  });

  it("rejects bulk plot and extractor upgrades", () => {
    expect(
      farmShopPurchaseInputSchema.safeParse({ type: "PLOT", quantity: 2 }).success,
    ).toBe(false);
    expect(
      farmShopPurchaseInputSchema.safeParse({ type: "EXTRACTOR", quantity: 2 })
        .success,
    ).toBe(false);
  });
});
