import { afterEach, beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { clan, item, userItem, mpvpBattleQueue, mpvpBattleUser, userData, village, war } from "@/drizzle/schema";
import { fetchActiveShrineLobbies, fetchAllActiveWars } from "@/queries/profile";
import { findQueueUserCache } from "@/queries/socialUserCache";
import { withRequestScope } from "@/server/requestScope";
import { getBattleUserPatch, getMembershipUserPatch, getShrineLobbyUserPatch } from "@/server/utils/socialUserCache";
import { shrineRouter } from "@/server/api/routers/shrine";
import { makeEffect } from "../../../libs/combat/helpers/battleScenario";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("confirmed social profile projections", () => {
  afterEach(resetServerModuleStubs);
  beforeEach(async () => {
    await resetTables(userItem, item, mpvpBattleUser, mpvpBattleQueue, war, clan, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "old", name: "Old village", sector: 10, kageId: "old-kage" },
      { id: "new", name: "New village", sector: 20, kageId: "new-kage" },
    ]);
    await insertUsers([{ userId: "projection-user", villageId: "old", status: "AWAKE" }]);
  });

  it("replaces membership relations and drops wars removed after an earlier request-scope read", async () => {
    const db = await getTestDatabase();
    await db.insert(war).values({ id: "old-war", type: "SECTOR_WAR", status: "ACTIVE", attackerVillageId: "new", defenderVillageId: "old", sector: 30 });
    const before = (await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") }))!;
    await withRequestScope(async () => {
      expect(await fetchAllActiveWars(db)).toHaveLength(1);
      await db.delete(war).where(eq(war.id, "old-war"));
      await db.update(userData).set({ villageId: "new", clanId: null }).where(eq(userData.userId, before.userId));
      const patch = await getMembershipUserPatch(db, before);
      expect(patch).toMatchObject({ villageId: "new", clanId: null, clan: null, village: { id: "new" }, activeWars: [] });
      expect(patch?.regeneration).toBeNumber();
      expect(patch).not.toHaveProperty("money");
      expect(patch).not.toHaveProperty("questData");
    });
  });

  it("observes newly created shrine notices despite a warmed request memo", async () => {
    const db = await getTestDatabase();
    await withRequestScope(async () => {
      expect(await fetchActiveShrineLobbies(db, new Date(0))).toHaveLength(0);
      await db.insert(mpvpBattleQueue).values({ id: "fresh-shrine", battleType: "SHRINE_BATTLE", attackerEntityId: "old", defenderEntityId: "new", sector: 30 });
      const patch = await getShrineLobbyUserPatch(db, "projection-user", "old");
      expect(patch?.shrineBattles.map((entry) => entry.id)).toEqual(["fresh-shrine"]);
    });
  });

  it("publishes a newer combat retained by conditional queue cleanup", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "BATTLE", battleId: "new-combat" }).where(eq(userData.userId, "projection-user"));
    expect(await findQueueUserCache(db, "projection-user")).toMatchObject({ status: "BATTLE", battleId: "new-combat" });
  });
  it("derives mastery and energy eligibility from committed training with private gear sources", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ level: 50, rank: "JONIN", ninjutsuMastery: 110 }).where(eq(userData.userId, "projection-user"));
    await insertItems([{ id: "eligible-armor", itemType: "ARMOR", slot: "CHEST", maxDurability: 100, requiredNinjutsuMastery: 100,
      effects: [makeEffect("increasemastery", { masteryTypes: ["Ninjutsu"], power: 50, powerPerLevel: 0, calculation: "static" }), makeEffect("increasemaxpools", { poolsAffected: ["Energy"], power: 200, powerPerLevel: 0, calculation: "static" })] }]);
    await insertUserItems([{ id: "worn-armor", userId: "projection-user", itemId: "eligible-armor", equipped: "CHEST", durability: 100 }]);
    const patch = await getBattleUserPatch(db, "projection-user");
    expect(patch?.effectiveMasteries.ninjutsuMastery).toBe(160);
    expect(patch?.maxEnergy).toBeGreaterThan(200);
    expect(patch).not.toHaveProperty("items");
    expect(patch).not.toHaveProperty("bloodline");
  });

  it("returns committed recovery when an expired shrine leave is rejected", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "projection-user"));
    await db.insert(mpvpBattleQueue).values({ id: "expired-shrine", battleType: "SHRINE_BATTLE", attackerEntityId: "old", defenderEntityId: "new", createdAt: new Date(0) });
    stubProfile("fetchUpdatedUser", async () => ({ user: await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") }) }));
    const result = await callerForDatabase(shrineRouter, "projection-user", db).leaveShrineBattle({ shrineBattleId: "expired-shrine" });
    expect(result).toMatchObject({ success: false, userPatch: { status: "AWAKE", battleId: null } });
  });

});
