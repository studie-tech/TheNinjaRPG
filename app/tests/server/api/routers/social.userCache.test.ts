import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { clan, item, quest, questHistory, userItem, mpvpBattleQueue, mpvpBattleUser, userCookingJob, userData, village, war } from "@/drizzle/schema";
import { fetchActiveShrineLobbies, fetchAllActiveWars } from "@/queries/profile";
import { findQueueUserCache } from "@/queries/socialUserCache";
import * as socialQueries from "@/queries/socialUserCache";
import * as profileQueries from "@/queries/profile";
import * as skillQueries from "@/queries/skillTree";
import { withRequestScope } from "@/server/requestScope";
import { getBattleUserPatch, getMembershipUserPatch, getShrineLobbyUserPatch, getWarAllegianceUserPatch } from "@/server/utils/socialUserCache";
import { shrineRouter } from "@/server/api/routers/shrine";
import { makeEffect } from "../../../libs/combat/helpers/battleScenario";
import { resetServerModuleStubs } from "../../../setup/serverModules";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuests, insertUserItems, insertUsers } from "../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("confirmed social profile projections", () => {
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); });
  beforeEach(async () => {
    await resetTables(questHistory, quest, userItem, item, mpvpBattleUser, mpvpBattleQueue, war, clan, userCookingJob, userData, village);
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

  it("requires a complete membership projection when its independent notice read fails", async () => {
    const db = await getTestDatabase();
    const user = (await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") }))!;
    vi.spyOn(profileQueries, "fetchAllActiveWars").mockRejectedValueOnce(new Error("Membership notices unavailable"));
    expect(await getMembershipUserPatch(db, user)).toBeUndefined();
  });

  it("reconciles war and shrine projections after failed confirmation reads", async () => {
    const db = await getTestDatabase();
    vi.spyOn(socialQueries, "findWarUserCache").mockRejectedValueOnce(new Error("War confirmation unavailable"));
    expect(await getWarAllegianceUserPatch(db, "projection-user")).toBeUndefined();
    vi.spyOn(profileQueries, "fetchActiveShrineLobbies").mockRejectedValueOnce(new Error("Shrine confirmation unavailable"));
    expect(await getShrineLobbyUserPatch(db, "projection-user", "old")).toBeUndefined();
  });

  it("omits the battle patch when private mastery sources cannot be confirmed", async () => {
    const db = await getTestDatabase();
    vi.spyOn(skillQueries, "fetchMasterySources").mockRejectedValueOnce(new Error("Mastery sources unavailable"));
    expect(await getBattleUserPatch(db, "projection-user")).toBeUndefined();
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

  it("retains warmed virtual achievement trackers in battle confirmations without a profile read", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ level: 50, rank: "JONIN", regeneration: 0 }).where(eq(userData.userId, "projection-user"));
    await insertQuests([{ id: "level-total", questType: "achievement", content: {
      objectives: [AllObjectives.parse({ id: "total", task: "user_level", value: 100 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    const profile = callerForDatabase(profileRouter, "projection-user", db);
    const initial = await profile.getUser();
    expect(initial.userData?.questData?.[0]?.goals[0]).toMatchObject({ value: 50, done: false });
    expect(initial.achievementProgress).toContainEqual(expect.objectContaining({ id: "level-total", questId: "level-total" }));
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") }))?.questData).toBeNull();
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, initial);
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile.getUser(); } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      await db.update(userData).set({ status: "BATTLE", battleId: "battle" }).where(eq(userData.userId, "projection-user"));
      const patch = await getBattleUserPatch(db, "projection-user");
      expect(patch).toBeDefined();
      expect(patch).not.toHaveProperty("questData");
      await updateUserCache(client, key, patch, { revision });
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.userData?.status).toBe("BATTLE");
      expect(cached.userData?.questData).toEqual(initial.userData?.questData);
      expect(cached.achievementProgress).toEqual(initial.achievementProgress);
      expect(reads).toBe(0);
    } finally { stop(); client.clear(); }
  });

  it.each([false, true])("reconciles expired shrine leave and notices (cooking settlement=%s)", async (settlesCooking) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED", rank: "JONIN", level: 50, cookingExperience: 0, regeneration: 0 }).where(eq(userData.userId, "projection-user"));
    await db.insert(mpvpBattleQueue).values({ id: "expired-shrine", battleType: "SHRINE_BATTLE", attackerEntityId: "old", defenderEntityId: "new", sector: 30, createdAt: new Date() });
    if (settlesCooking) {
      await db.insert(userCookingJob).values({ id: "cooking-receipt", userId: "projection-user", experience: 99, finishesAt: new Date(Date.now() + 3600000) });
    }
    const profile = callerForDatabase(profileRouter, "projection-user", db);
    const initial = await profile.getUser();
    expect(initial.userData).toHaveProperty("shrineBattles.length", 1);
    expect(initial.notifications).toContainEqual(expect.objectContaining({ name: "We are attacking Shrine (Sector 30)" }));
    expect(initial.userData?.cookingExperience).toBe(0);
    expect(initial.userData?.cookingJobs).toHaveLength(settlesCooking ? 1 : 0);
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, initial);
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile.getUser(); } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      await db.update(mpvpBattleQueue).set({ createdAt: new Date(0) }).where(eq(mpvpBattleQueue.id, "expired-shrine"));
      if (settlesCooking) {
        // The leave's opening hydration settles a receipt absent from its queue projection.
        await db.update(userCookingJob).set({ finishesAt: new Date(Date.now() - 1000) }).where(eq(userCookingJob.id, "cooking-receipt"));
      }
      const result = await callerForDatabase(shrineRouter, "projection-user", db).leaveShrineBattle({ shrineBattleId: "expired-shrine" });
      expect(result).toMatchObject({ success: false, message: "Shrine battle expired" });
      if (settlesCooking) expect(result.userPatch).toBeUndefined();
      else expect(result.userPatch).toMatchObject({ status: "AWAKE", battleId: null, shrineBattles: [] });
      await updateUserCache(client, key, result.userPatch, { revision });
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") });
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(saved).toMatchObject({ status: "AWAKE", cookingExperience: settlesCooking ? 99 : 0 });
      expect(cached.userData).toMatchObject({ status: "AWAKE", battleId: null, shrineBattles: [], cookingExperience: saved?.cookingExperience, cookingJobs: [] });
      expect(cached.notifications).not.toContainEqual(expect.objectContaining({ name: "We are attacking Shrine (Sector 30)" }));
      expect(reads).toBe(settlesCooking ? 1 : 0);
    } finally { stop(); client.clear(); }
  });

  it.each(["mission", "achievement"] as const)("masks remote hidden coordinates in a battle patch without a persisted %s history", async (questType) => {
    const db = await getTestDatabase();
    const questId = `battle-secret-${questType}`;
    await insertQuests([{ id: questId, questType, content: {
      objectives: [AllObjectives.parse({ id: "secret-target", task: "move_to_location", hideLocation: true, sector: 723, longitude: 41, latitude: 37 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    const privateTracker = QuestTracker.parse({ id: questId, goals: [{ id: "secret-target", sector: 723, longitude: 41, latitude: 37, value: 0, done: false }] });
    await db.update(userData).set({ role: "USER", sector: 10, questData: [privateTracker] }).where(eq(userData.userId, "projection-user"));
    const patch = await getBattleUserPatch(db, "projection-user");
    const goal = patch?.persistedQuestData?.[0]?.goals[0];
    expect(goal).toMatchObject({ id: "secret-target", done: false });
    expect(goal).not.toHaveProperty("sector");
    expect(goal).not.toHaveProperty("longitude");
    expect(goal).not.toHaveProperty("latitude");
    expect(patch).not.toHaveProperty("userQuests");
    const canonical = await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") });
    expect(canonical?.questData).toEqual([privateTracker]);
    expect(await db.query.questHistory.findMany({ where: eq(questHistory.userId, "projection-user") })).toEqual([]);
  });

  it.each([{ role: "USER" as const, sector: 723 }, { role: "CONTENT" as const, sector: 10 }])("retains coordinates visible to %s", async ({ role, sector }) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "visible-battle-target", content: {
      objectives: [AllObjectives.parse({ id: "target", task: "move_to_location", hideLocation: true, sector: 723, longitude: 41, latitude: 37 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.update(userData).set({ role, sector, questData: [QuestTracker.parse({ id: "visible-battle-target", goals: [{ id: "target", sector: 723, longitude: 41, latitude: 37 }] })] }).where(eq(userData.userId, "projection-user"));
    expect((await getBattleUserPatch(db, "projection-user"))?.persistedQuestData?.[0]?.goals[0]).toMatchObject({ sector: 723, longitude: 41, latitude: 37 });
  });

  it("omits coordinates when a battle tracker no longer has a definition", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ questData: [QuestTracker.parse({ id: "deleted-target", goals: [{ id: "target", sector: 723, longitude: 41, latitude: 37, value: 2 }] })] }).where(eq(userData.userId, "projection-user"));
    const goal = (await getBattleUserPatch(db, "projection-user"))?.persistedQuestData?.[0]?.goals[0];
    expect(goal).toMatchObject({ id: "target", value: 2 });
    expect(goal).not.toHaveProperty("sector");
    expect(goal).not.toHaveProperty("longitude");
    expect(goal).not.toHaveProperty("latitude");
  });

  it("skips quest definitions when committed battle trackers contain no locations", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ questData: [QuestTracker.parse({ id: "numeric-progress", goals: [{ id: "train", value: 3 }] })] }).where(eq(userData.userId, "projection-user"));
    const definitions = vi.spyOn(db.query.quest, "findMany");
    try {
      const patch = await getBattleUserPatch(db, "projection-user");
      expect(patch?.persistedQuestData?.[0]?.goals[0]).toMatchObject({ id: "train", value: 3 });
      expect(definitions).not.toHaveBeenCalled();
    } finally { definitions.mockRestore(); }
  });

  it("omits coordinates for a goal removed from its current quest definition", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "edited-target", content: {
      objectives: [AllObjectives.parse({ id: "replacement", task: "stats_trained", value: 1 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.update(userData).set({ questData: [QuestTracker.parse({ id: "edited-target", goals: [{ id: "removed-target", sector: 723, longitude: 41, latitude: 37 }] })] }).where(eq(userData.userId, "projection-user"));
    const goal = (await getBattleUserPatch(db, "projection-user"))?.persistedQuestData?.[0]?.goals[0];
    expect(goal).not.toHaveProperty("sector");
    expect(goal).not.toHaveProperty("longitude");
    expect(goal).not.toHaveProperty("latitude");
  });

  it("omits the battle patch when required privacy definitions cannot be confirmed", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ questData: [QuestTracker.parse({ id: "unconfirmed-target", goals: [{ id: "target", sector: 723, longitude: 41, latitude: 37 }] })] }).where(eq(userData.userId, "projection-user"));
    const definitions = vi.spyOn(db.query.quest, "findMany").mockRejectedValueOnce(new Error("Definition lookup unavailable"));
    try { expect(await getBattleUserPatch(db, "projection-user")).toBeUndefined(); }
    finally { definitions.mockRestore(); }
  });

});
