import { huntingSession, huntingProgress } from "@/drizzle/schema";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, getTableName } from "drizzle-orm";
import { actionLog, battle, mpvpBattleUser, quest, questHistory, rankedPvpQueue, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { getIsolatedPyramid } from "@/libs/questRun";
import { profileRouter } from "@/server/api/routers/profile";
import { staffRouter } from "@/server/api/routers/staff";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables, runRawSql } from "../../setup/testDatabase";

describeWithDatabase("staff Pyramid recovery", () => {
  beforeEach(async () => {
    await runRawSql("DROP TRIGGER IF EXISTS staff_recovery_failure");
    await resetTables(huntingSession, huntingProgress, questHistory, quest, userData, actionLog, mpvpBattleUser, rankedPvpQueue, battle);
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
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });

  it("releases a hunting encounter while preserving preparation and partial allowance", async () => {
    const database = await getTestDatabase();
    await database.insert(battle).values({ id: "hunt", battleType: "HUNTING", background: "default", usersState: [], usersEffects: [], groundEffects: [], extraState: {} as never, createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date() });
    await database.insert(huntingSession).values({ userId: "hero", id: "session", habitatId: "forest", contractId: "boar", sector: 1, battleId: "hunt", readyAt: new Date(0), startedAt: new Date() });
    await database.insert(huntingProgress).values({ userId: "hero", contractId: "boar", used: 1 });
    expect((await (await callerFor(staffRouter, "staff")).forceAwake({ userId: "hero", reason: "Recover a stranded hunter" })).success).toBe(true);
    expect(await database.query.huntingSession.findFirst()).toMatchObject({ battleId: null, readyAt: new Date(0), version: 1 });
    expect((await database.query.huntingProgress.findFirst())?.used).toBe(1);
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeUndefined();
  });

  it("keeps the hunting battle recoverable when waking the character fails", async () => {
    const database = await getTestDatabase();
    await database.insert(battle).values({ id: "hunt", battleType: "HUNTING", background: "default", usersState: [], usersEffects: [], groundEffects: [], extraState: {} as never, createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date() });
    await database.insert(huntingSession).values({ userId: "hero", id: "session", habitatId: "forest", contractId: "boar", sector: 1, battleId: "hunt", readyAt: new Date(0), startedAt: new Date() });
    await runRawSql("CREATE TRIGGER staff_recovery_failure BEFORE UPDATE ON UserData FOR EACH ROW BEGIN IF OLD.userId = 'hero' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery write failed'; END IF; END");
    await expect((await callerFor(staffRouter, "staff")).forceAwake({ userId: "hero", reason: "Recover a stranded hunter" })).rejects.toThrow("Failed query");
    expect(await database.query.battle.findFirst({ where: eq(battle.id, "hunt") })).toBeDefined();
    expect(await database.query.huntingSession.findFirst()).toMatchObject({ battleId: "hunt", version: 0 });
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
