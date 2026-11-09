import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { HOME_FURNITURE_STORAGE_CAPACITY, HomeTypeDetails } from "@/drizzle/constants";
import {
  item,
  itemPurchaseCounter,
  itemVariant,
  userData,
  userItem,
  userItemImbuement,
  userItemVariant,
  village,
} from "@/drizzle/schema";
import { calcMaxItems } from "@/libs/item";
import { homeRouter } from "@/server/api/routers/home";
import { itemRouter } from "@/server/api/routers/item";
import { getNextUserSnapshotAt } from "@/utils/time";
import { FURNITURE_ITEM_DEFAULTS } from "@/validators/itemFurniture";

import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  beforeStatements,
  beforeTransaction,
  failStatements,
  inTransactions,
} from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "furniture-buyer";
const villageId = "furniture-village";
const price = 100;
const money = 1_000;
const capacity = HOME_FURNITURE_STORAGE_CAPACITY;

/** Standard item checkout delivers furniture into the same guarded home-storage economy. */
describeWithDatabase("standard furniture purchases", () => {
  beforeEach(async () => {
    await resetTables(
      userItemImbuement,
      userItemVariant,
      itemVariant,
      itemPurchaseCounter,
      userItem,
      item,
      userData,
      village,
    );
    const database = await getTestDatabase();
    await database
      .insert(village)
      .values({ id: villageId, name: "Furniture", sector: 30, kageId: "kage" });
    await insertUsers([
      { userId, username: userId, villageId, sector: 30, status: "AWAKE", money },
    ]);
    await insertItems([
      {
        ...FURNITURE_ITEM_DEFAULTS,
        id: "furniture",
        name: "Painted Cabinet",
        itemType: "FURNITURE",
        cost: price,
        inShop: true,
      },
      { id: "material", itemType: "MATERIAL" },
      { id: "ordinary", itemType: "OTHER" },
    ]);
  });

  const snapshot = async () => {
    const database = await getTestDatabase();
    const [owners, inventory, counters] = await Promise.all([
      database.select().from(userData).where(eq(userData.userId, userId)),
      database
        .select()
        .from(userItem)
        .where(eq(userItem.userId, userId))
        .orderBy(userItem.id),
      database.select().from(itemPurchaseCounter),
    ]);
    return { owner: owners[0]!, inventory, counters };
  };
  const storedRows = async (count: number, itemId = "furniture") =>
    insertUserItems(
      Array.from({ length: count }, (_, index) => ({
        id: `stored-${itemId}-${index}`,
        userId,
        itemId,
        storedAtHome: true,
      })),
    );
  const buy = async () =>
    (await callerFor(itemRouter, userId)).buy({
      itemId: "furniture",
      villageId,
      stack: 1,
    });

  it("charges the standard item price and delivers an unplaced, unequipped home row", async () => {
    // Furniture authored with an equip slot, equip count or durability still arrives as
    // unequipped home storage.
    const database = await getTestDatabase();
    await database
      .update(item)
      .set({ slot: "ITEM", maxEquips: 3, maxDurability: 100 })
      .where(eq(item.id, "furniture"));
    const result = await buy();
    expect(result).toMatchObject({ success: true, userDelta: { money: -price } });
    const after = await snapshot();
    expect(after.owner.money).toBe(money - price);
    expect(after.inventory).toHaveLength(1);
    expect(after.inventory[0]).toMatchObject({
      itemId: "furniture",
      quantity: 1,
      storedAtHome: true,
      equipped: "NONE",
      durability: 0,
      homeX: null,
      homeY: null,
      homeRotation: 0,
    });
    const home = await (await callerFor(homeRouter, userId)).getUserHome();
    expect(home?.furniture.map(({ id }) => id)).toEqual([after.inventory[0]!.id]);
    expect(home?.layout).toEqual([]);
  });

  it("creates distinct owned copies through normal repeated item purchases", async () => {
    expect((await buy()).success).toBe(true);
    expect((await buy()).success).toBe(true);
    const after = await snapshot();
    expect(after.owner.money).toBe(money - 2 * price);
    expect(after.inventory).toHaveLength(2);
    expect(new Set(after.inventory.map(({ id }) => id)).size).toBe(2);
    expect(
      after.inventory.every(
        ({ itemId, quantity, storedAtHome }) =>
          itemId === "furniture" && quantity === 1 && storedAtHome,
      ),
    ).toBe(true);
  });

  it("rejects a full furniture home-storage bucket without payment or delivery", async () => {
    await storedRows(capacity);
    const before = await snapshot();
    expect(await buy()).toMatchObject({
      success: false,
      message: expect.stringContaining("storage is full"),
    });
    expect(await snapshot()).toEqual(before);
  });

  it("uses home capacity rather than a full carried inventory", async () => {
    const { owner } = await snapshot();
    await insertUserItems(
      Array.from({ length: calcMaxItems(owner) }, (_, index) => ({
        id: `carried-${index}`,
        userId,
        itemId: "ordinary",
        storedAtHome: false,
      })),
    );
    expect((await buy()).success).toBe(true);
    expect(
      (await snapshot()).inventory.filter(({ storedAtHome }) => storedAtHome),
    ).toHaveLength(1);
  });

  it("keeps full ordinary and material storage separate from furniture capacity", async () => {
    await storedRows(HomeTypeDetails.NONE.storage, "material");
    await storedRows(HomeTypeDetails.NONE.storage, "ordinary");
    expect((await buy()).success).toBe(true);
    const after = await snapshot();
    expect(
      after.inventory.filter(
        ({ storedAtHome, itemId }) => storedAtHome && itemId === "furniture",
      ),
    ).toHaveLength(1);
  });

  it("delivers only one of two concurrent purchases into the final storage slot", async () => {
    await storedRows(capacity - 1);
    const api = await callerFor(itemRouter, userId);
    const results = await Promise.all([
      api.buy({ itemId: "furniture", villageId, stack: 1 }),
      api.buy({ itemId: "furniture", villageId, stack: 1 }),
    ]);
    expect(results.filter(({ success }) => success)).toHaveLength(1);
    const after = await snapshot();
    expect(after.inventory).toHaveLength(capacity);
    expect(after.inventory.filter(({ id }) => !id.startsWith("stored-"))).toHaveLength(
      1,
    );
    expect(after.owner.money).toBe(money - price);
  });

  it("rejects checkout after a concurrent downgrade changes the home snapshot", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({
        homeType: "STUDIO_APARTMENT",
        regenAt: new Date(Date.now() + 60_000),
      })
      .where(eq(userData.userId, userId));
    await storedRows(capacity - 1);
    const before = await snapshot();
    let downgrade:
      | Awaited<ReturnType<ReturnType<typeof homeRouter.createCaller>["upgradeHome"]>>
      | undefined;
    const raced = beforeTransaction(database, async () => {
      downgrade = await (await callerFor(homeRouter, userId)).upgradeHome({
        homeType: "NONE",
      });
    });
    const purchase = await callerForDatabase(itemRouter, userId, raced).buy({
      itemId: "furniture",
      villageId,
      stack: 1,
    });
    expect(downgrade?.success).toBe(true);
    expect(purchase.success).toBe(false);
    const after = await snapshot();
    expect(after.owner.homeType).toBe("NONE");
    expect(after.inventory).toEqual(before.inventory);
    expect(after.owner.money).toBe(
      before.owner.money + Math.floor(HomeTypeDetails.STUDIO_APARTMENT.cost * 0.75),
    );
    expect(after.owner.updatedAt.getTime()).toBeGreaterThan(
      before.owner.updatedAt.getTime(),
    );
  });

  it("rejects a stale downgrade after checkout fills the furniture storage bucket", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({
        homeType: "STUDIO_APARTMENT",
        regenAt: new Date(Date.now() + 60_000),
      })
      .where(eq(userData.userId, userId));
    await storedRows(capacity - 1);
    let purchase:
      | Awaited<ReturnType<ReturnType<typeof itemRouter.createCaller>["buy"]>>
      | undefined;
    const raced = beforeStatements(database, userItem, [
      async () => {
        purchase = await buy();
      },
    ]);
    const downgrade = await callerForDatabase(homeRouter, userId, raced).upgradeHome({
      homeType: "NONE",
    });
    expect(purchase?.success).toBe(true);
    expect(downgrade.success).toBe(false);
    const after = await snapshot();
    expect(after.owner.homeType).toBe("STUDIO_APARTMENT");
    expect(after.inventory).toHaveLength(capacity);
    expect(after.owner.money).toBe(money - price);
    expect(
      after.inventory.filter(({ storedAtHome }) => storedAtHome).length,
    ).toBeLessThanOrEqual(HOME_FURNITURE_STORAGE_CAPACITY);
  });

  it("rejects insufficient funds and unsupported stacks without consuming quota", async () => {
    const database = await getTestDatabase();
    await Promise.all([
      database
        .update(userData)
        .set({ money: price - 1 })
        .where(eq(userData.userId, userId)),
      database
        .update(item)
        .set({ purchaseLimit: 1, purchaseLimitPeriod: "DAILY" })
        .where(eq(item.id, "furniture")),
    ]);
    const before = await snapshot();
    expect((await buy()).success).toBe(false);
    expect(await snapshot()).toEqual(before);
    const api = await callerFor(itemRouter, userId);
    expect((await api.buy({ itemId: "furniture", villageId, stack: 2 })).success).toBe(
      false,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a stale balance snapshot before delivery", async () => {
    const database = await getTestDatabase();
    const before = await snapshot();
    const raced = beforeTransaction(database, () =>
      database
        .update(userData)
        .set({ money: 0, updatedAt: getNextUserSnapshotAt(before.owner.updatedAt) })
        .where(eq(userData.userId, userId)),
    );
    const api = callerForDatabase(itemRouter, userId, raced);
    expect((await api.buy({ itemId: "furniture", villageId, stack: 1 })).success).toBe(
      false,
    );
    const after = await snapshot();
    expect(after.owner.money).toBe(0);
    expect(after.inventory).toEqual([]);
    expect(after.counters).toEqual([]);
  });

  it("rolls back payment when inventory delivery fails", async () => {
    const database = await getTestDatabase();
    const before = await snapshot();
    const failing = inTransactions(database, (tx) => failStatements(tx, userItem));
    const api = callerForDatabase(itemRouter, userId, failing);
    await expect(api.buy({ itemId: "furniture", villageId, stack: 1 })).rejects.toThrow(
      "Statement failed on purpose",
    );
    expect(await snapshot()).toEqual(before);
  });
});
