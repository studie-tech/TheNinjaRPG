// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COST_EXTRA_ITEM_SLOT, COST_EXTRA_JUTSU_SLOT } from "@/drizzle/constants";
import {
  bloodline,
  item,
  itemLoadout,
  skillTree,
  userData,
  userItem,
  userItemImbuement,
  userSkill,
} from "@/drizzle/schema";
import { calcEnergy } from "@/libs/profile";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { bloodrightRouter } from "@/server/api/routers/bloodright";
import type { DrizzleClient } from "@/server/db";
import { fetchUserEquipment, itemRouter } from "@/server/api/routers/item";
import { countUserReads } from "../../setup/userReads";
import { beforeStatements } from "../../setup/statements";
import { makeEffect } from "../../libs/combat/helpers/battleScenario";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const userId = "cache-equipment-player";

describeWithDatabase("committed profile cache patches", () => {
  beforeEach(async () => {
    const db = await getTestDatabase();
    await resetTables(userItemImbuement, userSkill, skillTree, itemLoadout, userItem, item, userData, bloodline);
    await insertUsers([{
      userId,
      level: 10,
      rank: "JONIN",
      occupation: "CRAFTING",
      money: 10000,
      bank: 200,
      reputationPoints: 100,
      seichiSilver: 300,
      ninjutsuMastery: 100,
    }]);
    await insertItems([{
      id: "cache-armor",
      itemType: "ARMOR",
      slot: "CHEST",
      maxDurability: 100,
      cost: 1000,
      effects: [
        makeEffect("increasemastery", { masteryTypes: ["Ninjutsu"], power: 50 }),
        makeEffect("increasemaxpools", { poolsAffected: ["Energy"], power: 200 }),
      ],
    }]);
    await insertUserItems([{
      id: "worn-armor",
      userId,
      itemId: "cache-armor",
      equipped: "CHEST",
      durability: 0,
    }]);
    stubProfile("fetchUser", async (_client: unknown, id: string) =>
      db.query.userData.findFirst({ where: eq(userData.userId, id) }),
    );
  });

  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("returns confirmed slot deltas without needing an optional cache read", async () => {
    const db = await getTestDatabase();
    const failingCacheRead = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "query")
          return {
            ...target.query,
            userData: {
              ...target.query.userData,
              findFirst: () => Promise.reject(new Error("Cache read unavailable")),
            },
          };
        return Reflect.get(target, key, receiver);
      },
    });
    const caller = callerForDatabase(blackMarketRouter, userId, failingCacheRead);
    const result = await caller.buyItemSlot();
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ reputationPoints: -COST_EXTRA_ITEM_SLOT, extraItemSlots: 1 });
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(stored?.extraItemSlots).toBe(1);
    expect(stored?.reputationPoints).toBe(100 - COST_EXTRA_ITEM_SLOT);
  });

  it("returns repaired worn gear together with restored mastery and energy capacity", async () => {
    const db = await getTestDatabase();
    const before = await fetchUserEquipment(db, userId);
    expect(before?.maxEnergy).toBe(calcEnergy(10));
    expect(before?.effectiveMasteries.ninjutsuMastery).toBe(100);

    const caller = await callerFor(itemRouter, userId);
    const result = await caller.repair({ userItemId: "worn-armor" });
    expect(result.success).toBe(true);
    if (!("data" in result) || !result.data) throw new Error("Missing repair patch");
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(result.data.money).toBe(stored?.money);
    expect(result.data.money).toBeLessThan(10000);
    expect(result.data.items.map((row) => [row.id, row.durability])).toEqual([["worn-armor", 100]]);
    expect(result.data.maxEnergy).toBe(calcEnergy(10) + 200);
    expect(result.data.effectiveMasteries.ninjutsuMastery).toBe(150);

    const rejected = await caller.repair({ userItemId: "worn-armor" });
    expect(rejected.success).toBe(false);
    expect("data" in rejected).toBe(false);
  });

  it("returns an empty equipped list and removes derived bonuses after unequipping", async () => {
    const db = await getTestDatabase();
    await db.update(userItem).set({ durability: 100 }).where(eq(userItem.id, "worn-armor"));
    const caller = await callerFor(itemRouter, userId);
    const result = await caller.unequipAllItems();
    expect(result.success).toBe(true);
    if (!("data" in result) || !result.data || !("items" in result.data)) throw new Error("Missing unequip patch");
    expect(result.data.items).toEqual([]);
    expect(result.data.maxEnergy).toBe(calcEnergy(10));
    expect(result.data.effectiveMasteries.ninjutsuMastery).toBe(100);
  });

  it("does not read the profile again when nothing is equipped", async () => {
    const db = await getTestDatabase();
    await db.update(userItem).set({ equipped: "NONE" }).where(eq(userItem.id, "worn-armor"));
    const reads = vi.spyOn(db.query.userData, "findFirst");
    const caller = await callerFor(itemRouter, userId);
    const result = await caller.unequipAllItems();
    expect(result).toMatchObject({ success: true, data: {} });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("returns confirmed slot deltas without a postwrite user read", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ reputationPoints: sql`${userData.reputationPoints} + 7`, extraItemSlots: 2 }).where(eq(userData.userId, userId));
    const reads = vi.spyOn(db.query.userData, "findFirst");
    const caller = await callerFor(blackMarketRouter, userId);
    const result = await caller.buyItemSlot();
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ reputationPoints: -COST_EXTRA_ITEM_SLOT, extraItemSlots: 1 });
    expect(reads).toHaveBeenCalledTimes(1);
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(stored).toMatchObject({ reputationPoints: 107 - COST_EXTRA_ITEM_SLOT, extraItemSlots: 3 });
  });

  it("keeps full refreshes for pending energy queue settlement", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ energyTrainingQueue: [{ stat: "offence", energy: 10 }] }).where(eq(userData.userId, userId));
    expect(await fetchUserEquipment(db, userId)).toBeUndefined();
    const caller = await callerFor(blackMarketRouter, userId);
    expect((await caller.buyItemSlot()).userDelta).toBeUndefined();
  });

  it("prevents slot purchases from spending the same reputation snapshot twice", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(blackMarketRouter, userId);
    for (const [endpoint, cost, field] of [
      ["buyItemSlot", COST_EXTRA_ITEM_SLOT, "extraItemSlots"],
      ["buyJutsuSlot", COST_EXTRA_JUTSU_SLOT, "extraJutsuSlots"],
    ] as const) {
      await db.update(userData).set({ reputationPoints: cost, [field]: 0 }).where(eq(userData.userId, userId));
      const snapshot = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      stubProfile("fetchUser", async () => snapshot);
      const results = await Promise.all([caller[endpoint](), caller[endpoint]()]);
      expect(results.filter((result) => result.success)).toHaveLength(1);
      const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      expect(stored?.reputationPoints).toBe(0);
      expect(stored?.[field]).toBe(1);
    }
  });

  it("allows concurrent funded slot purchases and reports each confirmed increment", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(blackMarketRouter, userId);
    for (const [endpoint, cost, field] of [
      ["buyItemSlot", COST_EXTRA_ITEM_SLOT, "extraItemSlots"],
      ["buyJutsuSlot", COST_EXTRA_JUTSU_SLOT, "extraJutsuSlots"],
    ] as const) {
      await db.update(userData).set({ reputationPoints: cost * 2, [field]: 0 }).where(eq(userData.userId, userId));
      const snapshot = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      stubProfile("fetchUser", async () => snapshot);
      const results = await Promise.all([caller[endpoint](), caller[endpoint]()]);
      expect(results.every((result) => result.success)).toBe(true);
      for (const result of results) expect(result.userDelta).toEqual({ reputationPoints: -cost, [field]: 1 });
      const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      expect(stored?.reputationPoints).toBe(0);
      expect(stored?.[field]).toBe(2);
    }
  });

  it("returns confirmed Bloodright deltas and guarded arrays without another user read", async () => {
    const db = await getTestDatabase();
    await db.insert(bloodline).values({ id: "cache-line", name: "Cache Line", rank: "D", image: "", description: "Fixture", effects: [] });
    await db.update(userData).set({ bloodlineId: "cache-line" }).where(eq(userData.userId, userId));
    await db.insert(skillTree).values({ id: "cache-tier", name: "Cache Tier", image: "", description: "Fixture", effects: [], tier: 1, pathType: "BLOODRIGHT", bloodlineId: "cache-line", seichiSilverCost: 100 });
    let requiresUserRefresh = false;
    stubProfile("fetchUpdatedUser", async ({ client }: { client: DrizzleClient }) => ({ user: await client.query.userData.findFirst({ where: eq(userData.userId, userId) }), requiresUserRefresh }));
    const counted = countUserReads(db);
    const caller = callerForDatabase(bloodrightRouter, userId, counted.client);
    const purchased = await caller.purchase({ skillId: "cache-tier" });
    expect(purchased.userPatch).toEqual({ bloodright: [{ skillId: "cache-tier", cost: 100 }] });
    expect(purchased.userDelta).toEqual({ bloodrightSpent: 100, seichiSilver: -100 });
    expect(counted.getReads()).toBe(1);
    const refunded = await caller.refund({ skillId: "cache-tier" });
    expect(refunded.userPatch).toEqual({ bloodright: [] });
    expect(refunded.userDelta).toEqual({ bloodrightSpent: -100, seichiSilver: 100 });
    expect(counted.getReads()).toBe(2);
    await caller.purchase({ skillId: "cache-tier" });
    const reset = await caller.reset();
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(reset.userPatch).toEqual({ bloodright: [], bloodrightSpent: 0, monthlySkillResets: stored?.monthlySkillResets });
    expect(reset.userDelta).toEqual({ seichiSilver: 100 });
    expect(reset.userPatch?.monthlySkillResets?.count).toBe(1);
    expect(counted.getReads()).toBe(4);
    expect(stored?.seichiSilver).toBe(300);
    requiresUserRefresh = true;
    expect((await caller.purchase({ skillId: "cache-tier" })).userDelta).toBeUndefined();
    expect((await caller.refund({ skillId: "cache-tier" })).userDelta).toBeUndefined();
    await caller.purchase({ skillId: "cache-tier" });
    expect((await caller.reset()).userDelta).toBeUndefined();
  });

  it("rejects a changed invested amount before confirming a Bloodright reset refund", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ bloodright: [{ skillId: "cache-tier", cost: 100 }], bloodrightSpent: 100 }).where(eq(userData.userId, userId));
    stubProfile("fetchUpdatedUser", async () => ({ user: await db.query.userData.findFirst({ where: eq(userData.userId, userId) }), requiresUserRefresh: false }));
    const client = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ bloodrightSpent: 101 }).where(eq(userData.userId, userId));
    }]);
    const result = await callerForDatabase(bloodrightRouter, userId, client).reset();
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(stored?.seichiSilver).toBe(300);
    expect(stored?.bloodrightSpent).toBe(101);
    expect(stored?.bloodright).toEqual([{ skillId: "cache-tier", cost: 100 }]);
  });
});
