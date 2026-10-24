import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { aiProfile, battle, battleHistory, clan, mpvpBattleQueue, mpvpBattleUser, territoryWar, userData, village } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchBattle } from "@/server/api/routers/combat";
import { clanRouter } from "@/server/api/routers/clan";
import { territoryWarRouter } from "@/server/api/routers/territoryWar";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const caller = (id = "leader") => callerFor(territoryWarRouter, id);
const team = async () => (await getTestDatabase()).query.mpvpBattleQueue.findFirst();

describeWithDatabase("Territory War participation", () => {
  beforeEach(async () => {
    await resetTables(battleHistory, battle, mpvpBattleUser, mpvpBattleQueue, territoryWar, clan, village, userData, aiProfile);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", sector: 1, kageId: "leader" },
      { id: "enemy", name: "Enemy", sector: 2, kageId: "rival" },
      { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", sector: 3, kageId: "syndicate-chief" },
    ]);
    await insertUsers(["leader", "ally", "third", "fourth", "rival"].map(id => ({ userId: id, username: id, villageId: id === "rival" ? "enemy" : "home", status: "AWAKE" as const, rank: "JONIN" as const, level: 50, sector: 100, curHealth: 5000, maxHealth: 5000, curChakra: 5000, maxChakra: 5000, curStamina: 5000, maxStamina: 5000, regeneration: 0 })));
    await insertUsers([{ userId: "guardian", username: "guardian", isAi: true, isWarCamp: true, level: 50, curHealth: 100, maxHealth: 100 }]);
    await db.insert(aiProfile).values({ id: "Default", userId: "default", rules: [] });
    await db.insert(territoryWar).values({ id: "event", predecessorId: "initial", sector: 100, guardianId: "guardian", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 1800000) });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("validates sector and competitor and caps a team at three players", async () => {
    const leader = await caller();
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
    const id = (await team())!.id;
    expect((await (await caller("rival")).joinTeam({ teamId: id })).success).toBe(false);
    expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(true);
    expect((await (await caller("third")).joinTeam({ teamId: id })).success).toBe(true);
    expect((await (await caller("fourth")).joinTeam({ teamId: id })).success).toBe(false);
    expect((await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, "fourth") }))?.status).toBe("AWAKE");
    expect((await leader.startBattle({ teamId: id })).success).toBe(true);
    const stored = (await (await getTestDatabase()).query.battle.findFirst())!;
    const snapshot = (await fetchBattle(await getTestDatabase(), stored.id))!;
    expect(snapshot.usersState.filter(user => !user.isAi && !user.isSummon)).toHaveLength(3);
    expect(snapshot.usersState.filter(user => user.isAi && !user.isSummon)).toHaveLength(1);
    expect(new Set(Object.values(snapshot.extraState.territoryWar!.competitors).map(comp => comp.id))).toEqual(new Set(["village:home"]));
  });

  it("includes a member admitted just before the launch reservation", async () => {
    const db = await getTestDatabase();
    const leader = await caller();
    await leader.createTeam({ eventId: "event" });
    const id = (await team())!.id;
    const delayed = beforeStatements(db, mpvpBattleQueue, [async () => {
      expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(true);
    }]);
    const result = await callerForDatabase(territoryWarRouter, "leader", delayed).startBattle({ teamId: id });
    expect(result.success, result.message).toBe(true);
    const snapshot = (await fetchBattle(db, ("battleId" in result ? result.battleId : undefined)!))!;
    expect(snapshot.usersState.filter(user => !user.isAi).map(user => user.userId).sort()).toEqual(["ally", "leader"]);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "ally") }))?.status).toBe("BATTLE");
  });

  it("keeps leader-first contested admissions recoverable and consistent with queued status", async () => {
    const db = await getTestDatabase();
    const ids = Array.from({ length: 7 }, (_, index) => `contender-${index}`);
    await insertUsers(ids.map(userId => ({ userId, villageId: "home", status: "AWAKE" as const, sector: 100 })));
    const contenders = ids.map(id => callerForDatabase(territoryWarRouter, id, db));
    const leader = await caller();
    for (let round = 0; round < 6; round += 1) {
      const created = await leader.createTeam({ eventId: "event" });
      expect(created.success).toBe(true);
      const id = (await team())!.id;
      const admissions = await Promise.allSettled(contenders.map(contender => contender.joinTeam({ teamId: id })));
      expect(admissions.every(result => result.status === "fulfilled")).toBe(true);
      const members = await db.query.mpvpBattleUser.findMany();
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(members.length).toBeLessThanOrEqual(3);
      expect(members.some(member => member.userId === "leader")).toBe(true);
      const queued = (await db.query.userData.findMany()).filter(user => user.status === "QUEUED");
      expect(queued.map(user => user.userId).sort()).toEqual(members.map(member => member.userId).sort());
      expect(new Set(members.map(member => member.slot)).size).toBe(members.length);
      await resetTables(mpvpBattleUser, mpvpBattleQueue);
      await db.update(userData).set({ status: "AWAKE" });
    }
  });

  it("resolves any outlaw clan and displays that competitor's active bonus", async () => {
    const db = await getTestDatabase();
    const until = new Date(Date.now() + 3600000);
    await db.insert(clan).values({ id: "faction", name: "Faction", image: "image", founderId: "leader", leaderId: "leader", leaderOrderId: "leader", villageId: VILLAGE_SYNDICATE_ID, territoryWarBoostUntil: until });
    await db.update(userData).set({ isOutlaw: true, villageId: VILLAGE_SYNDICATE_ID, clanId: "faction" }).where(eq(userData.userId, "leader"));
    const current = await (await caller()).getCurrent();
    expect(current.competitor).toMatchObject({ id: "clan:faction", name: "Faction" });
    expect(current.boostUntil).toEqual(until);
    expect((await (await caller()).createTeam({ eventId: "event" })).success).toBe(true);
    expect((await team())!.attackerEntityId).toBe("clan:faction");
    await db.update(userData).set({ clanId: null }).where(eq(userData.userId, "leader"));
    expect((await (await caller()).getCurrent()).competitor.id).toBe(`village:${VILLAGE_SYNDICATE_ID}`);
  });

  it.each(["active", "missing membership", "missing lobby", "missing event", "expired event"] as const)("rolls back a partially launched team with %s", async (ownership) => {
    const db = await getTestDatabase();
    await db.insert(clan).values({ id: "citizen-clan", name: "Citizens", image: "image", founderId: "leader", leaderId: "leader", leaderOrderId: "leader", villageId: "home" });
    await db.update(userData).set({ clanId: "citizen-clan" });
    const leader = await caller();
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
    const id = (await team())!.id;
    expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(true);
    const delayed = beforeStatements(db, userData, [
      async () => {
        const kicked = await (await callerFor(clanRouter, "leader")).kickMember({ clanId: "citizen-clan", memberId: "ally" });
        expect(kicked.success, kicked.message).toBe(true);
      },
      async () => {
        if (ownership === "missing membership") await db.delete(mpvpBattleUser).where(eq(mpvpBattleUser.userId, "leader"));
        if (ownership === "missing lobby") await db.delete(mpvpBattleQueue).where(eq(mpvpBattleQueue.id, id));
        if (ownership === "missing event") await db.delete(territoryWar).where(eq(territoryWar.id, "event"));
        if (ownership === "expired event") await db.update(territoryWar).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(territoryWar.id, "event"));
      },
    ]);
    const failed = await callerForDatabase(territoryWarRouter, "leader", delayed).startBattle({ teamId: id });
    expect(failed.success).toBe(false);
    expect(await db.query.battle.findMany()).toEqual([]);
    const restored = (await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))!;
    expect(restored.battleId).toBeNull();
    expect(restored.status).toBe(ownership === "active" ? "QUEUED" : "AWAKE");
    if (ownership === "active") {
      expect((await team())!.battleId).toBeNull();
      expect((await db.query.mpvpBattleUser.findMany()).map(member => member.userId)).toEqual(["leader"]);
      const retry = await leader.startBattle({ teamId: id });
      expect(retry.success, retry.message).toBe(true);
    }
  });

  it("allows leaving a waiting team and rejects a stale event", async () => {
    const db = await getTestDatabase();
    const leader = await caller();
    await leader.createTeam({ eventId: "event" });
    const id = (await team())!.id;
    expect((await leader.leaveTeam({ teamId: id })).success).toBe(true);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))?.status).toBe("AWAKE");
    await db.update(territoryWar).set({ resolvedAt: new Date() });
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(false);
    expect((await leader.startBattle({ teamId: id })).success).toBe(false);
  });
});
