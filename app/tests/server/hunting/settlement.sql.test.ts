import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { battle, huntingProgress, huntingReceipt, huntingSession, item, userData, userItem } from "@/drizzle/schema";
import { calcBattleResult } from "@/libs/combat/util";
import { settleHuntingBattle } from "@/server/utils/hunting";
import { makeCompleteBattle, makeUser } from "../../libs/combat/helpers/battleScenario";
import { insertItems, insertUsers } from "../../setup/factories";
import { huntingBattleState } from "../../setup/hunting";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("Atomic hunting settlement", () => {
  beforeEach(async () => {
    await resetTables(battle, huntingProgress, huntingReceipt, huntingSession, item, userData, userItem);
    await insertUsers([{ userId: "hunter", username: "Hunter", status: "BATTLE", battleId: "hunt", huntingExperience: 123 }]);
    await insertItems([{ id: "hide", name: "Boar hide" }, { id: "tusk", name: "Boar tusk" }]);
    const db = await getTestDatabase();
    await db.insert(huntingSession).values({ userId: "hunter", id: "session", habitatId: "forest", contractId: "contract", sector: 1, version: 1, battleId: "hunt", readyAt: new Date(0), startedAt: new Date(0) });
    await db.insert(huntingProgress).values({ userId: "hunter", contractId: "contract" });
  });
  const setup = async (outcome: "Won" | "Lost" | "Fled" = "Won", final = false) => {
    const db = await getTestDatabase();
    const player = makeUser({ userId: "hunter", username: "Hunter", villageId: "village-a", direction: "right", curHealth: outcome === "Lost" ? 0 : 5000, fledBattle: outcome === "Fled" });
    const enemy = makeUser({ userId: "enemy", username: "Enemy", villageId: "village-b", direction: "left", isAi: true, curHealth: outcome === "Won" ? 0 : 5000 });
    const current = makeCompleteBattle({ usersState: [player, enemy], id: "hunt", battleType: "HUNTING", version: 0, extraState: { hunting: huntingBattleState(), villages: {}, wars: {}, clans: {}, anbuSquads: {}, items: {}, relations: {}, userQuests: {},  questData: {}, bounties: {}, bountySignups: {} } });
    current.extraState.hunting = { ...huntingBattleState(), used: final ? 2 : 0 };
    if (final) await db.update(huntingProgress).set({ used: 2 });
    await db.insert(battle).values({ ...current, createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date() });
    current.extraState.completedQuests = {};
    const result = calcBattleResult(current, "hunter");
    if (!result) throw Error("Missing battle result");
    return { db, current, result, version: current.version };
  };
  it("delivers exactly once when terminal callbacks race and on refresh", async () => {
    const { db, current, result, version } = await setup();
    const outcomes = await Promise.all([1, 2].map(() => settleHuntingBattle(db, current, result, version, async () => {})));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await settleHuntingBattle(db, current, result, version, async () => {})).toBe(false);
    expect(await db.query.huntingReceipt.findMany()).toHaveLength(1);
    expect((await db.query.userData.findFirst())?.huntingExperience).toBe(173);
    expect((await db.query.huntingProgress.findFirst())?.used).toBe(1);
    expect((await db.query.userItem.findMany()).filter((i) => i.itemId === "hide").reduce((n, i) => n + i.quantity, 0)).toBe(2);
    expect((await db.query.huntingSession.findFirst())?.lastResult?.remaining).toBe(2);
  });
  it("commits final allowance consumption and cooldown with rewards", async () => {
    const { db, current, result, version } = await setup("Won", true);
    await settleHuntingBattle(db, current, result, version, async () => {});
    const progress = await db.query.huntingProgress.findFirst();
    expect(progress?.used).toBe(3);
    expect(progress?.cooldownUntil?.getTime()).toBeGreaterThan(Date.now());
  });
  it.each(["Lost", "Fled"] as const)("keeps preparation and allowance after %s", async (outcome) => {
    const { db, current, result, version } = await setup(outcome);
    await settleHuntingBattle(db, current, result, version, async () => {});
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    expect((await db.query.userData.findFirst())?.huntingExperience).toBe(123);
    expect((await db.query.huntingProgress.findFirst())?.used).toBe(0);
    expect((await db.query.huntingSession.findFirst())?.readyAt?.getTime()).toBe(0);
    expect((await db.query.huntingSession.findFirst())?.battleId).toBeNull();
  });
  it("rolls back the battle, receipt, allowance and inventory if recovery fails", async () => {
    const { db, current, result, version } = await setup();
    await expect(settleHuntingBattle(db, current, result, version, async () => { throw Error("recovery failed"); })).rejects.toThrow("recovery failed");
    expect(await db.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeDefined();
    expect(await db.query.huntingReceipt.findMany()).toHaveLength(0);
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    expect((await db.query.huntingProgress.findFirst())?.used).toBe(0);
    expect((await db.query.userData.findFirst())?.huntingExperience).toBe(123);
    expect((await db.query.huntingSession.findFirst())?.battleId).toBe("hunt");
  });
  it("splits non-stackable and capped-stack material quantities", async () => {
    const { db, current, result, version } = await setup();
    const meta = current.extraState.hunting;
    if (!meta) throw Error("Missing hunting state");
    meta.contract.rewards = [{ itemId: "hide", quantity: 5, chance: 100 }, { itemId: "tusk", quantity: 2, chance: 100 }];
    meta.materialStacks = { hide: 2, tusk: 1 };
    await settleHuntingBattle(db, current, result, version, async () => {});
    const inventory = await db.query.userItem.findMany();
    expect(inventory.filter((i) => i.itemId === "hide").map((i) => i.quantity).sort()).toEqual([1, 2, 2]);
    expect(inventory.filter((i) => i.itemId === "tusk").map((i) => i.quantity)).toEqual([1, 1]);
  });
  it("uses fresh quest state and results when a settlement transaction deadlocks", async () => {
    const { db, current, result, version } = await setup();
    const snapshots: number[] = [];
    let attempts = 0;
    await settleHuntingBattle(db, current, result, version, async (_tx, playerBattle, playerResult) => {
      const state = playerBattle.extraState.hunting;
      if (!state) throw Error("Missing hunting state");
      snapshots.push(state.used);
      state.used += 1;
      playerResult.notifications.push("settled");
      if (++attempts === 1) throw Error("Deadlock found when trying to get lock");
    });
    expect(snapshots).toEqual([0, 0]);
    expect(current.extraState.hunting?.used).toBe(0);
    expect(result.notifications.filter((n) => n === "settled")).toHaveLength(1);
    expect((await db.query.huntingProgress.findFirst())?.used).toBe(1);
    expect(await db.query.huntingReceipt.findMany()).toHaveLength(1);
  });

});
