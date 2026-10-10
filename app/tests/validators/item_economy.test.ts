import { describe, expect, it } from "bun:test";
import { ItemValidatorRawSchema } from "@/validators/combat";
import { refineItemEconomy } from "@/validators/itemEconomy";
import { auctionListingSchemaForItem } from "@/validators/auction";
import { editableOf } from "@/libs/contentReview/entities";

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

describe("auction form per-unit price validation", () => {
  const item = { canBeTraded: true, auctionMinPrice: 10, auctionMaxPrice: 20 };
  const listing = {
    userItemId: "owned",
    listingType: "AUCTION",
    startingPrice: 10,
    durationHours: 24,
    currencyType: "MONEY",
  };
  it.each([9, 21])("rejects starting price %i with a field error", (startingPrice) => {
    const parsed = auctionListingSchemaForItem(item).safeParse({
      ...listing,
      startingPrice,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(
        parsed.error.issues.some((issue) => issue.path[0] === "startingPrice"),
      ).toBe(true);
  });
  it.each([10, 20])("accepts boundary %i", (startingPrice) => {
    expect(
      auctionListingSchemaForItem(item).safeParse({ ...listing, startingPrice })
        .success,
    ).toBe(true);
  });
  it("checks both explicit and full-stack quantities", () => {
    const schema = auctionListingSchemaForItem(item, 5);
    expect(schema.safeParse({ ...listing, startingPrice: 49 }).success).toBe(false);
    expect(schema.safeParse({ ...listing, startingPrice: 50 }).success).toBe(true);
    expect(
      schema.safeParse({ ...listing, startingPrice: 40, quantity: 2 }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...listing, startingPrice: 41, quantity: 2 }).success,
    ).toBe(false);
  });
  it("validates buyout bounds and requires buyout above starting price", () => {
    const schema = auctionListingSchemaForItem(item);
    expect(schema.safeParse({ ...listing, buyoutPrice: 20 }).success).toBe(true);
    for (const buyoutPrice of [9, 10, 21])
      expect(schema.safeParse({ ...listing, buyoutPrice }).success).toBe(false);
  });
  it("bypasses configured bounds for direct listings", () => {
    expect(
      auctionListingSchemaForItem(item).safeParse({
        ...listing,
        listingType: "DIRECT",
        startingPrice: 1,
        buyoutPrice: 1000,
      }).success,
    ).toBe(true);
  });
  it.each([10, 5000, 50001])(
    "ignores ryo bounds for reputation price %i",
    (startingPrice) => {
      expect(
        auctionListingSchemaForItem({
          ...item,
          auctionMinPrice: 5000,
          auctionMaxPrice: 50000,
        }).safeParse({
          ...listing,
          currencyType: "REPUTATION",
          startingPrice,
          buyoutPrice: startingPrice + 1,
        }).success,
      ).toBe(true);
    },
  );
});
