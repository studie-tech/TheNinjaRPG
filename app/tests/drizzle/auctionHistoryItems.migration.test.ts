import { beforeEach, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  actionLog,
  auctionListing,
  auctionOffer,
  item,
  userItem,
} from "@/drizzle/schema";
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
const backfill = migration.slice(migration.indexOf("-- The fills below"));

describeWithDatabase("auction history items migration", () => {
  beforeEach(async () => {
    await resetTables(actionLog, auctionOffer, auctionListing, userItem, item);
    await insertItems([
      { id: "ore", name: "Ore", canStack: true, stackSize: 100 },
      { id: "gem", name: "Gem", canStack: true, stackSize: 100 },
    ]);
    await insertUserItems([
      { id: "listed", userId: "seller", itemId: "ore", quantity: 4 },
      { id: "merging", userId: "seller", itemId: "ore", quantity: -6 },
      { id: "offered", userId: "seller", itemId: "gem", quantity: 2 },
    ]);
    const listing = (
      id: string,
      userItemId: string,
      filled = { itemId: "", quantity: 0 },
    ) => ({
      ...filled,
      id,
      sellerId: "seller",
      userItemId,
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
        listing("merged", "listed"),
        listing("logged-gone", "deleted"),
        listing("early", "listed"),
        listing("negative", "listed"),
        listing("filled", "listed", { itemId: "gem", quantity: 7 }),
      ]);
    const created = (relatedId: string, changes: object) => ({
      id: `log-${relatedId}`,
      userId: "seller",
      tableName: "auctionListing",
      relatedId,
      changes: JSON.stringify({ action: "CREATE_AUCTION", ...changes }),
    });
    await db.insert(actionLog).values([
      created("merged", { itemId: "ore", quantity: 2 }),
      {
        ...created("logged-gone", {}),
        changes: { action: "CREATE_AUCTION", itemId: "gem", quantity: 5 },
      },
      { ...created("gone", {}), changes: "CREATE_AUCTION by an old client" },
      created("early", { itemId: "ore" }),
      created("negative", { itemId: "ore", quantity: -3 }),
      created("filled", { itemId: "ore", quantity: 2 }),
      {
        ...created("held", { itemId: "gem", quantity: 9 }),
        id: "log-bid",
        changes: JSON.stringify({ action: "PLACE_BID", itemId: "gem", quantity: 9 }),
      },
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
        id: "trade-filled",
        ownerId: "seller",
        offerType: "TRADE",
        requestedItemId: "gem",
        requestedQuantity: 1,
        offeredUserItemId: "offered",
        offeredItemId: "ore",
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

  it("records each listing's item and quantity from its creation, else from its stack", async () => {
    // A second run fills only rows still empty, such as listings created during the deploy.
    await runRawSql(backfill);
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
      { id: "early", itemId: "ore", quantity: 4 },
      { id: "filled", itemId: "gem", quantity: 7 },
      { id: "gone", itemId: "", quantity: 0 },
      { id: "held", itemId: "ore", quantity: 4 },
      { id: "logged-gone", itemId: "gem", quantity: 5 },
      { id: "merged", itemId: "ore", quantity: 2 },
      { id: "negative", itemId: "ore", quantity: 3 },
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
      { id: "trade-filled", offeredItemId: "ore" },
    ]);
  });
});
