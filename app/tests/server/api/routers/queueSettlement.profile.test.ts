import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { DMG_SETTING_DEFAULTS } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  gameSetting,
  item,
  jutsu,
  quest,
  questHistory,
  userData,
  userItem,
  userJutsu,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { calcJutsuTrainCost } from "@/libs/train";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { trainRouter } from "@/server/api/routers/train";
import {
  EncountersAtLocation,
  QuestTracker,
  TrainSpecificJutsu,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertDefaultAiProfile,
  insertItems,
  insertJutsus,
  insertQuestHistory,
  insertQuests,
  insertUsers,
  insertUserVotes,
} from "../../../setup/factories";
import { queueMasteries } from "../../../setup/queues";
import { beforeStatements, overrideQuery } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "queue-profile-drop";

const queueCraft = async (
  hidden = false,
  startsAt = new Date(Date.now() - 120_000),
) => {
  const db = await getTestDatabase();
  await db.delete(userQueue).where(eq(userQueue.userId, userId));
  await insertItems([
    {
      id: "antidote",
      itemType: "CONSUMABLE",
      canBeCrafted: true,
      stackSize: 10,
      hidden,
    },
    { id: "herb", stackSize: 100 },
  ]);
  await db.insert(userQueue).values({
    id: "queued-antidote",
    userId,
    kind: "CRAFT",
    position: 1,
    itemId: "antidote",
    quantity: 1,
    materials: [
      { userItemId: "spent-herbs", itemId: "herb", quantity: 2, storedAtHome: false },
    ],
    durationSeconds: 60,
    startsAt,
    finishesAt: new Date(startsAt.getTime() + 60_000),
  });
};

