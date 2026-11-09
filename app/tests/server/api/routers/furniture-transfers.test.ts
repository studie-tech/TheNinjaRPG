import { beforeEach, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { HomeTypeDetails } from "@/drizzle/constants";
import { auctionBid, auctionListing, item, userData, userItem } from "@/drizzle/schema";
import { completeAuctionInternal } from "@/server/api/routers/auction";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("furniture auction transfers", () => {
  beforeEach(async () => {
    await resetTables(auctionBid, auctionListing, userItem, item, userData);
    await insertUsers([
      { userId: "seller", username: "Seller" },
      { userId: "buyer", username: "Buyer", homeType: "NONE" },
    ]);
    await insertItems([
      { id: "chair", name: "Chair", itemType: "FURNITURE", canBeTraded: true },
    ]);
    await insertUserItems([
      {
        id: "placed-chair",
        userId: "seller",
        itemId: "chair",
        isInAuction: true,
        storedAtHome: true,
        homeX: 24,
        homeY: 68,
        homeRotation: 1,
      },
    ]);
    await (await getTestDatabase()).insert(auctionListing).values({
      id: "chair-auction",
      sellerId: "seller",
      userItemId: "placed-chair",
      listingType: "AUCTION",
      startingPrice: 100,
      currentPrice: 100,
      expiresAt: new Date(0),
    });
  });

  it("delivers sold furniture unplaced and carried when the buyer's home is full", async () => {
    const database = await getTestDatabase();
    await insertUserItems(
      Array.from({ length: HomeTypeDetails.NONE.storage }, (_, index) => ({
        id: `stored-chair-${index}`,
        userId: "buyer",
        itemId: "chair",
        storedAtHome: true,
      })),
    );
    await database.insert(auctionBid).values({
      id: "winning-bid",
      auctionId: "chair-auction",
      bidderId: "buyer",
      amount: 100,
    });
    expect((await completeAuctionInternal(database, "chair-auction")).success).toBe(
      true,
    );
    const [transferred] = await database
      .select()
      .from(userItem)
      .where(eq(userItem.id, "placed-chair"));
    expect(transferred).toMatchObject({
      userId: "buyer",
      isInAuction: false,
      storedAtHome: false,
      homeX: null,
      homeY: null,
      homeRotation: 0,
    });
    const storedItems = await database
      .select({ id: userItem.id })
      .from(userItem)
      .where(and(eq(userItem.userId, "buyer"), eq(userItem.storedAtHome, true)));
    expect(storedItems).toHaveLength(HomeTypeDetails.NONE.storage);
  });
});
