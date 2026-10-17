import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { warKill } from "@/drizzle/schema";
import { questHistory, sector, userData, village, war, warAlly, warActionReceipt, warCamp, warContribution } from "@/drizzle/schema";
import { applyObjectiveWarAction, applyObjectiveWarDecay, expireWarPoints, syncWarCamps, resumeBracketImmunitySql } from "@/server/utils/objectiveWar";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { warRouter } from "@/server/api/routers/war";
import { defaultWarRules } from "@/validators/war";
import { insertUsers } from "../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const seed = async () => {
  const db = await getTestDatabase();
  await db.insert(village).values([{ id: "a", name: "a", sector: 100, kageId: "ka" }, { id: "b", name: "b", sector: 200, kageId: "kb" }]);
  await insertUsers([{ userId: "hero", villageId: "a" }, { userId: "hero2", villageId: "a" }, { userId: "foe", villageId: "b" }]);
  await db.insert(sector).values([{ sector: 201, villageId: "b" }, { sector: 202, villageId: "b" }]);
  await db.insert(war).values({ id: "w", type: "VILLAGE_WAR", status: "ACTIVE", attackerVillageId: "a", defenderVillageId: "b",
    rules: { ...defaultWarRules, enabled: true }, combatStartedAt: new Date(Date.now() - 3600000),
    objectiveState: { attackerEspionage: 100, defenderEspionage: 0, objectives: [
      { sector: 201, villageId: "b", hp: 350, maxHp: 5000, isReserve: false, destroyed: false },
      { sector: 202, villageId: "b", hp: 350, maxHp: 5000, isReserve: true, destroyed: false },
    ] },
  });
  return db;
};
const readWar = async () => (await (await getTestDatabase()).query.war.findFirst({ where: eq(war.id, "w") }))!;

