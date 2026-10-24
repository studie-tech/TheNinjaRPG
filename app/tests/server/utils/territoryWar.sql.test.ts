import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { battle, clan, mpvpBattleQueue, mpvpBattleUser, notification, sector, territoryWar, territoryWarReceipt, territoryWarScore, userData, village } from "@/drizzle/schema";
import { updateBattle } from "@/libs/combat/database";
import type { CombatResult } from "@/libs/combat/types";
import { calcBattleResult } from "@/libs/combat/util";
import type { DrizzleClient } from "@/server/db";
import { cleanupTerritoryWarTeams, resolveTerritoryWar, settleTerritoryWarCombat, syncTerritoryWars, territoryWarBoostWindowsSql } from "@/server/utils/territoryWar";
import { guardianVictory } from "../../setup/territoryWar";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";

const now = () => new Date();
const eventRow = () => ({ id: "event", predecessorId: "initial", sector: 100, guardianId: "guardian", startsAt: new Date(Date.now() - 10000), endsAt: new Date(Date.now() + 1800000) });
const apply = async (fight: ReturnType<typeof guardianVictory>) => {
  const db = await getTestDatabase();
  return db.transaction(tx => settleTerritoryWarCombat(tx as unknown as DrizzleClient, fight));
};
const pvpVictory = () => {
  const fight = guardianVictory();
  fight.battleType = "COMBAT";
  const victim = fight.usersState[1]!;
  victim.isAi = false;
  victim.villageId = "enemy";
  fight.extraState.territoryWar!.competitors[victim.userId] = { id: "village:enemy", name: "Enemy", villageId: "enemy", clanId: null };
  return fight;
};

