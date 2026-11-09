import { beforeEach, expect, it } from "bun:test";
import { auctionBid, auctionListing, item, userData, userItem } from "@/drizzle/schema";
import { auctionRouter } from "@/server/api/routers/auction";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

/** The listing browser's price bounds are inclusive on both ends. */
describeWithDatabase("auction listing price filters", () => {
  beforeEach(async () => {
    await resetTables(auctionBid, auctionListing, userItem, item, userData);
    await insertUsers([
      { userId: "seller", level: 50 },
      { userId: "browser", level: 50 },
    ]);
    await insertItems([{ id: "lot", name: "Auction lot", canBeTraded: true }]);
    await insertUserItems(
      ["cheap", "middle", "dear"].map((id) => ({
        id: `${id}-instance`,
        itemId: "lot",
        userId: "seller",
        isInAuction: true,
      })),
    );
    await (await getTestDatabase()).insert(auctionListing).values(
      [
        ["cheap", 10],
        ["middle", 50],
        ["dear", 90],
      ].map(([id, price]) => ({
        id: id as string,
        sellerId: "seller",
        userItemId: `${id}-instance`,
        listingType: "AUCTION" as const,
        startingPrice: price as number,
        currentPrice: price as number,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    );
  });

  const listed = async (bounds: { minPrice?: number; maxPrice?: number }) =>
    (
      await (
        await callerFor(auctionRouter, "browser")
      ).getAuctionListings({ limit: 10, ...bounds })
    ).data
      .map((listing) => listing.id)
      .sort();

  it("keeps listings priced at or between the bounds", async () => {
    expect(await listed({ maxPrice: 50 })).toEqual(["cheap", "middle"]);
    expect(await listed({ minPrice: 50 })).toEqual(["dear", "middle"]);
    expect(await listed({ minPrice: 20, maxPrice: 80 })).toEqual(["middle"]);
  });
});
