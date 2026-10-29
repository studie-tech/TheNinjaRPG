import { eq } from "drizzle-orm";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { MAX_SKILL_POINTS, SECTOR_MAP_VERSION } from "@/drizzle/constants";
import { item, quest, questHistory, sectorMap, userCookingJob, userData, userItem, userQueue, userVote } from "@/drizzle/schema";
import { questsRouter } from "@/server/api/routers/quests";
import { profileRouter } from "@/server/api/routers/profile";
import { getEnergyQueue } from "@/libs/queue";
import * as questQueries from "@/queries/quests";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { AllObjectives, CollectItem, InstantNewQuestObjective, InstantStartBattleObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuestHistory, insertQuests, insertUserItems, insertUsers } from "../../../../setup/factories";
import { queueEnergy } from "../../../../setup/queues";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../../setup/testDatabase";

const playerId = "quest-cache-player";
const missionId = "quest-cache-mission";
const content = (value: number) => ({
  objectives: [SimpleObjective.parse({ id: "train", task: "stats_trained", value })],
  reward: ObjectiveReward.parse({ reward_money: 100, reward_exp: 50 }),
  sceneBackground: "", sceneCharacters: [],
});
const immediateObjectives = [
  { name: "battle", done: false, objective: InstantStartBattleObjective.parse({ id: "instant", task: "start_battle", opponentAIs: [{ ids: ["cache-opponent"], number: 1 }] }) },
  { name: "new quest", done: true, objective: InstantNewQuestObjective.parse({ id: "instant", task: "new_quest", newQuestIds: ["another-cache-quest"] }) },
  { name: "item collection", done: true, objective: CollectItem.parse({ id: "instant", task: "collect_item", sector: 0, longitude: 10, latitude: 7, collectItemIds: ["cache-item"] }) },
];

const readPlayer = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, playerId) });

const countProfileReads = async () => {
  const database = await getTestDatabase();
  const read = database.query.userData.findFirst.bind(database.query.userData);
  let reads = 0;
  vi.spyOn(database.query.userData, "findFirst").mockImplementation(((options: Parameters<typeof read>[0]) => {
    if (options?.with) reads++;
    return read(options);
  }) as never);
  return () => reads;
};

