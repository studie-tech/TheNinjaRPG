import { beforeEach, expect, it } from "bun:test";
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
        message: getInventoryBucketFullMessage(bucket),
      });
      const afterRejection = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(afterRejection?.money).toBe(afterPurchase?.money);
    },
  );

  it("buys directly into an empty equipment slot when the backpack is full", async () => {
    await fillBackpack("normal");
    const api = await callerFor(itemRouter, userId);
    expect((await api.buy({ itemId: "gear", villageId, stack: 1 })).success).toBe(true);
    const rows = await api.getUserItems();
    expect(rows.find((row) => row.itemId === "gear")?.equipped).toBe("HEAD");
    // The occupied head slot prevents the next helmet from auto-equipping.
    expect(await api.buy({ itemId: "gear", villageId, stack: 1 })).toMatchObject({
      success: false,
      message: "Inventory is full",
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
        message: getInventoryBucketFullMessage(bucket),
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
