import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { auctionListing, auctionOffer, item, userItem } from "@/drizzle/schema";
import { insertItems, insertUserItems } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const migration = await readFile(
  new URL("../../drizzle/migrations/0154_auction_history_items.sql", import.meta.url),
  "utf8",
);

/** The data statements; the test database already has the migration's columns. */
const backfill = migration.slice(migration.indexOf("UPDATE"));

describeWithDatabase("auction history items migration", () => {
  beforeEach(async () => {
    await resetTables(auctionOffer, auctionListing, userItem, item);
    await insertItems([
      { id: "ore", name: "Ore", canStack: true, stackSize: 100 },
      { id: "gem", name: "Gem", canStack: true, stackSize: 100 },
    ]);
    await insertUserItems([
      { id: "listed", userId: "seller", itemId: "ore", quantity: 4 },
      { id: "merging", userId: "seller", itemId: "ore", quantity: -6 },
      { id: "offered", userId: "seller", itemId: "gem", quantity: 2 },
    ]);
    const listing = (id: string, userItemId: string) => ({
      id,
      sellerId: "seller",
      userItemId,
      itemId: "",
      quantity: 0,
      listingType: "AUCTION" as const,
      startingPrice: 1,
      currentPrice: 1,
      expiresAt: new Date(),
    });
    const db = await getTestDatabase();
    await db
      .insert(auctionListing)
      .values([
        listing("held", "listed"),
        listing("claimed", "merging"),
        listing("gone", "deleted"),
      ]);
    await db.insert(auctionOffer).values([
      {
        id: "trade",
        ownerId: "seller",
        offerType: "TRADE",
        requestedItemId: "ore",
        requestedQuantity: 1,
        offeredUserItemId: "offered",
        offeredQuantity: 2,
      },
      {
        id: "request",
        ownerId: "seller",
        offerType: "REQUEST",
        requestedItemId: "ore",
        requestedQuantity: 1,
        ryo: 10,
      },
    ]);
  });

  it("records each listing's item and the quantity its stack holds", async () => {
    await runRawSql(backfill);
    const rows = await (await getTestDatabase())
      .select({
        id: auctionListing.id,
        itemId: auctionListing.itemId,
        quantity: auctionListing.quantity,
      })
      .from(auctionListing);
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "claimed", itemId: "ore", quantity: 6 },
      { id: "gone", itemId: "", quantity: 0 },
      { id: "held", itemId: "ore", quantity: 4 },
    ]);
  });

  it("records the item a trade offer holds", async () => {
    await runRawSql(backfill);
    const rows = await (await getTestDatabase())
      .select({ id: auctionOffer.id, offeredItemId: auctionOffer.offeredItemId })
      .from(auctionOffer);
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "request", offeredItemId: null },
      { id: "trade", offeredItemId: "gem" },
    ]);
  });
});
