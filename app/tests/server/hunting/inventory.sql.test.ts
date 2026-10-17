import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  huntingHabitat,
  huntingProgress,
  huntingReceipt,
  huntingSession,
  item,
  sectorMap,
  userData,
  userItem,
} from "@/drizzle/schema";
import { updateBattle } from "@/libs/combat/database";
import type { CompleteBattle } from "@/libs/combat/types";
import { calcBattleResult } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { huntingRouter } from "@/routers/hunting";
import { itemRouter } from "@/routers/item";
import type { DrizzleClient } from "@/server/db";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { huntingHabitatContent, huntingMap } from "../../setup/hunting";
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
      aiProfile, battle, battleHistory, huntingHabitat, huntingProgress,
      huntingReceipt, huntingSession, item, sectorMap, userData, userItem,
    );
    await insertUsers([
      { userId: "hunter", username: "Hunter", occupation: "HUNTER", status: "AWAKE", huntingExperience: 123, sector: 1, rank: "JONIN", level: 50, isOutlaw: true, regeneration: 0 },
      { userId: "enemy", isAi: true },
    ]);
    await insertItems([
      { id: "hide", canBeHunted: true },
      { id: "tusk", canBeHunted: true },
      { id: "potion", itemType: "CONSUMABLE", canStack: true, stackSize: 10, slot: "ITEM" },
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
});
