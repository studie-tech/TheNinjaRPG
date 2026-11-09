import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  item,
  quest,
  questHistory,
  userData,
  userItem,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { itemRouter } from "@/server/api/routers/item";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { commitQuestObjectiveRewards } from "@/server/utils/questConsequences";
import { NonCombatConsumeRewardTag, NonCombatQuestTag } from "@/validators/combat";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward, PostProcessedRewardSchema } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { failStatements, inTransactions } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

// Validate the shared content fixture even when SQL tests are skipped locally.
const contractObjective = DialogObjective.parse({ id: "wait", task: "dialog" });

describeWithDatabase("item-only Special quest grants", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(actionLog, questHistory, quest, userItem, item, userData);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "CHUNIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
      },
    ]);
    await insertQuests([
      {
        id: "special",
        name: "Secret Contract",
        questType: "special",
        questRank: "D",
        hidden: false,
        maxAttempts: 0,
        maxCompletes: 0,
        retryDelay: "daily",
        content: {
          objectives: [contractObjective],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertItems([
      {
        id: "scroll",
        name: "Secret Scroll",
        itemType: "CONSUMABLE",
        destroyOnUse: true,
        preventBattleUsage: true,
        target: "SELF",
        method: "SINGLE",
        effects: [
          NonCombatQuestTag.parse({ questId: "special" }),
          NonCombatConsumeRewardTag.parse({ reward_money: 100 }),
        ],
      },
    ]);
    await insertUserItems([
      { id: "scroll-stack", userId: "hero", itemId: "scroll", quantity: 5 },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  const consume = async (requestId = "special-opening") => {
    const db = await getTestDatabase();
    return callerForDatabase(itemRouter, "hero", db).consume({
      userItemId: "scroll-stack",
      requestId: `quest-${requestId}`,
    });
  };

  it("grants the quest and other effects atomically, and replays a successful request", async () => {
    const db = await getTestDatabase();
    const before = await db.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    });
    const response = await consume();
    expect(response).toMatchObject({
      success: true,
      message: "Quest started: Secret Contract",
    });
    expect(await consume()).toEqual(response);
    expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 4 });
    expect(await db.query.questHistory.findFirst()).toMatchObject({
      questId: "special",
      questType: "special",
      completed: 0,
      previousAttempts: 1,
    });
    expect(await db.query.userData.findFirst()).toMatchObject({
      money: before!.money + 100,
    });
    expect(
      (await db.query.userData.findFirst())?.questData?.some(
        (tracker) => tracker.id === "special",
      ),
    ).toBe(true);
  });

  it("rejects an already active quest before consuming inventory or applying rewards", async () => {
    const db = await getTestDatabase();
    await insertQuestHistory([
      {
        userId: "hero",
        questId: "special",
        questType: "special",
        completed: 0,
        endAt: null,
      },
    ]);
    const before = await db.query.userData.findFirst();
    expect(await consume()).toMatchObject({
      success: false,
      message: expect.stringContaining("already on this quest"),
    });
    expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 5 });
    expect(await db.query.userData.findFirst()).toMatchObject({ money: before!.money });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("can complete and restart repeatedly in the same period despite zero caps", async () => {
    const db = await getTestDatabase();
    for (let i = 0; i < 3; i++) {
      expect(await consume(`repeat-${i}`)).toMatchObject({ success: true });
      const { user } = await fetchUpdatedUser({ client: db, userId: "hero" });
      const active = user!.userQuests.find((row) => row.questId === "special")!;
      const result = await commitQuestObjectiveRewards({
        client: db,
        userId: "hero",
        user: user!,
        userQuest: active,
        resolved: true,
        rewards: PostProcessedRewardSchema.parse({}),
        trackers: [],
        notifications: [],
        consequences: [],
        existingHistory: active,
      });
      expect(result.outcome).toBe("claimed");
    }
    expect(await db.query.questHistory.findFirst()).toMatchObject({
      previousAttempts: 3,
      previousCompletes: 3,
      completed: 1,
    });
    expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 2 });
  });

  it.each([
    { requiredLevel: 100 },
    { prerequisiteQuestId: "uncompleted" },
    { startsAt: "2999-01-01" },
    { endsAt: "2000-01-01" },
    { questRank: "S" as const },
    { questType: "mission" as const },
  ])(
    "retains the item and other effects when the quest is ineligible: %j",
    async (change) => {
      const db = await getTestDatabase();
      await db.update(quest).set(change).where(eq(quest.id, "special"));
      const before = await db.query.userData.findFirst();
      expect(await consume()).toMatchObject({ success: false });
      expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 5 });
      expect(await db.query.userData.findFirst()).toMatchObject({
        money: before!.money,
      });
      expect(await db.query.questHistory.findMany()).toHaveLength(0);
      expect(await db.query.actionLog.findMany()).toHaveLength(0);
    },
  );

  it("rejects a deleted quest and keeps the scroll", async () => {
    const db = await getTestDatabase();
    await db.delete(quest).where(eq(quest.id, "special"));
    expect(await consume()).toMatchObject({ success: false });
    expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 5 });
  });

  it("rolls back history, rewards and debit when writing the new quest fails", async () => {
    const db = await getTestDatabase();
    const failing = inTransactions(db, (tx) =>
      failStatements(tx, questHistory, 1, { operations: ["insert"] }),
    );
    const before = await db.query.userData.findFirst();
    await expect(
      callerForDatabase(itemRouter, "hero", failing).consume({
        userItemId: "scroll-stack",
        requestId: "rollback-request",
      }),
    ).rejects.toThrow("Statement failed on purpose");
    expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 5 });
    expect(await db.query.userData.findFirst()).toMatchObject({ money: before!.money });
    expect(await db.query.questHistory.findMany()).toHaveLength(0);
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("permits only one concurrent grant across distinct consumption requests", async () => {
    const db = await getTestDatabase();
    const results = await Promise.all([consume("race-a"), consume("race-b")]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await db.query.userItem.findFirst()).toMatchObject({ quantity: 4 });
    expect(await db.query.questHistory.findFirst()).toMatchObject({
      previousAttempts: 1,
    });
  });

  it("does not expose Special quests as startable choices or allow a direct UI start", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(questsRouter, "hero", db);
    expect(await caller.specificQuests({ questType: "special", level: 50 })).toEqual(
      [],
    );
    expect(
      await caller.startQuest({ questId: "special", userSector: 0 }),
    ).toMatchObject({ success: false });
    expect(await db.query.questHistory.findMany()).toHaveLength(0);
  });
});
