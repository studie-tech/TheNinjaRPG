import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { AUCTION_HOUSE_MIN_LEVEL } from "@/drizzle/constants";
import {
  actionLog,
  auctionBid,
  auctionListing,
  item,
  userData,
  userItem,
} from "@/drizzle/schema";
import { auctionRouter } from "@/server/api/routers/auction";
import { homeRouter } from "@/server/api/routers/home";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("auction listings take escrow out of home storage", () => {
  beforeEach(async () => {
    await resetTables(actionLog, auctionBid, auctionListing, userItem, item, userData);
    await insertUsers([
      {
        userId: "seller",
        username: "Seller",
        level: AUCTION_HOUSE_MIN_LEVEL,
        bank: 1000,
        homeType: "TOWN_HOUSE",
      },
      {
        userId: "buyer",
        username: "Buyer",
        level: AUCTION_HOUSE_MIN_LEVEL,
        bank: 1000,
      },
    ]);
    await insertItems([
      {
        id: "ore",
        name: "Silver ore",
        canBeTraded: true,
        canStack: true,
        stackSize: 100,
      },
      {
        id: "lamp",
        name: "Paper lamp",
        itemType: "FURNITURE",
        canBeTraded: true,
        canStack: false,
      },
    ]);
    await insertUserItems([
      {
        id: "stored-ore",
        userId: "seller",
        itemId: "ore",
        quantity: 12,
        storedAtHome: true,
      },
      {
        id: "placed-lamp",
        userId: "seller",
        itemId: "lamp",
        storedAtHome: true,
        homeX: 2,
        homeY: 3,
        homeRotation: 90,
      },
    ]);
  });

  const listing = {
    listingType: "AUCTION" as const,
    startingPrice: 1,
    buyoutPrice: 2,
    durationHours: 24,
    currencyType: "MONEY" as const,
  };
  const row = async (id: string) =>
    (
      await (await getTestDatabase()).select().from(userItem).where(eq(userItem.id, id))
    )[0];

  it("carries a whole stored stack into escrow and keeps it out of storage until cancelled", async () => {
    const seller = await callerFor(auctionRouter, "seller");
    expect(
      await seller.createAuctionListing({ ...listing, userItemId: "stored-ore" }),
    ).toMatchObject({ success: true });
    expect(await row("stored-ore")).toMatchObject({
      isInAuction: true,
      storedAtHome: false,
      quantity: 12,
    });

    const home = await callerFor(homeRouter, "seller");
    expect(await home.toggleStoreItem({ userItemId: "stored-ore" })).toMatchObject({
      success: false,
    });
    expect(await row("stored-ore")).toMatchObject({
      isInAuction: true,
      storedAtHome: false,
    });

    const [created] = await (await getTestDatabase()).select().from(auctionListing);
    expect(await seller.cancelAuction({ auctionId: created!.id })).toMatchObject({
      success: true,
    });
    expect(await row("stored-ore")).toMatchObject({
      isInAuction: false,
      storedAtHome: false,
      quantity: 12,
    });
  });

  it("escrows a split-off part of a stored stack as carried and leaves the remainder stored", async () => {
    const seller = await callerFor(auctionRouter, "seller");
    expect(
      await seller.createAuctionListing({
        ...listing,
        userItemId: "stored-ore",
        quantity: 4,
      }),
    ).toMatchObject({ success: true });
    const rows = await (await getTestDatabase())
      .select()
      .from(userItem)
      .where(eq(userItem.itemId, "ore"));
    expect(rows).toHaveLength(2);
    expect(rows.find(({ id }) => id === "stored-ore")).toMatchObject({
      quantity: 8,
      isInAuction: false,
      storedAtHome: true,
    });
    expect(rows.find(({ id }) => id !== "stored-ore")).toMatchObject({
      quantity: 4,
      isInAuction: true,
      storedAtHome: false,
      homeX: null,
      homeY: null,
      homeRotation: 0,
    });
  });

  it("clears a placed furniture position when it is listed", async () => {
    const seller = await callerFor(auctionRouter, "seller");
    expect(
      await seller.createAuctionListing({ ...listing, userItemId: "placed-lamp" }),
    ).toMatchObject({ success: true });
    expect(await row("placed-lamp")).toMatchObject({
      isInAuction: true,
      storedAtHome: false,
      homeX: null,
      homeY: null,
      homeRotation: 0,
    });
  });
});
