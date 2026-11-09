import { beforeEach, expect, it, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  farmPlot,
  item,
  itemPurchaseCounter,
  jutsu,
  quest,
  questHistory,
  trainingLog,
  userData,
  userItem,
  userJutsu,
  userQueue,
} from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { getNewTrackers } from "@/libs/quest";
import { mockAchievementHistoryEntries } from "@/libs/quest/projection";
import { initiateBattle } from "@/server/api/routers/combat";
import { farmingRouter } from "@/server/api/routers/farming";
import { itemRouter } from "@/server/api/routers/item";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { settleJutsuTrainingQueue } from "@/server/utils/userQueue";
import {
  CombatActivityTasks,
  getObjectiveSchema,
  QuestCompletionTasks,
  QuestTracker,
  QuestValidatorRawSchema,
} from "@/validators/objectives";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUsers,
  insertJutsus,
  insertDefaultAiProfile,
} from "../../setup/factories";
import { queueEnergy } from "../../setup/queues";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const userId = "achievement-player";
const achievementId = "activity-achievement";
const completionTasks = [
  ...Object.values(QuestCompletionTasks),
  "dungeons_completed",
  "raids_completed",
] as const;
const tasks = [...CombatActivityTasks, ...completionTasks];

describeWithDatabase("achievement persistence through sparse quest updates", () => {
  beforeEach(async () => {
    await resetTables(
      battleHistory,
      battle,
      aiProfile,
      trainingLog,
      farmPlot,
      itemPurchaseCounter,
      userQueue,
      userJutsu,
      userItem,
      item,
      jutsu,
      questHistory,
      quest,
      userData,
    );
    await insertUsers([
      {
        userId,
        villageId: "home",
        money: 10000,
        rank: "GENIN",
        level: 20,
        status: "AWAKE",
        isOutlaw: true,
        questData: [
          QuestTracker.parse({
            id: achievementId,
            goals: tasks.map((task) => ({
              id: task,
              value: CombatActivityTasks.some((activity) => activity === task) ? 4 : 10,
              done: completionTasks.some((completion) => completion === task),
            })),
          }),
          QuestTracker.parse({ id: "deleted-quest" }),
        ],
      },
    ]);
    await insertQuests([
      {
        id: achievementId,
        questType: "achievement",
        hidden: false,
        consecutiveObjectives: false,
        content: QuestValidatorRawSchema.shape.content.parse({
          objectives: tasks.map((task) =>
            getObjectiveSchema(task).parse({ id: task, task, value: 10 }),
          ),
          reward: {},
          sceneBackground: "",
          sceneCharacters: [],
        }),
      },
      {
        id: "active-quest",
        consecutiveObjectives: false,
        content: QuestValidatorRawSchema.shape.content.parse({
          objectives: [
            getObjectiveSchema("jutsus_mastered").parse({
              id: "jutsu",
              task: "jutsus_mastered",
              value: 10,
            }),
            getObjectiveSchema("buy_item").parse({
              id: "buy",
              task: "buy_item",
              value: 10,
              buyItemIds: ["shop-item"],
            }),
            getObjectiveSchema("plants_watered").parse({
              id: "water",
              task: "plants_watered",
              value: 10,
            }),
            getObjectiveSchema("stats_trained").parse({
              id: "energy",
              task: "stats_trained",
              value: 100,
            }),
            getObjectiveSchema("minutes_training").parse({
              id: "minutes",
              task: "minutes_training",
              value: 100,
            }),
          ],
          reward: {},
          sceneBackground: "",
          sceneCharacters: [],
        }),
      },
    ]);
    await insertQuestHistory([
      { id: "active-history", userId, questId: "active-quest" },
      { id: "orphan-history", userId, questId: "deleted-quest" },
    ]);
  });

  it.each(["none", "passive", "isolation"] as const)(
    "retains unclaimed achievement goals when profile hydration encounters %s CAS contention",
    async (race) => {
      const db = await getTestDatabase();
      const prior = new Date(Date.now() - 600_000);
      await db
        .update(userData)
        .set({
          status: race === "isolation" ? "BATTLE" : "AWAKE",
          battleId: null,
          regeneration: 0,
          updatedAt: prior,
          regenAt: prior,
          primaryElement: "Fire",
          secondaryElement: "Water",
        })
        .where(eq(userData.userId, userId));
      await db
        .update(quest)
        .set({
          content: QuestValidatorRawSchema.shape.content.parse({
            objectives: [
              getObjectiveSchema("stories_completed").parse({
                id: "story",
                task: "stories_completed",
                value: 1,
              }),
            ],
            reward: {},
            sceneBackground: "",
            sceneCharacters: [],
          }),
        })
        .where(eq(quest.id, "active-quest"));
      await insertQuests([{ id: "completed-story", questType: "story" }]);
      await insertQuestHistory([
        {
          userId,
          questId: "completed-story",
          questType: "story",
          completed: 1,
          previousCompletes: 1,
        },
      ]);
      const before = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      const expected = structuredClone(before!.questData![0]!);
      if (race !== "none") expected.goals[0]!.value = 5;
      const client =
        race === "none"
          ? db
          : beforeStatements(db, userData, [
              async () =>
                db
                  .update(userData)
                  .set({ updatedAt: new Date(), questData: [expected] })
                  .where(eq(userData.userId, userId)),
            ]);
      const result = await fetchUpdatedUser({ client, userId });
      const saved = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(saved?.questData?.find((entry) => entry.id === achievementId)).toEqual(
        expected,
      );
      expect(
        result.user?.questData?.find((entry) => entry.id === achievementId),
      ).toEqual(expected);
      expect(
        saved?.questData?.find((entry) => entry.id === "active-quest")?.goals,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "story", value: 1, done: true }),
        ]),
      );
      expect(
        result.user?.userQuests.some((entry) => entry.questId === "deleted-quest"),
      ).toBe(false);
      if (race !== "none") {
        expect(result.requiresUserRefresh).toBe(true);
        expect(result.requiresProgressionRefresh).toBe(true);
      }
      const reloaded = await fetchUpdatedUser({ client: db, userId });
      expect(
        reloaded.user?.questData?.find((entry) => entry.id === achievementId),
      ).toEqual(expected);
    },
  );

  it.each(["passive", "isolation"] as const)(
    "handles repeated %s CAS contention without persisting incomplete achievement progress",
    async (race) => {
      const db = await getTestDatabase();
      if (race === "isolation")
        await db
          .update(userData)
          .set({ status: "BATTLE" })
          .where(eq(userData.userId, userId));
      const before = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      let attempts = 0;
      const client = beforeStatements(
        db,
        userData,
        Array.from({ length: 3 }, () => async () => {
          attempts++;
          await db
            .update(userData)
            .set({
              updatedAt: sql`TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt})`,
            })
            .where(eq(userData.userId, userId));
        }),
      );
      if (race === "isolation") {
        await expect(
          fetchUpdatedUser({ client, userId, forceRegen: true }),
        ).rejects.toThrow("User state changed concurrently");
        expect(attempts).toBe(3);
      } else {
        const result = await fetchUpdatedUser({ client, userId, forceRegen: true });
        expect(attempts).toBe(1);
        expect(
          result.user?.questData?.find((entry) => entry.id === achievementId),
        ).toEqual(before?.questData?.find((entry) => entry.id === achievementId));
        expect(result.user?.updatedAt).toEqual(
          new Date(before!.updatedAt.getTime() + 1),
        );
        expect(
          result.user?.userQuests.some((entry) => entry.questId === "deleted-quest"),
        ).toBe(false);
        expect(result.requiresUserRefresh).toBe(true);
        expect(result.requiresProgressionRefresh).toBe(true);
      }
      const saved = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(saved?.questData).toEqual(before?.questData);
    },
  );

  it.each([
    ["jutsu", "jutsu", 1],
    ["buy", "buy", 1],
    ["water", "water", 1],
    ["energy", "energy", 8.5],
    ["mastery", "minutes", 15],
    ["element", "minutes", 15],
    ["none", "energy", undefined],
  ] as const)(
    "retains unclaimed counters and earned completions through %s updates",
    async (action, goalId, expectedProgress) => {
      const db = await getTestDatabase();
      const before = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      const now = new Date();
      if (action === "jutsu") {
        await insertJutsus([{ id: "new-jutsu", name: "New" }]);
        await db.insert(userQueue).values({
          id: "jutsu-queue",
          userId,
          kind: "JUTSU",
          position: 1,
          jutsuId: "new-jutsu",
          reservedRyo: 100,
          durationSeconds: 60,
          startsAt: now,
          finishesAt: new Date(now.getTime() + 60000),
        });
        expect(await settleJutsuTrainingQueue(db, userId, now)).toBe(1);
      } else if (action === "buy") {
        await insertItems([{ id: "shop-item", cost: 10, inShop: true }]);
        const api = await callerFor(itemRouter, userId);
        expect(
          (await api.buy({ itemId: "shop-item", villageId: "home", stack: 1 })).success,
        ).toBe(true);
      } else if (action === "water") {
        await insertItems([{ id: "seed", isFarmSeed: true }]);
        await db.insert(farmPlot).values({
          id: "growing-plot",
          userId,
          slotIndex: 0,
          seedItemId: "seed",
          plantedAt: now,
          finishAt: new Date(now.getTime() + 3600000),
        });
        const api = await callerFor(farmingRouter, userId);
        expect((await api.waterPlot({ plotId: "growing-plot" })).success).toBe(true);
      } else {
        await db
          .update(userData)
          .set({
            curEnergy: 0,
            regeneration: 100,
            regenAt: new Date(now.getTime() - 195000),
            ...(action === "mastery"
              ? {
                  currentlyTrainingMastery: "ninjutsuMastery" as const,
                  masteryTrainingStartedAt: new Date(now.getTime() - 20 * 60000),
                  trainingSpeed: "15min" as const,
                }
              : {}),
            ...(action === "element"
              ? {
                  currentlyTrainingElement: "Wind" as const,
                  elementalTrainingStartedAt: new Date(now.getTime() - 20 * 60000),
                  elementalTrainingSpeed: "15min" as const,
                }
              : {}),
          })
          .where(eq(userData.userId, userId));
        await insertUsers([
          {
            userId: "enemy",
            username: "Enemy",
            isAi: true,
            inArena: true,
            rank: "NONE",
            level: 1,
          },
        ]);
        await insertDefaultAiProfile();
        if (action === "energy")
          await queueEnergy(userId, [{ stat: "offence", energy: 100 }]);
        const trigger = vi
          .spyOn(getServerPusher(), "trigger")
          .mockResolvedValue({} as never);
        try {
          const result = await initiateBattle(
            { client: db, userIds: [userId], targetIds: ["enemy"] },
            "ARENA",
          );
          expect(result.success).toBe(true);
          const state = await db.query.battle.findFirst({
            where: eq(battle.id, result.battleId!),
          });
          expect(
            state?.extraState.questData[userId]?.find(
              (tracker) => tracker.id === achievementId,
            ),
          ).toEqual(before?.questData?.[0]);
        } finally {
          trigger.mockRestore();
        }
      }
      const after = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
        with: { userQuests: { with: { quest: true } }, completedQuests: true },
      });
      expect(after?.questData?.find((tracker) => tracker.id === achievementId)).toEqual(
        before?.questData?.[0],
      );
      expect(
        after?.questData
          ?.find((tracker) => tracker.id === "active-quest")
          ?.goals.find((goal) => goal.id === goalId)?.value,
      ).toBe(expectedProgress);
      if (action !== "none") {
        expect(
          after?.questData?.some((tracker) => tracker.id === "deleted-quest"),
        ).toBe(false);
      }
      expect(
        after?.userQuests.some((history) => history.questId === achievementId),
      ).toBe(false);

      const definition = await db.query.quest.findFirst({
        where: eq(quest.id, achievementId),
      });
      const user = {
        ...after!,
        village: null,
        clan: null,
        items: [],
        dungeonsCompleted: 0,
        raidsCompleted: 0,
      } as unknown as Parameters<typeof getNewTrackers>[0];
      user.userQuests.push(...mockAchievementHistoryEntries([definition!], user));
      const reloaded = getNewTrackers(user, [{ task: "any" }]);
      expect(reloaded.trackers.find((tracker) => tracker.id === achievementId)).toEqual(
        before?.questData?.[0],
      );
    },
  );
});
