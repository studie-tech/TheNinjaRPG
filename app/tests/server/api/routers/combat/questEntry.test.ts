import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { ITEM_LEVEL_CAP } from "@/drizzle/constants";
import {
  actionLog,
  aiProfile,
  battle,
  battleHistory,
  item,
  itemLoadout,
  quest,
  questHistory,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { itemRouter } from "@/server/api/routers/item";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("quest battle entry item identity", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      actionLog,
      battleHistory,
      battle,
      aiProfile,
      questHistory,
      quest,
      itemLoadout,
      userItemImbuement,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
      { userId: "foe", isAi: true },
    ]);
    await insertItems([
      { id: "ticket", itemType: "WEAPON" },
      {
        id: "evolved",
        itemType: "WEAPON",
        parentItemId: "ticket",
        requiredLevel: 1,
      },
    ]);
    const client = await getTestDatabase();
    await client
      .insert(aiProfile)
      .values({ id: "Default", userId: "default-ai", rules: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  /** Start a non-isolated run, where evolution remains an allowed inventory action. */
  const entrySnapshot = async (fragmented: boolean) => {
    await insertQuests([
      {
        id: "pyramid",
        questType: "battlepyramid",
        hidden: false,
        content: {
          entryItems: [{ ids: ["ticket"], number: fragmented ? 3 : 1 }],
          objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const client = await getTestDatabase();
    const content = (await client.query.quest.findFirst())!;
    await insertQuestHistory([
      {
        id: "run",
        userId: "hero",
        questId: "pyramid",
        questType: "battlepyramid",
        entryPaid: false,
        questVersion: content.updatedAt,
      },
    ]);
    await insertUserItems([
      ...(fragmented
        ? [{ id: "a", userId: "hero", itemId: "ticket", quantity: 2 }]
        : []),
      {
        id: "b",
        userId: "hero",
        itemId: "ticket",
        quantity: 1,
        level: ITEM_LEVEL_CAP,
      },
    ]);
    const attempt = (await client.query.questHistory.findFirst({
      with: { quest: true },
    }))!;
    return { client, attempt };
  };

  for (const fragmented of [false, true]) {
    it(`rejects an evolved ticket${fragmented ? " and rolls back a prior stack debit" : ""}`, async () => {
      const { client, attempt } = await entrySnapshot(fragmented);
      const caller = await callerFor(itemRouter, "hero");
      let evolved = false;
      // The transaction begins after battle and entry inventory have been preloaded.
      const raced = new Proxy(client, {
        get(target, property, receiver) {
          if (property === "transaction") {
            return async (...args: Parameters<typeof client.transaction>) => {
              expect(
                (await caller.evolveItem({
                  userItemId: "b",
                  evolutionItemId: "evolved",
                })).success,
              ).toBe(true);
              expect(
                await client.query.userItem.findFirst({ where: eq(userItem.id, "b") }),
              ).toMatchObject({ itemId: "evolved", quantity: 1 });
              evolved = true;
              return target.transaction(...args);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const result = await initiateBattle(
        {
          client: raced,
          userIds: ["hero"],
          targetIds: ["foe"],
          biome: "default",
          questAttempt: attempt,
          questBattleSource: { questId: "pyramid", objectiveId: "floor" },
        },
        "QUEST",
      );
      expect(evolved).toBe(true);
      expect(result).toMatchObject({
        success: false,
        message: "Your entry items changed. Please try again.",
      });
      expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(false);
      expect(
        await client.query.userItem.findFirst({ where: eq(userItem.id, "b") }),
      ).toMatchObject({ itemId: "evolved", quantity: 1 });
      if (fragmented)
        expect(
          await client.query.userItem.findFirst({ where: eq(userItem.id, "a") }),
        ).toMatchObject({ itemId: "ticket", quantity: 2 });
      expect(await client.query.battle.findMany()).toHaveLength(0);
      expect(await client.query.battleHistory.findMany()).toHaveLength(0);
      expect(
        await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
      ).toMatchObject({ status: "AWAKE", battleId: null });
    });
  }

  it("charges unchanged matching stacks and starts the battle", async () => {
    const { client, attempt } = await entrySnapshot(true);
    const result = await initiateBattle(
      {
        client,
        userIds: ["hero"],
        targetIds: ["foe"],
        biome: "default",
        questAttempt: attempt,
        questBattleSource: { questId: "pyramid", objectiveId: "floor" },
      },
      "QUEST",
    );
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("requiresUserRefresh", true);
    expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(true);
    expect(await client.query.userItem.findMany()).toHaveLength(0);
    expect(await client.query.battle.findMany()).toHaveLength(1);
    expect(await client.query.battleHistory.findMany()).toHaveLength(1);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
    ).toMatchObject({ status: "BATTLE", battleId: result.battleId });
  });
});
