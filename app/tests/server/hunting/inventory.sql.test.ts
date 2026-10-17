import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  auctionBid,
  auctionListing,
  battle,
  battleHistory,
  huntingHabitat,
  huntingProgress,
  huntingReceipt,
  huntingSession,
  item,
  itemLoadout,
  itemVariant,
  sectorMap,
  userData,
  userItem,
  userItemVariant,
} from "@/drizzle/schema";
import { updateBattle } from "@/libs/combat/database";
import type { CompleteBattle } from "@/libs/combat/types";
import { calcBattleResult } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { auctionRouter } from "@/routers/auction";
import { huntingRouter } from "@/routers/hunting";
import { itemRouter } from "@/routers/item";
import type { DrizzleClient } from "@/server/db";
import { getTagSchema, IncreaseReskinSlots, RepairTag, UnlockItemVariantTag } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { huntingHabitatContent, huntingMap } from "../../setup/hunting";
import { beforeStatements } from "../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

/** Pause a real endpoint after its equipment or inventory preload has completed. */
const pauseRead = (db: DrizzleClient, equipment: boolean) => {
  const reached = gate();
  const resume = gate();
  const userQuery = new Proxy(db.query.userData, {
    get(target, key, receiver) {
      if (equipment && key === "findMany")
        return async (...args: Parameters<typeof target.findMany>) => {
          const rows = await target.findMany(...args);
          if ((args[0] as { with?: { items?: unknown } })?.with?.items) {
            reached.release();
            await resume.promise;
          }
          return rows;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const itemQuery = new Proxy(db.query.userItem, {
    get(target, key, receiver) {
      if (!equipment && key === "findMany")
        return async (...args: Parameters<typeof target.findMany>) => {
          const rows = await target.findMany(...args);
          reached.release();
          await resume.promise;
          return rows;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const query = new Proxy(db.query, {
    get(target, key, receiver) {
      if (key === "userData") return userQuery;
      if (key === "userItem") return itemQuery;
      return Reflect.get(target, key, receiver);
    },
  });
  const client = new Proxy(db, {
    get(target, key, receiver) {
      return key === "query" ? query : Reflect.get(target, key, receiver);
    },
  });
  return { client, reached: reached.promise, resume: resume.release };
};

/** Pause the real merge after its negative claims, before its publish statement executes. */
const pauseMergePublish = (db: DrizzleClient) => {
  const reached = gate();
  const resume = gate();
  let paused = false;
  const client = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "update")
        return (table: Parameters<typeof target.update>[0]) => {
          const builder = target.update(table);
          if (table !== userItem) return builder;
          return new Proxy(builder, {
            get(update, property, updateReceiver) {
              if (property === "set")
                return (values: Parameters<typeof update.set>[0]) => {
                  const setter = update.set(values);
                  if (paused || !("quantity" in values) || "updatedAt" in values)
                    return setter;
                  paused = true;
                  return new Proxy(setter, {
                    get(set, setKey, setReceiver) {
                      if (setKey === "where")
                        return (...args: Parameters<typeof set.where>) => {
                          const write = set.where(...args);
                          return new Proxy(write, {
                            get(statement, writeKey, writeReceiver) {
                              if (writeKey === "then")
                                return (...callbacks: Parameters<typeof statement.then>) => {
                                  reached.release();
                                  return resume.promise.then(() => statement.then(...callbacks));
                                };
                              return Reflect.get(statement, writeKey, writeReceiver);
                            },
                          });
                        };
                      return Reflect.get(set, setKey, setReceiver);
                    },
                  });
                };
              return Reflect.get(update, property, updateReceiver);
            },
          });
        };
      return Reflect.get(target, key, receiver);
    },
  });
  return { client, reached: reached.promise, resume: resume.release };
};

describeWithDatabase("Hunting inventory admission", () => {
  const pusher = { trigger: async () => {} } as unknown as PusherClient;
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json([{ result: [59, 60] }]),
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      aiProfile, auctionBid, auctionListing, battle, battleHistory, huntingHabitat, huntingProgress,
      huntingReceipt, huntingSession, item, itemLoadout, itemVariant, sectorMap,
      userData, userItem, userItemVariant,
    );
    await insertUsers([
      { userId: "hunter", username: "Hunter", occupation: "HUNTER", status: "AWAKE", huntingExperience: 123, sector: 1, rank: "JONIN", level: 50, isOutlaw: true, regeneration: 0 },
      { userId: "enemy", isAi: true },
    ]);
    await insertItems([
      { id: "hide", canBeHunted: true },
      { id: "tusk", canBeHunted: true },
      { id: "potion", itemType: "CONSUMABLE", canStack: true, stackSize: 10, slot: "ITEM" },
      { id: "spare", itemType: "CONSUMABLE", canStack: true, stackSize: 10, slot: "ITEM" },
    ]);
    const db = await getTestDatabase();
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await db.insert(huntingHabitat).values({ id: "forest", content: huntingHabitatContent(), updatedAt: new Date() });
    await db.insert(sectorMap).values({ id: "map", sector: 1, name: "Forest", width: 1, height: 1, status: "PUBLISHED", normalizedJson: huntingMap() });
  });
  afterEach(() => vi.restoreAllMocks());

  const prepare = async () => {
    const db = await getTestDatabase();
    const hunter = callerForDatabase(huntingRouter, "hunter", db);
    expect((await hunter.accept({ habitatId: "forest", contractId: "contract", version: null })).success).toBe(true);
    await db.update(huntingSession).set({ readyAt: new Date(0) });
    return { db, hunter, id: (await db.query.huntingSession.findFirst())!.id };
  };

  const settle = async (db: DrizzleClient) => {
    const current = (await db.query.battle.findFirst()) as CompleteBattle;
    for (const enemy of current.usersState.filter((u) => u.isAi)) enemy.curHealth = 0;
    const result = calcBattleResult(current, "hunter");
    if (!result) throw Error("No terminal result");
    expect(await updateBattle(db, result, "hunter", current, current.version, pusher)).not.toBeNull();
    expect(await db.query.huntingReceipt.findMany()).toHaveLength(1);
    expect(await db.query.huntingProgress.findFirst()).toMatchObject({ used: 1 });
    expect(await db.query.battle.findMany()).toHaveLength(0);
    return current;
  };

  const expectNoAdmission = async (db: DrizzleClient) => {
    expect(await db.query.battle.findMany()).toHaveLength(0);
    expect(await db.query.battleHistory.findMany()).toHaveLength(0);
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ battleId: null });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") })).toMatchObject({ status: "AWAKE", battleId: null });
    expect(await db.query.huntingReceipt.findMany()).toHaveLength(0);
    expect(await db.query.huntingProgress.findFirst()).toMatchObject({ used: 0 });
  };

  it.each([false, true])("rejects stale unequipped equipment before a merge (keeper: %s)", async (keeper) => {
    await staleEquipment(keeper, false);
  });

  it.each([false, true])("rejects stale equipment after the merge published (keeper: %s)", async (keeper) => {
    await staleEquipment(keeper, true);
  });

  const staleEquipment = async (keeper: boolean, publishFirst: boolean) => {
    const equippedId = keeper ? "a-equipped" : "z-equipped";
    await insertUserItems([
      { id: equippedId, itemId: "potion", userId: "hunter", quantity: 3, equipped: "ITEM_1" },
      { id: keeper ? "z-backpack" : "a-backpack", itemId: "potion", userId: "hunter", quantity: 4 },
    ]);
    const { db, hunter, id } = await prepare();
    const preload = pauseRead(db, true);
    const pendingStart = callerForDatabase(huntingRouter, "hunter", preload.client).start({ id });
    await preload.reached;
    expect((await callerForDatabase(itemRouter, "hunter", db).unequipAllItems()).success).toBe(true);
    const merge = pauseRead(db, false);
    const pendingMerge = callerForDatabase(itemRouter, "hunter", merge.client).mergeStacks({ itemId: "potion" });
    await merge.reached;
    if (publishFirst) {
      merge.resume();
      expect((await pendingMerge).success).toBe(true);
    }
    preload.resume();
    expect((await pendingStart).success).toBe(false);
    await expectNoAdmission(db);
    if (!publishFirst) {
      merge.resume();
      expect((await pendingMerge).success).toBe(true);
    }
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, equippedId) })).toEqual(
      keeper ? expect.objectContaining({ quantity: 7 }) : undefined,
    );
    expect((await hunter.start({ id })).success).toBe(true);
    await settle(db);
    expect((await db.query.userItem.findMany({ where: eq(userItem.itemId, "potion") })).reduce((n, row) => n + row.quantity, 0)).toBe(7);
  };

  it.each(["claim", "publish"] as const)("restores a backpack merge interrupted before %s by combat admission", async (phase) => {
    await insertUserItems([
      { id: "a", itemId: "potion", userId: "hunter", quantity: 3 },
      { id: "b", itemId: "potion", userId: "hunter", quantity: 4 },
      { id: "worn", itemId: "potion", userId: "hunter", quantity: 2, equipped: "ITEM_1" },
    ]);
    const { db, hunter, id } = await prepare();
    const merge = phase === "claim" ? pauseRead(db, false) : pauseMergePublish(db);
    const pendingMerge = callerForDatabase(itemRouter, "hunter", merge.client).mergeStacks({ itemId: "potion" });
    await merge.reached;
    expect((await hunter.start({ id })).success).toBe(true);
    merge.resume();
    expect((await pendingMerge).success).toBe(false);
    const current = await settle(db);
    expect(current.usersState.find((u) => u.userId === "hunter")!.items.map((i) => i.id)).toEqual(["worn"]);
    expect((await db.query.userItem.findMany({ where: eq(userItem.itemId, "potion") })).map((row) => [row.id, row.quantity]).sort()).toEqual([["a", 3], ["b", 4], ["worn", 2]]);
    expect((await callerForDatabase(itemRouter, "hunter", db).mergeStacks({ itemId: "potion" })).success).toBe(true);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "a") })).toMatchObject({ quantity: 7 });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity: 2 });
  });

  it.each([false, true])("waits for equipped merge claims hidden during preload (publish before admission: %s)", async (publishFirst) => {
    await insertUserItems([
      { id: "a", itemId: "potion", userId: "hunter", quantity: 3, equipped: "ITEM_1" },
      { id: "b", itemId: "potion", userId: "hunter", quantity: 4, equipped: "ITEM_1" },
    ]);
    const { db, hunter, id } = await prepare();
    const merge = pauseMergePublish(db);
    const pendingMerge = callerForDatabase(itemRouter, "hunter", merge.client).mergeStacks({ itemId: "potion" });
    await merge.reached;
    const preload = pauseRead(db, true);
    const pendingStart = callerForDatabase(huntingRouter, "hunter", preload.client).start({ id });
    await preload.reached;
    if (publishFirst) {
      merge.resume();
      expect((await pendingMerge).success).toBe(true);
    }
    preload.resume();
    expect((await pendingStart).success).toBe(false);
    await expectNoAdmission(db);
    if (!publishFirst) {
      merge.resume();
      expect((await pendingMerge).success).toBe(true);
    }
    expect((await hunter.start({ id })).success).toBe(true);
    await settle(db);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "a") })).toMatchObject({ quantity: 7 });
  });

  it("rejects durability changed after equipment preload without overwriting the repair", async () => {
    await insertUserItems([{ id: "worn", itemId: "potion", userId: "hunter", quantity: 3, equipped: "ITEM_1", durability: 20 }]);
    const { db, hunter, id } = await prepare();
    const preload = pauseRead(db, true);
    const pendingStart = callerForDatabase(huntingRouter, "hunter", preload.client).start({ id });
    await preload.reached;
    await db.update(userItem).set({ durability: 80 }).where(eq(userItem.id, "worn"));
    preload.resume();
    expect((await pendingStart).success).toBe(false);
    await expectNoAdmission(db);
    expect((await hunter.start({ id })).success).toBe(true);
    await settle(db);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity: 3, durability: 80 });
  });

  const inventoryActions = [
    "sell", "unequip", "toggle", "replace",
    "empty-loadout", "replacement-loadout", "same-loadout",
  ] as const;
  const changeInventory = (db: DrizzleClient, action: (typeof inventoryActions)[number]) => {
    const inventory = callerForDatabase(itemRouter, "hunter", db);
    switch (action) {
      case "sell": return inventory.sellUserItem({ userItemId: "worn" });
      case "unequip": return inventory.unequipAllItems();
      case "toggle": return inventory.toggleEquip({ userItemId: "worn" });
      case "replace": return inventory.toggleEquip({ userItemId: "spare", slot: "ITEM_1" });
      case "empty-loadout": return inventory.selectItemLoadout({ id: "empty" });
      case "replacement-loadout": return inventory.selectItemLoadout({ id: "replacement" });
      case "same-loadout": return inventory.selectItemLoadout({ id: "current" });
    }
  };

  it.each(
    inventoryActions.flatMap((action) =>
      [false, true].map((stale) => [action, stale] as const),
    ),
  )("preserves hunting inventory for %s (admission during deadlock retry: %s)", async (action, staleRequest) => {
    await insertUserItems([
      { id: "worn", itemId: "potion", userId: "hunter", quantity: 3, equipped: "ITEM_1" },
      { id: "spare", itemId: "spare", userId: "hunter", quantity: 2 },
    ]);
    const { db, hunter, id } = await prepare();
    await db.insert(itemLoadout).values([
      { id: "current", userId: "hunter", itemData: [{ userItemId: "worn", itemId: "potion", slot: "ITEM_1" }] },
      { id: "empty", userId: "hunter", itemData: [] },
      { id: "replacement", userId: "hunter", itemData: [{ userItemId: "spare", itemId: "spare", slot: "ITEM_1" }] },
    ]);
    await db.update(userData).set({ itemLoadout: "current", staffAccount: true }).where(eq(userData.userId, "hunter"));
    const before = await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") });
    if (!before) throw Error("Missing hunter");
    let admission: Promise<unknown> | undefined;
    const start = () => admission ??= hunter.start({ id }).then((saved) => {
      expect(saved.success).toBe(true);
    });
    if (!staleRequest) await start();
    const client = staleRequest
      ? beforeStatements(db, userItem, [
          async () => { throw Error("Deadlock found when trying to get lock"); },
          start,
          start,
        ])
      : db;
    expect(await changeInventory(client, action)).toMatchObject({
      success: false,
      message: expect.stringContaining("hunting battle"),
    });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity: 3, equipped: "ITEM_1" });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "spare") })).toMatchObject({ quantity: 2, equipped: "NONE" });
    expect(await db.query.itemLoadout.findFirst({ where: eq(itemLoadout.id, "current") })).toMatchObject({ itemData: [{ userItemId: "worn", itemId: "potion", slot: "ITEM_1" }] });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") })).toMatchObject({ money: before.money, itemLoadout: "current" });
    expect((await callerForDatabase(itemRouter, "hunter", db).splitStack({ userItemId: "worn", quantityToKeep: 1 })).success).toBe(false);
    await settle(db);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") })).toMatchObject({ status: "AWAKE", huntingExperience: 173 });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity: 3, equipped: "ITEM_1" });
    expect((await changeInventory(db, action)).success).toBe(true);
  });

  it("rejects ordinary item consumption after hunting wins admission", async () => {
    const { db, hunter, id } = await prepare();
    const before = await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") });
    await db.update(item).set({ effects: [IncreaseReskinSlots.parse({ power: 1 })] }).where(eq(item.id, "potion"));
    await insertUserItems([{ id: "worn", itemId: "potion", userId: "hunter", quantity: 3, equipped: "ITEM_1" }]);
    const client = beforeStatements(db, userItem, [async () => {
      expect((await hunter.start({ id })).success).toBe(true);
    }]);
    expect(await callerForDatabase(itemRouter, "hunter", client).consume({ userItemId: "worn" })).toMatchObject({ success: false, message: "Item no longer available — please refresh and try again" });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity: 3 });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") }))?.extraReskinSlots).toBe(before?.extraReskinSlots);
    await settle(db);
  });

  it.each([1, 3])("rejects stale variant consumption after admission (quantity: %s)", async (quantity) => {
    const { db, hunter, id } = await prepare();
    await db.update(item).set({ effects: [UnlockItemVariantTag.parse({})] }).where(eq(item.id, "potion"));
    await insertUserItems([
      { id: "worn", itemId: "potion", userId: "hunter", quantity, equipped: "ITEM_1" },
      { id: "owned-spare", itemId: "spare", userId: "hunter" },
    ]);
    await db.insert(itemVariant).values({ id: "variant", itemId: "spare", name: "Variant", image: "/variant.png", costType: "VARIANT_TOKEN" });
    const client = beforeStatements(db, userItem, [async () => {
      expect((await hunter.start({ id })).success).toBe(true);
    }]);
    expect((await callerForDatabase(itemRouter, "hunter", client).consumeVariantToken({ tokenUserItemId: "worn", variantId: "variant" })).success).toBe(false);
    expect(await db.query.userItemVariant.findMany()).toHaveLength(0);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity });
    await settle(db);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ quantity });
    expect((await callerForDatabase(itemRouter, "hunter", db).consumeVariantToken({ tokenUserItemId: "worn", variantId: "variant" })).success).toBe(true);
  });

  it.each([
    ["single", "target"], ["single", "kit"],
    ["all", "target"], ["all", "kit"],
  ] as const)("rejects stale %s repair after admission before the %s write", async (method, phase) => {
    const { db, hunter, id } = await prepare();
    await insertItems([{ id: "kit", name: "Repair kit", itemType: "CONSUMABLE", slot: "ITEM", destroyOnUse: true, maxDurability: 100, effects: [getTagSchema("repair").parse({ power: 100 })] }]);
    await db.update(item).set({ maxDurability: 100 }).where(eq(item.id, "potion"));
    await insertUserItems([
      { id: "worn", itemId: "potion", userId: "hunter", quantity: 3, equipped: "ITEM_1", durability: 20 },
      { id: "kit", itemId: "kit", userId: "hunter", equipped: "ITEM_2" },
    ]);
    const start = async () => { expect((await hunter.start({ id })).success).toBe(true); };
    const client = beforeStatements(db, userItem, phase === "target" ? [start] : [async () => {}, start]);
    const inventory = callerForDatabase(itemRouter, "hunter", client);
    const repaired = method === "single"
      ? await inventory.useRepairItem({ repairItemId: "kit", targetItemId: "worn" })
      : await inventory.useRepairAll();
    expect(repaired.success).toBe(false);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "kit") })).toMatchObject({ quantity: 1 });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "worn") })).toMatchObject({ durability: 20 });
    await settle(db);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") }))?.status).toBe("AWAKE");
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "kit") })).toMatchObject({ quantity: 1 });
  });

  it("rejects an auction reservation after the item enters a hunting battle", async () => {
    await insertUsers([{ userId: "buyer", username: "Buyer", status: "AWAKE", level: 50, bank: 10000 }]);
    const { db, hunter, id } = await prepare();
    await db.update(item).set({ canBeTraded: true, auctionMinPrice: 1, auctionMaxPrice: 1000 }).where(eq(item.id, "potion"));
    await insertUserItems([{ id: "lot", userId: "hunter", itemId: "potion", quantity: 3 }]);
    const auction = callerForDatabase(auctionRouter, "hunter", db);
    const listing = { userItemId: "lot", listingType: "AUCTION" as const, startingPrice: 100, buyoutPrice: 200, durationHours: 1, currencyType: "MONEY" as const };
    const stale = beforeStatements(db, userItem, [async () => {
      expect((await callerForDatabase(itemRouter, "hunter", db).toggleEquip({ userItemId: "lot", slot: "ITEM_1" })).success).toBe(true);
      expect((await hunter.start({ id })).success).toBe(true);
    }]);
    expect(await callerForDatabase(auctionRouter, "hunter", stale).createAuctionListing(listing)).toMatchObject({ success: false, message: expect.stringContaining("availability changed") });
    expect(await db.query.auctionListing.findMany()).toHaveLength(0);
    expect(await db.query.auctionBid.findMany()).toHaveLength(0);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "lot") })).toMatchObject({ userId: "hunter", equipped: "ITEM_1", isInAuction: false, quantity: 3 });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") })).toMatchObject({ bank: 10000 });
    await settle(db);
    expect((await callerForDatabase(itemRouter, "hunter", db).toggleEquip({ userItemId: "lot" })).success).toBe(true);
    expect((await auction.createAuctionListing(listing)).success).toBe(true);
    const created = (await db.query.auctionListing.findFirst())!;
    expect((await callerForDatabase(auctionRouter, "buyer", db).placeBid({ auctionId: created.id, amount: 200 })).success).toBe(true);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "lot") })).toMatchObject({ userId: "buyer", quantity: 3 });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") })).toMatchObject({ bank: 9800 });
  });

  it("rejects hunting equipment reserved by an auction after preload", async () => {
    const { db, id } = await prepare();
    await db.update(item).set({ canBeTraded: true, auctionMinPrice: 1, auctionMaxPrice: 1000 }).where(eq(item.id, "potion"));
    await insertUserItems([{ id: "lot", userId: "hunter", itemId: "potion", quantity: 3, equipped: "ITEM_1" }]);
    const preload = pauseRead(db, true);
    const pendingStart = callerForDatabase(huntingRouter, "hunter", preload.client).start({ id });
    await preload.reached;
    const inventory = callerForDatabase(itemRouter, "hunter", db);
    expect((await inventory.toggleEquip({ userItemId: "lot" })).success).toBe(true);
    const stale = beforeStatements(db, userItem, [async () => {
      expect((await callerForDatabase(auctionRouter, "hunter", db).createAuctionListing({ userItemId: "lot", listingType: "AUCTION", startingPrice: 100, buyoutPrice: 200, durationHours: 1, currencyType: "MONEY" })).success).toBe(true);
    }]);
    expect((await callerForDatabase(itemRouter, "hunter", stale).toggleEquip({ userItemId: "lot", slot: "ITEM_1" })).success).toBe(true);
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "lot") })).toMatchObject({ equipped: "ITEM_1", isInAuction: true });
    preload.resume();
    expect((await pendingStart).success).toBe(false);
    await expectNoAdmission(db);
    expect(await db.query.auctionListing.findMany()).toHaveLength(1);
  });

  it.each([1, 3])("preserves repair-kit refunds outside the hunting snapshot (stack quantity: %s)", async (quantity) => {
    await insertItems([
      { id: "armor", name: "Armor", itemType: "ARMOR", slot: "CHEST", maxDurability: 100 },
      { id: "low", name: "Low kit", itemType: "CONSUMABLE", slot: "ITEM", maxDurability: 0, destroyOnUse: true, canStack: true, stackSize: 10, effects: [RepairTag.parse({ power: 30 })] },
      { id: "high", name: "High kit", itemType: "CONSUMABLE", slot: "ITEM", maxDurability: 0, destroyOnUse: true, canStack: true, stackSize: 10, effects: [RepairTag.parse({ power: 50 })] },
    ]);
    await insertUserItems([
      { id: "worn", userId: "hunter", itemId: "armor", equipped: "CHEST", durability: 20 },
      { id: "low-kit", userId: "hunter", itemId: "low", equipped: "ITEM_1", quantity: 1 },
      { id: "high-kit", userId: "hunter", itemId: "high", equipped: "ITEM_2", quantity, level: 2, experience: 17, durability: 13 },
    ]);
    const { db, hunter, id } = await prepare();
    const paused = gate();
    const resume = gate();
    const client = beforeStatements(db, userItem, [async () => {}, async () => { paused.release(); await resume.promise; }]);
    const repair = callerForDatabase(itemRouter, "hunter", client).useRepairAll();
    await paused.promise;
    try {
      let consumed = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const kit = await db.query.userItem.findFirst({ where: eq(userItem.id, "high-kit") });
        if ((kit?.quantity ?? 0) === quantity - 1) { consumed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(consumed).toBe(true);
      expect((await hunter.start({ id })).success).toBe(true);
      const current = (await db.query.battle.findFirst()) as CompleteBattle;
      expect(current.usersState.find((u) => u.userId === "hunter")!.items.find((i) => i.id === "high-kit")?.quantity ?? 0).toBe(quantity - 1);
    } finally {
      resume.release();
    }
    expect(await repair).toMatchObject({ success: false, message: expect.stringContaining("Could not consume repair kits") });
    const refunded = (await db.query.userItem.findMany({ where: eq(userItem.itemId, "high") })).find((row) => row.id !== "high-kit");
    expect(refunded).toMatchObject({ userId: "hunter", equipped: "NONE", quantity: 1, level: 2, experience: 17, durability: 13 });
    await settle(db);
    const kits = await db.query.userItem.findMany({ where: eq(userItem.itemId, "high") });
    expect(kits.reduce((total, row) => total + row.quantity, 0)).toBe(quantity);
    expect(kits.find((row) => row.id === refunded!.id)).toMatchObject({ equipped: "NONE", quantity: 1 });
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "low-kit") })).toMatchObject({ quantity: 1 });
  });
});
