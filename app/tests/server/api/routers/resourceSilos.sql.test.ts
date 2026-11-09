import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { actionLog, item, resourceSilo, rewardPackage, userData, userItem, userRewards, userVote } from "@/drizzle/schema";
import { resourceSiloProgressUpdate, resolveWarTornRespawn } from "@/queries/resourceSilos";
import { resourceSilosRouter } from "@/server/api/routers/resourceSilos";
import { resetPvpExperienceAverageCache } from "@/server/utils/pvpExperience";
import type { DrizzleClient } from "@/server/db";
import * as time from "@/utils/time";
import { ObjectiveReward } from "@/validators/rewards";
import { makeBattleUser, makeCompleteBattle } from "../../../setup/combat";
import { insertItems, insertUsers, insertUserVotes } from "../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables, runRawSql } from "../../../setup/testDatabase";

const userId = "silo-player";
let window: ReturnType<typeof time.getResourceSiloWindow>;
const progress = (points = 60, claimed = false) => ({ windowId: window.id, points, claimed });
const row = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) });
const api = () => callerFor(resourceSilosRouter, userId);

describeWithDatabase("resource silo claims and recovery", () => {
  beforeEach(async () => {
    await resetTables(userData, resourceSilo, rewardPackage, actionLog, item, userItem, userRewards, userVote);
    resetPvpExperienceAverageCache();
    const now = new Date();
    window = { active: true, id: "2026-11-13T12:00:00.000Z", start: new Date(now.getTime() - 60000), end: new Date(now.getTime() + 60000), next: now };
    vi.spyOn(time, "getResourceSiloWindow").mockImplementation(() => window);
    await insertUsers([{ userId, username: userId, sector: 335, status: "AWAKE", resourceSiloProgress: progress(), money: 50000 }]);
    await insertUserVotes([{ userId }]);
    const db = await getTestDatabase();
    await db.insert(resourceSilo).values({ id: "war-torn", updatedAt: now, entries: [{ kind: "package", sourceId: "pack", name: "Supplies", chance: 100, rewards: ObjectiveReward.parse({ reward_money: 123 }) }] });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("commits exactly one payout for concurrent claims", async () => {
    const caller = await api();
    const results = await Promise.all([caller.claim(), caller.claim()]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await row())!.money).toBe(50123);
    expect((await row())!.resourceSiloProgress?.claimed).toBe(true);
    expect((await caller.claim()).success).toBe(false);
  });
  it("retries a rolled-back delivery without compounding PvP bonuses", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ pvpExperience: 100 }).where(eq(userData.userId, userId));
    let attempts = 0;
    const retrying = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") return (callback: Parameters<DrizzleClient["transaction"]>[0]) => db.transaction(async (tx) => {
          const result = await callback(tx);
          if (attempts++ === 0) throw Object.assign(new Error("Deadlock found when trying to get lock"), { errno: 1213, code: "ER_LOCK_DEADLOCK" });
          return result;
        });
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await callerForDatabase(resourceSilosRouter, userId, retrying).claim();
    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
    // This sole active player is at the population mean and receives its one-time 2% tier.
    expect((await row())!.money).toBe(50125);
  });
  it("enforces threshold, spawn, sector, awake state and active schedule", async () => {
    const db = await getTestDatabase(); const caller = await api();
    for (const patch of [{ resourceSiloProgress: progress(59) }, { resourceSiloProgress: { ...progress(), windowId: "old" } }, { sector: 334 }, { status: "BATTLE" as const, battleId: "busy" }, { isBanned: true }]) {
      await db.update(userData).set({ sector: 335, status: "AWAKE", battleId: null, isBanned: false, resourceSiloProgress: progress(), ...patch }).where(eq(userData.userId, userId));
      expect((await caller.claim()).success).toBe(false);
    }
    await db.update(userData).set({ sector: 335, status: "AWAKE", isBanned: false }).where(eq(userData.userId, userId));
    window.active = false;
    expect((await caller.claim()).success).toBe(false);
    expect((await row())!.money).toBe(50000);
  });
  it("rolls back the receipt and all grants when item delivery fails", async () => {
    const db = await getTestDatabase();
    await insertItems([{ id: "silo-cache", name: "Cache", itemType: "CONSUMABLE" }]);
    await db.update(resourceSilo).set({ entries: [{ kind: "cache", sourceId: "silo-cache", name: "Cache", chance: 100, rewards: ObjectiveReward.parse({ reward_money: 123, reward_items: [{ ids: ["silo-cache"], quantity: 1, number: 100 }] }) }] });
    await runRawSql("CREATE TRIGGER silo_fail_delivery BEFORE INSERT ON UserItem FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'delivery unavailable'");
    try { await expect((await api()).claim()).rejects.toThrow(); }
    finally { await runRawSql("DROP TRIGGER IF EXISTS silo_fail_delivery"); }
    expect((await row())!.money).toBe(50000);
    expect((await row())!.resourceSiloProgress?.claimed).toBe(false);
    expect((await (await api()).claim()).success).toBe(true);
    expect(await db.query.userItem.findMany()).toHaveLength(1);
    expect((await row())!.money).toBe(50123);
  });
  it("consumes a valid no-drop claim and hides stale-window progress", async () => {
    const db = await getTestDatabase();
    await db.update(resourceSilo).set({ entries: [{ kind: "package", sourceId: "zero", name: "Unlucky", chance: 0.000001, rewards: ObjectiveReward.parse({ reward_money: 10 }) }] });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect((await (await api()).claim()).success).toBe(true);
    expect((await row())!.money).toBe(50000);
    window.id = "next";
    const status = await (await api()).getStatus();
    expect(status.points).toBe(0); expect(status.claimed).toBe(false);
  });
  it("guards revival costs and consumes a death choice only once", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "HOSPITALIZED", warTornRespawn: true, sector: 1, curHealth: 0, curChakra: 1, curStamina: 1 }).where(eq(userData.userId, userId));
    const before = (await row())!;
    const results = await Promise.all([resolveWarTornRespawn(db, before, { x: 10, y: 5 }), resolveWarTornRespawn(db, before, { x: 10, y: 5 })]);
    expect(results.filter((result) => result.rowsAffected === 1)).toHaveLength(1);
    const revived = (await row())!;
    expect(revived.money).toBe(10000); expect(revived.status).toBe("AWAKE"); expect(revived.sector).toBe(335);
    expect(revived.curHealth).toBe(revived.maxHealth); expect(revived.curChakra).toBe(revived.maxChakra); expect(revived.curStamina).toBe(revived.maxStamina);
    expect(revived.warTornRespawn).toBe(false); expect(revived.immunityUntil.getTime()).toBe(0);
    await db.update(userData).set({ status: "HOSPITALIZED", warTornRespawn: true }).where(eq(userData.userId, userId));
    expect((await resolveWarTornRespawn(db, (await row())!, { x: 10, y: 5 })).rowsAffected).toBe(0);
    expect((await resolveWarTornRespawn(db, (await row())!, undefined)).rowsAffected).toBe(1);
    expect((await row())!.money).toBe(10000); expect((await row())!.status).toBe("HOSPITALIZED");
  });
  it("retains accrued Energy when revival resets the hospital clock", async () => {
    const db = await getTestDatabase();
    const at = new Date();
    await db.update(userData).set({ status: "HOSPITALIZED", warTornRespawn: true, curEnergy: 3, maxEnergy: 100, regeneration: 5, regenAt: new Date(at.getTime() - 120000) }).where(eq(userData.userId, userId));
    expect((await resolveWarTornRespawn(db, (await row())!, { x: 10, y: 5 }, at)).rowsAffected).toBe(1);
    expect((await row())!.curEnergy).toBe(13);
    expect((await row())!.regenAt.getTime()).toBe(at.getTime());
  });
  it("composes automatic waking with a successful claim and respects the opt-out", async () => {
    const db = await getTestDatabase(); const caller = await api();
    await db.update(userData).set({ status: "ASLEEP", autoWakeUp: false }).where(eq(userData.userId, userId));
    expect((await caller.claim()).success).toBe(false);
    expect((await row())!.status).toBe("ASLEEP");
    await db.update(userData).set({ autoWakeUp: true }).where(eq(userData.userId, userId));
    const result = await caller.claim();
    expect(result.success).toBe(true);
    expect("actionNotice" in result && result.actionNotice).toContain("woke you up");
    expect((await row())!.status).toBe("AWAKE");
    expect((await row())!.money).toBe(50123);
  });
  it("atomically increments and resets progress under the battle settlement receipt", async () => {
    const db = await getTestDatabase();
    const state = makeCompleteBattle({ id: "fight", battleType: "COMBAT", extraState: { resourceSiloWindowId: window.id }, usersState: [makeBattleUser(userId, { sector: 335, direction: "left", isAi: false }), makeBattleUser("foe", { sector: 335, direction: "right", isAi: false })] });
    await db.update(userData).set({ battleId: "fight", resourceSiloProgress: { ...progress(45), windowId: "old" } }).where(eq(userData.userId, userId));
    const patch = resourceSiloProgressUpdate(state, userId, { outcome: "Won" } as never, new Date());
    const settle = () => db.update(userData).set({ ...patch, battleId: null }).where(sql`${userData.userId} = ${userId} AND ${userData.battleId} = 'fight'`);
    await Promise.all([settle(), settle()]);
    expect((await row())!.resourceSiloProgress).toEqual(progress(10));
    await db.update(userData).set({ battleId: "fight-2" }).where(eq(userData.userId, userId));
    await db.update(userData).set(resourceSiloProgressUpdate(state, userId, { outcome: "Lost" } as never, new Date())).where(eq(userData.userId, userId));
    expect((await row())!.resourceSiloProgress?.points).toBe(15);
  });
  it("requires staff permissions and snapshots package payloads on save", async () => {
    const caller = await api();
    expect((await caller.save({ entries: [] })).success).toBe(false);
    await expect(caller.getEditor()).rejects.toThrow();
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "CONTENT" }).where(eq(userData.userId, userId));
    await db.insert(rewardPackage).values({ id: "source", name: "Pack", description: "", rewards: ObjectiveReward.parse({ reward_money: 321 }) });
    expect((await caller.save({ entries: [{ kind: "package", sourceId: "source", chance: 100 }] })).success).toBe(true);
    await db.delete(rewardPackage).where(eq(rewardPackage.id, "source"));
    expect((await caller.claim()).success).toBe(true);
    expect((await row())!.money).toBe(50321);
  });
});
