import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  aiProfile,
  battle,
  battleHistory,
  item,
  quest,
  questHistory,
  userData,
  userItem,
  village,
  villageStructure,
  war,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { assignQuestToUser } from "@/server/utils/questAssignment";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertDefaultAiProfile,
  insertItems,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

/** A Pyramid run checks and consumes its entry items when it starts. */
describeWithDatabase("quest entry items are paid at the start of a run", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      actionLog,
      battleHistory,
      battle,
      aiProfile,
      questHistory,
      quest,
      userItem,
      item,
      villageStructure,
      war,
      village,
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
    await insertItems([{ id: "ticket", name: "Pyramid Ticket", itemType: "WEAPON" }]);
    await insertQuests([
      {
        id: "pyramid",
        name: "Pyramid",
        questType: "battlepyramid",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content: {
          entryItems: [{ ids: ["ticket"], number: 3 }],
          objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertDefaultAiProfile();
  });
  afterEach(() => vi.restoreAllMocks());

  const start = async (questId = "pyramid") => {
    const client = await getTestDatabase();
    const { user } = await fetchUpdatedUser({ client, userId: "hero" });
    const pyramid = await client.query.quest.findFirst({
      where: eq(quest.id, questId),
    });
    return {
      client,
      result: await assignQuestToUser({
        client,
        user: user!,
        quest: pyramid!,
        source: "ui",
        prevAttempt: undefined,
      }),
    };
  };

  it("rejects a start without enough items and writes nothing", async () => {
    // Two carried tickets plus one stored at home: stored items cannot pay.
    await insertUserItems([
      { id: "carried", userId: "hero", itemId: "ticket", quantity: 2 },
      { id: "home", userId: "hero", itemId: "ticket", quantity: 1, storedAtHome: true },
    ]);
    const { client, result } = await start();
    expect(result).toMatchObject({
      success: false,
      message: "You need 3× Pyramid Ticket in your inventory to enter.",
    });
    expect(await client.query.questHistory.findMany()).toHaveLength(0);
    expect(
      (await client.query.userItem.findMany()).map((row) => row.quantity).sort(),
    ).toEqual([1, 2]);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
    ).toMatchObject({ status: "AWAKE" });
  });

  it("charges once at the start and never again at the first battle", async () => {
    await insertUserItems([
      { id: "a", userId: "hero", itemId: "ticket", quantity: 2 },
      { id: "b", userId: "hero", itemId: "ticket", quantity: 5 },
    ]);
    const { client, result } = await start();
    expect(result.success).toBe(true);
    const attempt = await client.query.questHistory.findFirst({
      with: { quest: true },
    });
    expect(attempt?.entryPaid).toBe(true);
    // Stacks are allocated in id order: all of "a", then one from "b".
    expect(
      await client.query.userItem.findMany({ orderBy: userItem.id }),
    ).toMatchObject([{ id: "b", quantity: 4 }]);

    const battleResult = await initiateBattle(
      {
        client,
        userIds: ["hero"],
        targetIds: ["foe"],
        biome: "default",
        questAttempt: attempt!,
        questBattleSource: { questId: "pyramid", objectiveId: "floor" },
      },
      "QUEST",
    );
    expect(battleResult.success).toBe(true);
    expect(await client.query.userItem.findMany()).toMatchObject([
      { id: "b", quantity: 4 },
    ]);
    expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(true);
  });

  it.each([
    { ticketed: false, changed: false },
    { ticketed: true, changed: false },
    { ticketed: false, changed: true },
    { ticketed: true, changed: true },
  ])(
    "admits recovery with a war slot (ticketed=$ticketed, changed=$changed)",
    async ({ ticketed, changed }) => {
      const client = await getTestDatabase();
      await client.insert(village).values(
        ["home", "enemy"].map((id, i) => ({
          id,
          name: id,
          sector: 201 + i,
          kageId: `${id}-kage`,
          tokens: 1000,
        })),
      );
      await client.insert(war).values({
        id: "war",
        type: "VILLAGE_WAR",
        status: "ACTIVE",
        sector: 201,
        attackerVillageId: "home",
        defenderVillageId: "enemy",
        attackerWarHealth: 100,
        defenderWarHealth: 100,
        defenderShrineHp: 0,
      });
      await client.insert(villageStructure).values(
        ["home", "enemy"].map((id) => ({
          id: `${id}/townhall`,
          name: "Town Hall",
          route: "/townhall",
          image: "",
          villageId: id,
          curSp: 1000,
        })),
      );
      await client
        .update(userData)
        .set({
          villageId: "home",
          status: "ASLEEP",
          autoWakeUp: true,
          immunityUntil: new Date(Date.now() + 3600000),
        })
        .where(eq(userData.userId, "hero"));
      await insertQuests([
        {
          id: "warrun",
          name: "War Run",
          questType: "war",
          hidden: false,
          maxAttempts: 100,
          maxCompletes: 100,
          content: {
            entryItems: ticketed ? [{ ids: ["ticket"], number: 2 }] : [],
            objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      await insertUserItems([
        { id: "a", userId: "hero", itemId: "ticket", quantity: 3 },
      ]);

      const interleaved = changed
        ? beforeStatements(client, userData, [
            async () => {
              await client
                .update(userData)
                .set({ autoWakeUp: false })
                .where(eq(userData.userId, "hero"));
            },
          ])
        : client;
      const result = await callerForDatabase(
        questsRouter,
        "hero",
        interleaved,
      ).startQuest({ questId: "warrun", userSector: 0 });
      const saved = await client.query.userData.findFirst({
        where: eq(userData.userId, "hero"),
      });
      expect(result.success).toBe(!changed);
      expect(saved).toMatchObject({
        status: changed ? "ASLEEP" : "AWAKE",
        dailyWarMissions: changed ? 0 : 1,
      });
      expect(saved!.warParticipantUntil.getTime() > Date.now()).toBe(!changed);
      expect(saved!.bracketImmunityLiftedUntil.getTime() > Date.now()).toBe(!changed);
      expect(saved!.immunityUntil.getTime() > Date.now()).toBe(changed);
      expect(await client.query.userItem.findMany()).toMatchObject([
        { id: "a", quantity: ticketed && !changed ? 1 : 3 },
      ]);
      if (changed) {
        expect(result.message).toContain("activity");
        expect(result.actionNotice).toBeUndefined();
        expect(await client.query.questHistory.findMany()).toHaveLength(0);
        expect(saved?.questData ?? []).toHaveLength(0);
      } else {
        expect(result.actionNotice).toBe("This action woke you up.");
        expect(result.userRecovery?.activity).toMatchObject({
          status: "AWAKE",
          battleId: null,
        });
        expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(ticketed);
        expect(saved?.questData).toMatchObject([{ id: "warrun" }]);
      }
    },
  );
});