describeWithDatabase("objective war atomic strategic actions", () => {
  beforeEach(async () => { await resetTables(warKill, questHistory, warActionReceipt, warCamp, warContribution, warAlly, war, sector, userData, village); await seed(); });
  it("records PvP outcomes once with strategic credit and exposes both contribution counters", async () => {
    const db = await getTestDatabase();
    const w = await readWar();
    const action = {
      id: "battle:hero:w", userId: "hero", sideVillageId: "a", damage: 10,
      kills: [{ id: "kill", warId: "w", killerId: "hero", victimId: "foe", killerVillageId: "a", victimVillageId: "b", sector: 100, shrineHpChange: 0, townhallHpChange: 0 }],
    };
    await Promise.all(Array.from({ length: 3 }, () => applyObjectiveWarAction(db, w, action)));
    expect(await db.query.warKill.findMany()).toHaveLength(1);
    const info = await callerForDatabase(warRouter, "hero", db).getObjectiveWarInfo({ warId: "w" });
    expect(info?.combatContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "hero", kills: 1, losses: 0 }),
      expect.objectContaining({ userId: "foe", kills: 0, losses: 1 }),
    ]));
    await db.update(war).set({ endedAt: new Date(), status: "DRAW" }).where(eq(war.id, "w"));
    expect(await applyObjectiveWarAction(db, w, { ...action, id: "late", kills: [{ ...action.kills[0]!, id: "late-kill" }] })).toBe(false);
    expect(await db.query.warKill.findMany()).toHaveLength(1);
  });
  it("deduplicates replay and credits enemy damage separately from actual recovery", async () => {
    const db = await getTestDatabase();
    await db.update(war).set({ attackerWarHealth: 9998, defenderWarHealth: 8 }).where(eq(war.id, "w"));
    const w = await readWar();
    await Promise.all(Array.from({ length: 5 }, () => applyObjectiveWarAction(db, w, { id: "same", userId: "hero", sideVillageId: "a", damage: 10, recovery: 7, espionage: 3 })));
    const after = await readWar();
    expect(after.defenderWarHealth).toBe(0); expect(after.attackerWarHealth).toBe(10000);
    const row = (await db.query.warContribution.findFirst())!;
    expect(row.damage).toBe(8); expect(row.recovery).toBe(2);
  });
  it("destroys a shrine once across simultaneous eligible winners", async () => {
    const db = await getTestDatabase(); const w = await readWar();
    await Promise.all(["hero", "hero2"].map((userId) => applyObjectiveWarAction(db, w, { id: userId, userId, sideVillageId: "a", objectiveIndex: 0, shrineDamage: 350 })));
    const after = await readWar(); expect(after.defenderWarHealth).toBe(8500);
    expect(after.objectiveState?.objectives[0]?.destroyed).toBe(true);
    const captured = await db.query.sector.findFirst({ where: eq(sector.sector, 201) });
    expect(captured?.villageId).toBe("a"); expect(captured?.shrineLevel).toBe(0);
    const rows = await db.query.warContribution.findMany(); expect(rows.reduce((n, r) => n + r.damage, 0)).toBe(1500);
  });
  it("locks a reserve shrine's boosts for seven days without transferring it", async () => {
    const db = await getTestDatabase();
    await applyObjectiveWarAction(db, await readWar(), { id: "reserve", userId: "hero", sideVillageId: "a", objectiveIndex: 1, shrineDamage: 350 });
    const row = (await db.query.sector.findFirst({ where: eq(sector.sector, 202) }))!;
    expect(row.villageId).toBe("b"); expect(row.shrineLevel).toBe(1);
    expect(row.boostLockedUntil!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);
  });
  it("guards hidden objectives and the combat notice boundary", async () => {
    const db = await getTestDatabase();
    await db.update(war).set({ combatStartedAt: new Date(Date.now() + 100000) }).where(eq(war.id, "w"));
    expect(await applyObjectiveWarAction(db, await readWar(), { id: "notice", userId: "hero", sideVillageId: "a", damage: 10 })).toBe(false);
    expect(await applyObjectiveWarAction(db, await readWar(), { id: "spy", userId: "foe", sideVillageId: "b", espionage: 3 })).toBe(false);
    expect(await applyObjectiveWarAction(db, await readWar(), { id: "sabotage", userId: "hero", sideVillageId: "a", objectiveIndex: 0, shrineDamage: 350 })).toBe(false);
    expect((await readWar()).objectiveState?.defenderEspionage).toBe(0);
  });
  it("caps espionage while concurrent missions complete", async () => {
    const db = await getTestDatabase(); const w = await readWar();
    await Promise.all(["one", "two", "three"].map((id) => applyObjectiveWarAction(db, w, { id, userId: "foe", sideVillageId: "b", espionage: 60 })));
    expect((await readWar()).objectiveState?.defenderEspionage).toBe(100);
  });
  it("does not credit ended wars", async () => {
    const db = await getTestDatabase(); const w = await readWar();
    await db.update(war).set({ endedAt: new Date(), status: "DRAW" }).where(eq(war.id, "w"));
    expect(await applyObjectiveWarAction(db, w, { id: "late", userId: "hero", sideVillageId: "a", damage: 10 })).toBe(false);
    expect((await readWar()).defenderWarHealth).toBe(10000);
  });
  it("applies daily decay once with a timestamp CAS and does not drain treasury", async () => {
    const db = await getTestDatabase();
    await db.update(war).set({ combatStartedAt: new Date(Date.now() - 3 * 86400000), lastTokenReductionAt: new Date(Date.now() - 2.1 * 86400000) }).where(eq(war.id, "w"));
    const w = await readWar(); await Promise.all([applyObjectiveWarDecay(db, w), applyObjectiveWarDecay(db, w)]);
    expect((await readWar()).attackerWarHealth).toBe(9400);
  });
  it("resumes the remaining immunity exposure after a long battle", async () => {
    const db = await getTestDatabase(); const now = Date.now();
    await db.update(userData).set({ bracketImmunityPausedAt: new Date(now - 3600000), bracketImmunityLiftedUntil: new Date(now - 1800000) }).where(eq(userData.userId, "hero"));
    await db.update(userData).set({ bracketImmunityLiftedUntil: resumeBracketImmunitySql(), bracketImmunityPausedAt: null }).where(eq(userData.userId, "hero"));
    const u = (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))!;
    expect(u.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeGreaterThan(1790000);
    expect(u.bracketImmunityPausedAt).toBeNull();
  });
  it("returns restored immunity when recovering an orphaned battle", async () => {
    const db = await getTestDatabase(); const now = Date.now();
    await db.update(userData).set({ status: "BATTLE", battleId: null, bracketImmunityPausedAt: new Date(now - 3600000), bracketImmunityLiftedUntil: new Date(now - 1800000) }).where(eq(userData.userId, "hero"));
    const { user } = await fetchUpdatedUser({ client: db, userId: "hero" });
    if (!user) throw new Error("Missing recovered user");
    expect(user.status).toBe("AWAKE");
    expect(user.bracketImmunityPausedAt).toBeNull();
    expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeGreaterThan(1790000);
  });

  it("converts all points exactly once under simultaneous claims", async () => {
    const db = await getTestDatabase(); await db.update(war).set({ endedAt: new Date(), status: "DRAW" }).where(eq(war.id, "w"));
    await db.insert(warContribution).values({ warId: "w", userId: "hero", damage: 150 });
    const before = (await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))!;
    const caller = callerForDatabase(warRouter, "hero", db);
    const results = await Promise.all([caller.convertWarPoints({ warId: "w" }), caller.convertWarPoints({ warId: "w" })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }))!.villagePrestige).toBe(before.villagePrestige + 1500);
  });
  it("expires claims while retaining historical damage", async () => {
    const db = await getTestDatabase(); await db.update(war).set({ endedAt: new Date(Date.now() - 4 * 86400000), status: "DRAW" }).where(eq(war.id, "w"));
    await db.insert(warContribution).values({ warId: "w", userId: "hero", damage: 20 });
    await expireWarPoints(db);
    const row = (await db.query.warContribution.findFirst())!;
    expect(row.damage).toBe(20); expect(row.expiredAt).not.toBeNull();
    expect((await callerForDatabase(warRouter, "hero", db).convertWarPoints({ warId: "w" })).success).toBe(false);
  });
  it("resolves camps once and gives no damage to tied camps", async () => {
    const db = await getTestDatabase(); const w = { ...await readWar(), warAllies: [] };
    await db.insert(warCamp).values({ id: "camp", warId: "w", sector: 201, guardianId: "ai", startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() - 1000), attackerScore: 20, defenderScore: 10 });
    await Promise.all([syncWarCamps(db, [w]), syncWarCamps(db, [w])]);
    expect((await readWar()).defenderWarHealth).toBe(9700);
    await db.insert(warCamp).values({ id: "tie", warId: "w", sector: 201, guardianId: "ai", startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() - 1000), attackerScore: 20, defenderScore: 20 });
    await syncWarCamps(db, [w]); expect((await readWar()).defenderWarHealth).toBe(9700);
  });
  it("credits ordinary PvP at a hidden objective without damaging its shrine", async () => {
    const db = await getTestDatabase();
    await db.update(war).set({ objectiveState: { ...(await readWar()).objectiveState!, attackerEspionage: 0 } }).where(eq(war.id, "w"));
    await applyObjectiveWarAction(db, await readWar(), { id: "hidden-kill", userId: "hero", sideVillageId: "a", damage: 10, recovery: 7, espionage: 3, objectiveIndex: 0, shrineDamage: 350 });
    const after = await readWar();
    expect(after.defenderWarHealth).toBe(9990);
    expect(after.objectiveState!.attackerEspionage).toBe(3);
    expect(after.objectiveState!.objectives[0]!.hp).toBe(350);
  });
  it("keeps ordinary PvP credit after the preloaded objective was destroyed", async () => {
    const db = await getTestDatabase(); const w = await readWar();
    await applyObjectiveWarAction(db, w, { id: "capture", userId: "hero", sideVillageId: "a", objectiveIndex: 0, shrineDamage: 350 });
    await applyObjectiveWarAction(db, w, { id: "later-kill", userId: "hero2", sideVillageId: "a", damage: 10, objectiveIndex: 0, shrineDamage: 350 });
    expect((await readWar()).defenderWarHealth).toBe(8490);
  });
  it("does not accept a stale ally roster after withdrawal", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ villageId: "ally" }).where(eq(userData.userId, "hero"));
    expect(await applyObjectiveWarAction(db, await readWar(), { id: "withdrawn", userId: "hero", sideVillageId: "a", damage: 40 })).toBe(false);
    expect((await readWar()).defenderWarHealth).toBe(10000);
  });
  it("scores camp victories without creating synthetic personal points", async () => {
    const db = await getTestDatabase();
    await db.insert(warCamp).values({ id: "open", warId: "w", sector: 201, guardianId: "ai", startsAt: new Date(Date.now() - 10000), endsAt: new Date(Date.now() + 10000) });
    const camp = (await db.query.warCamp.findFirst({ where: eq(warCamp.id, "open") }))!;
    await applyObjectiveWarAction(db, await readWar(), { id: "camp-win", userId: "hero", sideVillageId: "a", camp });
    expect((await db.query.warCamp.findFirst({ where: eq(warCamp.id, "open") }))!.attackerScore).toBe(10);
    expect((await db.query.warContribution.findFirst())!.damage).toBe(0);
  });
  it("applies overdue decay through the seventh day", async () => {
    const db = await getTestDatabase(); const start = new Date(Date.now() - 8 * 86400000);
    await db.update(war).set({ combatStartedAt: start, lastTokenReductionAt: start }).where(eq(war.id, "w"));
    await applyObjectiveWarDecay(db, await readWar());
    expect((await readWar()).attackerWarHealth).toBe(7900);
  });
  it("settles a camp that closed before the war deadline even when the scheduler is late", async () => {
    const db = await getTestDatabase();
    await db.update(war).set({ combatStartedAt: new Date(Date.now() - 8 * 86400000) }).where(eq(war.id, "w"));
    await db.insert(warCamp).values({ id: "late", warId: "w", sector: 201, guardianId: "ai", startsAt: new Date(Date.now() - 2 * 86400000), endsAt: new Date(Date.now() - 1.5 * 86400000), attackerScore: 10 });
    await syncWarCamps(db, [await readWar()]);
    expect((await readWar()).defenderWarHealth).toBe(9700);
  });

  it("clamps overshooting shrine damage rather than underflowing JSON health", async () => {
    const db = await getTestDatabase();
    expect(await applyObjectiveWarAction(db, await readWar(), { id: "overshoot", userId: "hero", sideVillageId: "a", objectiveIndex: 0, shrineDamage: 1000 })).toBe(true);
    expect((await readWar()).objectiveState!.objectives[0]!.hp).toBe(0);
    expect((await readWar()).defenderWarHealth).toBe(8500);
  });

  it("rejects shrine credit after sector ownership changes while preserving PvP credit", async () => {
    const db = await getTestDatabase(); const w = await readWar();
    await db.update(sector).set({ villageId: "third" }).where(eq(sector.sector, 201));
    expect(await applyObjectiveWarAction(db, w, { id: "lost-shrine", userId: "hero", sideVillageId: "a", objectiveIndex: 0, shrineDamage: 350 })).toBe(false);
    expect(await applyObjectiveWarAction(db, w, { id: "ordinary-kill", userId: "hero", sideVillageId: "a", damage: 10, objectiveIndex: 0, shrineDamage: 350 })).toBe(true);
    const after = await readWar();
    expect(after.defenderWarHealth).toBe(9990);
    expect(after.objectiveState!.objectives[0]!.hp).toBe(350);
  });

  it("preserves an earlier camp victory when delayed daily decay is also due", async () => {
    const db = await getTestDatabase(); const start = new Date(Date.now() - 24.5 * 3600000);
    await db.update(war).set({ combatStartedAt: start, lastTokenReductionAt: start, attackerWarHealth: 200, defenderWarHealth: 250 }).where(eq(war.id, "w"));
    await db.insert(warCamp).values({ id: "first-victory", warId: "w", sector: 201, guardianId: "ai", startsAt: new Date(start.getTime() + 21 * 3600000), endsAt: new Date(start.getTime() + 22 * 3600000), attackerScore: 10 });
    await insertUsers([{ userId: "camp-ai", username: "camp-guardian", isAi: true, isWarCamp: true }]);
    await syncWarCamps(db, [await readWar()]);
    expect(await db.query.warCamp.findMany()).toHaveLength(1);
    const after = await readWar(); expect(after.attackerWarHealth).toBe(200); expect(after.defenderWarHealth).toBe(0);
  });
  it("stops overdue decay at the first terminal day", async () => {
    const db = await getTestDatabase(); const start = new Date(Date.now() - 6 * 86400000);
    await db.update(war).set({ combatStartedAt: start, lastTokenReductionAt: start, attackerWarHealth: 1000, defenderWarHealth: 1300 }).where(eq(war.id, "w"));
    await applyObjectiveWarDecay(db, await readWar());
    const after = await readWar(); expect(after.attackerWarHealth).toBe(0); expect(after.defenderWarHealth).toBe(100);
  });

});
