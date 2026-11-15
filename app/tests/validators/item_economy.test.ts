import { describe, expect, it } from "bun:test";
import { editableOf } from "@/libs/contentReview/entities";
import { ItemValidatorRawSchema } from "@/validators/combat";
import { refineItemEconomy } from "@/validators/itemEconomy";

const economy = ItemValidatorRawSchema.pick({
  auctionMinPrice: true,
  auctionMaxPrice: true,
  purchaseLimit: true,
  purchaseLimitPeriod: true,
}).superRefine(refineItemEconomy);

describe("item economy validation", () => {
  it("defaults to empty bounds and unlimited purchases", () => {
    expect(economy.parse({})).toEqual({
      auctionMinPrice: null,
      auctionMaxPrice: null,
      purchaseLimit: null,
      purchaseLimitPeriod: "NONE",
    });
    expect(
      economy.parse({ auctionMinPrice: "", auctionMaxPrice: "", purchaseLimit: "" }),
    ).toEqual(economy.parse({}));
  });
  it.each([
    { auctionMinPrice: 0 },
    { auctionMaxPrice: 100 },
    { auctionMinPrice: 5, auctionMaxPrice: 5 },
  ])("accepts optional bounds %j", (data) => {
    expect(economy.safeParse(data).success).toBe(true);
  });
  it.each([
    { auctionMinPrice: -1 },
    { auctionMaxPrice: 1.5 },
    { auctionMinPrice: 10, auctionMaxPrice: 9 },
    { purchaseLimit: 0 },
    { purchaseLimit: 101 },
    { purchaseLimit: 1.5 },
    { purchaseLimitPeriod: "YEARLY" },
  ])("rejects invalid configuration %j", (data) => {
    expect(economy.safeParse(data).success).toBe(false);
  });
  it.each(["DAILY", "WEEKLY", "MONTHLY"])(
    "requires a quantity for %s",
    (purchaseLimitPeriod) => {
      expect(economy.safeParse({ purchaseLimitPeriod }).success).toBe(false);
      for (const purchaseLimit of [1, 100])
        expect(economy.safeParse({ purchaseLimitPeriod, purchaseLimit }).success).toBe(
          true,
        );
    },
  );
  it("includes economy fields in content-review snapshots and proposals", () => {
    const data = economy.parse({
      auctionMinPrice: 2,
      auctionMaxPrice: 20,
      purchaseLimit: 10,
      purchaseLimitPeriod: "WEEKLY",
    });
    expect(editableOf("ITEM", data)).toEqual(data);
  });
});

it("defaults both recipe yields to one and accepts bounded whole quantities", () => {
  const yields = ItemValidatorRawSchema.pick({
    craftingOutputQuantity: true,
    cookingOutputQuantity: true,
  });
  expect(yields.parse({})).toEqual({
    craftingOutputQuantity: 1,
    cookingOutputQuantity: 1,
  });
  expect(
    yields.safeParse({ craftingOutputQuantity: 4, cookingOutputQuantity: 3 }).success,
  ).toBe(true);
  for (const value of [0, -1, 1.5, 101]) {
    expect(yields.safeParse({ craftingOutputQuantity: value }).success).toBe(false);
    expect(yields.safeParse({ cookingOutputQuantity: value }).success).toBe(false);
  }
});
