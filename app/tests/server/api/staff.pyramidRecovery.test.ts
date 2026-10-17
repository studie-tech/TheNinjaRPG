import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, getTableName } from "drizzle-orm";
import { actionLog, battle, huntingHabitat, huntingProgress, huntingReceipt, huntingSession, mpvpBattleUser, quest, questHistory, rankedPvpQueue, userData, userItem } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { getIsolatedPyramid } from "@/libs/questRun";
import { combatRouter } from "@/server/api/routers/combat";
import { huntingRouter } from "@/server/api/routers/hunting";
import { profileRouter } from "@/server/api/routers/profile";
import { staffRouter } from "@/server/api/routers/staff";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { makeBattleUser, makeCompleteBattle } from "../../libs/combat/helpers/battleScenario";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { huntingBattleState, huntingHabitatContent } from "../../setup/hunting";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables, runRawSql } from "../../setup/testDatabase";

describeWithDatabase("staff Pyramid recovery", () => {
  beforeEach(async () => {
    await runRawSql("DROP TRIGGER IF EXISTS staff_recovery_failure");
    await runRawSql("DROP TRIGGER IF EXISTS staff_hunt_cleanup_failure");
    await resetTables(huntingHabitat, huntingSession, huntingProgress, huntingReceipt, userItem, questHistory, quest, userData, actionLog, mpvpBattleUser, rankedPvpQueue, battle);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertUsers([
      { userId: "hero", status: "BATTLE", battleId: null, regeneration: 10, curHealth: 100, maxHealth: 1000, updatedAt: new Date(Date.now() - 350_000), regenAt: new Date(Date.now() - 125_000) },
      { userId: "staff", role: "OWNER" },
    ]);
    await insertQuests([{
      id: "pyramid", questType: "battlepyramid", hidden: false,
      content: { isolated: true, entryItems: [], objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    }]);
    await insertQuestHistory([{ id: "attempt", userId: "hero", questId: "pyramid", questType: "battlepyramid", isolated: true }]);
  });
  afterEach(async () => {
    await runRawSql("DROP TRIGGER IF EXISTS staff_recovery_failure");
    await runRawSql("DROP TRIGGER IF EXISTS staff_hunt_cleanup_failure");
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });

  /** A terminal hunt whose preloaded reward snapshot still holds the admission's session version. */
  const setupHuntingEncounter = async () => {
    const database = await getTestDatabase();
    const current = makeCompleteBattle({
      id: "hunt", battleType: "HUNTING", background: "default", version: 0, activeUserId: "hero",
      createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date(),
      usersState: [
        makeBattleUser("hero", { direction: "right", villageId: "one", sector: 1 }),
        makeBattleUser("enemy", { direction: "left", villageId: "two", isAi: true, curHealth: 0 }),
      ],
      extraState: { hunting: { ...huntingBattleState(), userId: "hero", used: 1 }, villages: {}, wars: {}, clans: {}, anbuSquads: {}, items: {}, relations: {}, userQuests: {}, questData: {}, bounties: {}, bountySignups: {} },
    });
    await database.insert(battle).values(current);
    await database.update(userData).set({ occupation: "HUNTER", battleId: current.id, huntingExperience: 123 }).where(eq(userData.userId, "hero"));
    await database.insert(huntingHabitat).values({ id: "forest", content: huntingHabitatContent(), updatedAt: new Date(0) });
    await database.insert(huntingSession).values({ userId: "hero", id: "session", habitatId: "forest", contractId: "contract", sector: 1, battleId: current.id, version: 1, readyAt: new Date(0), startedAt: new Date(0) });
    await database.insert(huntingProgress).values({ userId: "hero", contractId: "contract", used: 1 });
    return { database, current };
  };

  it("releases a hunting encounter while preserving preparation and partial allowance", async () => {
    const { database } = await setupHuntingEncounter();
    expect((await (await callerFor(staffRouter, "staff")).forceAwake({ userId: "hero", reason: "Recover a stranded hunter" })).success).toBe(true);
    expect(await database.query.huntingSession.findFirst()).toMatchObject({ battleId: null, readyAt: new Date(0), version: 2 });
    expect((await database.query.huntingProgress.findFirst())?.used).toBe(1);
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeUndefined();
    const oldTab = await callerFor(combatRouter, "hero");
    expect(await oldTab.getBattle({ battleId: "hunt" })).toEqual({ battle: null, result: null });
    expect(await oldTab.performAction({ battleId: "hunt", version: 0 })).toEqual({ updateClient: true });
  });

  it("keeps the hunting battle recoverable when waking the character fails", async () => {
    const { database } = await setupHuntingEncounter();
    await runRawSql("CREATE TRIGGER staff_recovery_failure BEFORE UPDATE ON UserData FOR EACH ROW BEGIN IF OLD.userId = 'hero' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery write failed'; END IF; END");
    await expect((await callerFor(staffRouter, "staff")).forceAwake({ userId: "hero", reason: "Recover a stranded hunter" })).rejects.toThrow("Failed query");
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeDefined();
    expect(await database.query.huntingSession.findFirst()).toMatchObject({ battleId: "hunt", version: 1 });
  });

  it.each(["getBattle", "performAction"] as const)("keeps recovery committed after cleanup fails and rejects a stale %s payout", async route => {
    const { database } = await setupHuntingEncounter();
    await runRawSql("CREATE TRIGGER staff_hunt_cleanup_failure BEFORE DELETE ON Battle FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cleanup failed'");
    await expect((await callerFor(staffRouter, "staff")).forceAwake({ userId: "hero", reason: "Recover a stranded hunter" })).rejects.toThrow("Failed query");
    expect(await database.query.huntingSession.findFirst()).toMatchObject({ battleId: null, readyAt: new Date(0), version: 2 });
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeDefined();
    await runRawSql("DROP TRIGGER staff_hunt_cleanup_failure");
    const oldTab = await callerFor(combatRouter, "hero");
    if (route === "getBattle")
      await expect(oldTab.getBattle({ battleId: "hunt" })).rejects.toThrow("Hunting session changed during settlement");
    else
      expect(await oldTab.performAction({ battleId: "hunt", version: 0 })).toEqual({ updateClient: true, notification: "Unable to update battle. Please try again." });
    expect(await database.query.huntingReceipt.findMany()).toHaveLength(0);
    expect(await database.query.userItem.findMany()).toHaveLength(0);
    expect(await database.query.huntingProgress.findFirst()).toMatchObject({ used: 1, cooldownUntil: null, version: 0 });
    const profile = await (await callerFor(profileRouter, "hero")).getUser();
    expect(profile.userData).toMatchObject({ status: "AWAKE", battleId: null, huntingExperience: 123 });
    expect(getIsolatedPyramid(profile.userData)).toBeUndefined();
    const board = await (await callerFor(huntingRouter, "hero")).getBoard();
    expect(board.user).toMatchObject({ status: "AWAKE", huntingExperience: 123 });
    expect(board.session).toMatchObject({ battleId: null, readyAt: new Date(0), version: 2 });
    expect(board.progress).toEqual([expect.objectContaining({ used: 1, cooldownUntil: null })]);
  });

  it("deletes only the captured fight when a new hunt starts before cleanup", async () => {
    const { database, current } = await setupHuntingEncounter();
    const client = new Proxy(database, { get(target, property, receiver) {
      if (property === "execute") return async (...args: Parameters<typeof target.execute>) => {
        const recovered = await target.execute(...args);
        // Admit the next fight after recovery commits, while cleanup of the previous fight waits.
        await target.insert(battle).values({ ...current, id: "next-hunt" });
        await target.update(huntingSession).set({ battleId: "next-hunt", version: 3 }).where(eq(huntingSession.userId, "hero"));
        await target.update(userData).set({ status: "BATTLE", battleId: "next-hunt" }).where(eq(userData.userId, "hero"));
        return recovered;
      };
      return Reflect.get(target, property, receiver);
    } });
    expect((await callerForDatabase(staffRouter, "staff", client).forceAwake({ userId: "hero", reason: "Recover a stranded hunter" })).success).toBe(true);
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeUndefined();
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "next-hunt") })).toBeDefined();
    expect(await database.query.huntingSession.findFirst()).toMatchObject({ battleId: "next-hunt", version: 3 });
    expect(await database.query.userData.findFirst({ where: eq(userData.userId, "hero") })).toMatchObject({ status: "BATTLE", battleId: "next-hunt" });
  });

  for (const table of [userData, questHistory]) {
    it(`keeps isolation and status intact when ${getTableName(table)} fails`, async () => {
      const client = await getTestDatabase();
      const snapshot = await client.query.userData.findFirst({ where: eq(userData.userId, "hero") });
      await runRawSql(`CREATE TRIGGER staff_recovery_failure BEFORE UPDATE ON \`${getTableName(table)}\` FOR EACH ROW BEGIN IF OLD.userId = 'hero' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery write failed'; END IF; END`);
      const caller = await callerFor(staffRouter, "staff");
      await expect(caller.forceAwake({ userId: "hero", reason: "Recover a stranded player" })).rejects.toThrow("Failed query");
      const [stored, history] = await Promise.all([
        client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
        client.query.questHistory.findFirst({ where: eq(questHistory.id, "attempt") }),
      ]);
      expect(stored).toMatchObject({ status: "BATTLE", battleId: null, curHealth: 100 });
      expect(stored?.updatedAt).toEqual(snapshot?.updatedAt);
      expect(history).toMatchObject({ completed: 0, endAt: null, isolated: true });
      await runRawSql("DROP TRIGGER staff_recovery_failure");
      const profile = await (await callerFor(profileRouter, "hero")).getUser();
      expect(profile.userData).toMatchObject({ status: "BATTLE", curHealth: 100 });
      expect(getIsolatedPyramid(profile.userData)?.questId).toBe("pyramid");
    });
  }

  for (const hasRun of [false, true]) {
    it(`recovers a player ${hasRun ? "with" : "without"} Pyramid history and preserves logging and queue cleanup`, async () => {
      const client = await getTestDatabase();
      if (!hasRun) await resetTables(questHistory);
      const snapshot = await client.query.userData.findFirst({ where: eq(userData.userId, "hero") });
      await client.insert(rankedPvpQueue).values({ id: "queued", userId: "hero", rankedLp: 100 });
      const result = await (await callerFor(staffRouter, "staff")).forceAwake({ userId: "hero", reason: "Recover a stranded player" });
      expect(result.success).toBe(true);
      const stored = await client.query.userData.findFirst({ where: eq(userData.userId, "hero") });
      expect(stored).toMatchObject({ status: "AWAKE", battleId: null, travelFinishAt: null });
      expect(stored!.updatedAt.getTime()).toBeGreaterThan(snapshot!.updatedAt.getTime());
      if (hasRun) {
        const history = await client.query.questHistory.findFirst({ where: eq(questHistory.id, "attempt") });
        expect(history?.completed).toBe(0);
        expect(history?.endAt).toBeInstanceOf(Date);
      }
      expect(await client.query.rankedPvpQueue.findMany()).toHaveLength(0);
      expect(await client.query.actionLog.findMany()).toEqual([expect.objectContaining({ userId: "staff", relatedId: "hero" })]);
    });
  }

  it.each([false, true])("invalidates the live snapshot ahead of the wall clock with concurrent claim=%s", async concurrentClaim => {
    const db = await getTestDatabase();
    const snapshotAt = new Date(Date.now() + 60_000);
    await db.update(userData).set({ updatedAt: snapshotAt }).where(eq(userData.userId, "hero"));
    let liveSnapshotAt = snapshotAt;
    const client = new Proxy(db, { get(target, property, receiver) {
      if (property === "execute") return async (...args: Parameters<typeof target.execute>) => {
        if (concurrentClaim) {
          // Advance after staff's initial read so recovery must use the persisted version.
          const claim = await claimUserSnapshot({ client: target, userId: "hero", updatedAt: snapshotAt });
          expect(claim.success).toBe(true);
          liveSnapshotAt = claim.claimedAt;
        }
        return target.execute(...args);
      };
      return Reflect.get(target, property, receiver);
    } });
    const result = await callerForDatabase(staffRouter, "staff", client).forceAwake({ userId: "hero", reason: "Recover a stranded player" });
    const stored = await db.query.userData.findFirst({ where: eq(userData.userId, "hero") });
    expect(result.success).toBe(true);
    expect(stored?.status).toBe("AWAKE");
    expect(stored?.updatedAt.getTime()).toBe(liveSnapshotAt.getTime() + 1);
    expect((await claimUserSnapshot({ client: db, userId: "hero", updatedAt: liveSnapshotAt, set: { status: "BATTLE" } })).success).toBe(false);
  });
});
