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
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { overrideQuery } from "../../../../setup/statements";

describeWithDatabase("auction listing quantities", () => {
  beforeEach(async () => {
    await resetTables(actionLog, auctionBid, auctionListing, userItem, item, userData);
    await insertUsers([
      { userId: "sender", level: AUCTION_HOUSE_MIN_LEVEL, bank: 1000 },
      { userId: "recipient", level: AUCTION_HOUSE_MIN_LEVEL, bank: 1000 },
    ]);
    await insertItems([
      {
        id: "fish",
        name: "River Trout",
        itemType: "COOKING",
        canStack: true,
        stackSize: 99,
        canBeTraded: true,
      },
    ]);
    await insertUserItems([
      {
        id: "stack",
        userId: "sender",
        itemId: "fish",
        quantity: 12,
        level: 3,
        experience: 15,
        durability: 70,
      },
    ]);
  });

  const listing = {
    userItemId: "stack",
    listingType: "DIRECT" as const,
    targetUserId: "recipient",
    startingPrice: 1,
    buyoutPrice: 2,
    durationHours: 24,
    currencyType: "MONEY" as const,
  };
  const snapshot = async () => {
    const db = await getTestDatabase();
    const [inventory, listings, logs] = await Promise.all([
      db.select().from(userItem),
      db.select().from(auctionListing),
      db.select().from(actionLog),
    ]);
    return { inventory, listings, logs };
  };

  it.each([4, 12, undefined])(
    "delivers quantity %s and retains the exact remainder",
    async (quantity) => {
      const sender = await callerFor(auctionRouter, "sender");
      expect(await sender.createAuctionListing({ ...listing, quantity })).toMatchObject(
        { success: true },
      );
      const reserved = await snapshot();
      const amount = quantity ?? 12;
      expect(reserved.inventory.find((row) => row.isInAuction)?.quantity).toBe(amount);
      expect(reserved.inventory.reduce((sum, row) => sum + row.quantity, 0)).toBe(12);
      if (amount < 12)
        expect(reserved.inventory.find((row) => row.id === "stack")).toMatchObject({
          userId: "sender",
          quantity: 12 - amount,
          isInAuction: false,
        });
      else expect(reserved.inventory).toHaveLength(1);
      const recipient = await callerFor(auctionRouter, "recipient");
      expect(
        await recipient.placeBid({ auctionId: reserved.listings[0]!.id, amount: 2 }),
      ).toMatchObject({ success: true });
      const delivered = await snapshot();
      expect(
        delivered.inventory.find((row) => row.userId === "recipient"),
      ).toMatchObject({
        quantity: amount,
        isInAuction: false,
        level: 3,
        experience: 15,
        durability: 70,
      });
      expect(
        delivered.inventory
          .filter((row) => row.userId === "sender")
          .reduce((sum, row) => sum + row.quantity, 0),
      ).toBe(12 - amount);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid quantity %s without writes",
    async (quantity) => {
      const sender = await callerFor(auctionRouter, "sender");
      const before = await snapshot();
      await expect(
        sender.createAuctionListing({ ...listing, quantity }),
      ).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    },
  );

  it("rejects excess quantities without writes", async () => {
    const sender = await callerFor(auctionRouter, "sender");
    const before = await snapshot();
    expect(
      await sender.createAuctionListing({ ...listing, quantity: 13 }),
    ).toMatchObject({ success: false });
    expect(await snapshot()).toEqual(before);
  });

  it.each([undefined, "missing", "sender"])(
    "rejects recipient %s before splitting",
    async (targetUserId) => {
      const sender = await callerFor(auctionRouter, "sender");
      const before = await snapshot();
      expect(
        await sender.createAuctionListing({ ...listing, targetUserId, quantity: 4 }),
      ).toMatchObject({ success: false });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("rejects another player's stack", async () => {
    const recipient = await callerFor(auctionRouter, "recipient");
    const before = await snapshot();
    expect(
      await recipient.createAuctionListing({
        ...listing,
        targetUserId: "sender",
        quantity: 4,
      }),
    ).toMatchObject({ success: false });
    expect(await snapshot()).toEqual(before);
  });

  it.each([4, 8, 12])(
    "concurrent quantity %i submissions conserve the stack",
    async (quantity) => {
      const sender = await callerFor(auctionRouter, "sender");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          sender.createAuctionListing({ ...listing, quantity }),
        ),
      );
      const successes = results.filter((result) => result.success).length;
      expect(successes).toBeGreaterThan(0);
      expect(successes * quantity).toBeLessThanOrEqual(12);
      const after = await snapshot();
      expect(after.listings).toHaveLength(successes);
      expect(after.logs).toHaveLength(successes);
      expect(after.inventory.reduce((sum, row) => sum + row.quantity, 0)).toBe(12);
      expect(after.inventory.every((row) => row.quantity > 0)).toBe(true);
      expect(
        after.inventory
          .filter((row) => row.isInAuction)
          .reduce((sum, row) => sum + row.quantity, 0),
      ).toBe(successes * quantity);
    },
  );

  it("rejects a stale quantity snapshot before splitting", async () => {
    const db = await getTestDatabase();
    let firstRead = true;
    const raced = overrideQuery(db, "userItem", {
      findFirst: async (read, ...args) => {
        const row = await read(...args);
        if (firstRead) {
          firstRead = false;
          await db
            .update(userItem)
            .set({ quantity: 10 })
            .where(eq(userItem.id, "stack"));
        }
        return row;
      },
    });
    const sender = callerForDatabase(auctionRouter, "sender", raced);
    expect(
      await sender.createAuctionListing({ ...listing, quantity: 4 }),
    ).toMatchObject({ success: false });
    const after = await snapshot();
    expect(after.inventory).toHaveLength(1);
    expect(after.inventory[0]).toMatchObject({ quantity: 10, isInAuction: false });
    expect(after.listings).toHaveLength(0);
    expect(after.logs).toHaveLength(0);
  });
});
