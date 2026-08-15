import { describe, expect, it } from "vitest";
import { MAX_ITEM_SHOP_PURCHASE_QUANTITY } from "@/drizzle/constants";
import { itemBuySchema } from "@/validators/item";

describe("itemBuySchema", () => {
  const validInput = {
    itemId: "item-id",
    stack: 1,
    villageId: "village-id",
  };

  it("accepts integer purchase quantities through the configured maximum", () => {
    expect(itemBuySchema.safeParse(validInput).success).toBe(true);
    expect(
      itemBuySchema.safeParse({
        ...validInput,
        stack: MAX_ITEM_SHOP_PURCHASE_QUANTITY,
      }).success,
    ).toBe(true);
  });

  it("rejects fractional purchase quantities", () => {
    expect(itemBuySchema.safeParse({ ...validInput, stack: 1.5 }).success).toBe(false);
  });
});
