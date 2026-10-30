import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { actionLog, gameSetting, quest, questHistory, userData, userVote, village } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { villageRouter } from "@/server/api/routers/village";
import * as profileApi from "@/server/api/routers/profile";
import { InstantNewQuestObjective, MoveToObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const userId = "membership-quest-actor";
const key = [["profile", "getUser"], { type: "query" }];
const content = { objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };

describeWithDatabase("village membership quest reconciliation", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(actionLog, questHistory, quest, userVote, gameSetting, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "old-home", name: "Old Home", sector: 1, kageId: "", type: "VILLAGE", joinable: true },
      { id: "new-home", name: "New Home", sector: 2, kageId: "", type: "VILLAGE", joinable: true },
      { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", sector: 3, kageId: "", type: "OUTLAW" },
    ]);
    await insertUsers([{ userId, username: "MembershipActor", role: "OWNER", rank: "JONIN", level: 50,
      status: "AWAKE", villageId: "old-home", regeneration: 0, primaryElement: "Fire", secondaryElement: "Water",
      updatedAt: new Date(), regenAt: new Date(), reputationPoints: 100000 }]);
    await db.insert(userVote).values({ id: "membership-vote", userId, secret: "member1", lastVoteAt: new Date() });
  });

  it.each(["joinVillage", "leaveVillage", "swapVillage"] as const)("%s reconciles destination achievements without post-mutation hydration", async (method) => {
    const db = await getTestDatabase();
    const source = method === "joinVillage" ? VILLAGE_SYNDICATE_ID : "old-home";
    const destination = method === "leaveVillage" ? VILLAGE_SYNDICATE_ID : "new-home";
    await db.update(userData).set({ villageId: source, isOutlaw: method === "joinVillage" }).where(eq(userData.userId, userId));
    await insertQuests([
      { id: "old-achievement", questType: "achievement", requiredVillage: source, content, hidden: false },
      { id: "new-achievement", questType: "achievement", requiredVillage: destination, content, hidden: false },
    ]);
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    expect(initial.achievementProgress.map((entry) => entry.questId)).toEqual(["old-achievement"]);
    const client = new QueryClient();
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
      const caller = callerForDatabase(villageRouter, userId, db);
      const result = method === "leaveVillage" ? await caller.leaveVillage() : await caller[method]({ villageId: destination });
      expect(result.success).toBe(true);
      expect(hydration).toHaveBeenCalledTimes(1);
      expect(result).not.toHaveProperty("userPatch");
      await client.invalidateQueries({ queryKey: key, exact: true });
      expect(getUser).toHaveBeenCalledTimes(1);
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.userData?.villageId).toBe(destination);
      expect(cached.userData?.questData?.map((tracker) => tracker.id)).toEqual(["new-achievement"]);
      expect(await db.query.questHistory.findMany({ where: eq(questHistory.userId, userId) })).toEqual([]);
      const canonical = await profile.getUser();
      expect(cached.userData?.questData?.slice().sort((a, b) => a.id.localeCompare(b.id))).toEqual(canonical.userData?.questData?.slice().sort((a, b) => a.id.localeCompare(b.id)));
      expect(cached.userData?.userQuests.slice().sort((a, b) => a.questId.localeCompare(b.questId))).toEqual(canonical.userData?.userQuests.slice().sort((a, b) => a.questId.localeCompare(b.questId)));
      expect(cached.achievementProgress.map(({ startedAt: _startedAt, ...entry }) => entry)).toEqual(canonical.achievementProgress.map(({ startedAt: _startedAt, ...entry }) => entry));
      expect(cached.userData?.regeneration).toBe(canonical.userData?.regeneration);
    } finally { unsubscribe(); client.clear(); }
  });

  it("reconciles newly bootstrapped private quest locations through the canonical fallback", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "USER", villageId: VILLAGE_SYNDICATE_ID, isOutlaw: true }).where(eq(userData.userId, userId));
    await insertQuests([{ id: "private-destination-tier", questType: "tier", requiredVillage: "new-home", requiredLevel: 1, maxLevel: 100, hidden: false,
      content: { ...content, objectives: [MoveToObjective.parse({ id: "secret", task: "move_to_location", sector: 723, longitude: 41, latitude: 37, hideLocation: true })] } }]);
    const result = await callerForDatabase(villageRouter, userId, db).joinVillage({ villageId: "new-home" });
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty("userPatch");
    const canonical = await callerForDatabase(profileRouter, userId, db).getUser();
    expect(canonical.userData?.userQuests?.[0]?.quest.content.objectives[0]).toMatchObject({ sector: 1337, longitude: 1337, latitude: 1337 });
    const publicGoal = canonical.userData?.questData?.[0]?.goals[0];
    expect(publicGoal?.id).toBe("secret");
    expect(publicGoal).not.toHaveProperty("sector");
    expect(publicGoal).not.toHaveProperty("longitude");
    expect(publicGoal).not.toHaveProperty("latitude");
    const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(saved?.questData?.[0]?.goals[0]).toMatchObject({ sector: 723, longitude: 41, latitude: 37 });
  });

  it.each(["joinVillage", "leaveVillage", "swapVillage"] as const)("%s reconciles automatic child quest effects without retaining a partial projection or delta", async (method) => {
    const db = await getTestDatabase();
    const source = method === "joinVillage" ? VILLAGE_SYNDICATE_ID : "old-home";
    const destination = method === "leaveVillage" ? VILLAGE_SYNDICATE_ID : "new-home";
    await db.update(userData).set({ villageId: source, isOutlaw: method === "joinVillage" }).where(eq(userData.userId, userId));
    await insertQuests([
      { id: "new-achievement", questType: "achievement", requiredVillage: destination, content, hidden: false },
      { id: "destination-tier", questType: "tier", requiredVillage: destination, requiredLevel: 1, maxLevel: 100, hidden: false,
        content: { ...content, objectives: [InstantNewQuestObjective.parse({ id: "start-child", task: "new_quest", newQuestIds: ["child-mission"] })] } },
      { id: "child-mission", name: "New Child Mission", questType: "mission", requiredVillage: destination, content, hidden: false },
    ]);
    await db.insert(questHistory).values({ id: "paused-destination-tier", userId, questId: "destination-tier", questType: "tier" });
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    expect(initial.userData?.userQuests).toEqual([]);
    const client = new QueryClient();
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
      const caller = callerForDatabase(villageRouter, userId, db);
      const result = method === "leaveVillage" ? await caller.leaveVillage() : await caller[method]({ villageId: destination });
      expect(result.success).toBe(true);
      expect(hydration).toHaveBeenCalledTimes(1);
      expect(await db.query.questHistory.findFirst({ where: eq(questHistory.questId, "child-mission") })).toBeUndefined();
      expect(result).not.toHaveProperty("userPatch");
      expect(result).not.toHaveProperty("announcements");
      await client.invalidateQueries({ queryKey: key, exact: true });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(client.getQueryData<typeof initial>(key)?.notifications).toContainEqual(expect.objectContaining({ name: "Started new quest: New Child Mission" }));
      const cached = await profile.getUser();
      expect(cached.userData?.villageId).toBe(destination);
      expect(cached.userData?.userQuests.map((entry) => entry.questId).sort()).toEqual(["child-mission", "destination-tier"]);
      expect(cached.userData?.questData?.map((tracker) => tracker.id).sort()).toEqual(["child-mission", "destination-tier", "new-achievement"]);
      expect(cached.achievementProgress.map((entry) => entry.questId)).toEqual(["new-achievement"]);
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      expect(cached.userData?.reputationPoints).toBe(saved?.reputationPoints);
      expect(cached.notifications.some((entry) => entry.name === "Started new quest: New Child Mission")).toBe(false);
      expect(saved?.reputationPoints).toBe(initial.userData?.reputationPoints);
    } finally { unsubscribe(); client.clear(); }
  });
});