describeWithDatabase("Queue settlement response reconciliation", () => {
  beforeEach(async () => {
    await resetTables(
      battle,
      battleHistory,
      aiProfile,
      gameSetting,
      questHistory,
      quest,
      userQueue,
      userItem,
      item,
      userJutsu,
      jutsu,
      userVote,
      userData,
    );
    const now = new Date();
    await insertUsers([
      {
        userId,
        username: userId,
        rank: "GENIN",
        level: 20,
        status: "AWAKE",
        isOutlaw: true,
        money: 0,
        regeneration: 0,
        updatedAt: now,
        regenAt: now,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    const db = await getTestDatabase();
    await insertUserVotes([{ userId, lastVoteAt: now }]);
    await insertJutsus([{ id: "hidden-drop", name: "Hidden", hidden: true }]);
    await db.insert(userQueue).values({
      id: "profile-drop-row",
      userId,
      kind: "JUTSU",
      position: 1,
      jutsuId: "hidden-drop",
      reservedRyo: 100,
      durationSeconds: 60,
      startsAt: new Date(now.getTime() - 60_000),
      finishesAt: now,
    });
  });
  afterEach(() => {
    setSystemTime();
    vi.restoreAllMocks();
  });

  it("returns refunded balance and removes a dropped queue row in the same refresh", async () => {
    const db = await getTestDatabase();
    const first = await fetchUpdatedUser({ client: db, userId });
    const actual = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { queue: true },
    });
    const second = await fetchUpdatedUser({ client: db, userId });
    expect(actual?.money).toBe(100);
    expect(actual?.queue).toEqual([]);
    expect(second.user?.money).toBe(100);
    expect(second.user?.queue).toEqual([]);
    expect(first.user?.money).toBe(100);
    expect(first.user?.queue).toEqual([]);
    expect(first.requiresUserRefresh).toBe(true);
    expect(first.requiresProgressionRefresh).toBe(true);
    expect(first.craftingItemsChanged).toBe(false);
  });

  it("includes newly learned queued jutsu in the first achievement snapshot", async () => {
    const db = await getTestDatabase();
    await db.update(jutsu).set({ hidden: false }).where(eq(jutsu.id, "hidden-drop"));
    await insertQuests([
      {
        id: "learn-queued-jutsu",
        questType: "achievement",
        hidden: false,
        content: {
          objectives: [
            TrainSpecificJutsu.parse({
              id: "learn",
              task: "train_specific_jutsu",
              trainJutsuIds: ["hidden-drop"],
              value: 1,
            }),
          ],
        },
      },
    ]);

    const result = await fetchUpdatedUser({ client: db, userId });

    expect(result.startedQueuedJobs).toBe(1);
    expect(
      await db.query.userJutsu.findFirst({ where: eq(userJutsu.userId, userId) }),
    ).toMatchObject({ jutsuId: "hidden-drop" });
    expect(
      result.user?.questData?.find((entry) => entry.id === "learn-queued-jutsu")?.goals,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "learn", value: 1, done: true }),
      ]),
    );
  });

  it.each([false, true])(
    "location checks request inventory refresh after queued craft output or refund (hidden: %s)",
    async (hidden) => {
      await queueCraft(hidden);
      const db = await getTestDatabase();
      const result = await (await callerFor(questsRouter, userId)).checkLocationQuest();
      const inventory = await db.query.userItem.findMany({
        where: eq(userItem.userId, userId),
      });
      expect(result.success).toBe(true);
      expect(result.itemsChanged).toBe(true);
      expect(inventory).toMatchObject([
        { itemId: hidden ? "herb" : "antidote", quantity: hidden ? 2 : 1 },
      ]);
      if (!hidden)
        expect(inventory[0]!.craftingFinishedAt!.getTime()).toBeLessThan(Date.now());
      expect(
        await db.query.userQueue.findMany({ where: eq(userQueue.userId, userId) }),
      ).toEqual([]);
      // Both the output insertion and a drop that starts zero jobs must be reported.
      expect(
        (await fetchUpdatedUser({ client: db, userId })).craftingItemsChanged,
      ).toBe(false);
      expect(
        (await (await callerFor(questsRouter, userId)).checkLocationQuest())
          .itemsChanged,
      ).toBe(false);
    },
  );

  it("retains the craft inventory signal after a rejected passive settlement", async () => {
    await queueCraft();
    const db = await getTestDatabase();
    const prior = new Date(Date.now() - 600_000);
    await db
      .update(userData)
      .set({ updatedAt: prior, regenAt: prior })
      .where(eq(userData.userId, userId));
    const client = beforeStatements(db, userData, [
      async () =>
        db
          .update(userData)
          .set({
            updatedAt: sql`TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt})`,
            curEnergy: 17,
          })
          .where(eq(userData.userId, userId)),
    ]);
    const result = await fetchUpdatedUser({ client, userId, forceRegen: true });
    expect(result.craftingItemsChanged).toBe(true);
    expect(result.startedQueuedJobs).toBe(1);
    expect(result.user?.curEnergy).toBe(17);
    expect(result.user?.queue).toEqual([]);
    expect(
      await db.query.userItem.findMany({ where: eq(userItem.userId, userId) }),
    ).toHaveLength(1);
  });

  it("refreshes inventory when an objective ambush settles a craft due after profile hydration", async () => {
    const now = new Date();
    setSystemTime(now);
    await queueCraft(false, new Date(now.getTime() + 60_000));
    const db = await getTestDatabase();
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await db.insert(gameSetting).values(
      Object.entries(DMG_SETTING_DEFAULTS).map(([name, value]) => ({
        id: name,
        name,
        value,
        time: now,
      })),
    );
    await insertUsers([{ userId: "ambusher", isAi: true, rank: "GENIN", level: 20 }]);
    await insertDefaultAiProfile({ userId: "ambusher" });
    await insertQuests([
      {
        id: "ambush-quest",
        questType: "mission",
        hidden: false,
        content: {
          objectives: [
            EncountersAtLocation.parse({
              id: "ambush",
              task: "win_encounter_at_location",
              sector: 0,
              attackers: [{ ids: ["ambusher"], number: 100 }],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertQuestHistory([
      { id: "ambush-attempt", userId, questId: "ambush-quest", questType: "mission" },
    ]);
    await db
      .update(userData)
      .set({
        questData: [
          QuestTracker.parse({
            id: "ambush-quest",
            startAt: now.toISOString(),
            goals: [
              {
                id: "ambush",
                value: 0,
                done: false,
                sector: 0,
                longitude: 0,
                latitude: 0,
              },
            ],
          }),
        ],
      })
      .where(eq(userData.userId, userId));
    let profileReads = 0;
    const client = overrideQuery(db, "userData", {
      findFirst: async (read, options) => {
        const user = await read(options);
        if (options?.with?.queue) {
          profileReads++;
          // Hydration captured `now` before this read; battle setup uses the later clock.
          setSystemTime(new Date(now.getTime() + 180_000));
        }
        return user;
      },
    });
    const result = await callerForDatabase(
      questsRouter,
      userId,
      client,
    ).checkLocationQuest();
    expect(profileReads).toBe(1);
    expect(result.notifications).toContain("You have been attacked!");
    expect(await db.query.battle.findFirst()).toMatchObject({
      battleType: "RANDOM_ENCOUNTER",
    });
    expect(
      await db.query.userItem.findMany({ where: eq(userItem.userId, userId) }),
    ).toMatchObject([{ itemId: "antidote", quantity: 1 }]);
    expect(
      await db.query.userQueue.findMany({ where: eq(userQueue.userId, userId) }),
    ).toEqual([]);
    expect(result.itemsChanged).toBe(true);
  });

  it("does not reject new training as queue-full after refunding its only hidden queued job", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ money: 1000 }).where(eq(userData.userId, userId));
    await insertJutsus([{ id: "valid-training", name: "Valid" }]);
    const caller = await callerFor(jutsuRouter, userId);
    const first = await caller.startTraining({ jutsuId: "valid-training" });
    const dropped = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { queue: true },
    });
    const info = await db.query.jutsu.findFirst({
      where: eq(jutsu.id, "valid-training"),
    });
    expect(dropped?.money).toBe(1100 - calcJutsuTrainCost(info!, 0));
    expect(dropped?.queue).toEqual([]);
    expect(first.success).toBe(true);
  });

  it("a started timed job does reread the current balance and queue", async () => {
    const db = await getTestDatabase();
    await db.update(jutsu).set({ hidden: false }).where(eq(jutsu.id, "hidden-drop"));
    const result = await fetchUpdatedUser({ client: db, userId });
    const actual = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: { queue: true },
    });
    expect(result.startedQueuedJobs).toBe(1);
    expect(result.user?.queue).toEqual(actual?.queue);
    expect(result.user?.money).toBe(actual?.money);
    expect(result.requiresUserRefresh).toBe(true);
    expect(result.requiresProgressionRefresh).toBe(true);
  });

  it("reports a queued job started before a rejected passive settlement", async () => {
    const db = await getTestDatabase();
    const prior = new Date(Date.now() - 600_000);
    await db.update(jutsu).set({ hidden: false }).where(eq(jutsu.id, "hidden-drop"));
    await db
      .update(userData)
      .set({ updatedAt: prior, regenAt: prior })
      .where(eq(userData.userId, userId));
    const client = beforeStatements(db, userData, [
      async () =>
        db
          .update(userData)
          .set({
            updatedAt: sql`TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt})`,
            curEnergy: 17,
          })
          .where(eq(userData.userId, userId)),
    ]);
    const result = await fetchUpdatedUser({ client, userId, forceRegen: true });
    expect(result.startedQueuedJobs).toBe(1);
    expect(result.user?.curEnergy).toBe(17);
    expect(result.user?.queue).toEqual([]);
    expect(result.requiresUserRefresh).toBe(true);
    expect(result.requiresProgressionRefresh).toBe(true);
    expect(
      await db.query.userJutsu.findMany({ where: eq(userJutsu.userId, userId) }),
    ).toHaveLength(1);
    expect((await fetchUpdatedUser({ client: db, userId })).startedQueuedJobs).toBe(0);
  });

  it.each([5, 16])(
    "collecting a viewed mastery after %s minutes preserves its queued next session",
    async (elapsedMinutes) => {
      const db = await getTestDatabase();
      await db.delete(userQueue).where(eq(userQueue.userId, userId));
      const session = {
        stat: "ninjutsuMastery" as const,
        startedAt: new Date(Date.now() - elapsedMinutes * 60_000),
      };
      await db
        .update(userData)
        .set({
          currentlyTrainingMastery: "ninjutsuMastery",
          masteryTrainingStartedAt: session.startedAt,
          trainingSpeed: "15min",
          dailyTrainings: 0,
        })
        .where(eq(userData.userId, userId));
      await queueMasteries(userId, [{ stat: "genjutsuMastery", speed: "1hr" }]);
      const result = await (await callerFor(trainRouter, userId)).stopMasteryTraining(
        session,
      );
      const actual = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
        with: { queue: true },
      });
      expect(result.success).toBe(elapsedMinutes < 15);
      expect(actual?.ninjutsuMastery).toBeGreaterThan(10);
      expect(actual?.currentlyTrainingMastery).toBe("genjutsuMastery");
      expect(actual?.trainingSpeed).toBe("1hr");
      expect(actual?.genjutsuMastery).toBe(10);
      expect(actual?.dailyTrainings).toBe(1);
    },
  );
});
