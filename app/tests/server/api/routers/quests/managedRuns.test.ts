import { getNextUserSnapshotAt } from "@/utils/time";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  item,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  questHistory,
  trainingLog,
  userData,
  userItem,
  userQueue,
  type UserQuest,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { overworldAiRouter } from "@/server/api/routers/overworldAi";
import { questsRouter } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { createTRPCRouter } from "@/server/api/trpc";

import {
  DefeatOpponents,
  DialogObjective,
  QuestTracker,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
  insertDefaultAiProfile,
} from "../../../../setup/factories";
import { queueEnergy, readEnergyQueue } from "../../../../setup/queues";
import {
  beforeStatements,
  failStatements,
  withoutTransactions,
} from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  runRawSql,
} from "../../../../setup/testDatabase";
import { deferred } from "../../../../setup/deferred";

const router = createTRPCRouter({ quests: questsRouter });

/** Exercise battle initialization with the same attempt snapshot as the quest router. */
const startFloor = (client: DrizzleClient, attempt: UserQuest) =>
  initiateBattle(
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

describeWithDatabase("managed quest battle and abandonment", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battleHistory,
      battle,
      aiProfile,
      overworldAiPlacementQuest,
      overworldAiPlacement,
      questHistory,
      quest,
      userItem,
      item,
      userQueue,
      trainingLog,
      userData,
    );
    await insertUsers([
      {
        userId: "hero",
        status: "BATTLE",
        rank: "JONIN",
        curHealth: 1000,
        maxHealth: 1000,
      },
      { userId: "foe", isAi: true },
    ]);
    await insertQuests([
      {
        id: "pyramid",
        questType: "battlepyramid",
        hidden: false,
        content: {
          isolated: true,
          entryItems: [{ ids: ["ticket"], number: 3 }],
          objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const client = await getTestDatabase();
    const content = await client.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    });
    if (!content) throw new Error("Missing quest fixture");
    await insertQuestHistory([
      {
        id: "run",
        userId: "hero",
        questId: "pyramid",
        questType: "battlepyramid",
        isolated: true,
        entryPaid: true,
        questVersion: content.updatedAt,
      },
    ]);
    await insertDefaultAiProfile();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });

  /** Read the persisted attempt and content without inventing an entry receipt. */
  const snapshot = async () => {
    const client = await getTestDatabase();
    const attempt = await client.query.questHistory.findFirst({
      where: eq(questHistory.id, "run"),
      with: { quest: true },
    });
    if (!attempt) throw new Error("Missing run fixture");
    return { client, attempt };
  };

  /** Prepare the authored no-ticket run with its matching content version. */
  const floorSnapshot = async (paid: boolean) => {
    const { client, attempt } = await snapshot();
    if (!paid) {
      await client
        .update(quest)
        .set({ content: { ...attempt.quest.content, entryItems: [] } })
        .where(eq(quest.id, "pyramid"));
      const content = await client.query.quest.findFirst({
        where: eq(quest.id, "pyramid"),
      });
      await client
        .update(questHistory)
        .set({ entryPaid: false, questVersion: content!.updatedAt })
        .where(eq(questHistory.id, "run"));
    }
    return snapshot();
  };

  /** Bind an unticketed Pyramid floor to the player's current overworld NPC tile. */
  const overworldFloorSnapshot = async () => {
    const { client, attempt } = await floorSnapshot(false);
    await client
      .update(questHistory)
      .set({ isolated: false })
      .where(eq(questHistory.id, "run"));
    await client
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "hero"));
    await client.insert(overworldAiPlacement).values({
      id: "npc",
      aiTemplateUserId: "foe",
      interactionType: "FRIENDLY",
      sectorList: [0],
    });
    await client
      .update(quest)
      .set({
        content: {
          ...attempt.quest.content,
          isolated: false,
          objectives: [
            DefeatOpponents.parse({
              id: "floor",
              task: "defeat_opponents",
              overworldPlacementId: "npc",
              opponentAIs: [{ ids: ["foe"], number: 1 }],
              givePools: 40,
            }),
          ],
        },
      })
      .where(eq(quest.id, "pyramid"));
    const content = await client.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    });
    await Promise.all([
      client
        .update(questHistory)
        .set({ questVersion: content!.updatedAt })
        .where(eq(questHistory.id, "run")),
      client
        .update(userData)
        .set({
          sector: 0,
          longitude: 0,
          latitude: 0,
          questData: [QuestTracker.parse({ id: "pyramid" })],
        })
        .where(eq(userData.userId, "hero")),
    ]);
    return snapshot();
  };

  it("starts an unticketed bound overworld floor without a transaction", async () => {
    const { client } = await overworldFloorSnapshot();
    const caller = callerForDatabase(
      overworldAiRouter,
      "hero",
      withoutTransactions(client),
    );
    const result = await caller.interactWithOverworldAi({
      placementId: "npc",
      positionVersion: 0,
    });
    expect(result.success).toBe(true);
    const saved = await client.query.battle.findFirst();
    expect(saved?.extraState.questBattleSource).toEqual({
      questId: "pyramid",
      objectiveId: "floor",
    });
    expect(
      saved?.usersState.find((user) => user.controllerId === "hero")?.curHealth,
    ).toBe(400);
    expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(false);
  });

  for (const state of ["hidden", "edited", "ended", "abandoned"] as const) {
    it(`compensates an unticketed NPC floor when its attempt is ${state} before the claim`, async () => {
      const { client, attempt } = await overworldFloorSnapshot();
      const raced = beforeStatements(withoutTransactions(client), userData, [
        async () => {
          if (state === "hidden")
            await client
              .update(quest)
              .set({ hidden: true })
              .where(eq(quest.id, "pyramid"));
          if (state === "edited")
            await client
              .update(quest)
              .set({ updatedAt: new Date(attempt.quest.updatedAt.getTime() + 1000) })
              .where(eq(quest.id, "pyramid"));
          if (state === "ended")
            await client
              .update(questHistory)
              .set({ endAt: new Date() })
              .where(eq(questHistory.id, "run"));
          if (state === "abandoned") {
            const caller = callerForDatabase(
              router,
              "hero",
              withoutTransactions(client),
            ).quests;
            expect((await caller.abandon({ id: "pyramid" })).success).toBe(true);
          }
        },
      ]);
      const caller = callerForDatabase(overworldAiRouter, "hero", raced);
      expect(
        (
          await caller.interactWithOverworldAi({
            placementId: "npc",
            positionVersion: 0,
          })
        ).success,
      ).toBe(false);
      expect(await client.query.battle.findMany()).toHaveLength(0);
      expect(await client.query.battleHistory.findMany()).toHaveLength(0);
      const hero = await client.query.userData.findFirst({
        where: eq(userData.userId, "hero"),
      });
      expect(hero).toMatchObject({ status: "AWAKE", battleId: null });
      if (state === "abandoned") {
        expect(hero?.questData).toEqual([]);
        expect((await client.query.questHistory.findFirst())?.endAt).toBeInstanceOf(
          Date,
        );
      }
      expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(false);
    });
  }

  for (const paid of [true, false]) {
    it(`starts successive ${paid ? "paid" : "no-ticket"} floors without a transaction`, async () => {
      const { client } = await floorSnapshot(paid);
      for (const floor of [1, 2]) {
        const { attempt: current } = await snapshot();
        expect((await startFloor(withoutTransactions(client), current)).success).toBe(
          true,
        );
        const saved = await client.query.battle.findFirst();
        expect(saved?.extraState.userQuests.hero?.[0]?.entryPaid).toBe(paid);
        expect(saved?.extraState.questBattleSource).toEqual({
          questId: "pyramid",
          objectiveId: "floor",
        });
        expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(paid);
        expect(await client.query.battleHistory.findMany()).toHaveLength(floor);
        await client.delete(battle);
        await client
          .update(userData)
          .set({ status: "BATTLE", battleId: null })
          .where(eq(userData.userId, "hero"));
      }
    });
  }

  for (const paid of [true, false]) {
    for (const [name, table] of [
      ["battle", battle],
      ["history", battleHistory],
      ["participant", userData],
    ] as const) {
      it(`compensates a ${paid ? "paid" : "no-ticket"} floor when its ${name} write rejects`, async () => {
        const { client, attempt } = await floorSnapshot(paid);
        const failed = failStatements(withoutTransactions(client), table);
        await expect(startFloor(failed, attempt)).rejects.toThrow(
          "Statement failed on purpose",
        );
        expect(await client.query.battle.findMany()).toHaveLength(0);
        expect(await client.query.battleHistory.findMany()).toHaveLength(0);
        expect(
          await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
        ).toMatchObject({ status: "BATTLE", battleId: null });
        expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(paid);
      });
    }
  }

  it("waits for delayed history and participant writes before compensating a failed insert", async () => {
    const { client, attempt } = await snapshot();
    const { promise: released, resolve: release } = deferred<void>();
    let entered = 0;
    const { promise: ready, resolve: markReady } = deferred<void>();
    const delay = async () => {
      entered += 1;
      if (entered === 2) markReady();
      await released;
    };
    const history = beforeStatements(withoutTransactions(client), battleHistory, [
      delay,
    ]);
    const participant = beforeStatements(history, userData, [delay]);
    const failure = new Error("Battle insert failed");
    const failed = beforeStatements(participant, battle, [
      async () => {
        await ready;
        throw failure;
      },
    ]);
    const pending = startFloor(failed, attempt);
    await ready;
    release();
    await expect(pending).rejects.toBe(failure);
    expect(await client.query.battle.findMany()).toHaveLength(0);
    expect(await client.query.battleHistory.findMany()).toHaveLength(0);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
    ).toMatchObject({ status: "BATTLE", battleId: null });
  });

  it("preserves a different concurrent battle while removing a failed floor's rows", async () => {
    const { client, attempt } = await snapshot();
    expect((await startFloor(client, attempt)).success).toBe(true);
    const otherBattle = (await client.query.battle.findFirst())!;
    const otherHistory = (await client.query.battleHistory.findFirst())!;
    await client
      .update(userData)
      .set({ status: "BATTLE", battleId: null })
      .where(eq(userData.userId, "hero"));
    const raced = beforeStatements(withoutTransactions(client), userData, [
      async () => {
        await client
          .update(userData)
          .set({ status: "BATTLE", battleId: otherBattle.id })
          .where(eq(userData.userId, "hero"));
        throw new Error("Participant claim failed");
      },
    ]);
    await expect(startFloor(raced, attempt)).rejects.toThrow(
      "Participant claim failed",
    );
    expect(await client.query.battle.findMany()).toEqual([otherBattle]);
    expect(await client.query.battleHistory.findMany()).toEqual([otherHistory]);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
    ).toMatchObject({ status: "BATTLE", battleId: otherBattle.id });
  });

  it("retains and logs earned queue training from a claimed participant when an insert fails", async () => {
    const { client, attempt } = await snapshot();
    await client
      .update(userData)
      .set({ curEnergy: 100, isOutlaw: true })
      .where(eq(userData.userId, "hero"));
    await queueEnergy("hero", [{ stat: "offence", energy: 100 }]);
    const before = (await client.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    }))!;
    const failed = failStatements(withoutTransactions(client), battle);
    await expect(startFloor(failed, attempt)).rejects.toThrow(
      "Statement failed on purpose",
    );
    const after = (await client.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    }))!;
    expect(after).toMatchObject({
      status: "BATTLE",
      battleId: null,
      energyQueueHead: 1,
    });
    expect(after.offence).toBeGreaterThan(before.offence);
    expect(await readEnergyQueue("hero")).toEqual([]);
    expect((await client.query.trainingLog.findMany()).map((log) => log.stat)).toEqual([
      "offence",
    ]);
    expect(await client.query.battleHistory.findMany()).toHaveLength(0);
  });

  it("rolls back the first receipt, ticket stacks and battle when SQL rejects its claim", async () => {
    const { client } = await snapshot();
    await client
      .update(questHistory)
      .set({ entryPaid: false })
      .where(eq(questHistory.id, "run"));
    await insertItems([{ id: "ticket", itemType: "CONSUMABLE" }]);
    await insertUserItems([
      { id: "a", userId: "hero", itemId: "ticket", quantity: 2, equipped: "ITEM_1" },
      { id: "b", userId: "hero", itemId: "ticket", quantity: 3, equipped: "ITEM_2" },
    ]);
    const { attempt } = await snapshot();
    const originalItems = await client.query.userItem.findMany();
    await runRawSql(`CREATE TRIGGER managed_entry_reject_claim BEFORE UPDATE ON UserData
      FOR EACH ROW BEGIN
        IF OLD.userId = 'hero' AND NEW.status = 'BATTLE' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Battle claim failed';
        END IF;
      END`);
    try {
      await expect(startFloor(client, attempt)).rejects.toThrow();
      expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(false);
      expect(await client.query.userItem.findMany()).toEqual(originalItems);
      expect(await client.query.battle.findMany()).toHaveLength(0);
      expect(await client.query.battleHistory.findMany()).toHaveLength(0);
      expect(
        await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
      ).toMatchObject({ status: "BATTLE", battleId: null });
    } finally {
      await runRawSql("DROP TRIGGER managed_entry_reject_claim");
    }
  });

  it("commits only the first payment and preloads the reduced inventory", async () => {
    const { client } = await snapshot();
    await client
      .update(questHistory)
      .set({ entryPaid: false })
      .where(eq(questHistory.id, "run"));
    await insertItems([{ id: "ticket", itemType: "CONSUMABLE" }]);
    await insertUserItems([
      { id: "a", userId: "hero", itemId: "ticket", quantity: 2, equipped: "ITEM_1" },
      { id: "b", userId: "hero", itemId: "ticket", quantity: 3, equipped: "ITEM_2" },
    ]);
    const { attempt } = await snapshot();
    const { result, statements } = await recordQueries(() =>
      startFloor(client, attempt),
    );
    expect(result.success).toBe(true);
    expect(statements.some((statement) => /^BEGIN$/i.test(statement))).toBe(true);
    expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(true);
    expect(
      (await client.query.userItem.findMany()).map((row) => [row.id, row.quantity]),
    ).toEqual([["b", 2]]);
    const saved = await client.query.battle.findFirst();
    expect(saved?.extraState.userQuests.hero?.[0]?.entryPaid).toBe(true);
    expect(
      saved?.usersState
        .find((user) => user.controllerId === "hero")
        ?.items.map((row) => [row.id, row.quantity]),
    ).toEqual([["b", 2]]);
  });

  for (const state of ["ended", "hidden", "edited", "combat"] as const) {
    it(`compensates a paid floor when ${state} changes before its participant claim`, async () => {
      const { client, attempt } = await snapshot();
      const raced = beforeStatements(withoutTransactions(client), userData, [
        async () => {
          if (state === "ended")
            await client
              .update(questHistory)
              .set({ endAt: new Date() })
              .where(eq(questHistory.id, "run"));
          if (state === "hidden")
            await client
              .update(quest)
              .set({ hidden: true })
              .where(eq(quest.id, "pyramid"));
          if (state === "edited")
            await client
              .update(quest)
              .set({ updatedAt: new Date(attempt.quest.updatedAt.getTime() + 1000) })
              .where(eq(quest.id, "pyramid"));
          if (state === "combat")
            await client
              .update(userData)
              .set({ status: "BATTLE", battleId: "other" })
              .where(eq(userData.userId, "hero"));
        },
      ]);
      expect((await startFloor(raced, attempt)).success).toBe(false);
      expect(await client.query.battle.findMany()).toHaveLength(0);
      expect(await client.query.battleHistory.findMany()).toHaveLength(0);
      expect(
        (await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
          ?.battleId,
      ).toBe(state === "combat" ? "other" : null);
      expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(true);
    });
  }

  it("allows one simultaneous paid floor and compensates the loser", async () => {
    const { client, attempt } = await snapshot();
    const results = await Promise.all([
      startFloor(withoutTransactions(client), attempt),
      startFloor(withoutTransactions(client), attempt),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await client.query.battle.findMany()).toHaveLength(1);
    expect(await client.query.battleHistory.findMany()).toHaveLength(1);
  });

  it("settles delayed sibling inserts before compensating a rejected paid-floor claim", async () => {
    const { client, attempt } = await snapshot();
    const { promise: started, resolve: markInsertStarted } = deferred<void>();
    const { promise: released, resolve: releaseInsert } = deferred<void>();
    const delayed = beforeStatements(withoutTransactions(client), battle, [
      async () => {
        markInsertStarted();
        await released;
      },
    ]);
    const raced = beforeStatements(delayed, userData, [
      async () => {
        // The insert and claim must be dispatched together even for a managed attempt.
        await started;
        await client
          .update(questHistory)
          .set({ endAt: new Date() })
          .where(eq(questHistory.id, "run"));
        releaseInsert();
      },
    ]);
    expect((await startFloor(raced, attempt)).success).toBe(false);
    expect(await client.query.battle.findMany()).toHaveLength(0);
    expect(await client.query.battleHistory.findMany()).toHaveLength(0);
    expect(
      (await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.battleId,
    ).toBeNull();
  });

  for (const refreshed of [false, true]) {
    it(`rejects newly authored tickets for an unpaid no-ticket attempt, refreshed=${refreshed}`, async () => {
      const { client, attempt } = await snapshot();
      const content = { ...attempt.quest.content, entryItems: [] };
      await client.update(quest).set({ content }).where(eq(quest.id, "pyramid"));
      const noTicketQuest = await client.query.quest.findFirst({
        where: eq(quest.id, "pyramid"),
      });
      await client
        .update(questHistory)
        .set({ entryPaid: false, questVersion: noTicketQuest!.updatedAt })
        .where(eq(questHistory.id, "run"));
      const { attempt: noTicketAttempt } = await snapshot();
      await client
        .update(quest)
        .set({
          content: attempt.quest.content,
          updatedAt: new Date(noTicketQuest!.updatedAt.getTime() + 1000),
        })
        .where(eq(quest.id, "pyramid"));
      // Supplying enough tickets ensures the refreshed snapshot reaches the version guard.
      await insertItems([{ id: "ticket" }]);
      await insertUserItems([
        { id: "ticket-stack", userId: "hero", itemId: "ticket", quantity: 3 },
      ]);
      expect(
        (
          await startFloor(
            client,
            refreshed ? (await snapshot()).attempt : noTicketAttempt,
          )
        ).success,
      ).toBe(false);
      expect(await client.query.battle.findMany()).toHaveLength(0);
      expect(await client.query.battleHistory.findMany()).toHaveLength(0);
      expect((await client.query.questHistory.findFirst())?.entryPaid).toBe(false);
      expect((await client.query.userItem.findFirst())?.quantity).toBe(3);
    });
  }

  it("atomically abandons a managed run and clears its NPC slot without a transaction", async () => {
    const { client } = await snapshot();
    await client
      .update(userData)
      .set({ activeNpcQuestId: "pyramid" })
      .where(eq(userData.userId, "hero"));
    const caller = callerForDatabase(
      router,
      "hero",
      withoutTransactions(client),
    ).quests;
    const { result, statements } = await recordQueries(() =>
      caller.abandon({ id: "pyramid" }),
    );
    expect(result.success).toBe(true);
    expect(
      statements.filter((statement) => /^\s*UPDATE /i.test(statement)),
    ).toHaveLength(1);
    expect((await client.query.questHistory.findFirst())?.endAt).toBeInstanceOf(Date);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
    ).toMatchObject({ activeNpcQuestId: null, questData: [] });
  });

  for (const state of ["account", "combat", "ended", "completed"] as const) {
    it(`rejects ${state} changes without a partial abandonment`, async () => {
      const { client } = await snapshot();
      let beforeUser: Awaited<ReturnType<typeof client.query.userData.findFirst>>;
      let beforeRun: Awaited<ReturnType<typeof client.query.questHistory.findFirst>>;
      const raced = beforeStatements(withoutTransactions(client), questHistory, [
        async () => {
          const hero = await client.query.userData.findFirst({
            where: eq(userData.userId, "hero"),
          });
          if (state === "account")
            await client
              .update(userData)
              .set({ updatedAt: getNextUserSnapshotAt(hero!.updatedAt) })
              .where(eq(userData.userId, "hero"));
          if (state === "combat")
            await client
              .update(userData)
              .set({ status: "BATTLE", battleId: "other" })
              .where(eq(userData.userId, "hero"));
          if (state === "ended")
            await client
              .update(questHistory)
              .set({ endAt: new Date() })
              .where(eq(questHistory.id, "run"));
          if (state === "completed")
            await client
              .update(questHistory)
              .set({ completed: 1 })
              .where(eq(questHistory.id, "run"));
          beforeUser = await client.query.userData.findFirst({
            where: eq(userData.userId, "hero"),
          });
          beforeRun = await client.query.questHistory.findFirst();
        },
      ]);
      const caller = callerForDatabase(router, "hero", raced).quests;
      expect((await caller.abandon({ id: "pyramid" })).success).toBe(false);
      expect(
        await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
      ).toEqual(beforeUser!);
      expect(await client.query.questHistory.findFirst()).toEqual(beforeRun!);
    });
  }

  it("arbitrates simultaneous paid entry and abandonment without split state", async () => {
    const { client, attempt } = await snapshot();
    const caller = callerForDatabase(
      router,
      "hero",
      withoutTransactions(client),
    ).quests;
    const [started, abandoned] = await Promise.all([
      startFloor(withoutTransactions(client), attempt),
      caller.abandon({ id: "pyramid" }),
    ]);
    expect(Number(started.success) + Number(abandoned.success)).toBe(1);
    const [hero, run, battles, histories] = await Promise.all([
      client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
      client.query.questHistory.findFirst(),
      client.query.battle.findMany(),
      client.query.battleHistory.findMany(),
    ]);
    expect(hero?.status).toBe(started.success ? "BATTLE" : "AWAKE");
    expect(hero?.battleId).toBe(started.success ? started.battleId! : null);
    expect(run?.endAt === null).toBe(started.success);
    expect(battles).toHaveLength(started.success ? 1 : 0);
    expect(histories).toHaveLength(started.success ? 1 : 0);
  });
});
