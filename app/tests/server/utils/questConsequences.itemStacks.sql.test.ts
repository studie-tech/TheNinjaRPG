import { beforeEach, expect, it } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import {
  item,
  quest,
  questHistory,
  userData,
  userItem,
  userVote,
} from "@/drizzle/schema";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { CollectItem, DeliverItem } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const playerId = "collecting-player";

describeWithDatabase("collected quest items", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, questHistory, quest, userVote, userData);
    invalidatePublishedMapCache();
    await insertUsers([
      {
        userId: playerId,
        username: "collector",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        status: "AWAKE",
        sector: 0,
        longitude: 10,
        latitude: 7,
      },
    ]);
    await insertUserVotes([{ userId: playerId }]);
    await insertItems([{ id: "herb", name: "Herb", canStack: true, stackSize: 100 }]);
    await insertUserItems([
      { id: "herb-stack", userId: playerId, itemId: "herb", quantity: 10 },
    ]);
    await insertQuests([
      {
        id: "herb-collection",
        name: "Herb collection",
        questType: "achievement",
        requiredLevel: 1,
        content: {
          objectives: [
            CollectItem.parse({
              id: "collect",
              task: "collect_item",
              sector: 0,
              longitude: 10,
              latitude: 7,
              collectItemIds: ["herb"],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });

  it("adds a collected item to the stack already carried", async () => {
    await (await callerFor(profileRouter, playerId)).getUser();
    const rows = await (await getTestDatabase())
      .select({ id: userItem.id, quantity: userItem.quantity })
      .from(userItem)
      .where(eq(userItem.userId, playerId))
      .orderBy(asc(userItem.id));
    expect(rows).toEqual([{ id: "herb-stack", quantity: 11 }]);
  });

  it.each([1, 2])(
    "delivers %i herbs from the carried stack and keeps the rest",
    async (deliveries) => {
      await (await getTestDatabase()).delete(quest);
      const questIds = Array.from(
        { length: deliveries },
        (_, index) => `delivery-${index}`,
      );
      await insertQuests(
        questIds.map((id) => ({
          id,
          name: "Herb delivery",
          questType: "mission",
          requiredLevel: 1,
          content: {
            objectives: [
              DeliverItem.parse({
                id: "deliver",
                task: "deliver_item",
                sector: 0,
                longitude: 10,
                latitude: 7,
                item_name: "Herb",
                deliverItemIds: ["herb"],
              }),
            ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        })),
      );
      await insertQuestHistory(
        questIds.map((questId) => ({
          userId: playerId,
          questId,
          questType: "mission",
        })),
      );
      await (await callerFor(questsRouter, playerId)).checkLocationQuest();
      const rows = await (await getTestDatabase())
        .select({ id: userItem.id, quantity: userItem.quantity })
        .from(userItem)
        .where(eq(userItem.userId, playerId));
      expect(rows).toEqual([{ id: "herb-stack", quantity: 10 - deliveries }]);
    },
  );

  it("delivers from the backpack before an equipped stack", async () => {
    const db = await getTestDatabase();
    await db
      .update(userItem)
      .set({ equipped: "ITEM_1", quantity: 1 })
      .where(eq(userItem.id, "herb-stack"));
    await insertUserItems([
      { id: "herb-tote", userId: playerId, itemId: "herb", quantity: 9 },
    ]);
    const { user } = await fetchUpdatedUser({ client: db, userId: playerId });
    const result = await handleQuestConsequences(
      db,
      user!,
      [{ type: "remove_item", ids: ["herb"] }],
      [],
    );
    expect(result.claimed).toBe(true);
    const rows = await db
      .select({
        id: userItem.id,
        quantity: userItem.quantity,
        equipped: userItem.equipped,
      })
      .from(userItem)
      .where(eq(userItem.userId, playerId));
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "herb-stack", quantity: 1, equipped: "ITEM_1" },
      // The visit collects one herb onto the backpack stack before the delivery takes one.
      { id: "herb-tote", quantity: 9, equipped: "NONE" },
    ]);
  });

  it.each([
    ["the quantity it was read at", 10, 9, true],
    ["a stack that grew since it was read", 14, 13, false],
  ] as const)(
    "takes one unit from %s and projects the client inventory only then",
    async (_, current, expected, projected) => {
      const db = await getTestDatabase();
      await db
        .update(userItem)
        .set({ equipped: "ITEM_1" })
        .where(eq(userItem.id, "herb-stack"));
      const { user } = await fetchUpdatedUser({ client: db, userId: playerId });
      // Only the equipped stack is left, so the delivery takes from it.
      await db
        .delete(userItem)
        .where(and(eq(userItem.userId, playerId), eq(userItem.equipped, "NONE")));
      await db
        .update(userItem)
        .set({ quantity: current })
        .where(eq(userItem.id, "herb-stack"));
      const result = await handleQuestConsequences(
        db,
        user!,
        [{ type: "remove_item", ids: ["herb"] }],
        [],
      );
      expect(result.claimed).toBe(true);
      expect(
        (await db.query.userItem.findFirst({ where: eq(userItem.id, "herb-stack") }))
          ?.quantity,
      ).toBe(expected);
      expect(result.inventoryChanges !== undefined).toBe(projected);
    },
  );
});
