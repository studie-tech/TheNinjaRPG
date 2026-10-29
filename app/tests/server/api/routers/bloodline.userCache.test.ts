import * as crypto from "node:crypto";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { PITY_BLOODLINE_ROLLS, ROLL_CHANCE } from "@/drizzle/constants";
import { actionLog, bloodline, bloodlineRolls, gameSetting, quest, questHistory, userData, userVote } from "@/drizzle/schema";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { BloodlineCollection, QuestTracker, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";
import { countUserReads } from "../../../setup/userReads";

const userId = "lineage-collector";
const questId = "lineage-collection";
const lineId = "last-lineage";

describeWithDatabase("lineage acquisition profile reconciliation", () => {
  let restoreRandomInt: (() => void) | undefined;
  afterEach(() => { restoreRandomInt?.(); restoreRandomInt = undefined; });
  beforeEach(async () => {
    await resetTables(actionLog, bloodlineRolls, bloodline, questHistory, quest, userVote, gameSetting, userData);
    await insertUsers([{ userId, username: "LineageCollector", role: "USER", rank: "JONIN", level: 50,
      primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true,
      regeneration: 0, reputationPoints: 100000, updatedAt: new Date(), regenAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "collector-vote", userId, secret: "collect1", lastVoteAt: new Date() });
    await db.insert(bloodline).values({ id: lineId, name: "Last Lineage", rank: "A", hidden: false,
      image: "", description: "Collection fixture", regenIncrease: 0, effects: [] });
    await insertQuests([{ id: questId, name: "Lineage Collection", questType: "achievement", hidden: false,
      content: { objectives: [BloodlineCollection.parse({ id: "collect", task: "bloodline_collection", bloodlineRanks: ["A"] })],
        reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
  });

  it.each(["roll", "pityRoll", "purchaseBloodline"] as const)("%s records an unclaimed collection completion through the canonical fallback", async (method) => {
    const db = await getTestDatabase();
    if (method === "pityRoll") await db.insert(bloodlineRolls).values({ id: "pity-credit", userId, type: "ITEM", goal: "A", used: PITY_BLOODLINE_ROLLS });
    const randomInt = vi.spyOn(crypto, "randomInt").mockImplementation(() => Math.ceil(ROLL_CHANCE.S * 1_000_000));
    restoreRandomInt = () => randomInt.mockRestore();
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    const goal = (snapshot: typeof initial | undefined) => snapshot?.userData?.questData?.find((tracker) => tracker.id === questId)?.goals[0];
    expect(goal(initial)).toMatchObject({ done: false, value: 0, target: 1 });
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const caller = callerForDatabase(bloodlineRouter, userId, db);
      const result = method === "roll" ? await caller.roll() : method === "pityRoll"
        ? await caller.pityRoll({ rank: "A" }) : await caller.purchaseBloodline({ bloodlineId: lineId });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      await updateUserCache(client, key, result.userPatch, { revision });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(goal(client.getQueryData(key))).toMatchObject({ done: true, value: 1, target: 1 });
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      expect(saved?.questData?.find((tracker) => tracker.id === questId)?.goals[0]?.done).toBe(true);
      await db.insert(bloodline).values({ id: "catalogue-growth", name: "New Lineage", rank: "A", hidden: false, image: "", description: "New catalogue entry", effects: [] });
      expect(goal(await profile.getUser())?.done).toBe(true);
    } finally { unsubscribe(); client.clear(); }
  });

  it.each(["unrelated rank", "completed goal", "unavailable quest"])("keeps an acquisition patch local for %s", async (scenario) => {
    const db = await getTestDatabase();
    if (scenario === "unrelated rank") {
      const content = { objectives: [BloodlineCollection.parse({ id: "collect", task: "bloodline_collection", bloodlineRanks: ["D"] })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
      await db.update(quest).set({ content }).where(eq(quest.id, questId));
    } else if (scenario === "completed goal") {
      await db.update(userData).set({ questData: [QuestTracker.parse({ id: questId, goals: [{ id: "collect", done: true, value: 1, target: 1 }] })] }).where(eq(userData.userId, userId));
    } else await db.update(quest).set({ requiredLevel: 100 }).where(eq(quest.id, questId));
    const result = await callerForDatabase(bloodlineRouter, userId, db).purchaseBloodline({ bloodlineId: lineId });
    expect(result).toMatchObject({ success: true, userPatch: { bloodlineId: lineId } });
  });

  it("reconciles a hidden active collection definition for staff", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "CONTENT" }).where(eq(userData.userId, userId));
    await db.update(quest).set({ hidden: true, questType: "mission" }).where(eq(quest.id, questId));
    await db.insert(questHistory).values({ id: "hidden-run", userId, questId, questType: "mission" });
    const result = await callerForDatabase(bloodlineRouter, userId, db).purchaseBloodline({ bloodlineId: lineId });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
  });

  it("reconciles a lineage-dependent tier quest that can now be admitted", async () => {
    const db = await getTestDatabase();
    await db.delete(quest).where(eq(quest.id, questId));
    await insertQuests([{ id: "lineage-tier", questType: "tier", requiredBloodlineId: lineId, requiredLevel: 1, maxLevel: 100 }]);
    const result = await callerForDatabase(bloodlineRouter, userId, db).purchaseBloodline({ bloodlineId: lineId });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    await callerForDatabase(profileRouter, userId, db).getUser();
    expect(await db.query.questHistory.findFirst({ where: eq(questHistory.questId, "lineage-tier") })).toMatchObject({ userId, questId: "lineage-tier" });
  });

  it.each(["tier", "exam"] as const)("swapping admits a previously owned bloodline's %s quest through the canonical fallback", async (questType) => {
    const db = await getTestDatabase();
    await db.delete(quest).where(eq(quest.id, questId));
    await db.insert(bloodlineRolls).values({ id: "previous-lineage", userId, bloodlineId: lineId, type: "ITEM" });
    await insertQuests([{ id: "lineage-bootstrap", questType, requiredBloodlineId: lineId, requiredLevel: 1, maxLevel: 100, hidden: false }]);
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await callerForDatabase(bloodlineRouter, userId, db).swapBloodline({ bloodlineId: lineId });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      await updateUserCache(client, key, result.userPatch, { revision, achievementProgress: result.achievementProgress });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(client.getQueryData<typeof initial>(key)?.userData?.userQuests.map((entry) => entry.questId)).toContain("lineage-bootstrap");
      expect(await db.query.questHistory.findFirst({ where: eq(questHistory.questId, "lineage-bootstrap") })).toMatchObject({ userId, questId: "lineage-bootstrap" });
    } finally { unsubscribe(); client.clear(); }
  });

  it("keeps a bloodline swap local when collection history is unchanged", async () => {
    const db = await getTestDatabase();
    await db.insert(bloodline).values({ id: "unowned-lineage", name: "Unowned Lineage", rank: "A", image: "", description: "Collection fixture", effects: [] });
    await db.insert(bloodlineRolls).values({ id: "previous-lineage", userId, bloodlineId: lineId, type: "ITEM" });
    const result = await callerForDatabase(bloodlineRouter, userId, db).swapBloodline({ bloodlineId: lineId });
    expect(result).toMatchObject({ success: true, userPatch: { bloodlineId: lineId } });
    expect(result.achievementProgress?.find((entry) => entry.questId === questId)).toBeDefined();
  });

  it("reconciles newly eligible and obsolete lineage achievements and missions after a swap", async () => {
    const db = await getTestDatabase();
    await db.delete(quest).where(eq(quest.id, questId));
    await db.insert(bloodline).values({ id: "old-lineage", name: "Old Lineage", rank: "D", image: "", description: "Former lineage", effects: [] });
    await db.update(userData).set({ bloodlineId: "old-lineage" }).where(eq(userData.userId, userId));
    await db.insert(bloodlineRolls).values({ id: "previous-lineage", userId, bloodlineId: lineId, type: "ITEM" });
    const content = { objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
    await insertQuests(["old", "new"].flatMap((prefix) => (["achievement", "mission"] as const).map((questType) => ({
      id: `${prefix}-${questType}`, questType, requiredBloodlineId: prefix === "old" ? "old-lineage" : lineId, content, hidden: false,
    }))));
    await db.insert(questHistory).values(["old", "new"].map((prefix) => ({ id: `${prefix}-mission-run`, userId, questId: `${prefix}-mission`, questType: "mission" as const })));
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    expect(initial.achievementProgress.map((entry) => entry.questId)).toEqual(["old-achievement"]);
    expect(initial.userData?.userQuests.map((entry) => entry.questId)).toEqual(["old-mission"]);
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await callerForDatabase(bloodlineRouter, userId, db).swapBloodline({ bloodlineId: lineId });
      expect(result.success).toBe(true);
      await updateUserCache(client, key, result.userPatch, { revision, achievementProgress: result.achievementProgress });
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.achievementProgress.map((entry) => entry.questId)).toEqual(["new-achievement"]);
      expect(cached.userData?.userQuests.map((entry) => entry.questId)).toEqual(["new-mission"]);
      expect(cached.userData?.questData?.map((tracker) => tracker.id).sort()).toEqual(["new-achievement", "new-mission"]);
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(cached.userData?.questData).toEqual((await profile.getUser()).userData?.questData);
    } finally { unsubscribe(); client.clear(); }
  });

  it.each(["roll", "pityRoll", "purchaseBloodline"] as const)("%s reconciles newly eligible lineage achievements and an existing mission", async (method) => {
    const db = await getTestDatabase();
    await db.delete(quest).where(eq(quest.id, questId));
    if (method === "pityRoll") await db.insert(bloodlineRolls).values({ id: "pity-credit", userId, type: "ITEM", goal: "A", used: PITY_BLOODLINE_ROLLS });
    const randomInt = vi.spyOn(crypto, "randomInt").mockImplementation(() => Math.ceil(ROLL_CHANCE.S * 1_000_000));
    restoreRandomInt = () => randomInt.mockRestore();
    const content = { objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
    await insertQuests((["achievement", "mission"] as const).map((questType) => ({ id: `new-${questType}`, questType, requiredBloodlineId: lineId, content, hidden: false })));
    await db.insert(questHistory).values({ id: "new-mission-run", userId, questId: "new-mission", questType: "mission" });
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    expect(initial.achievementProgress).toEqual([]);
    expect(initial.userData?.userQuests).toEqual([]);
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const caller = callerForDatabase(bloodlineRouter, userId, db);
      const result = method === "roll" ? await caller.roll() : method === "pityRoll" ? await caller.pityRoll({ rank: "A" }) : await caller.purchaseBloodline({ bloodlineId: lineId });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      await updateUserCache(client, key, result.userPatch, { revision });
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.achievementProgress.map((entry) => entry.questId)).toEqual(["new-achievement"]);
      expect(cached.userData?.userQuests.map((entry) => entry.questId)).toEqual(["new-mission"]);
      expect(getUser).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); client.clear(); }
  });

  it("removing a bloodline retires lineage-dependent achievements and missions", async () => {
    const db = await getTestDatabase();
    await db.delete(quest).where(eq(quest.id, questId));
    await db.update(userData).set({ bloodlineId: lineId }).where(eq(userData.userId, userId));
    const content = { objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
    await insertQuests((["achievement", "mission"] as const).map((questType) => ({ id: `old-${questType}`, questType, requiredBloodlineId: lineId, content, hidden: false })));
    await db.insert(questHistory).values({ id: "old-mission-run", userId, questId: "old-mission", questType: "mission" });
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    expect(initial.achievementProgress.map((entry) => entry.questId)).toEqual(["old-achievement"]);
    expect(initial.userData?.userQuests.map((entry) => entry.questId)).toEqual(["old-mission"]);
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await callerForDatabase(bloodlineRouter, userId, db).removeBloodline();
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      await updateUserCache(client, key, result.userPatch, { revision });
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.achievementProgress).toEqual([]);
      expect(cached.userData?.userQuests).toEqual([]);
      expect(cached.userData?.questData).toEqual([]);
      expect(getUser).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); client.clear(); }
  });

  it("keeps removal local with two profile reads when collection history is unchanged", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ bloodlineId: lineId }).where(eq(userData.userId, userId));
    const counted = countUserReads(db);
    const result = await callerForDatabase(bloodlineRouter, userId, counted.client).removeBloodline();
    expect(result).toMatchObject({ success: true, userPatch: { bloodlineId: null } });
    expect(counted.getReads()).toBe(2);
  });
});
