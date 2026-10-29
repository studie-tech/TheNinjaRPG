import { beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { craftingRequirement, item, quest, questHistory, userCookingJob, userData, userItem, userQueue, userVote } from "@/drizzle/schema";
import { occupationRouter } from "@/server/api/routers/occupation";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuestHistory, insertQuests, insertUserItems, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

describeWithDatabase("crafting user cache quest progress", () => {
  beforeEach(async () => {
    await resetTables(userCookingJob, userQueue, userItem, craftingRequirement, item, questHistory, quest, userVote, userData);
    await insertUsers([{ userId: "crafter", username: "Crafter", status: "AWAKE", level: 50, rank: "JONIN", primaryElement: "Fire", secondaryElement: "Water", occupation: "CRAFTING", isOutlaw: true, federalStatus: "GOLD", regenAt: new Date(), updatedAt: new Date() }]);
    await insertItems([{ id: "material", stackSize: 100 }, { id: "crafted", canBeCrafted: true, craftingExperience: 5, rarity: "COMMON", stackSize: 1 }]);
    await insertUserItems([{ id: "material-stack", userId: "crafter", itemId: "material", quantity: 20 }]);
    const db = await getTestDatabase();
    await db.insert(craftingRequirement).values({ id: "recipe", craftItemId: "crafted", requirementItemId: "material", quantity: 1 });
    await db.insert(userVote).values({ id: "vote", userId: "crafter", secret: "secret01", lastVoteAt: new Date() });
  });


  it("publishes the queue and production XP when cancelling starts the following craft", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(occupationRouter, "crafter");
    expect((await caller.craftItem({ itemId: "crafted", quantity: 1 })).success).toBe(true);
    expect((await caller.craftItem({ itemId: "crafted", quantity: 1 })).success).toBe(true);
    expect((await caller.craftItem({ itemId: "crafted", quantity: 1 })).success).toBe(true);
    const waiting = await db.query.userQueue.findMany();
    expect(waiting).toHaveLength(2);
    await db.update(userItem).set({ craftingFinishedAt: new Date(Date.now() - 60000) });
    const result = await caller.cancelQueuedCraft({ queueId: waiting[0]!.id });
    expect(result.success).toBe(true);
    expect(result.userPatch?.queue).toEqual([]);
    expect(result.userPatch?.craftingExperience).toBe(10);
    expect(result.userPatch?.cookingJobs).toEqual([]);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))?.craftingExperience).toBe(result.userPatch?.craftingExperience);
  });

  it.each([
    { role: "USER" as const, sector: 1, hideLocation: true, visible: false },
    { role: "USER" as const, sector: 723, hideLocation: true, visible: true },
    { role: "CONTENT" as const, sector: 1, hideLocation: true, visible: true },
    { role: "USER" as const, sector: 1, hideLocation: false, visible: true },
  ])("projects unchanged virtual achievement coordinates when cancelling a craft (%s)", async ({ role, sector, hideLocation, visible }) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "virtual-location", questType: "achievement", hidden: false, content: {
      objectives: [AllObjectives.parse({ id: "target", task: "move_to_location", hideLocation, sector: 723, longitude: 41, latitude: 37 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    const privateTracker = QuestTracker.parse({ id: "virtual-location", goals: [{ id: "target", sector: 723, longitude: 41, latitude: 37, value: 0, done: false }] });
    await db.update(userData).set({ role, sector, regeneration: 0, questData: [privateTracker] }).where(eq(userData.userId, "crafter"));
    const profile = await callerFor(profileRouter, "crafter");
    const initial = await profile.getUser();
    const before = (await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))!;
    expect(await db.query.questHistory.findMany({ where: eq(questHistory.userId, "crafter") })).toEqual([]);
    await db.insert(userQueue).values({ id: "waiting-craft", userId: "crafter", kind: "CRAFT", position: 0, itemId: "crafted", quantity: 1, materials: [], durationSeconds: 60, startsAt: new Date(Date.now() + 3600000), finishesAt: new Date(Date.now() + 3660000) });
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, initial);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(occupationRouter, "crafter")).cancelQueuedCraft({ queueId: "waiting-craft" });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeDefined();
      const goal = result.userPatch?.questData?.find((tracker) => tracker.id === privateTracker.id)?.goals[0];
      expect(goal).toMatchObject({ id: "target", value: 0, done: false });
      if (visible) expect(goal).toMatchObject({ sector: 723, longitude: 41, latitude: 37 });
      else {
        expect(goal).not.toHaveProperty("sector");
        expect(goal).not.toHaveProperty("longitude");
        expect(goal).not.toHaveProperty("latitude");
      }
      await updateUserCache(client, key, result.userPatch, { revision });
      expect(client.getQueryData<typeof initial>(key)?.userData?.questData).toEqual(initial.userData?.questData);
      const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))!;
      expect(saved.questData).toEqual(before.questData);
      expect(saved.questData?.[0]?.goals[0]).toMatchObject({ sector: 723, longitude: 41, latitude: 37 });
    } finally { client.clear(); }
  });

  it.each(["definition", "objective"] as const)("omits unknown coordinates after cancelling a craft with a removed %s", async (removed) => {
    const db = await getTestDatabase();
    if (removed === "objective") await insertQuests([{ id: "removed-location", content: {
      objectives: [AllObjectives.parse({ id: "replacement", task: "items_crafted", value: 1 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    const privateTracker = QuestTracker.parse({ id: "removed-location", goals: [{ id: "target", sector: 723, longitude: 41, latitude: 37, value: 2 }] });
    await db.update(userData).set({ questData: [privateTracker] }).where(eq(userData.userId, "crafter"));
    await db.insert(userQueue).values({ id: "waiting-craft", userId: "crafter", kind: "CRAFT", position: 0, itemId: "crafted", quantity: 1, materials: [], durationSeconds: 60, startsAt: new Date(Date.now() + 3600000), finishesAt: new Date(Date.now() + 3660000) });
    const result = await (await callerFor(occupationRouter, "crafter")).cancelQueuedCraft({ queueId: "waiting-craft" });
    expect(result.success).toBe(true);
    const goal = result.userPatch?.questData?.[0]?.goals[0];
    expect(goal).toMatchObject({ id: "target", value: 2 });
    expect(goal).not.toHaveProperty("sector");
    expect(goal).not.toHaveProperty("longitude");
    expect(goal).not.toHaveProperty("latitude");
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))?.questData).toEqual([privateTracker]);
  });

  it("reconciles through the profile when cancellation cannot confirm location visibility", async () => {
    const db = await getTestDatabase();
    const privateTracker = QuestTracker.parse({ id: "unconfirmed-location", goals: [{ id: "target", sector: 723, longitude: 41, latitude: 37 }] });
    await db.update(userData).set({ questData: [privateTracker] }).where(eq(userData.userId, "crafter"));
    await db.insert(userQueue).values({ id: "waiting-craft", userId: "crafter", kind: "CRAFT", position: 0, itemId: "crafted", quantity: 1, materials: [], durationSeconds: 60, startsAt: new Date(Date.now() + 3600000), finishesAt: new Date(Date.now() + 3660000) });
    const definitions = vi.spyOn(db.query.quest, "findMany").mockRejectedValueOnce(new Error("Definition lookup unavailable"));
    try {
      const result = await (await callerFor(occupationRouter, "crafter")).cancelQueuedCraft({ queueId: "waiting-craft" });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      expect(await db.query.userQueue.findMany()).toEqual([]);
      expect((await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))?.questData).toEqual([privateTracker]);
    } finally { definitions.mockRestore(); }
  });
  it.each(["mission", "achievement", "queued"] as const)("publishes only committed production progress (%s)", async (scenario) => {
    const db = await getTestDatabase();
    const questType = scenario === "achievement" ? "achievement" : "mission";
    await insertQuests([{ id: "craft-goal", questType, maxAttempts: 100, maxCompletes: 100, content: { objectives: [AllObjectives.parse({ id: "make-one", task: "items_crafted", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await insertQuestHistory([{ userId: "crafter", questId: "craft-goal", questType }]);
    await db.update(userData).set({ questData: [QuestTracker.parse({ id: "craft-goal", goals: [{ id: "make-one", value: 0, done: false }] })] }).where(eq(userData.userId, "crafter"));
    if (scenario === "queued") await insertUserItems([{ id: "active-craft", userId: "crafter", itemId: "crafted", craftingFinishedAt: new Date(Date.now() + 60000) }]);
    const initial = await fetchUpdatedUser({ client: db, userId: "crafter" });
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, { userData: initial.user });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return { userData: initial.user }; } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(occupationRouter, "crafter")).craftItem({ itemId: "crafted", quantity: 1 });
      expect(result.success).toBe(true);
      const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))!;
      expect(saved.craftingExperience).toBe(scenario === "queued" ? 0 : 5);
      if (scenario === "achievement") {
        expect(result.userPatch).toBeUndefined();
        return;
      }
      await updateUserCache(client, key, result.userPatch, { revision, achievementProgress: result.achievementProgress });
      const cached = client.getQueryData<{ userData: NonNullable<typeof initial.user> }>(key)!.userData;
      expect(cached.questData).toEqual(saved.questData);
      expect(cached.questData?.find((tracker) => tracker.id === "craft-goal")?.goals[0]).toMatchObject({ value: scenario === "queued" ? 0 : 1, done: scenario !== "queued" });
      expect(cached.craftingExperience).toBe(saved.craftingExperience);
      expect(reads).toBe(0);
    } finally { stop(); client.clear(); }
  });

  it.each(["mission", "achievement"] as const)("evaluates total crafting XP after the committed grant (%s)", async (questType) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "craft-total", questType, consecutiveObjectives: false, maxAttempts: 100, maxCompletes: 100, content: { objectives: [
      AllObjectives.parse({ id: "total-xp", task: "crafting_experience", value: 100 }),
      AllObjectives.parse({ id: "made-items", task: "items_crafted", value: 2 }),
      AllObjectives.parse({ id: "earned-xp", task: "crafting_experience_gained", value: 10 }),
    ], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await insertQuestHistory([{ userId: "crafter", questId: "craft-total", questType }]);
    await db.update(userData).set({ craftingExperience: 95, questData: [QuestTracker.parse({ id: "craft-total", goals: [{ id: "total-xp", value: 95, done: false }, { id: "made-items", value: 0, done: false }, { id: "earned-xp", value: 0, done: false }] })] }).where(eq(userData.userId, "crafter"));
    const initial = await fetchUpdatedUser({ client: db, userId: "crafter" });
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, { userData: initial.user });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => {
      reads++;
      return { userData: (await fetchUpdatedUser({ client: db, userId: "crafter" })).user };
    } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(occupationRouter, "crafter")).craftItem({ itemId: "crafted", quantity: 1 });
      expect(result.success).toBe(true);
      const saved = (await db.query.userData.findFirst({ where: eq(userData.userId, "crafter") }))!;
      const goals = saved.questData?.find((tracker) => tracker.id === "craft-total")?.goals;
      expect(saved.craftingExperience).toBe(100);
      expect(goals?.find((goal) => goal.id === "total-xp")).toMatchObject({ value: 100, done: true });
      expect(goals?.find((goal) => goal.id === "made-items")).toMatchObject({ value: 1, done: false });
      expect(goals?.find((goal) => goal.id === "earned-xp")).toMatchObject({ value: 5, done: false });
      if (questType === "achievement") {
        expect(result.userPatch).toBeUndefined();
      } else {
        expect(result.userPatch?.questData).toEqual(saved.questData);
      }
      await updateUserCache(client, key, result.userPatch, { revision, achievementProgress: result.achievementProgress });
      const cached = client.getQueryData<{ userData: NonNullable<typeof initial.user> }>(key)!.userData;
      expect(cached.craftingExperience).toBe(saved.craftingExperience);
      expect(cached.questData).toEqual(saved.questData);
      expect(reads).toBe(questType === "achievement" ? 1 : 0);
    } finally { stop(); client.clear(); }
  });

  it.each(["story", "event", "anbu"] as const)("reconciles navigation after completing a team-enabled %s quest", async (questType) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "team-craft", questType, teamEnabled: true, maxAttempts: 100, maxCompletes: 100, content: { objectives: [AllObjectives.parse({ id: "make-one", task: "items_crafted", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await insertQuestHistory([{ userId: "crafter", questId: "team-craft", questType }]);
    await db.update(userData).set({ questData: [QuestTracker.parse({ id: "team-craft", goals: [{ id: "make-one", value: 0, done: false }] })] }).where(eq(userData.userId, "crafter"));
    const profile = await callerFor(profileRouter, "crafter");
    const initial = await profile.getUser();
    expect(initial.notifications).toContainEqual(expect.objectContaining({ name: "Quest Teams" }));
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, initial);
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile.getUser(); } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(occupationRouter, "crafter")).craftItem({ itemId: "crafted", quantity: 1 });
      expect(result.success).toBe(true);
      await updateUserCache(client, key, result.userPatch, { revision, achievementProgress: result.achievementProgress });
      const authoritative = await profile.getUser();
      expect(authoritative.notifications).toContainEqual(expect.objectContaining({ name: "Quest rewards waiting: open your Logbook", notificationCount: 1 }));
      expect(authoritative.notifications.some((entry) => entry.href === "/questteams")).toBe(false);
      const cached = client.getQueryData<typeof initial>(key)!;
      expect(cached.notifications).toEqual(authoritative.notifications);
      expect(cached.userData?.questData).toEqual(authoritative.userData?.questData);
      expect(reads).toBe(1);
      expect(result.userPatch).toBeUndefined();
    } finally { stop(); client.clear(); }
  });
});
