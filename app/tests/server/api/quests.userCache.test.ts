import { eq } from "drizzle-orm";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { quest, questHistory, userData, userQueue, userVote } from "@/drizzle/schema";
import { questsRouter } from "@/server/api/routers/quests";
import { profileRouter } from "@/server/api/routers/profile";
import { getEnergyQueue } from "@/libs/queue";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { CollectItem, InstantNewQuestObjective, InstantStartBattleObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { queueEnergy } from "../../setup/queues";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

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
    await resetTables(userQueue, questHistory, quest, userVote, userData);
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
  afterEach(() => vi.restoreAllMocks());

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
    const client = new QueryClient();
    const key = ["prerequisite-profile"];
    client.setQueryData(key, before);
    const revision = prepareUserUpdate(client, key);
    const reads = await countProfileReads();
    const result = await api.checkRewards({ questId: missionId });
    expect(result).toMatchObject({ success: true, resolved: true });
    expect(reads()).toBe(1);
    await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    const isEligible = requiredLevel <= 50;
    expect(client.getQueryState(key)?.isInvalidated).toBe(isEligible);
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
