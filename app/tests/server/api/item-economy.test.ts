import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { AUCTION_HOUSE_MIN_LEVEL } from "@/drizzle/constants";
import {
  actionLog,
  auctionListing,
  item,
  itemPurchaseCounter,
  quest,
  questHistory,
  userData,
  userItem,
} from "@/drizzle/schema";
import { auctionRouter } from "@/server/api/routers/auction";
import { itemRouter } from "@/server/api/routers/item";
import { getItemPurchasePeriodStart } from "@/utils/time";
import { QuestValidatorRawSchema } from "@/validators/objectives";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("item purchase quotas", () => {
  beforeEach(async () => {
    await resetTables(
      userItem,
      itemPurchaseCounter,
      questHistory,
      quest,
      item,
      userData,
    );
    await insertUsers([
      { userId: "buyer", villageId: "home", money: 10000, status: "AWAKE" },
    ]);
    await insertItems([
      {
        id: "limited",
        canStack: true,
        stackSize: 100,
        cost: 10,
        inShop: true,
        purchaseLimit: 5,
        purchaseLimitPeriod: "DAILY",
      },
    ]);
    await insertQuests([
      {
        id: "buy-quest",
        content: QuestValidatorRawSchema.shape.content.parse({
          objectives: [
            {
              id: "buy",
              task: "buy_item",
              buyItemIds: ["limited"],
              value: 10,
              description: "",
              successDescription: "",
            },
          ],
          reward: {},
          sceneBackground: "",
          sceneCharacters: [],
        }),
      },
    ]);
    await insertQuestHistory([
      { id: "buy-history", userId: "buyer", questId: "buy-quest", completed: 0 },
    ]);
  });

  const snapshot = async () => {
    const db = await getTestDatabase();
    const [users, inventory, counters, history] = await Promise.all([
      db.select().from(userData),
      db.select().from(userItem),
      db.select().from(itemPurchaseCounter),
      db.select().from(questHistory),
    ]);
    return { users, inventory, counters, history };
  };

  it.each(["DAILY", "WEEKLY", "MONTHLY"] as const)(
    "counts units and rejects excess %s purchases without side effects",
    async (purchaseLimitPeriod) => {
      const db = await getTestDatabase();
      await db.update(item).set({ purchaseLimitPeriod }).where(eq(item.id, "limited"));
      const api = await callerFor(itemRouter, "buyer");
      expect(
        await api.buy({ itemId: "limited", villageId: "home", stack: 3 }),
      ).toMatchObject({ success: true });
      const before = await snapshot();
      expect(before.counters[0]?.quantity).toBe(3);
      expect(before.inventory[0]?.quantity).toBe(3);
      expect(before.users[0]?.money).toBe(9970);
      expect(
        before.users[0]?.questData
          ?.find((q) => q.id === "buy-quest")
          ?.goals.find((g) => g.id === "buy")?.value,
      ).toBe(3);
      expect(await api.getPurchaseAllowance({ id: "limited" })).toMatchObject({
        limit: 5,
        purchased: 3,
        remaining: 2,
      });
      expect(
        await api.buy({ itemId: "limited", villageId: "home", stack: 3 }),
      ).toMatchObject({
        success: false,
        message: expect.stringContaining("2 remaining"),
      });
      expect(await snapshot()).toEqual(before);
      expect(
        await api.buy({ itemId: "limited", villageId: "home", stack: 2 }),
      ).toMatchObject({ success: true });
      expect(await api.getPurchaseAllowance({ id: "limited" })).toMatchObject({
        purchased: 5,
        remaining: 0,
      });
    },
  );

  it("NONE neither enforces nor writes a counter", async () => {
    const db = await getTestDatabase();
    await db
      .update(item)
      .set({ purchaseLimitPeriod: "NONE" })
      .where(eq(item.id, "limited"));
    const api = await callerFor(itemRouter, "buyer");
    expect(
      await api.buy({ itemId: "limited", villageId: "home", stack: 10 }),
    ).toMatchObject({ success: true });
    expect((await snapshot()).counters).toEqual([]);
  });

  it.each(["DAILY", "WEEKLY", "MONTHLY"] as const)(
    "ignores an expired %s counter",
    async (purchaseLimitPeriod) => {
      const db = await getTestDatabase();
      await db.update(item).set({ purchaseLimitPeriod }).where(eq(item.id, "limited"));
      await db
        .insert(itemPurchaseCounter)
        .values({
          userId: "buyer",
          itemId: "limited",
          period: purchaseLimitPeriod,
          periodStart: new Date("2000-01-01T00:00:00Z"),
          quantity: 5,
        });
      const api = await callerFor(itemRouter, "buyer");
      expect(
        await api.buy({ itemId: "limited", villageId: "home", stack: 5 }),
      ).toMatchObject({ success: true });
      expect((await snapshot()).counters).toHaveLength(2);
    },
  );

  it("does not reuse another period's counter with the same UTC start", async () => {
    const db = await getTestDatabase();
    await db.insert(itemPurchaseCounter).values({
      userId: "buyer",
      itemId: "limited",
      period: "WEEKLY",
      periodStart: getItemPurchasePeriodStart("DAILY")!,
      quantity: 5,
    });
    const api = await callerFor(itemRouter, "buyer");
    expect(await api.getPurchaseAllowance({ id: "limited" })).toMatchObject({ remaining: 5 });
    expect(await api.buy({ itemId: "limited", villageId: "home", stack: 5 })).toMatchObject({ success: true });
    const { counters } = await snapshot();
    expect(counters).toHaveLength(2);
    expect(counters.map((counter) => counter.period).sort()).toEqual(["DAILY", "WEEKLY"]);
    expect(await api.getPurchaseAllowance({ id: "limited" })).toMatchObject({ remaining: 0 });
  });

  it("does not consume quota or advance quests when funds are insufficient", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ money: 0 }).where(eq(userData.userId, "buyer"));
    const before = await snapshot();
    const api = await callerFor(itemRouter, "buyer");
    expect(
      await api.buy({ itemId: "limited", villageId: "home", stack: 1 }),
    ).toMatchObject({ success: false });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back balance and quest changes when another purchase consumes the last quota after the read", async () => {
    const db = await getTestDatabase();
    // Inject a competing committed quota claim after the endpoint's reads, before
    // its real transaction; all purchase writes still execute against MySQL.
    const raced = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== "transaction") return Reflect.get(target, key, receiver);
        return async (callback: Parameters<typeof db.transaction>[0]) => {
          await db
            .insert(itemPurchaseCounter)
            .values({
              userId: "buyer",
              itemId: "limited",
              period: "DAILY",
              periodStart: getItemPurchasePeriodStart("DAILY")!,
              quantity: 5,
            });
          return db.transaction(callback);
        };
      },
    });
    const before = await snapshot();
    const api = callerForDatabase(itemRouter, "buyer", raced);
    expect(
      await api.buy({ itemId: "limited", villageId: "home", stack: 1 }),
    ).toMatchObject({
      success: false,
      message: expect.stringContaining("0 remaining"),
    });
    const after = await snapshot();
    expect(after.users).toEqual(before.users);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.history).toEqual(before.history);
    expect(after.counters[0]?.quantity).toBe(5);
  });

  it("rolls back quota, payment, and quest changes if item delivery fails", async () => {
    const db = await getTestDatabase();
    const failing = new Proxy(db, {
      get(target, key, receiver) {
        if (key !== "transaction") return Reflect.get(target, key, receiver);
        return (callback: Parameters<typeof db.transaction>[0]) =>
          db.transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, key, receiver) {
                  if (key !== "insert") return Reflect.get(transaction, key, receiver);
                  return (table: Parameters<typeof tx.insert>[0]) => {
                    if (table === userItem) throw new Error("Delivery failed");
                    return tx.insert(table);
                  };
                },
              }),
            ),
          );
      },
    });
    const before = await snapshot();
    const api = callerForDatabase(itemRouter, "buyer", failing);
    await expect(
      api.buy({ itemId: "limited", villageId: "home", stack: 1 }),
    ).rejects.toThrow("Delivery failed");
    expect(await snapshot()).toEqual(before);
  });

  it("concurrent purchases cannot exceed quota", async () => {
    const api = await callerFor(itemRouter, "buyer");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        api.buy({ itemId: "limited", villageId: "home", stack: 2 }),
      ),
    );
    const successCount = results.filter((result) => result.success).length;
    const after = await snapshot();
    expect(successCount).toBeGreaterThan(0);
    expect(successCount).toBeLessThanOrEqual(2);
    expect(after.counters[0]?.quantity).toBe(successCount * 2);
    expect(after.inventory.reduce((total, row) => total + row.quantity, 0)).toBe(
      successCount * 2,
    );
    expect(after.users[0]?.money).toBe(10000 - successCount * 20);
  });
});

