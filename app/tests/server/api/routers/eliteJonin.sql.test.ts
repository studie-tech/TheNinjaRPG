import { beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { canBootstrapQuestType } from "@/deltas/profile";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { calcHP } from "@/libs/profile";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import { fetchQuestDiscoveryCandidates } from "@/queries/quests";
import { fetchQuestBootstrap } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { fetchUncompletedQuests } from "@/server/utils/questAssignment";
import { commitQuestObjectiveRewards } from "@/server/utils/questConsequences";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { QuestReward } from "@/validators/rewardPackages";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("Elite Jonin milestone claims", () => {
  beforeEach(async () => resetTables(questHistory, quest, userData));

  it("discovers legacy level-100 content at 110 without reopening earlier milestones", async () => {
    const client = await getTestDatabase();
    await insertUsers([{ userId: "elite", rank: "ELITE JONIN", level: 110 }]);
    const user = await client.query.userData.findFirst({
      where: eq(userData.userId, "elite"),
    });
    if (!user) throw new Error("Missing Elite Jonin");
    await insertQuests([
      { id: "legacy", questType: "starter", requiredLevel: 100, maxLevel: 100 },
      { id: "legacy-tier", questType: "tier", requiredLevel: 100, maxLevel: 100 },
      { id: "bounded", questType: "starter", requiredLevel: 100, maxLevel: 101 },
      {
        id: "milestone",
        questType: "starter",
        requiredLevel: 100,
        maxLevel: 100,
        content: {
          objectives: [],
          reward: QuestReward.parse({ reward_level: 101, reward_stats: 20_000 }),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const candidates = await fetchQuestDiscoveryCandidates(client, user.userId, {
      questTypes: ["starter"],
      level: 110,
    });
    expect(
      candidates
        .filter((q) => isAvailableUserQuests(q, { ...user, completedQuests: [] }).check)
        .map((q) => q.id),
    ).toEqual(["legacy"]);
    expect(
      canBootstrapQuestType(
        await fetchQuestBootstrap(client, user.userId),
        "tier",
        user.level,
      ),
    ).toBe(true);
    expect(
      (await fetchUncompletedQuests(client, user, "tier")).map((q) => q.id),
    ).toEqual(["legacy-tier"]);
    const fetch = stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in Elite Jonin catalogue test",
    });
    try {
      const catalogue = await (await callerFor(questsRouter, user.userId)).getAll({
        limit: 100,
        userLevel: 110,
      });
      expect(catalogue.data.map((q) => q.id)).toContain("legacy");
      expect(catalogue.data.map((q) => q.id)).not.toContain("bounded");
    } finally {
      fetch.mockRestore();
    }
  });

  it("awards one level and one stat gain when two different milestones race for the same level", async () => {
    const client = await getTestDatabase();
    await insertUsers([
      {
        userId: "elite",
        rank: "ELITE JONIN",
        level: 100,
        skillPoints: 7,
        offence: 1_300_000,
        defence: 1_300_000,
        strength: 400_000,
        intelligence: 400_000,
        speed: 400_000,
        willpower: 400_000,
      },
    ]);
    await insertQuests(
      ["first", "second"].map((id) => ({
        id,
        questType: "starter",
        requiredLevel: 100,
        maxLevel: 100,
        content: {
          objectives: [],
          reward: QuestReward.parse({ reward_level: 101, reward_stats: 20_000 }),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })),
    );
    await insertQuestHistory(
      ["first", "second"].map((questId) => ({
        questId,
        userId: "elite",
        questType: "starter",
      })),
    );
    const snapshot = (await client.query.userData.findFirst({
      where: eq(userData.userId, "elite"),
      with: {
        userQuests: { with: { quest: true } },
        completedQuests: true,
        items: { with: { item: true } },
      },
    }))!;
    const results = await Promise.all(
      snapshot.userQuests.map((history) =>
        commitQuestObjectiveRewards({
          client,
          userId: "elite",
          user: structuredClone(snapshot) as never,
          rewards: PostProcessedRewardSchema.parse({
            reward_level: 101,
            reward_stats: 20_000,
          }),
          trackers: [],
          userQuest: history as never,
          existingHistory: history,
          resolved: true,
          notifications: [],
          consequences: [],
        }),
      ),
    );
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "claimed",
      "state_changed",
    ]);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, "elite") }),
    ).toMatchObject({
      level: 101,
      skillPoints: 7,
      offence: 1_320_000,
      defence: 1_320_000,
      strength: 420_000,
      intelligence: 420_000,
      speed: 420_000,
      willpower: 420_000,
      maxHealth: calcHP(101),
    });
    const histories = await client.query.questHistory.findMany();
    expect(histories.filter((history) => history.completed === 1)).toHaveLength(1);
    expect(
      histories.filter((history) => history.completed === 0 && history.endAt === null),
    ).toHaveLength(1);
  });

  it("executes a newly unlocked quest consequence using the committed milestone level", async () => {
    const client = await getTestDatabase();
    await insertUsers([
      {
        userId: "elite",
        rank: "ELITE JONIN",
        level: 100,
        offence: 1_300_000,
        defence: 1_300_000,
        strength: 400_000,
        intelligence: 400_000,
        speed: 400_000,
        willpower: 400_000,
        questData: [
          QuestTracker.parse({
            id: "watch",
            goals: [
              {
                id: "level",
                done: true,
                value: 101,
                selectedNextObjectiveId: "unlock",
              },
              { id: "unlock", done: false, value: 0 },
            ],
          }),
        ],
      },
    ]);
    await insertQuests([
      { id: "milestone", questType: "starter", requiredLevel: 100, maxLevel: 100 },
      {
        id: "watch",
        questType: "story",
        consecutiveObjectives: true,
        maxLevel: 110,
        content: {
          reward: QuestReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
          objectives: [
            AllObjectives.parse({
              id: "level",
              task: "user_level",
              value: 101,
              nextObjectiveId: "unlock",
            }),
            AllObjectives.parse({
              id: "unlock",
              task: "new_quest",
              newQuestIds: ["linked"],
            }),
          ],
        },
      },
      { id: "linked", questType: "starter", requiredLevel: 101, maxLevel: 110 },
    ]);
    await insertQuestHistory(
      ["milestone", "watch"].map((questId) => ({
        questId,
        userId: "elite",
        questType: questId === "watch" ? "story" : "starter",
      })),
    );
    const snapshot = (await client.query.userData.findFirst({
      where: eq(userData.userId, "elite"),
      with: {
        userQuests: { with: { quest: true } },
        completedQuests: true,
        items: { with: { item: true } },
      },
    }))!;
    const history = snapshot.userQuests.find((entry) => entry.questId === "milestone")!;
    const result = await commitQuestObjectiveRewards({
      client,
      userId: "elite",
      user: snapshot as never,
      rewards: PostProcessedRewardSchema.parse({
        reward_level: 101,
        reward_stats: 20_000,
      }),
      trackers: structuredClone(snapshot.questData ?? []),
      userQuest: history as never,
      existingHistory: history,
      resolved: true,
      notifications: [],
      consequences: [],
    });
    expect(result.outcome).toBe("claimed");
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "linked"),
      }),
    ).toMatchObject({ userId: "elite", completed: 0 });
  });
});
