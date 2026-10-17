import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, aiProfile, battle, battleHistory, huntingHabitat, huntingProgress, huntingReceipt, huntingSession, item, mpvpBattleUser, questHistory, rankedPvpQueue, sectorMap, storeUserIdAlias, userData, userItem } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import type { CompleteBattle } from "@/libs/combat/types";
import { combatRouter } from "@/server/api/routers/combat";
import { huntingRouter } from "@/server/api/routers/hunting";
import { staffRouter } from "@/server/api/routers/staff";
import type { DrizzleClient } from "@/server/db";
import { insertItems, insertUsers } from "../../setup/factories";
import { huntingHabitatContent, huntingMap } from "../../setup/hunting";
import { beforeStatements } from "../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("staff changes during hunting admission", () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([{ result: [59, 60] }]));
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(actionLog, aiProfile, battle, battleHistory, huntingHabitat, huntingProgress, huntingReceipt, huntingSession, item, mpvpBattleUser, questHistory, rankedPvpQueue, sectorMap, storeUserIdAlias, userData, userItem);
    await insertUsers([
      { userId: "hunter", username: "Hunter", occupation: "HUNTER", status: "AWAKE", huntingExperience: 123, sector: 1, rank: "JONIN", level: 50, isOutlaw: true, regeneration: 0 },
      { userId: "enemy", isAi: true },
      { userId: "staff", username: "Terriator", role: "CODING-ADMIN" },
    ]);
    await insertItems([{ id: "hide", canBeHunted: true }, { id: "tusk", canBeHunted: true }]);
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
    const session = (await db.query.huntingSession.findFirst())!;
    return { db, hunter, id: session.id, version: session.version };
  };
  const settleVictory = async (db: DrizzleClient, userId = "hunter") => {
    const current = (await db.query.battle.findFirst()) as CompleteBattle;
    for (const enemy of current.usersState.filter((u) => u.isAi)) enemy.curHealth = 0;
    await db.update(battle).set({ usersState: current.usersState }).where(eq(battle.id, current.id));
    const combat = callerForDatabase(combatRouter, userId, db);
    expect((await combat.getBattle({ battleId: current.id })).result?.outcome).toBe("Won");
    await combat.getBattle({ battleId: current.id });
    expect(await db.query.huntingReceipt.findMany()).toHaveLength(1);
    expect(await db.query.huntingProgress.findFirst()).toMatchObject({ userId, used: 1 });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ status: "AWAKE", battleId: null, huntingExperience: 173 });
    expect((await db.query.userItem.findMany({ where: eq(userItem.itemId, "hide") })).reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
    return current;
  };

  it("rejects stale force-awake recovery without clearing the admitted hunt or its queues", async () => {
    const { db, hunter, id, version } = await prepare();
    const client = beforeStatements(db, userData, [async () => {
      expect((await hunter.start({ id })).success).toBe(true);
      await db.insert(rankedPvpQueue).values({ id: "queued", userId: "hunter", rankedLp: 100 });
    }]);
    const result = await callerForDatabase(staffRouter, "staff", client).forceAwake({ userId: "hunter", reason: "Recover a stranded hunter" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("changed") });
    const current = (await db.query.battle.findFirst())!;
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") })).toMatchObject({ status: "BATTLE", battleId: current.id });
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ battleId: current.id, version: version + 1 });
    expect(await db.query.battle.findMany()).toHaveLength(1);
    expect(await db.query.rankedPvpQueue.findMany()).toHaveLength(1);
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
    await settleVictory(db);
  });

  it.each(["identity", "version"] as const)("preserves a hunting session whose %s changed before recovery", async (change) => {
    const { db, id, version } = await prepare();
    const next = change === "identity" ? { id: "replacement" } : { version: version + 1 };
    const client = beforeStatements(db, userData, [async () => {
      await db.update(huntingSession).set(next).where(eq(huntingSession.userId, "hunter"));
    }]);
    expect((await callerForDatabase(staffRouter, "staff", client).forceAwake({ userId: "hunter", reason: "Recover a stranded hunter" })).success).toBe(false);
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ id, version, ...next, battleId: null });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("preserves a first hunting session accepted after recovery's empty preload", async () => {
    const db = await getTestDatabase();
    const hunter = callerForDatabase(huntingRouter, "hunter", db);
    const client = beforeStatements(db, userData, [async () => {
      expect((await hunter.accept({ habitatId: "forest", contractId: "contract", version: null })).success).toBe(true);
    }]);
    expect((await callerForDatabase(staffRouter, "staff", client).forceAwake({ userId: "hunter", reason: "Recover a stranded hunter" })).success).toBe(false);
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ version: 0, battleId: null });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("rejects a stale rename before ownership moves and permits retry after the admitted hunt settles", async () => {
    const { db, hunter, id } = await prepare();
    await db.insert(userItem).values({ id: "inventory", userId: "hunter", itemId: "hide", quantity: 1 });
    const client = beforeStatements(db, storeUserIdAlias, [async () => { expect((await hunter.start({ id })).success).toBe(true); }]);
    const result = await callerForDatabase(staffRouter, "staff", client).updateUserId({ userId: "hunter", newUserId: "renamed" });
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("changed") });
    const current = (await db.query.battle.findFirst()) as CompleteBattle;
    expect(current.extraState.hunting?.userId).toBe("hunter");
    expect(current.usersState.some((u) => u.userId === "hunter")).toBe(true);
    expect(await db.query.huntingSession.findFirst()).toMatchObject({ userId: "hunter", battleId: current.id });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "hunter") })).toMatchObject({ status: "BATTLE", battleId: current.id });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "renamed") })).toBeUndefined();
    expect(await db.query.userItem.findFirst({ where: eq(userItem.id, "inventory") })).toMatchObject({ userId: "hunter" });
    expect(await db.query.huntingProgress.findFirst()).toMatchObject({ userId: "hunter", used: 0 });
    expect(await db.query.storeUserIdAlias.findFirst()).toMatchObject({ oldUserId: "hunter", newUserId: "renamed" });
    await db.delete(userItem).where(eq(userItem.id, "inventory"));
    await settleVictory(db);
    expect((await callerForDatabase(staffRouter, "staff", db).updateUserId({ userId: "hunter", newUserId: "renamed" })).success).toBe(true);
    for (const table of [huntingSession, huntingProgress, huntingReceipt, userItem]) {
      expect(await db.select().from(table).where(eq(table.userId, "hunter"))).toHaveLength(0);
      expect((await db.select().from(table).where(eq(table.userId, "renamed"))).length).toBeGreaterThan(0);
    }
  });

  for (const operation of ["forceAwake", "updateUserId"] as const) {
    it(`rejects a stale hunt when ${operation} finishes before its admission, then settles a fresh hunt`, async () => {
      const { db, id } = await prepare();
      let paused!: () => void;
      let resume!: () => void;
      const reached = new Promise<void>((resolve) => { paused = resolve; });
      const wait = new Promise<void>((resolve) => { resume = resolve; });
      const client = new Proxy(db, { get(target, key, receiver) {
        if (key === "transaction") return async (...args: Parameters<typeof target.transaction>) => { paused(); await wait; return target.transaction(...args); };
        return Reflect.get(target, key, receiver);
      } });
      const pending = callerForDatabase(huntingRouter, "hunter", client).start({ id });
      try {
        await reached;
        const staff = callerForDatabase(staffRouter, "staff", db);
        const changed = operation === "forceAwake"
          ? await staff.forceAwake({ userId: "hunter", reason: "Recover a stranded hunter" })
          : await staff.updateUserId({ userId: "hunter", newUserId: "renamed" });
        expect(changed.success).toBe(true);
      } finally {
        resume();
      }
      expect((await pending).success).toBe(false);
      expect(await db.query.battle.findMany()).toHaveLength(0);
      const owner = operation === "forceAwake" ? "hunter" : "renamed";
      expect((await callerForDatabase(huntingRouter, owner, db).start({ id })).success).toBe(true);
      await settleVictory(db, owner);
    });
  }
});
