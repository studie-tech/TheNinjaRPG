// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { quest, questHistory, userData, userVote } from "@/drizzle/schema";
import { questsRouter } from "@/server/api/routers/quests";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const playerId = "quest-cache-player";
const missionId = "quest-cache-mission";
const content = (value: number) => ({
  objectives: [SimpleObjective.parse({ id: "train", task: "stats_trained", value })],
  reward: ObjectiveReward.parse({ reward_money: 100, reward_exp: 50 }),
  sceneBackground: "", sceneCharacters: [],
});

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
    await resetTables(questHistory, quest, userVote, userData);
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
    expect(result.userDelta?.earnedExperience).toBe((saved?.earnedExperience ?? 0) - (before?.earnedExperience ?? 0));
    expect(result.userPatch).toMatchObject({ missionsA: saved?.missionsA, curEnergy: saved?.curEnergy, questFinishAt: saved?.questFinishAt });
    expect(result.userPatch?.completedQuests?.some((entry) => entry.questId === missionId && entry.completed === 1)).toBe(true);
    expect(result.userPatch?.userQuests?.some((entry) => entry.questId === missionId)).toBe(false);
    expect(result.userPatch?.questData?.some((entry) => entry.id === missionId)).toBe(false);
    expect(reads()).toBe(1);
  });
});