describeWithDatabase("Territory War atomic scoring and lifecycle", () => {
  beforeEach(async () => {
    await resetTables(battle, territoryWarReceipt, territoryWarScore, territoryWar, mpvpBattleUser, mpvpBattleQueue, notification, sector, clan, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", kageId: "chief", sector: 1, tokens: 10 },
      { id: "enemy", name: "Enemy", kageId: "chief-2", sector: 2, tokens: 20 },
      { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", kageId: "outlaw-chief", sector: 3 },
      { id: "hideout", name: "Hideout", kageId: "faction-chief", sector: 4, type: "HIDEOUT" },
    ]);
    await insertUsers([{ userId: "guardian", isAi: true, isWarCamp: true }, ...[0, 1, 2].map(i => ({ userId: `player-${i}`, villageId: "home", status: "AWAKE" as const }))]);
  });

  it("delivers team points once using only writes in combat settlement", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values(eventRow());
    const result = await recordQueries(() => apply(guardianVictory(3)));
    expect(result.statements.some(statement => /^select\b/i.test(statement))).toBe(false);
    await apply(guardianVictory(3));
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(15);
    expect(await db.query.territoryWarReceipt.findMany()).toHaveLength(1);
  });

  it("serializes simultaneous finishers and grants the treasury and boost exactly once", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ unreadNotifications: 7 });
    await db.insert(territoryWar).values(eventRow());
    await db.insert(territoryWarScore).values(["home", "enemy"].map(id => ({ warId: "event", competitorId: `village:${id}`, name: id, villageId: id, points: 395 })));
    const enemy = guardianVictory(1, "enemy-battle");
    enemy.extraState.territoryWar!.competitors["player-0"] = { id: "village:enemy", name: "Enemy", villageId: "enemy", clanId: null };
    await Promise.all([apply(guardianVictory()), apply(enemy)]);
    const scores = await db.query.territoryWarScore.findMany();
    expect(scores.filter(score => score.rewarded)).toHaveLength(1);
    expect(scores.map(score => score.points).sort()).toEqual([395, 400]);
    const balances = await db.query.village.findMany();
    expect(balances.reduce((total, row) => total + row.tokens, 0)).toBe(300030);
    expect(balances.filter(row => row.territoryWarBoostUntil)).toHaveLength(1);
    await db.transaction(tx => resolveTerritoryWar(tx as unknown as DrizzleClient, "event"));
    expect((await db.query.village.findMany()).reduce((total, row) => total + row.tokens, 0)).toBe(300030);
    expect(await db.query.notification.findMany()).toHaveLength(1);
    expect((await db.select({ unread: userData.unreadNotifications }).from(userData).orderBy(userData.userId)).map(user => user.unread)).toEqual([7, 8, 8, 8]);
  });

  it.each([false, true])("pays an outlaw clan with hasHideout=%s to the proper destination", async hasHideout => {
    const db = await getTestDatabase();
    await db.insert(clan).values({ id: "faction", name: "Faction", image: "image", villageId: hasHideout ? "hideout" : VILLAGE_SYNDICATE_ID, founderId: "founder", leaderId: "founder", leaderOrderId: "founder", hasHideout, points: 17 });
    await db.insert(territoryWar).values(eventRow());
    await db.insert(territoryWarScore).values({ warId: "event", competitorId: "clan:faction", name: "Faction", clanId: "faction", points: 395 });
    const fight = guardianVictory();
    fight.extraState.territoryWar!.competitors["player-0"] = { id: "clan:faction", name: "Faction", clanId: "faction", villageId: null };
    await apply(fight);
    const faction = (await db.query.clan.findFirst())!;
    expect(faction.points).toBe(hasHideout ? 17 : 300017);
    expect(faction.territoryWarBoostUntil).not.toBeNull();
    expect((await db.query.village.findFirst({ where: eq(village.id, "hideout") }))?.tokens).toBe(hasHideout ? 300000 : 0);
  });

  it("grants both tied target competitors while never rewarding a sub-target timeout", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values(eventRow());
    await db.insert(territoryWarScore).values(["home", "enemy"].map(id => ({ warId: "event", competitorId: `village:${id}`, name: id, villageId: id, points: 400 })));
    await db.transaction(tx => resolveTerritoryWar(tx as unknown as DrizzleClient, "event"));
    expect((await db.query.territoryWarScore.findMany()).every(row => row.rewarded)).toBe(true);
    await db.update(territoryWar).set({ resolvedAt: null, endsAt: new Date(Date.now() - 1000) });
    await db.update(territoryWarScore).set({ points: 399, rewarded: false });
    await syncTerritoryWars(db);
    expect((await db.query.territoryWarScore.findMany()).every(row => !row.rewarded)).toBe(true);
  });

  it("commits the terminal battle claim and team scoring together and releases unattended teammates", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values(eventRow());
    const fight = guardianVictory(3);
    await db.insert(battle).values(fight);
    await db.update(userData).set({ battleId: fight.id, status: "BATTLE" }).where(eq(userData.isAi, false));
    const result = { didWin: 1, friendsLeft: 2, targetsLeft: 0 } as CombatResult;
    const claimed = await updateBattle(db, result, "player-0", fight, fight.version);
    expect(claimed?.battleOver).toBe(true);
    await claimed?.finishBattle();
    expect(await db.query.battle.findFirst()).toBeUndefined();
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(15);
    expect((await db.query.userData.findMany()).filter(user => user.userId !== "guardian" && user.userId !== "player-0").every(user => user.status === "AWAKE" && user.battleId === null)).toBe(true);
    expect(await updateBattle(db, result, "player-0", fight, fight.version)).toBeNull();
  });

  it.each([false, true])("credits a PvP win before the opponent collects, including late collection=%s", async late => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values(eventRow());
    const fight = pvpVictory();
    await db.insert(battle).values(fight);
    const win = calcBattleResult(fight, "player-0", []);
    expect(win?.outcome).toBe("Won");
    expect(win?.targetsLeft).toBe(1);
    const claimed = await recordQueries(() => updateBattle(db, win, "player-0", fight, 0));
    expect(claimed.result?.battleOver).toBe(false);
    expect(claimed.statements.some(statement => /^select\b/i.test(statement))).toBe(false);
    const saved = (await db.query.battle.findFirst())!;
    expect(saved.usersState.map(user => user.leftBattle)).toEqual([true, false]);
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(3);
    expect(await db.query.territoryWarReceipt.findMany()).toHaveLength(1);
    expect(await updateBattle(db, win, "player-0", fight, 0)).toBeNull();
    if (late) await db.update(territoryWar).set({ endsAt: new Date(Date.now() - 1) }).where(eq(territoryWar.id, "event"));
    const loss = calcBattleResult(saved, "guardian", []);
    expect(loss?.outcome).toBe("Lost");
    const collected = await updateBattle(db, loss, "guardian", saved, saved.version);
    expect(collected?.battleOver).toBe(true);
    expect(await db.query.battle.findFirst()).toBeUndefined();
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(3);
    expect(await db.query.territoryWarReceipt.findMany()).toHaveLength(1);
  });

  it("rejects a stale PvP claim and resolves first-to-target on the successful winner claim", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values(eventRow());
    await db.insert(territoryWarScore).values({ warId: "event", competitorId: "village:home", name: "Home", villageId: "home", points: 397 });
    const fight = pvpVictory();
    await db.insert(battle).values(fight);
    const win = calcBattleResult(fight, "player-0", []);
    expect(await updateBattle(db, win, "player-0", fight, -1)).toBeNull();
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(397);
    expect(await db.query.territoryWarReceipt.findMany()).toHaveLength(0);
    const claimed = await updateBattle(db, win, "player-0", fight, 0);
    expect(claimed?.battleOver).toBe(false);
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(400);
    expect((await db.query.territoryWarScore.findFirst())?.rewarded).toBe(true);
    expect((await db.query.territoryWar.findFirst())?.resolvedAt).not.toBeNull();
    expect((await db.query.village.findFirst({ where: eq(village.id, "home") }))?.tokens).toBe(300010);
  });

  it("rolls score, receipts and rewards back together after a failed write", async () => {
    const db = await getTestDatabase();
    await db.insert(territoryWar).values(eventRow());
    await expect(db.transaction(async tx => {
      await settleTerritoryWarCombat(tx as unknown as DrizzleClient, guardianVictory());
      throw new Error("failed final write");
    })).rejects.toThrow("failed final write");
    expect(await db.query.territoryWarReceipt.findMany()).toHaveLength(0);
    expect(await db.query.territoryWarScore.findMany()).toHaveLength(0);
    await apply(guardianVictory());
    expect((await db.query.territoryWarScore.findFirst())?.points).toBe(5);
  });

  it("schedules one event on a neutral sector, expires it without rewards, and waits five hours after its end", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ unreadNotifications: 7 });
    await db.insert(sector).values({ sector: 10, villageId: "home" });
    const startsAt = now();
    await Promise.all([syncTerritoryWars(db, startsAt), syncTerritoryWars(db, startsAt)]);
    const events = await db.query.territoryWar.findMany();
    expect(events).toHaveLength(1);
    expect([1, 2, 3, 4, 10]).not.toContain(events[0]!.sector);
    expect(events[0]!.guardianId).toBe("guardian");
    expect(await db.query.notification.findMany()).toHaveLength(1);
    expect((await db.select({ unread: userData.unreadNotifications }).from(userData).orderBy(userData.userId)).map(user => user.unread)).toEqual([7, 8, 8, 8]);
    const endsAt = events[0]!.endsAt;
    await syncTerritoryWars(db, new Date(endsAt.getTime() + 1));
    expect((await db.query.territoryWar.findFirst())?.resolvedAt).toEqual(endsAt);
    await syncTerritoryWars(db, new Date(endsAt.getTime() + 5 * 3600000 - 1));
    expect(await db.query.territoryWar.findMany()).toHaveLength(1);
    await syncTerritoryWars(db, new Date(endsAt.getTime() + 5 * 3600000));
    expect(await db.query.territoryWar.findMany()).toHaveLength(2);
    expect((await db.select({ unread: userData.unreadNotifications }).from(userData).orderBy(userData.userId)).map(user => user.unread)).toEqual([7, 9, 9, 9]);
  });

  it("preloads both historical victory windows in the existing activity query", async () => {
    const db = await getTestDatabase();
    const recent = new Date(Date.now() - 30 * 60000);
    const earlier = new Date(recent.getTime() - 6 * 3600000);
    await db.insert(territoryWar).values([{ ...eventRow(), resolvedAt: earlier }, { ...eventRow(), id: "second", predecessorId: "event", startsAt: new Date(earlier.getTime() + 5 * 3600000), resolvedAt: recent }]);
    await db.insert(territoryWarScore).values(["event", "second"].map(warId => ({ warId, competitorId: "village:home", villageId: "home", name: "Home", points: 400, rewarded: true })));
    await db.update(userData).set({ masteryTrainingStartedAt: new Date(earlier.getTime() - 60000), regenAt: new Date() }).where(eq(userData.userId, "player-0"));
    const user = await db.query.userData.findFirst({ where: eq(userData.userId, "player-0"), extras: table => ({ windows: territoryWarBoostWindowsSql(table).as("windows") }) });
    expect(user?.windows).toHaveLength(2);
    expect(user?.windows.map(window => new Date(window.startsAt).getTime()).sort()).toEqual([earlier.getTime(), recent.getTime()]);
  });

  it.each(["resolved", "expired", "empty", "reserved", "active", "battle", "other", "missing"])("releases only expired waiting lobbies: %s", async state => {
    const db = await getTestDatabase();
    const removesLobby = ["resolved", "expired", "empty", "reserved"].includes(state);
    const realBattle = state === "battle" ? guardianVictory() : null;
    if (state !== "missing") await db.insert(territoryWar).values({ ...eventRow(), endsAt: new Date(Date.now() + (state === "expired" ? -1000 : 1800000)), resolvedAt: ["active", "expired"].includes(state) ? null : now() });
    if (realBattle) await db.insert(battle).values(realBattle);
    await db.insert(mpvpBattleQueue).values({ id: "lobby", territoryWarId: "event", battleType: state === "other" ? "CLAN_BATTLE" : "TERRITORY_WAR", battleId: state === "reserved" ? "reservation" : realBattle?.id, attackerEntityId: "village:home", defenderEntityId: "guardian", sector: 100 });
    if (state !== "empty") await db.insert(mpvpBattleUser).values({ id: "member", clanBattleId: "lobby", userId: "player-0", side: "ATTACKER", slot: 0 });
    await db.update(userData).set({ status: realBattle ? "BATTLE" : "QUEUED", battleId: realBattle?.id ?? null }).where(eq(userData.userId, "player-0"));
    await cleanupTerritoryWarTeams(db);
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(removesLobby ? 0 : 1);
    expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(removesLobby ? 0 : 1);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "player-0") }))?.status).toBe(realBattle ? "BATTLE" : removesLobby && state !== "empty" ? "AWAKE" : "QUEUED");
  });
});
