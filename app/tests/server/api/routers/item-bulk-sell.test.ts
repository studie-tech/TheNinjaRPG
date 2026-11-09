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
  runRawSql,
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
      {
        userId: seller,
        username: seller,
        status: "AWAKE",
        money: startMoney,
        farmCurrency: 0,
      },
      { userId: "other-player", username: "other-player", status: "AWAKE" },
    ]);
    await insertItems([
      { id: "potion", name: "Potion", cost: 100, rarity: "COMMON", inShop: true },
      { id: "blade", name: "Blade", cost: 1_000, rarity: "RARE", inShop: true },
      { id: "token", name: "Token", cost: 500, isEventItem: true },
      { id: "seed", name: "Seed", isFarmSeed: true, inShop: false, farmSellValue: 50 },
      {
        id: "relic",
        name: "Relic",
        cost: 3_000_000,
        rarity: "LEGENDARY",
        inShop: true,
      },
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
    expect(result.soldUserItemIds.sort()).toEqual([
      "blade-row",
      "potion-row",
      "token-row",
    ]);
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
    const logs = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.userId, seller));
    expect(logs.map((log) => log.relatedMsg)).toEqual(["Sold item: Relic"]);
  });

  it("sells the maximum batch, pays every stack and removes the paid rows", async () => {
    const ids = Array.from(
      { length: MAX_BULK_SELL_ITEMS },
      (_, index) => `batch-${index}`,
    );
    await insertUserItems(ids.map((id) => ({ id, userId: seller, itemId: "potion" })));
    const result = await sell(ids);
    expect(result.success).toBe(true);
    expect(result.soldUserItemIds.sort()).toEqual([...ids].sort());
    expect(result.refused).toEqual([]);
    expect(result.ryo).toBe(MAX_BULK_SELL_ITEMS * 20);
    expect(await money()).toBe(startMoney + MAX_BULK_SELL_ITEMS * 20);
    expect(await remaining(ids)).toEqual([]);
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
    expect(
      Object.fromEntries(
        result.refused.map((entry) => [entry.userItemId, entry.reason]),
      ),
    ).toEqual({
      "foreign-row": "is not in your inventory",
      "equipped-row": "is equipped",
      "home-row": "is stored at home",
      "auction-row": "is in auction",
      "crafting-row": "is being crafted",
      "seed-row": "needs 50 farm coins to buy back",
      "missing-row": "is not in your inventory",
    });
    expect(await money()).toBe(startMoney + 60);
    expect(await remaining(refusedIds)).toEqual(
      refusedIds.filter((id) => id !== "missing-row").sort(),
    );
  });

  it("pays nothing for a stack the guarded sale cannot consume", async () => {
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
    expect(result.refused.map((entry) => entry.userItemId).sort()).toEqual([
      "blade-row",
      "potion-row",
    ]);
    expect(result.userDelta).toEqual({ money: 0 });
    expect(result.message).toContain("Nothing was sold.");
    expect(await money()).toBe(startMoney);
    expect(await remaining(["potion-row", "blade-row"])).toEqual([
      "blade-row",
      "potion-row",
    ]);
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
    expect(await remaining(["equipped-row", "home-row"])).toEqual([
      "equipped-row",
      "home-row",
    ]);
  });

  it("refuses snapshots after quantity, auction, crafting or farm funds change", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ farmCurrency: 50 })
      .where(eq(userData.userId, seller));
    const snapshots = await itemQueries.listUserItemsForSellUserItems(
      database,
      { userId: seller },
      ["potion-row", "blade-row", "token-row", "seed-row"],
    );
    await Promise.all([
      database
        .update(userItem)
        .set({ quantity: 2 })
        .where(eq(userItem.id, "potion-row")),
      database
        .update(userItem)
        .set({ isInAuction: true })
        .where(eq(userItem.id, "blade-row")),
      database
        .update(userItem)
        .set({ craftingFinishedAt: new Date(Date.now() + 3_600_000) })
        .where(eq(userItem.id, "token-row")),
      database
        .update(userData)
        .set({ farmCurrency: 0 })
        .where(eq(userData.userId, seller)),
    ]);
    const sales = await Promise.all(
      snapshots.map((snapshot) =>
        itemQueries.sellUserItemAtomically(database, { userId: seller }, snapshot, 200),
      ),
    );
    expect(sales.map((sale) => sale.rowsAffected)).toEqual([0, 0, 0, 0]);
    expect(await money()).toBe(startMoney);
    expect(await remaining(snapshots.map((snapshot) => snapshot.id))).toEqual([
      "blade-row",
      "potion-row",
      "seed-row",
      "token-row",
    ]);
  });

  it("still pays for the sold stacks when another stack's sale fails", async () => {
    const remove = itemQueries.sellUserItemAtomically;
    vi.spyOn(itemQueries, "sellUserItemAtomically").mockImplementation(
      (client, ctx, useritem, price) => {
        if (useritem.id === "blade-row") throw new Error("Connection lost");
        return remove(client, ctx, useritem, price);
      },
    );
    const result = await sell(["potion-row", "blade-row"]);
    expect(result.success).toBe(true);
    expect(result.soldUserItemIds).toEqual(["potion-row"]);
    expect(result.ryo).toBe(60);
    expect(result.refused.map((entry) => entry.userItemId)).toEqual(["blade-row"]);
    expect(result.userDelta).toBeUndefined();
    expect(result.message).toContain("Sold 1 item for 60 ryo.");
    expect(result.message).toContain("Could not confirm Blade.");
    expect(result.message).not.toContain("stayed");
    expect(await money()).toBe(startMoney + 60);
    expect(await remaining(["potion-row", "blade-row"])).toEqual(["blade-row"]);
  });

  it.each([false, true])(
    "withholds the profile projection when a committed sale loses its acknowledgement (other confirmed sale=%s)",
    async (includeConfirmed) => {
      const execute = itemQueries.sellUserItemAtomically;
      vi.spyOn(itemQueries, "sellUserItemAtomically").mockImplementation(
        async (...args) => {
          const result = await execute(...args);
          if (args[2].id === "blade-row")
            throw new Error("Connection lost after commit");
          return result;
        },
      );
      const result = await sell(
        includeConfirmed ? ["potion-row", "blade-row"] : ["blade-row"],
      );
      expect(result.soldUserItemIds).toEqual(includeConfirmed ? ["potion-row"] : []);
      expect(result.ryo).toBe(includeConfirmed ? 60 : 0);
      expect(result.userDelta).toBeUndefined();
      expect(result.refused).toEqual([
        {
          userItemId: "blade-row",
          name: "Blade",
          reason: "sale could not be confirmed",
        },
      ]);
      expect(result.message).toContain("Could not confirm Blade.");
      expect(result.message).not.toContain("Nothing was sold");
      expect(result.message).not.toContain("stayed");
      expect(await money()).toBe(startMoney + 200 + (includeConfirmed ? 60 : 0));
      const database = await getTestDatabase();
      const [stack] = await database
        .select()
        .from(userItem)
        .where(eq(userItem.id, "blade-row"));
      expect(stack?.quantity).toBe(0);
    },
  );

  it("preserves the stack and its imbuements when payment is rejected", async () => {
    await runRawSql(
      "CREATE TRIGGER reject_bulk_sale_payment BEFORE UPDATE ON UserData FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment rejected'",
    );
    try {
      const result = await sell(["blade-row"]);
      expect(result.success).toBe(false);
      expect(result.soldUserItemIds).toEqual([]);
      expect(result.ryo).toBe(0);
      expect(await money()).toBe(startMoney);
      const database = await getTestDatabase();
      const [stack] = await database
        .select()
        .from(userItem)
        .where(eq(userItem.id, "blade-row"));
      expect(stack?.quantity).toBe(1);
      const imbuements = await database.select().from(userItemImbuement);
      expect(imbuements.map((row) => row.id)).toEqual(["blade-imbuement"]);
    } finally {
      await runRawSql("DROP TRIGGER IF EXISTS reject_bulk_sale_payment");
    }
    const retry = await sell(["blade-row"]);
    expect(retry.soldUserItemIds).toEqual(["blade-row"]);
    expect(await money()).toBe(startMoney + 200);
  });

  it("pays each stack once across concurrent sales and a replay", async () => {
    const results = await Promise.all([
      sell(["potion-row", "blade-row", "token-row"]),
      sell(["potion-row", "blade-row", "token-row"]),
    ]);
    expect(results.flatMap((result) => result.soldUserItemIds).sort()).toEqual([
      "blade-row",
      "potion-row",
      "token-row",
    ]);
    expect(results.reduce((sum, result) => sum + result.ryo, 0)).toBe(260);
    const replay = await sell(["potion-row", "blade-row", "token-row"]);
    expect(replay.soldUserItemIds).toEqual([]);
    expect(replay.ryo).toBe(0);
    expect(await money()).toBe(startMoney + 260);
  });

  it("rejects repeated ids and more than the bulk limit", async () => {
    await expect(sell(["potion-row", "potion-row"])).rejects.toThrow();
    await expect(
      sell(
        Array.from({ length: MAX_BULK_SELL_ITEMS + 1 }, (_, index) => `row-${index}`),
      ),
    ).rejects.toThrow();
    expect(await money()).toBe(startMoney);
  });
});