describeWithDatabase("confirmed quest cache responses", () => {
  beforeEach(async () => {
    await resetTables(userCookingJob, userItem, item, userQueue, questHistory, quest, sectorMap, userVote, userData);
    invalidatePublishedMapCache();
    await insertUsers([{ userId: playerId, username: "questcache", rank: "JONIN", level: 50,
      primaryElement: "Fire", secondaryElement: "Water", isOutlaw: true, status: "AWAKE",
      sector: 0, money: 1000, earnedExperience: 0, curEnergy: 30, regeneration: 0,
    }]);
    await insertQuests([
      { id: missionId, name: "Cache mission", questType: "mission", questRank: "A", maxCompletes: 3, content: content(10) },
      { id: "cache-tier", name: "Tier", questType: "tier", content: content(10000) },
    ]);
    await insertQuestHistory([{ userId: playerId, questId: "cache-tier", questType: "tier" }]);
    await (await getTestDatabase()).insert(userVote).values({ id: "cache-vote", userId: playerId, secret: "secret01", lastVoteAt: new Date() });
  });
  afterEach(() => { vi.restoreAllMocks(); invalidatePublishedMapCache(); });

  it("returns ordinary abandonment from the existing profile read and exact written timestamp", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "unclaimed-cache-achievement", questType: "achievement", content: content(10000) }]);
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    await db.update(userData).set({ activeNpcQuestId: missionId }).where(eq(userData.userId, playerId));
    const reads = await countProfileReads();
    const result = await api.abandon({ id: missionId });
    expect(result.success).toBe(true);
    expect(result.userPatch?.activeNpcQuestId).toBeNull();
    expect(result.userPatch?.userQuests?.some((entry) => entry.questId === missionId)).toBe(false);
    expect(result.userPatch?.questData?.some((entry) => entry.id === missionId)).toBe(false);
    expect(result.userPatch?.userQuests?.some((entry) => entry.questId === "cache-tier")).toBe(true);
    expect(result.userPatch?.questData?.some((entry) => entry.id === "unclaimed-cache-achievement")).toBe(true);
    expect((await readPlayer())?.questData?.some((entry) => entry.id === "unclaimed-cache-achievement")).toBe(false);
    expect(result.userPatch?.questFinishAt).toEqual((await readPlayer())?.questFinishAt);
    expect(reads()).toBe(1);
  });

  it.each(["event", "story", "mastery"] as const)(
    "claims a %s mastery reward once despite history for a deleted achievement",
    async (questType) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ ninjutsuMastery: 599999.85, masteryRanks: { ninjutsuMastery: "NOVICE" } })
        .where(eq(userData.userId, playerId));
      const examId = "custom-adept";
      await insertQuests([
        {
          id: examId,
          name: "Adept exam",
          questType,
          requiredNinjutsuMastery: 500000,
          content: {
            objectives: [
              SimpleObjective.parse({ id: "level", task: "user_level", value: 50 }),
            ],
            reward: ObjectiveReward.parse({
              reward_money: 100,
              reward_mastery_stat: "ninjutsuMastery",
              reward_mastery_rank: "ADEPT",
            }),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      await insertQuestHistory([
        { userId: playerId, questId: examId, questType },
        {
          userId: playerId,
          questId: "deleted-achievement",
          questType: "achievement",
          completed: 1,
          endAt: new Date(),
        },
      ]);
      const api = await callerFor(questsRouter, playerId);
      const result = await api.checkRewards({ questId: examId });
      expect(result).toMatchObject({ success: true, resolved: true });
      expect(result.userPatch).toBeUndefined();
      const saved = await readPlayer();
      expect(saved).toMatchObject({
        money: 1100,
        ninjutsuMastery: 599999.85,
        masteryRanks: { ninjutsuMastery: "ADEPT" },
      });
      expect((await api.checkRewards({ questId: examId })).success).toBe(true);
      expect(await readPlayer()).toMatchObject({
        money: 1100,
        masteryRanks: { ninjutsuMastery: "ADEPT" },
      });
      const history = await database.query.questHistory.findFirst({
        where: eq(questHistory.questId, examId),
      });
      expect(history).toMatchObject({ completed: 1, previousCompletes: 1 });
    },
  );

  it.each([
    { method: "startQuest", settleCooking: false },
    { method: "startQuest", settleCooking: true },
    { method: "startRandom", settleCooking: false },
    { method: "startRandom", settleCooking: true },
  ] as const)("forwards a located $method result without refetching the profile (settled cooking=$settleCooking)", async ({ method, settleCooking }) => {
    const db = await getTestDatabase();
    await db.update(quest).set({ questType: method === "startRandom" ? "crime" : "mission", content: { ...content(10), objectives: [AllObjectives.parse({ id: "located", task: "move_to_location", sector: 2, longitude: 10, latitude: 7, sectorType: "specific", sectorList: [], locationType: "specific", hideLocation: false })] } }).where(eq(quest.id, missionId));
    if (settleCooking) await db.insert(userCookingJob).values({ id: "completed-cooking", userId: playerId, experience: 23, finishesAt: new Date(Date.now() + 60000) });
    const profile = await (await callerFor(profileRouter, playerId)).getUser();
    if (settleCooking) await db.update(userCookingJob).set({ finishesAt: new Date(Date.now() - 1000) }).where(eq(userCookingJob.id, "completed-cooking"));
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, profile);
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile; } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const readsBefore = await countProfileReads();
      const caller = await callerFor(questsRouter, playerId);
      const result = method === "startQuest"
        ? await caller.startQuest({ questId: missionId, userSector: 0 })
        : await caller.startRandom({ type: "crime", rank: "A", userLevel: 50, userSector: 0, userVillageId: null });
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeDefined();
      await updateUserCache(client, key, result.userPatch, { revision, achievementProgress: result.achievementProgress });
      expect(client.getQueryData<typeof profile>(key)?.userData?.userQuests.some((entry) => entry.questId === missionId)).toBe(true);
      expect((await readPlayer())?.cookingExperience).toBe(settleCooking ? 23 : 0);
      expect(client.getQueryData<typeof profile>(key)?.userData).toMatchObject({ cookingExperience: settleCooking ? 23 : 0, cookingJobs: [] });
      expect(reads).toBe(0);
      // Cooking settlement reloads its committed receipt; the response adds no read.
      expect(readsBefore()).toBe(settleCooking ? 2 : 1);
    } finally { stop(); client.clear(); }
  });

  it.each([
    { questType: "mission", isolated: false },
    { questType: "battlepyramid", isolated: true },
  ] as const)("reconciles located paid $questType targets after its assignment transaction", async ({ questType, isolated }) => {
    const database = await getTestDatabase();
    await insertItems([{ id: "cache-ticket" }]);
    await insertUserItems([{ id: "cache-tickets", userId: playerId, itemId: "cache-ticket", quantity: 2 }]);
    await database.update(quest).set({
      questType,
      consecutiveObjectives: false,
      content: {
        ...content(10), isolated, entryItems: [{ ids: ["cache-ticket"], number: 1 }],
        objectives: [2, 3].map((sector) => AllObjectives.parse({
          id: `located-${sector}`, task: "defeat_opponents", opponentAIs: [{ ids: ["cache-opponent"], number: 1 }],
          sector, longitude: 10, latitude: 7, sectorType: "specific", locationType: "specific",
        })),
      },
    }).where(eq(quest.id, missionId));
    for (const sector of [2, 3]) await database.insert(sectorMap).values({
      id: `cache-map-${sector}`, sector, name: "Target map", width: 1, height: 1, status: "PUBLISHED",
      normalizedJson: {
        formatVersion: SECTOR_MAP_VERSION, sector, name: "Target map", width: 1, height: 1,
        tiles: [{ x: 0, y: 0, terrain: "ground", walkCost: 1, blocked: false, zone: "wilderness", battleBiome: "ground" }],
        objects: [], anchors: [], exits: [], metadata: { importedAt: new Date().toISOString(), source: "tiled" },
      },
    });

    const api = await callerFor(questsRouter, playerId);
    const { result, statements } = await recordQueries(() => api.startQuest({ questId: missionId, userSector: 0 }));
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.achievementProgress).toBeUndefined();
    expect(statements.some((statement) => /from `SectorMap`/i.test(statement))).toBe(false);
    const accepted = await readPlayer();
    expect(accepted?.status).toBe(isolated ? "BATTLE" : "AWAKE");
    expect(accepted?.questData?.find((entry) => entry.id === missionId)?.goals).toMatchObject([
      { sector: 2, longitude: 10, latitude: 7 },
      { sector: 3, longitude: 10, latitude: 7 },
    ]);
    expect(await database.query.questHistory.findFirst({ where: eq(questHistory.questId, missionId) })).toMatchObject({ entryPaid: true, isolated });
    expect(await database.query.userItem.findFirst({ where: eq(userItem.id, "cache-tickets") })).toMatchObject({ quantity: 1 });

    const reconciled = await (await callerFor(profileRouter, playerId)).getUser();
    const saved = (await readPlayer())?.questData?.find((entry) => entry.id === missionId)?.goals;
    expect(saved).toMatchObject([
      { sector: 2, longitude: 0, latitude: 0, locationChecked: true },
      { sector: 3, longitude: 0, latitude: 0, locationChecked: true },
    ]);
    expect(reconciled.userData?.questData?.find((entry) => entry.id === missionId)?.goals).toEqual(saved);
    expect(await database.query.userItem.findFirst({ where: eq(userItem.id, "cache-tickets") })).toMatchObject({ quantity: 1 });
  });

  it("returns the accepted specific mission, counter and trackers using its existing profile read", async () => {
    const reads = await countProfileReads();
    const result = await (await callerFor(questsRouter, playerId)).startQuest({ questId: missionId, userSector: 0 });
    expect(result.success).toBe(true);
    const saved = await readPlayer();
    expect(result.userPatch?.dailyMissions).toBe(saved?.dailyMissions);
    expect(result.userPatch?.dailyMissions).toBe(1);
    expect(result.userPatch?.questData?.find((entry) => entry.id === missionId)).toBeDefined();
    expect(result.userPatch?.userQuests?.filter((entry) => entry.questId === missionId)).toHaveLength(1);
    expect(reads()).toBe(1);
  });

  it.each(["startQuest", "startRandom"] as const)("reconciles collection effects unlocked by a consecutive %s assignment", async (method) => {
    const database = await getTestDatabase();
    const collectionItemId = "cache-consecutive-item";
    await insertItems([{ id: collectionItemId }]);
    await database.update(userData).set({ longitude: 10, latitude: 7 }).where(eq(userData.userId, playerId));
    await database.update(quest).set({
      questType: method === "startRandom" ? "crime" : "mission",
      consecutiveObjectives: true,
      content: {
        ...content(10),
        objectives: [
          SimpleObjective.parse({ id: "ready", task: "user_level", value: 1, nextObjectiveId: "collect" }),
          CollectItem.parse({ id: "collect", task: "collect_item", sector: 0, longitude: 10, latitude: 7, collectItemIds: [collectionItemId] }),
        ],
      },
    }).where(eq(quest.id, missionId));

    const api = await callerFor(questsRouter, playerId);
    const result = method === "startQuest"
      ? await api.startQuest({ questId: missionId, userSector: 0 })
      : await api.startRandom({ type: "crime", rank: "A", userLevel: 50, userSector: 0, userVillageId: null });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.achievementProgress).toBeUndefined();
    expect((await readPlayer())?.questData?.find((entry) => entry.id === missionId)?.goals.find((goal) => goal.id === "collect")?.done).toBe(false);
    expect(await database.query.userItem.findMany({ where: eq(userItem.userId, playerId) })).toHaveLength(0);

    const profileApi = await callerFor(profileRouter, playerId);
    const reconciled = await profileApi.getUser();
    expect(reconciled.userData?.questData?.find((entry) => entry.id === missionId)?.goals.find((goal) => goal.id === "collect")?.done).toBe(true);
    expect(await database.query.userItem.findMany({ where: eq(userItem.userId, playerId) })).toMatchObject([{ itemId: collectionItemId }]);
    await profileApi.getUser();
    expect(await database.query.userItem.findMany({ where: eq(userItem.userId, playerId) })).toHaveLength(1);
  });

  it.each(["startQuest", "startRandom"] as const)("keeps reconciliation after %s emits an immediate objective consequence", async (method) => {
    for (const { name, objective, done } of immediateObjectives) {
      const database = await getTestDatabase();
      await database.delete(questHistory).where(eq(questHistory.questId, missionId));
      await database.update(userData).set({ questData: [], dailyMissions: 0 }).where(eq(userData.userId, playerId));
      await database.update(quest).set({ questType: method === "startRandom" ? "crime" : "mission", content: { ...content(10), objectives: [objective] } }).where(eq(quest.id, missionId));
      const api = await callerFor(questsRouter, playerId);
      const result = method === "startQuest"
        ? await api.startQuest({ questId: missionId, userSector: 0 })
        : await api.startRandom({ type: "crime", rank: "A", userLevel: 50, userSector: 0, userVillageId: null });
      expect(result.success, name).toBe(true);
      expect(result.userPatch, name).toBeUndefined();
      expect(result.achievementProgress, name).toBeUndefined();
      const saved = await readPlayer();
      expect(saved?.questData?.find((entry) => entry.id === missionId)?.goals[0]?.done, name).toBe(done);
    }
  });

  it("returns the live skill-point balance after overlapping quest payouts in separate clients", async () => {
    const db = await getTestDatabase();
    const questIds = ["cache-event", "cache-story"];
    await insertItems([{ id: "cache-gift", name: "Gift" }]);
    await insertQuests(questIds.map((id, index) => ({
      id,
      name: id,
      questType: index === 0 ? "event" as const : "story" as const,
      content: { ...content(10), objectives: [SimpleObjective.parse({ id: "level", task: "user_level", value: 50 })],
        reward: ObjectiveReward.parse({ reward_skillpoints: 3, reward_items: [{ ids: ["cache-gift"], number: 100 }] }) },
    })));
    await insertQuestHistory(questIds.map((questId, index) => ({ userId: playerId, questId, questType: index === 0 ? "event" as const : "story" as const })));
    await db.update(userData).set({ skillPoints: 2 }).where(eq(userData.userId, playerId));
    const profileApi = await callerFor(profileRouter, playerId);
    const profile = await profileApi.getUser();
    const reads = await countProfileReads();
    const key = ["independent-profile"];
    const clients = questIds.map(() => new QueryClient());
    for (const client of clients) client.setQueryData(key, profile);
    const revisions = clients.map((client) => prepareUserUpdate(client, key));
    const gate = () => {
      let resolve = () => {};
      const promise = new Promise<void>((settle) => { resolve = settle; });
      return { promise, resolve };
    };
    const entered = questIds.map(gate);
    const releases = questIds.map(gate);
    let selections = 0;
    const select = db.select.bind(db);
    const selectWithPause = ((fields: Parameters<typeof select>[0]) => {
      const selection = select(fields);
      if (!fields || !("canStack" in fields)) return selection;
      return { from: (table: Parameters<typeof selection.from>[0]) => {
        const query = selection.from(table);
        return { where: async (condition: Parameters<typeof query.where>[0]) => {
          const index = selections++;
          entered[index]!.resolve();
          await releases[index]!.promise;
          return await query.where(condition);
        } };
      } };
    }) as typeof db.select;
    const pausedDb = new Proxy(db, { get: (target, property, receiver) => property === "select" ? selectWithPause : Reflect.get(target, property, receiver) });
    const api = callerForDatabase(questsRouter, playerId, pausedDb);
    const first = api.checkRewards({ questId: questIds[0]! });
    await Promise.race([entered[0]!.promise, first.then((result) => { throw new Error(`First claim skipped payout: ${result.success}`); })]);
    expect((await readPlayer())?.skillPoints).toBe(2);
    const second = api.checkRewards({ questId: questIds[1]! });
    await Promise.race([entered[1]!.promise, second.then((result) => { throw new Error(`Second claim skipped payout: ${result.success}`); })]);
    releases[0]!.resolve();
    const firstResult = await first;
    expect(firstResult.success).toBe(true);
    expect((await readPlayer())?.skillPoints).toBe(5);
    releases[1]!.resolve();
    const secondResult = await second;
    expect(secondResult.success).toBe(true);
    expect((await readPlayer())?.skillPoints).toBe(8);
    for (const [index, result] of [firstResult, secondResult].entries()) {
      await updateUserCache(clients[index]!, key, result.userPatch, { revision: revisions[index], delta: result.userDelta, achievementProgress: result.achievementProgress });
      expect(clients[index]!.getQueryState(key)?.isInvalidated).toBe(false);
    }
    expect(clients[1]!.getQueryData<typeof profile>(key)?.userData?.skillPoints).toBe(8);
    expect(secondResult.userPatch?.skillPoints).toBe(8);
    expect(reads()).toBe(2);
    for (const client of clients) client.clear();
  });

  it("keeps a paid claim successful and refetches when skill-point confirmation fails", async () => {
    const db = await getTestDatabase();
    await db.update(quest).set({
      content: {
        ...content(10),
        objectives: [SimpleObjective.parse({ id: "level", task: "user_level", value: 50 })],
        reward: ObjectiveReward.parse({ reward_money: 100, reward_skillpoints: 3 }),
      },
    }).where(eq(quest.id, missionId));
    await db.update(userData).set({ skillPoints: 2 }).where(eq(userData.userId, playerId));
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    const profileApi = await callerFor(profileRouter, playerId);
    const profile = await profileApi.getUser();
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, profile);
    let refetches = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        refetches++;
        return await profileApi.getUser();
      },
    });
    const stop = observer.subscribe(() => undefined);
    const confirmation = vi.spyOn(questQueries, "findQuestRewardSkillPoints")
      .mockRejectedValueOnce(new Error("Skill-point confirmation unavailable"));
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await api.checkRewards({ questId: missionId });
      expect(confirmation).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ success: true, resolved: true });
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(result.achievementProgress).toBeUndefined();
      await updateUserCache(client, key, result.userPatch, {
        revision, delta: result.userDelta, achievementProgress: result.achievementProgress,
      });
      expect(refetches).toBe(1);
      expect(client.getQueryData<typeof profile>(key)?.userData).toMatchObject({ money: 1100, skillPoints: 5 });
      expect((await api.checkRewards({ questId: missionId })).success).toBe(true);
      expect(confirmation).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      client.clear();
      // The confirmation is optional cache data; the SQL payout and receipt stay committed.
      expect(await readPlayer()).toMatchObject({ money: 1100, skillPoints: 5 });
      expect(await db.query.questHistory.findFirst({ where: eq(questHistory.questId, missionId) }))
        .toMatchObject({ completed: 1, previousCompletes: 1, endAt: expect.any(Date) });
    }
  });

  it("rejects a failed skill-point payout before attempting balance confirmation", async () => {
    const db = await getTestDatabase();
    await db.update(quest).set({
      content: {
        ...content(10),
        objectives: [SimpleObjective.parse({ id: "level", task: "user_level", value: 50 })],
        reward: ObjectiveReward.parse({ reward_money: 100, reward_skillpoints: 3 }),
      },
    }).where(eq(quest.id, missionId));
    await db.update(userData).set({ skillPoints: 2 }).where(eq(userData.userId, playerId));
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    const payout = vi.spyOn(questQueries, "updateUserDataForUpdateRewards")
      .mockRejectedValueOnce(new Error("Reward payout unavailable"));
    const confirmation = vi.spyOn(questQueries, "findQuestRewardSkillPoints");
    await expect(api.checkRewards({ questId: missionId })).rejects.toThrow("Reward payout unavailable");
    expect(payout).toHaveBeenCalledTimes(1);
    expect(confirmation).not.toHaveBeenCalled();
    expect(await readPlayer()).toMatchObject({ money: 1000, skillPoints: 2 });
  });

  it.each(["event", "story"] as const)("reconciles completed %s team navigation after disbanding", async (questType) => {
    const db = await getTestDatabase();
    const questId = "disbanded-team-cache";
    await insertItems([{ id: "cache-gift", name: "Gift" }]);
    await insertQuests([{ id: questId, name: "Team quest", questType, teamEnabled: true,
      content: { ...content(10), objectives: [SimpleObjective.parse({ id: "level", task: "user_level", value: 50 })],
        reward: ObjectiveReward.parse({ reward_items: [{ ids: ["cache-gift"], number: 100 }] }) },
    }]);
    await insertQuestHistory([{ userId: playerId, questId, questType }]);
    const profileApi = await callerFor(profileRouter, playerId);
    const profile = await profileApi.getUser();
    const notice = { name: "Quest rewards waiting: open your Logbook" };
    expect(profile.userData?.questPartyId).toBeNull();
    expect(profile.notifications).toContainEqual(expect.objectContaining(notice));
    const key = ["disbanded-team-profile"];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryDefaults(key, { queryFn: () => profileApi.getUser() });
    client.setQueryData(key, profile);
    const revision = prepareUserUpdate(client, key);
    const result = await (await callerFor(questsRouter, playerId)).checkRewards({ questId });
    expect(result).toMatchObject({ success: true, resolved: true });
    await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    const authoritative = await profileApi.getUser();
    expect(authoritative.notifications).not.toContainEqual(expect.objectContaining(notice));
    const cached = client.getQueryData<typeof profile>(key);
    expect(client.getQueryState(key)?.isInvalidated || !cached?.notifications.some((entry) => entry.name === notice.name)).toBe(true);
    client.clear();
  });

  it.each([
    { initial: 2, amount: 3, expected: 5 },
    { initial: MAX_SKILL_POINTS - 1, amount: 3, expected: MAX_SKILL_POINTS },
    { initial: 5, amount: -3, expected: 2 },
  ])("applies claimed inventory and $amount skill points from the accepted balance $initial without refetching getUser", async ({ initial, amount, expected }) => {
    const db = await getTestDatabase();
    await insertItems([{ id: "cache-gift", name: "Gift" }]);
    await db.update(quest).set({ content: { ...content(10), reward: ObjectiveReward.parse({ reward_money: 100, reward_skillpoints: amount, reward_items: [{ ids: ["cache-gift"], number: 100 }] }) } }).where(eq(quest.id, missionId));
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    await db.update(userData).set({ questData: [{ id: missionId, startAt: new Date().toISOString(), goals: [{ id: "train", value: 10, done: true, collected: false, recentlyDied: false }] }] }).where(eq(userData.userId, playerId));
    await db.insert(userCookingJob).values({ id: "completed-cooking", userId: playerId, experience: 23, finishesAt: new Date(Date.now() + 60000) });
    const profile = await (await callerFor(profileRouter, playerId)).getUser();
    await db.update(userData).set({ skillPoints: initial }).where(eq(userData.userId, playerId));
    await db.update(userCookingJob).set({ finishesAt: new Date(Date.now() - 1000) }).where(eq(userCookingJob.id, "completed-cooking"));
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, profile);
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return profile; } });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await api.checkRewards({ questId: missionId });
      expect(result.success).toBe(true);
      expect(result.userPatch?.skillPoints).toBe(expected);
      expect(await db.query.userItem.findMany()).toHaveLength(1);
      await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
      const saved = await readPlayer();
      expect(saved?.skillPoints).toBe(expected);
      expect(saved?.cookingExperience).toBe(23);
      expect(client.getQueryData<typeof profile>(key)?.userData).toMatchObject({ skillPoints: saved?.skillPoints, money: saved?.money, cookingExperience: saved?.cookingExperience, cookingJobs: await db.query.userCookingJob.findMany() });
      expect(reads).toBe(0);
    } finally { stop(); client.clear(); }
  });

  it.each(["away", "waiting", "future", "completed", "ready"] as const)(
    "reconciles an item payout only when collection effects run (%s)",
    async (state) => {
      const db = await getTestDatabase();
      await insertItems([{ id: "cache-gift", name: "Gift" }]);
      await db
        .update(quest)
        .set({
          content: {
            ...content(10),
            reward: ObjectiveReward.parse({
              reward_items: [{ ids: ["cache-gift"], number: 100 }],
            }),
          },
        })
        .where(eq(quest.id, missionId));
      const collectionId = "cache-collection";
      const objective = CollectItem.parse({
        id: "collect",
        task: "collect_item",
        sector: 0,
        longitude: state === "away" ? 11 : 10,
        latitude: 7,
        collectItemIds: ["cache-gift"],
        collect_time_minutes: 1,
      });
      await insertQuests([
        {
          id: collectionId,
          questType: "story",
          consecutiveObjectives: state === "future",
          content: {
            ...content(10),
            objectives:
              state === "future"
                ? [
                    SimpleObjective.parse({
                      id: "first",
                      task: "stats_trained",
                      value: 10000,
                    }),
                    objective,
                  ]
                : [objective],
          },
        },
      ]);
      await insertQuestHistory([
        { userId: playerId, questId: collectionId, questType: "story" },
      ]);
      const api = await callerFor(questsRouter, playerId);
      expect(
        (await api.startQuest({ questId: missionId, userSector: 0 })).success,
      ).toBe(true);
      const missionTracker = {
        id: missionId,
        startAt: new Date().toISOString(),
        goals: [
          { id: "train", value: 10, done: true, collected: false, recentlyDied: false },
        ],
      };
      const collectionGoal = {
        id: "collect",
        value: 0,
        sector: 0,
        longitude: objective.longitude,
        latitude: objective.latitude,
        locationChecked: true,
        done: state === "completed",
        collected: state === "completed",
        recentlyDied: false,
        ...(state === "waiting" || state === "ready"
          ? {
              timestamp: new Date().toISOString(),
              collectDeadline: new Date(Date.now() + 60000).toISOString(),
            }
          : {}),
      };
      await db
        .update(userData)
        .set({
          questData: [
            missionTracker,
            {
              id: collectionId,
              startAt: new Date().toISOString(),
              goals:
                state === "future"
                  ? [
                      {
                        id: "first",
                        value: 0,
                        done: false,
                        collected: false,
                        recentlyDied: false,
                      },
                      collectionGoal,
                    ]
                  : [collectionGoal],
            },
          ],
        })
        .where(eq(userData.userId, playerId));
      const profileApi = await callerFor(profileRouter, playerId);
      const profile = await profileApi.getUser();
      if (state === "ready") {
        const questData =
          profile.userData?.questData?.map((tracker) =>
            tracker.id === collectionId
              ? {
                  ...tracker,
                  goals: tracker.goals.map((goal) => ({
                    ...goal,
                    collectDeadline: new Date(Date.now() - 1000).toISOString(),
                  })),
                }
              : tracker,
          ) ?? [];
        await db
          .update(userData)
          .set({ questData })
          .where(eq(userData.userId, playerId));
      }
      const key = ["collection-profile"];
      const client = new QueryClient();
      client.setQueryData(key, profile);
      let reads = 0;
      const stop = new QueryObserver(client, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: async () => {
          reads++;
          return profileApi.getUser();
        },
      }).subscribe(() => {});
      try {
        const revision = prepareUserUpdate(client, key);
        const result = await api.checkRewards({ questId: missionId });
        expect(result).toMatchObject({ success: true, resolved: true });
        expect(result.userPatch !== undefined).toBe(state !== "ready");
        await updateUserCache(client, key, result.userPatch, {
          revision,
          delta: result.userDelta,
          achievementProgress: result.achievementProgress,
        });
        expect(reads).toBe(state === "ready" ? 1 : 0);
        const goal = client
          .getQueryData<typeof profile>(key)
          ?.userData?.questData?.find((tracker) => tracker.id === collectionId)
          ?.goals.find((entry) => entry.id === "collect");
        expect(goal?.done ?? false).toBe(state === "completed" || state === "ready");
        expect(await db.query.userItem.findMany()).toHaveLength(
          state === "ready" ? 2 : 1,
        );
      } finally {
        stop();
        client.clear();
      }
    },
  );

  it("returns a completed repeatable mission without exposing it as active or recreating its tracker", async () => {
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    const database = await getTestDatabase();
    await database.update(userData).set({ questData: [{ id: missionId, startAt: new Date().toISOString(), goals: [{ id: "train", value: 10, done: true, collected: false, recentlyDied: false }] }] }).where(eq(userData.userId, playerId));
    const before = await readPlayer();
    const reads = await countProfileReads();
    const result = await api.checkRewards({ questId: missionId });
    expect(result).toMatchObject({ success: true, resolved: true });
    const saved = await readPlayer();
    expect(result.userDelta?.money).toBe((saved?.money ?? 0) - (before?.money ?? 0));
    expect(result.userPatch?.earnedExperience).toBe(saved?.earnedExperience);
    expect(result.userDelta?.earnedExperience).toBeUndefined();
    expect(result.userPatch).not.toHaveProperty("updatedAt");
    expect(result.userPatch).toMatchObject({ missionsA: saved?.missionsA, curEnergy: saved?.curEnergy, questFinishAt: saved?.questFinishAt });
    expect(result.userPatch?.completedQuests?.some((entry) => entry.questId === missionId && entry.completed === 1)).toBe(true);
    expect(result.userPatch?.userQuests?.some((entry) => entry.questId === missionId)).toBe(false);
    expect(result.userPatch?.questData?.some((entry) => entry.id === missionId)).toBe(false);
    expect(reads()).toBe(1);
  });

  it("returns settled queued training alongside completion without requiring another profile read", async () => {
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    const database = await getTestDatabase();
    await queueEnergy(playerId, [{ stat: "offence", energy: 40 }]);
    await database.update(userData).set({
      curEnergy: 100,
      questData: [{ id: missionId, startAt: new Date().toISOString(), goals: [{ id: "train", value: 10, done: true, collected: false, recentlyDied: false }] }],
    }).where(eq(userData.userId, playerId));
    const before = await readPlayer();
    const reads = await countProfileReads();
    const result = await api.checkRewards({ questId: missionId });
    const saved = await readPlayer();
    expect(result).toMatchObject({ success: true, resolved: true });
    expect(saved?.offence).toBeGreaterThan(before?.offence ?? 0);
    expect(saved?.experience).toBeGreaterThan(before?.experience ?? 0);
    expect(result.userPatch).toMatchObject({
      offence: saved?.offence,
      experience: saved?.experience,
      earnedExperience: saved?.earnedExperience,
      curEnergy: saved?.curEnergy,
      energyQueueHead: 1,
    });
    expect(getEnergyQueue(result.userPatch as never)).toEqual([]);
    expect(result.userDelta?.money).toBe((saved?.money ?? 0) - (before?.money ?? 0));
    expect(reads()).toBe(1);
  });

  it.each([1, 60])("reconciles prerequisite achievements only when the player's level meets %s", async (requiredLevel) => {
    const achievementId = "cache-prerequisite-achievement";
    await insertQuests([{ id: achievementId, name: "Prerequisite achievement", questType: "achievement", prerequisiteQuestId: missionId, requiredLevel,
      content: { ...content(10), objectives: [SimpleObjective.parse({ id: "level", task: "user_level", value: 70 })] },
    }]);
    const api = await callerFor(questsRouter, playerId);
    expect((await api.startQuest({ questId: missionId, userSector: 0 })).success).toBe(true);
    await (await getTestDatabase()).update(userData).set({ questData: [{ id: missionId, startAt: new Date().toISOString(), goals: [{ id: "train", value: 10, done: true, collected: false, recentlyDied: false }] }] }).where(eq(userData.userId, playerId));
    const profileApi = await callerFor(profileRouter, playerId);
    const before = await profileApi.getUser();
    expect(before.achievementProgress?.some((entry) => entry.questId === achievementId)).toBe(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["prerequisite-profile"];
    let refetches = 0;
    client.setQueryDefaults(key, { queryFn: async () => { refetches++; return profileApi.getUser(); } });
    client.setQueryData(key, before);
    const revision = prepareUserUpdate(client, key);
    const reads = await countProfileReads();
    const result = await api.checkRewards({ questId: missionId });
    expect(result).toMatchObject({ success: true, resolved: true });
    expect(reads()).toBe(1);
    await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    const isEligible = requiredLevel <= 50;
    expect(refetches).toBe(isEligible ? 1 : 0);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    if (isEligible) {
      expect(result.userPatch).toBeUndefined();
      expect(result.achievementProgress).toBeUndefined();
      const authoritative = await profileApi.getUser();
      expect(authoritative.achievementProgress?.some((entry) => entry.questId === achievementId)).toBe(true);
      expect(authoritative.userData?.questData?.some((entry) => entry.id === achievementId)).toBe(true);
    } else {
      expect(result.userPatch).toBeDefined();
      expect(result.achievementProgress?.some((entry) => entry.questId === achievementId)).toBe(false);
    }
  });
});
