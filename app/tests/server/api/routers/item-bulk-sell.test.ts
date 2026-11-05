import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { MAX_BULK_SELL_ITEMS } from "@/drizzle/constants";
import {
  actionLog,
  huntingSession,
  item,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import * as itemQueries from "@/queries/item";
import { itemRouter } from "@/server/api/routers/item";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const seller = "bulk-seller";
const startMoney = 1_000;

const money = async () => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({ money: userData.money })
    .from(userData)
    .where(eq(userData.userId, seller));
  return row?.money;
};

const remaining = async (ids: string[]) => {
  const database = await getTestDatabase();
  const rows = await database
    .select({ id: userItem.id })
    .from(userItem)
    .where(inArray(userItem.id, ids));
  return rows.map((row) => row.id).sort();
};

const sell = async (userItemIds: string[]) =>
  (await callerFor(itemRouter, seller)).sellUserItems({ userItemIds });

/** Real inventory rows verify that only removed stacks are paid, and paid once. */
describeWithDatabase("bulk selling and dropping", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(
      actionLog,
      huntingSession,
      userItemImbuement,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      { userId: seller, username: seller, status: "AWAKE", money: startMoney, farmCurrency: 0 },
      { userId: "other-player", username: "other-player", status: "AWAKE" },
    ]);
    await insertItems([
      { id: "potion", name: "Potion", cost: 100, rarity: "COMMON", inShop: true },
      { id: "blade", name: "Blade", cost: 1_000, rarity: "RARE", inShop: true },
      { id: "token", name: "Token", cost: 500, isEventItem: true },
      { id: "seed", name: "Seed", isFarmSeed: true, inShop: false, farmSellValue: 50 },
      { id: "relic", name: "Relic", cost: 3_000_000, rarity: "LEGENDARY", inShop: true },
    ]);
    await insertUserItems([
      { id: "potion-row", userId: seller, itemId: "potion", quantity: 3 },
      { id: "blade-row", userId: seller, itemId: "blade" },
      { id: "token-row", userId: seller, itemId: "token" },
      { id: "seed-row", userId: seller, itemId: "seed" },
      { id: "relic-row", userId: seller, itemId: "relic" },
      { id: "equipped-row", userId: seller, itemId: "blade", equipped: "HAND_1" },
      { id: "home-row", userId: seller, itemId: "potion", storedAtHome: true },
      { id: "auction-row", userId: seller, itemId: "potion", isInAuction: true },
      {
        id: "crafting-row",
        userId: seller,
        itemId: "potion",
        craftingFinishedAt: new Date(Date.now() + 3_600_000),
      },
      { id: "foreign-row", userId: "other-player", itemId: "potion" },
    ]);
    const database = await getTestDatabase();
    await database.insert(userItemImbuement).values({
      id: "blade-imbuement",
      userItemId: "blade-row",
      imbuementItemId: "potion",
      craftingFinishedAt: new Date(0),
    });
  });

  it("sells a mix and pays the summed ryo once", async () => {
    const result = await sell(["potion-row", "blade-row", "token-row"]);
    expect(result.success).toBe(true);
    // Selling pays 20% of the cost for each stack: 3 potions (60) and a blade (200).
    expect(result.ryo).toBe(260);
    expect(result.soldUserItemIds.sort()).toEqual(["blade-row", "potion-row", "token-row"]);
    expect(result.refused).toEqual([]);
    expect(result.userDelta).toEqual({ money: 260 });
    expect(await money()).toBe(startMoney + 260);
    expect(await remaining(["potion-row", "blade-row", "token-row"])).toEqual([]);
    const database = await getTestDatabase();
    expect(await database.select().from(userItemImbuement)).toEqual([]);
  });

  it("logs a sale of an expensive item, as a single sale does", async () => {
    const result = await sell(["relic-row"]);
    expect(result.ryo).toBe(600_000);
    const database = await getTestDatabase();
    const logs = await database.select().from(actionLog).where(eq(actionLog.userId, seller));
    expect(logs.map((log) => log.relatedMsg)).toEqual(["Sold item: Relic"]);
  });

  it("refuses rows that are not the player's carried stock and pays nothing for them", async () => {
    const refusedIds = [
      "foreign-row",
      "equipped-row",
      "home-row",
      "auction-row",
      "crafting-row",
      "seed-row",
      "missing-row",
    ];
    const result = await sell(["potion-row", ...refusedIds]);
    expect(result.soldUserItemIds).toEqual(["potion-row"]);
    expect(result.ryo).toBe(60);
    expect(Object.fromEntries(result.refused.map((entry) => [entry.userItemId, entry.reason]))).toEqual({
      "foreign-row": "is not in your inventory",
      "equipped-row": "is equipped",
      "home-row": "is stored at home",
      "auction-row": "is in auction",
      "crafting-row": "is being crafted",
      "seed-row": "needs 50 farm coins to buy back",
      "missing-row": "is not in your inventory",
    });
    expect(await money()).toBe(startMoney + 60);
    expect(await remaining(refusedIds)).toEqual(refusedIds.filter((id) => id !== "missing-row").sort());
  });

  it("pays nothing for a stack the guarded delete cannot remove", async () => {
    const database = await getTestDatabase();
    await database.insert(huntingSession).values({
      userId: seller,
      id: "hunt",
      habitatId: "habitat",
      contractId: "contract",
      sector: 1,
      battleId: "battle",
      startedAt: new Date(),
    });
    const result = await sell(["potion-row", "blade-row"]);
    expect(result.success).toBe(false);
    expect(result.soldUserItemIds).toEqual([]);
    expect(result.ryo).toBe(0);
    expect(result.refused.map((entry) => entry.userItemId).sort()).toEqual(["blade-row", "potion-row"]);
    expect(await money()).toBe(startMoney);
    expect(await remaining(["potion-row", "blade-row"])).toEqual(["blade-row", "potion-row"]);
  });

  it("leaves a stack equipped or stored at home after it was checked", async () => {
    const list = itemQueries.listUserItemsForSellUserItems;
    // The rows read as carried, then the player equips one and stores the other.
    vi.spyOn(itemQueries, "listUserItemsForSellUserItems").mockImplementation(((
      ...args: Parameters<typeof list>
    ) =>
      list(...args).then((rows) =>
        rows.map((row) => ({ ...row, equipped: "NONE" as const, storedAtHome: false })),
      )) as never);
    const result = await sell(["potion-row", "equipped-row", "home-row"]);
    expect(result.soldUserItemIds).toEqual(["potion-row"]);
    expect(result.ryo).toBe(60);
    expect(result.refused.map((entry) => entry.userItemId).sort()).toEqual([
      "equipped-row",
      "home-row",
    ]);
    expect(await money()).toBe(startMoney + 60);
    expect(await remaining(["equipped-row", "home-row"])).toEqual(["equipped-row", "home-row"]);
  });

  it("still pays for the removed stacks when another stack's delete fails", async () => {
    const remove = itemQueries.deleteUserItemForSellUserItems;
    vi.spyOn(itemQueries, "deleteUserItemForSellUserItems").mockImplementation(
      (client, ctx, useritem) => {
        if (useritem.id === "blade-row") throw new Error("Connection lost");
        return remove(client, ctx, useritem);
      },
    );
    const result = await sell(["potion-row", "blade-row"]);
    expect(result.success).toBe(true);
    expect(result.soldUserItemIds).toEqual(["potion-row"]);
    expect(result.ryo).toBe(60);
    expect(result.refused.map((entry) => entry.userItemId)).toEqual(["blade-row"]);
    expect(await money()).toBe(startMoney + 60);
    expect(await remaining(["potion-row", "blade-row"])).toEqual(["blade-row"]);
  });

  it("rejects repeated ids and more than the bulk limit", async () => {
    await expect(sell(["potion-row", "potion-row"])).rejects.toThrow();
    await expect(
      sell(Array.from({ length: MAX_BULK_SELL_ITEMS + 1 }, (_, index) => `row-${index}`)),
    ).rejects.toThrow();
    expect(await money()).toBe(startMoney);
  });
});
