import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  item,
  itemLoadout,
  itemPurchaseCounter,
  userData,
  userItem,
  village,
} from "@/drizzle/schema";
import {
  countsTowardInventoryStorage,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  type InventoryBucket,
} from "@/libs/item";
import { homeRouter } from "@/server/api/routers/home";
import { itemRouter } from "@/server/api/routers/item";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "inventory-player";
const villageId = "inventory-village";

/** Fill to the user's actual bucket limit, reserving one slot for an unfinished craft. */
const fillBackpack = async (bucket: InventoryBucket, emptySlots = 0) => {
  const db = await getTestDatabase();
  const user = await db.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  const capacity = getInventoryBucketCapacity(bucket, user!);
  await insertUserItems(
    Array.from({ length: capacity - emptySlots }, (_, index) => ({
      id: `backpack-${index}`,
      userId,
      itemId: "backpack-item",
      // Unfinished crafts still reserve a storage slot.
      craftingFinishedAt: index === 0 ? new Date(Date.now() + 60_000) : null,
    })),
  );
};

describeWithDatabase("equipped items and backpack capacity", () => {
  beforeEach(async () => {
    await resetTables(
      itemPurchaseCounter,
      itemLoadout,
      userItem,
      item,
      userData,
      village,
    );
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: villageId, name: "Inventory Village", sector: 30, kageId: "kage" });
    await insertUsers([
      {
        userId,
        username: userId,
        villageId,
        sector: 30,
        status: "AWAKE",
        money: 10000,
        federalStatus: "NONE",
        staffAccount: false,
      },
    ]);
    await insertItems([
      {
        id: "backpack-item",
        name: "Backpack item",
        itemType: "CONSUMABLE",
        slot: "NONE",
        cost: 10,
        inShop: true,
      },
      {
        id: "gear",
        name: "Helmet",
        itemType: "ARMOR",
        slot: "HEAD",
        cost: 10,
        inShop: true,
        maxEquips: 1,
      },
    ]);
  });

  it.each(["normal", "event"] as const)(
    "uses space freed by equipped %s items and rejects the next backpack purchase",
    async (bucket) => {
      const db = await getTestDatabase();
      await db.update(item).set({ isEventItem: bucket === "event" });
      await fillBackpack(bucket, 1);
      await insertUserItems([
        { id: "worn", userId, itemId: "gear", equipped: "HEAD" },
        { id: "stored", userId, itemId: "backpack-item", storedAtHome: true },
      ]);
      const api = await callerFor(itemRouter, userId);
      const input = { itemId: "backpack-item", villageId, stack: 1 };
      expect((await api.buy(input)).success).toBe(true);
      const afterPurchase = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(await api.buy(input)).toMatchObject({
        success: false,
        message: getInventoryBucketFullMessage(bucket, { auction: 0, crafting: 1 }),
      });
      const afterRejection = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(afterRejection?.money).toBe(afterPurchase?.money);
    },
  );

  describe("stackable purchases", () => {
    const potionRows = async () =>
      (
        await (
          await getTestDatabase()
        ).query.userItem.findMany({
          where: eq(userItem.itemId, "potion"),
        })
      ).map((row) => [row.id, row.quantity]);
    const money = async () =>
      (
        await (
          await getTestDatabase()
        ).query.userData.findFirst({
          where: eq(userData.userId, userId),
        })
      )?.money;
    beforeEach(async () => {
      await insertItems([
        {
          id: "potion",
          name: "Potion",
          itemType: "CONSUMABLE",
          slot: "NONE",
          cost: 10,
          inShop: true,
          canStack: true,
          stackSize: 10,
        },
      ]);
    });

    it("adds the purchase to the stack already carried", async () => {
      await insertUserItems([{ id: "potions", userId, itemId: "potion", quantity: 3 }]);
      const api = await callerFor(itemRouter, userId);
      expect((await api.buy({ itemId: "potion", villageId, stack: 2 })).success).toBe(
        true,
      );
      expect(await potionRows()).toEqual([["potions", 5]]);
    });

    it("buys into a carried stack with room when the backpack is full", async () => {
      await fillBackpack("normal", 1);
      await insertUserItems([{ id: "potions", userId, itemId: "potion", quantity: 3 }]);
      const api = await callerFor(itemRouter, userId);
      expect((await api.buy({ itemId: "potion", villageId, stack: 2 })).success).toBe(
        true,
      );
      expect(await potionRows()).toEqual([["potions", 5]]);
      expect(await money()).toBe(10000 - 20);
    });

    it("splits a full backpack purchase across the carried stacks with room", async () => {
      await fillBackpack("normal", 2);
      await insertUserItems([
        { id: "potions-a", userId, itemId: "potion", quantity: 8 },
        { id: "potions-b", userId, itemId: "potion", quantity: 7 },
      ]);
      const api = await callerFor(itemRouter, userId);
      expect((await api.buy({ itemId: "potion", villageId, stack: 5 })).success).toBe(
        true,
      );
      expect((await potionRows()).sort()).toEqual([
        ["potions-a", 10],
        ["potions-b", 10],
      ]);
    });

    it.each([9, 10])(
      "rejects a full backpack purchase the carried stack of %i cannot take, without charging",
      async (quantity) => {
        await fillBackpack("normal", 1);
        await insertUserItems([{ id: "potions", userId, itemId: "potion", quantity }]);
        const api = await callerFor(itemRouter, userId);
        expect(await api.buy({ itemId: "potion", villageId, stack: 2 })).toMatchObject({
          success: false,
          message: getInventoryBucketFullMessage("normal"),
        });
        expect(await potionRows()).toEqual([["potions", quantity]]);
        expect(await money()).toBe(10000);
      },
    );
  });

  it("names the backpack slots held by listings when a purchase does not fit", async () => {
    await fillBackpack("normal", 2);
    await insertUserItems([
      { id: "listed-a", userId, itemId: "backpack-item", isInAuction: true },
      { id: "listed-b", userId, itemId: "backpack-item", isInAuction: true },
    ]);
    const api = await callerFor(itemRouter, userId);
    expect(
      await api.buy({ itemId: "backpack-item", villageId, stack: 1 }),
    ).toMatchObject({
      success: false,
      message:
        "Inventory is full (3 slots are held: 2 by auction listings or trade offers, 1 by an unfinished craft)",
    });

  });

  it("buys directly into an empty equipment slot when the backpack is full", async () => {
    await fillBackpack("normal");
    const api = await callerFor(itemRouter, userId);
    expect((await api.buy({ itemId: "gear", villageId, stack: 1 })).success).toBe(true);
    const rows = await api.getUserItems();
    expect(rows.find((row) => row.itemId === "gear")?.equipped).toBe("HEAD");
    // The occupied head slot prevents the next helmet from auto-equipping.
    expect(await api.buy({ itemId: "gear", villageId, stack: 1 })).toMatchObject({
      success: false,
      message: "Inventory is full (1 slot is held by an unfinished craft)",
    });
  });

  it.each(["normal", "event"] as const)(
    "retrieves a %s item into space freed by equipped gear, then counts unequips again",
    async (bucket) => {
      const db = await getTestDatabase();
      await db.update(item).set({ isEventItem: bucket === "event" });
      await fillBackpack(bucket, 1);
      await insertUserItems([
        { id: "worn", userId, itemId: "gear", equipped: "HEAD" },
        { id: "stored", userId, itemId: "backpack-item", storedAtHome: true },
        { id: "stored-next", userId, itemId: "backpack-item", storedAtHome: true },
      ]);
      const home = await callerFor(homeRouter, userId);
      expect((await home.toggleStoreItem({ userItemId: "stored" })).success).toBe(true);
      expect(await home.toggleStoreItem({ userItemId: "stored-next" })).toMatchObject({
        success: false,
        message: getInventoryBucketFullMessage(bucket, { auction: 0, crafting: 1 }),
      });
      const api = await callerFor(itemRouter, userId);
      const before = (await api.getUserItems()).filter(
        countsTowardInventoryStorage,
      ).length;
      expect((await api.toggleEquip({ userItemId: "worn" })).success).toBe(true);
      expect(
        (await api.getUserItems()).filter(countsTowardInventoryStorage),
      ).toHaveLength(before + 1);
    },
  );
});