describeWithDatabase("auction item price bounds", () => {
  beforeEach(async () => {
    await resetTables(
      auctionListing,
      actionLog,
      userItem,
      itemPurchaseCounter,
      item,
      userData,
    );
    await insertUsers([
      { userId: "seller", level: AUCTION_HOUSE_MIN_LEVEL },
      { userId: "buyer" },
    ]);
    await insertItems([
      {
        id: "bounded",
        canBeTraded: true,
        canStack: true,
        stackSize: 10,
        auctionMinPrice: 10,
        auctionMaxPrice: 20,
      },
    ]);
    await insertUserItems([
      { id: "owned", itemId: "bounded", userId: "seller", quantity: 5 },
    ]);
  });
  const listing = {
    userItemId: "owned",
    listingType: "AUCTION" as const,
    durationHours: 24,
    currencyType: "MONEY" as const,
  };

  it.each([49, 50, 100, 101])(
    "validates full-stack total %i before inventory mutation",
    async (startingPrice) => {
      const api = await callerFor(auctionRouter, "seller");
      const result = await api.createAuctionListing({ ...listing, startingPrice });
      expect(result.success).toBe(startingPrice >= 50 && startingPrice <= 100);
      const db = await getTestDatabase();
      const inventory = await db.select().from(userItem);
      expect(inventory[0]?.quantity).toBe(5);
      expect(inventory[0]?.isInAuction).toBe(result.success);
    },
  );
  it.each([
    {
      currentQuantity: 2,
      quantity: undefined,
      startingPrice: 50,
      buyoutPrice: undefined,
      succeeds: false,
    },
    {
      currentQuantity: 6,
      quantity: undefined,
      startingPrice: 50,
      buyoutPrice: undefined,
      succeeds: false,
    },
    {
      currentQuantity: 4,
      quantity: 2,
      startingPrice: 30,
      buyoutPrice: undefined,
      succeeds: false,
    },
    {
      currentQuantity: 7,
      quantity: 2,
      startingPrice: 30,
      buyoutPrice: undefined,
      succeeds: false,
    },
    {
      currentQuantity: 4,
      quantity: 2,
      startingPrice: 20,
      buyoutPrice: 30,
      succeeds: false,
    },
    {
      currentQuantity: 6,
      quantity: 2,
      startingPrice: 30,
      buyoutPrice: undefined,
      succeeds: false,
    },
    {
      currentQuantity: 5,
      quantity: 2,
      startingPrice: 30,
      buyoutPrice: undefined,
      succeeds: true,
    },
  ])(
    "prices and reserves the actual stack after a quantity race: %j",
    async ({ currentQuantity, quantity, startingPrice, buyoutPrice, succeeds }) => {
      const db = await getTestDatabase();
      let firstRead = true;
      const raced = new Proxy(db, {
        get(target, key, receiver) {
          if (key !== "query") return Reflect.get(target, key, receiver);
          return {
            ...db.query,
            userItem: {
              ...db.query.userItem,
              findFirst: async (
                ...args: Parameters<typeof db.query.userItem.findFirst>
              ) => {
                const row = await db.query.userItem.findFirst(...args);
                if (firstRead) {
                  firstRead = false;
                  // Another inventory operation commits after the auction's first read.
                  await db
                    .update(userItem)
                    .set({ quantity: currentQuantity })
                    .where(eq(userItem.id, "owned"));
                }
                return row;
              },
            },
          };
        },
      });
      const api = callerForDatabase(auctionRouter, "seller", raced);
      expect(
        await api.createAuctionListing({
          ...listing,
          startingPrice,
          buyoutPrice,
          quantity,
        }),
      ).toMatchObject({ success: succeeds });
      const [inventory, listings, logs] = await Promise.all([
        db.select().from(userItem),
        db.select().from(auctionListing),
        db.select().from(actionLog),
      ]);
      expect(inventory.reduce((total, row) => total + row.quantity, 0)).toBe(
        currentQuantity,
      );
      expect(listings).toHaveLength(succeeds ? 1 : 0);
      expect(inventory.filter((row) => row.isInAuction)).toHaveLength(succeeds ? 1 : 0);
      if (succeeds) {
        expect(inventory.find((row) => row.isInAuction)?.quantity).toBe(quantity);
        expect(JSON.parse(logs[0]!.changes as string).quantity).toBe(quantity);
      } else {
        expect(inventory).toHaveLength(1);
        expect(logs).toHaveLength(0);
      }
    },
  );
  it.each([19, 20, 40, 41])(
    "validates split-stack total %i before splitting",
    async (startingPrice) => {
      const api = await callerFor(auctionRouter, "seller");
      const result = await api.createAuctionListing({
        ...listing,
        startingPrice,
        quantity: 2,
      });
      const succeeds = startingPrice >= 20 && startingPrice <= 40;
      expect(result.success).toBe(succeeds);
      const db = await getTestDatabase();
      const inventory = await db.select().from(userItem);
      expect(inventory).toHaveLength(succeeds ? 2 : 1);
      expect(inventory.reduce((total, row) => total + row.quantity, 0)).toBe(5);
    },
  );
  it.each([100, 101])("checks buyout total %i", async (buyoutPrice) => {
    const api = await callerFor(auctionRouter, "seller");
    expect(
      (await api.createAuctionListing({ ...listing, startingPrice: 50, buyoutPrice }))
        .success,
    ).toBe(buyoutPrice === 100);
  });
  it("allows direct offers outside configured bounds", async () => {
    const api = await callerFor(auctionRouter, "seller");
    expect(
      await api.createAuctionListing({
        ...listing,
        listingType: "DIRECT",
        startingPrice: 1,
        targetUserId: "buyer",
      }),
    ).toMatchObject({ success: true });
  });
});
