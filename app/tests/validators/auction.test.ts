import { describe, expect, it } from "bun:test";
import { auctionListingSchemaForItem, createAuctionListingSchema } from "@/validators/auction";

describe("listing quantity validation", () => {
  const listing = { userItemId: "fish", listingType: "DIRECT", targetUserId: "recipient", startingPrice: 1, durationHours: 24 };
  const item = { canStack: true, canBeTraded: true, auctionMinPrice: null, auctionMaxPrice: null };
  it.each([undefined, 0, -1, 1.5, 13, Number.NaN, Number.POSITIVE_INFINITY])("puts invalid quantity %s errors on the quantity field", (quantity) => {
    const parsed = auctionListingSchemaForItem(item, 12).safeParse({ ...listing, quantity });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path[0] === "quantity")).toBe(true);
  });
  it.each([1, 4, 12])("accepts quantity %i", (quantity) => {
    expect(auctionListingSchemaForItem(item, 12).safeParse({ ...listing, quantity }).success).toBe(true);
  });
  it("accepts a listing without a quantity", () => {
    expect(createAuctionListingSchema.safeParse(listing).success).toBe(true);
  });
  it("does not require quantity for single items", () => {
    expect(auctionListingSchemaForItem(item, 1).safeParse(listing).success).toBe(true);
    expect(auctionListingSchemaForItem({ ...item, canStack: false }, 1).safeParse(listing).success).toBe(true);
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
