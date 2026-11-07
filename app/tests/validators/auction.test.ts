import { describe, expect, it } from "bun:test";
import { auctionListingSchemaForItem, createAuctionListingSchema } from "@/validators/auction";

const listing = { userItemId: "fish", listingType: "DIRECT", targetUserId: "recipient", startingPrice: 1, durationHours: 24 };
const item = { canStack: true, canBeTraded: true, auctionMinPrice: null, auctionMaxPrice: null };

describe("listing quantity validation", () => {
  it.each([undefined, 0, -1, 1.5, 13, Number.NaN, Number.POSITIVE_INFINITY])("puts invalid quantity %s errors on the quantity field", (quantity) => {
    const parsed = auctionListingSchemaForItem(item, 12).safeParse({ ...listing, quantity });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path[0] === "quantity")).toBe(true);
  });
  it.each([1, 4, 12])("accepts quantity %i", (quantity) => {
    expect(auctionListingSchemaForItem(item, 12).safeParse({ ...listing, quantity }).success).toBe(true);
  });
  it("preserves omitted full-stack requests for existing clients", () => {
    expect(createAuctionListingSchema.safeParse(listing).success).toBe(true);
  });
  it("does not require quantity for single items", () => {
    expect(auctionListingSchemaForItem(item, 1).safeParse(listing).success).toBe(true);
    expect(auctionListingSchemaForItem({ ...item, canStack: false }, 1).safeParse(listing).success).toBe(true);
  });
});
