import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { aiProfile, battle, clan, item, mpvpBattleQueue, mpvpBattleUser, quest, questHistory, userCookingJob, userData, userItem, village, war } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchAllGameSettings } from "@/queries/profile";
import { findMembershipUserCache } from "@/queries/socialUserCache";
import { initiateBattle } from "@/server/api/routers/combat";
import { profileRouter } from "@/server/api/routers/profile";
import { shrineRouter } from "@/server/api/routers/shrine";
import { getMembershipUserPatch } from "@/server/utils/socialUserCache";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("social mutation profile projections", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(aiProfile, battle, questHistory, quest, userItem, item, mpvpBattleUser, mpvpBattleQueue, war, clan, userCookingJob, userData, village);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "old", name: "Old village", sector: 10, kageId: "old-kage" },
      { id: "new", name: "New village", sector: 20, kageId: "new-kage" },
    ]);
    await insertUsers([{ userId: "projection-user", villageId: "old", status: "AWAKE", regeneration: 0 }]);
  });

  it("derives the clan bonus from opening raw sources without reading after the write", async () => {
    const db = await getTestDatabase();
    await db.insert(clan).values({ id: "regen-clan", name: "Regen", image: "", villageId: "old", founderId: "projection-user", leaderId: "projection-user", leaderOrderId: "order", regenBoost: 20 });
    await db.update(userData).set({ regeneration: 10, clanId: "regen-clan" }).where(eq(userData.userId, "projection-user"));
    const [before, settings] = await Promise.all([findMembershipUserCache(db, "projection-user"), fetchAllGameSettings(db)]);
    if (!before) throw new Error("Missing profile");
    await db.update(userData).set({ clanId: null }).where(eq(userData.userId, before.userId));
    const measured = await recordQueries(async () => getMembershipUserPatch(before, null, settings));
    expect(measured.statements).toEqual([]);
    expect(measured.result).toMatchObject({ clanId: null, clan: null });
    const canonical = await callerForDatabase(profileRouter, before.userId, db).getUser();
    expect(measured.result.regeneration).toEqual(canonical.userData?.regeneration ?? Number.NaN);
    expect(measured.result).not.toHaveProperty("activeWars");
    expect(measured.result).not.toHaveProperty("village");
  });

  it("carries a minimal actor-only admission update with no postwrite SELECTs and preserves private and virtual trackers", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ level: 50, rank: "JONIN", experience: 3_339_000, curHealth: 123, curChakra: 234, curStamina: 345, curEnergy: 12, regeneration: 0, pveFights: 8, bracketImmunityLiftedUntil: new Date(0), bracketImmunityPausedAt: null,
      questData: [QuestTracker.parse({ id: "deleted-private", goals: [{ id: "secret", sector: 723, longitude: 41, latitude: 37 }] })],
    }).where(eq(userData.userId, "projection-user"));
    await insertUsers([{ userId: "opponent-secret", username: "SecretOpponent", isAi: true, rank: "JONIN", level: 50, curHealth: 9999 }]);
    await db.insert(aiProfile).values({ id: "Default", userId: "opponent-secret", rules: [] });
    await insertQuests([{ id: "virtual-level", questType: "achievement", content: { objectives: [AllObjectives.parse({ id: "level", task: "user_level", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    const profile = callerForDatabase(profileRouter, "projection-user", db);
    const initial = await profile.getUser();
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const stop = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const measured = await recordQueries(() => initiateBattle({ client: db, userIds: ["projection-user"], targetIds: ["opponent-secret"], cacheUserId: "projection-user", biome: "default", scaleTarget: true }, "QUEST"));
      const result = measured.result;
      expect(result.success, result.message).toBe(true);
      const firstWrite = measured.statements.findIndex((statement) => /^(insert|update) /i.test(statement));
      expect(firstWrite).toBeGreaterThan(0);
      expect(measured.statements.slice(firstWrite).filter((statement) => /^select /i.test(statement))).toEqual([]);
      expect(result.userPatch).toEqual({ status: "BATTLE", battleId: result.battleId, bracketImmunityPausedAt: null });
      expect(result.userDelta).toEqual({ pveFights: 1 });
      expect(result.userPatch).not.toHaveProperty("questData");
      expect(result.userPatch).not.toHaveProperty("persistedQuestData");
      expect(result.userPatch).not.toHaveProperty("items");
      expect(JSON.stringify(result)).not.toContain("opponent-secret");
      await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta });
      expect(getUser).not.toHaveBeenCalled();
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.userData?.pveFights).toBe(9);
      expect(cached.userData).toMatchObject({ curHealth: initial.userData?.curHealth, curChakra: initial.userData?.curChakra, curStamina: initial.userData?.curStamina, curEnergy: initial.userData?.curEnergy, regenAt: initial.userData?.regenAt });
      expect(cached.userData?.questData).toEqual(initial.userData?.questData);
      expect(cached.achievementProgress).toEqual(initial.achievementProgress);
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") });
      expect(saved).toMatchObject({ status: "BATTLE", battleId: result.battleId, pveFights: 9, curHealth: 123, curChakra: 234, curStamina: 345, curEnergy: 12 });
    } finally { stop(); client.clear(); }
  });

  it("keeps canonical recovery for admission that pauses a live immunity timer", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ bracketImmunityLiftedUntil: new Date(Date.now() + 60_000) }).where(eq(userData.userId, "projection-user"));
    await insertUsers([{ userId: "timer-ai", username: "TimerOpponent", isAi: true }]);
    await db.insert(aiProfile).values({ id: "Default", userId: "timer-ai", rules: [] });
    const measured = await recordQueries(() => initiateBattle({ client: db, userIds: ["projection-user"], targetIds: ["timer-ai"], cacheUserId: "projection-user", biome: "default" }, "QUEST"));
    expect(measured.result.success).toBe(true);
    expect(measured.result.userPatch).toBeUndefined();
    expect(measured.result.userDelta).toBeUndefined();
    const firstWrite = measured.statements.findIndex((statement) => /^(insert|update) /i.test(statement));
    expect(measured.statements.slice(firstWrite).filter((statement) => /^select /i.test(statement))).toEqual([]);
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
      else expect(result.userPatch).toMatchObject({ status: "AWAKE", shrineBattles: [] });
      await updateUserCache(client, key, result.userPatch, { revision });
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "projection-user") });
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(saved).toMatchObject({ status: "AWAKE", cookingExperience: settlesCooking ? 99 : 0 });
      expect(cached.userData).toMatchObject({ status: "AWAKE", battleId: null, shrineBattles: [], cookingExperience: saved?.cookingExperience, cookingJobs: [] });
      expect(cached.notifications).not.toContainEqual(expect.objectContaining({ name: "We are attacking Shrine (Sector 30)" }));
      expect(reads).toBe(settlesCooking ? 1 : 0);
    } finally { stop(); client.clear(); }
  });

});
