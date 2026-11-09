import { fetchBattle } from "@/queries/combat";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { ENERGY_QUEST_REWARDS, TERMINAL_DIALOG_PREFIX } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  quest,
  questHistory,
  userData,
} from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { bankRouter } from "@/server/api/routers/bank";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { createTRPCRouter } from "@/server/api/trpc";
import {
  DialogObjective,
  InstantStartBattleObjective,
  QuestTracker,
  ResetQuestObjective,
} from "@/validators/objectives";
import { periodStart } from "@/utils/time";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
  insertDefaultAiProfile,
} from "../../../../setup/factories";
import { beforeStatements, failStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const router = createTRPCRouter({
  quests: questsRouter,
  combat: combatRouter,
  bank: bankRouter,
});
const dialog = (id: string, next?: string) =>
  DialogObjective.parse({
    id,
    task: "dialog",
    nextObjectiveId: next
      ? [{ text: "Continue", nextObjectiveId: next }]
      : [{ text: "Complete" }],
  });
const floor = (id: string, next: string) =>
  InstantStartBattleObjective.parse({
    id,
    task: "start_battle",
    opponentAIs: [{ ids: ["foe"], number: 1 }],
    nextObjectiveId: next,
    failObjectiveId: "checkpoint",
  });
const content = {
  isolated: true,
  entryItems: [],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: [],
  objectives: [
    dialog("enter", "floor1"),
    floor("floor1", "between"),
    dialog("between", "floor2"),
    floor("floor2", "finish"),
    dialog("finish"),
    ResetQuestObjective.parse({
      id: "checkpoint",
      task: "reset_quest",
      resetObjectiveId: "floor1",
    }),
  ],
};
const pusher = { trigger: vi.fn(async () => {}) } as unknown as PusherClient;

describeWithDatabase("persistent isolated Pyramid battle status", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(battleHistory, battle, aiProfile, questHistory, quest, userData);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
        curEnergy: 10,
        curHealth: 1000,
        maxHealth: 1000,
        curChakra: 1000,
        maxChakra: 1000,
        curStamina: 1000,
        maxStamina: 1000,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
      { userId: "foe", isAi: true },
    ]);
    await insertQuests([
      {
        id: "pyramid",
        name: "Pyramid",
        questType: "battlepyramid",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content,
      },
      {
        id: "other",
        name: "Other",
        questType: "story",
        hidden: false,
        content: { ...content, isolated: false, objectives: [dialog("other")] },
      },
    ]);
    await insertDefaultAiProfile({ userId: "foe" });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });

  const start = async () => {
    const client = await getTestDatabase();
    const api = callerForDatabase(router, "hero", client);
    expect(
      (await api.quests.startQuest({ questId: "pyramid", userSector: 0 })).success,
    ).toBe(true);
    return { client, api };
  };
  const hero = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    });
  const finishTracker = async () => {
    const client = await getTestDatabase();
    await client
      .update(userData)
      .set({
        questData: [
          QuestTracker.parse({
            id: "pyramid",
            goals: [
              {
                id: "enter",
                done: true,
                collected: true,
                selectedNextObjectiveId: "floor1",
              },
              {
                id: "floor1",
                done: true,
                collected: true,
                selectedNextObjectiveId: "between",
              },
              {
                id: "between",
                done: true,
                collected: true,
                selectedNextObjectiveId: "floor2",
              },
              {
                id: "floor2",
                done: true,
                collected: true,
                selectedNextObjectiveId: "finish",
              },
              { id: "finish" },
            ],
          }),
        ],
      })
      .where(eq(userData.userId, "hero"));
  };
  const settleFloor = async (won: boolean) => {
    const client = await getTestDatabase();
    const saved = await hero();
    const snapshot = await fetchBattle(client, saved!.battleId!);
    if (!snapshot) throw new Error("Missing floor battle");
    const player = snapshot.usersState.find((user) => user.userId === "hero")!;
    const opponent = snapshot.usersState.find((user) => user.isAi)!;
    player.curHealth = won ? 700 : 0;
    player.curChakra = 600;
    player.curStamina = 500;
    opponent.curHealth = won ? 0 : opponent.maxHealth;
    const result = calcBattleResult(snapshot, "hero", snapshot.extraState.settings);
    if (!result) throw new Error("Floor did not finish");
    await updateUser(client, pusher, snapshot, result, "hero");
    await client.delete(battle).where(eq(battle.id, snapshot.id));
    return result;
  };

  it("keeps BATTLE through entry, both floor settlements and continuation, then releases on completion", async () => {
    const { api, client } = await start();
    expect(await hero()).toMatchObject({ status: "BATTLE", battleId: null });
    expect(
      (await api.quests.checkRewards({ questId: "pyramid", nextObjectiveId: "floor1" }))
        .success,
    ).toBe(true);
    await fetchUpdatedUser({ client, userId: "hero" });
    expect((await hero())?.battleId).toBeString();
    expect((await settleFloor(true)).curHealth).toBe(700);
    expect(await hero()).toMatchObject({
      status: "BATTLE",
      battleId: null,
      curHealth: 700,
      curChakra: 600,
      curStamina: 500,
    });
    expect(
      (
        await api.quests.checkRewards({
          questId: "pyramid",
          nextObjectiveId: "between",
        })
      ).success,
    ).toBe(true);
    expect(
      (await api.quests.checkRewards({ questId: "pyramid", nextObjectiveId: "floor2" }))
        .success,
    ).toBe(true);
    await fetchUpdatedUser({ client, userId: "hero" });
    const second = await fetchBattle(client, (await hero())!.battleId!);
    expect(second?.usersState.find((user) => user.userId === "hero")).toMatchObject({
      curHealth: 700,
      curChakra: 600,
      curStamina: 500,
    });
    await settleFloor(true);
    expect(
      (await api.quests.checkRewards({ questId: "pyramid", nextObjectiveId: "finish" }))
        .success,
    ).toBe(true);
    const completed = await api.quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(completed).toMatchObject({ success: true, resolved: true });
    expect(await hero()).toMatchObject({
      status: "AWAKE",
      battleId: null,
      curHealth: 700,
      curEnergy: 10 + (ENERGY_QUEST_REWARDS.battlepyramid ?? 0),
    });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 1 });
  });

  it("keeps a defeat at one HP in BATTLE so its authored checkpoint can resume", async () => {
    const { api, client } = await start();
    await api.quests.checkRewards({ questId: "pyramid", nextObjectiveId: "floor1" });
    await fetchUpdatedUser({ client: await getTestDatabase(), userId: "hero" });
    await settleFloor(false);
    expect(await hero()).toMatchObject({
      status: "BATTLE",
      battleId: null,
      curHealth: 1,
    });
    const retry = await api.quests.retryBattle({ questId: "pyramid" });
    expect(retry).toMatchObject({
      success: false,
      message: "There is no lost battle to retry in this quest",
    });
    await fetchUpdatedUser({ client, userId: "hero" });
    const saved = await hero();
    expect(saved).toMatchObject({ status: "BATTLE", curHealth: 1 });
    expect(saved?.battleId).toBeString();
    const checkpoint = await fetchBattle(client, saved!.battleId!);
    expect(checkpoint?.extraState.questBattleSource).toEqual({
      questId: "pyramid",
      objectiveId: "floor1",
    });
  });

  it("rejects other quest rewards, retries and abandonment while between its own floors", async () => {
    const { api } = await start();
    await insertQuestHistory([
      { userId: "hero", questId: "other", questType: "story" },
    ]);
    expect((await api.quests.checkRewards({ questId: "other" })).success).toBe(false);
    expect((await api.quests.retryBattle({ questId: "other" })).success).toBe(false);
    expect((await api.quests.abandon({ id: "other" })).success).toBe(false);
    expect(
      (await api.quests.startQuest({ questId: "other", userSector: 0 })).success,
    ).toBe(false);
    expect((await api.bank.toPocket({ amount: 100 })).success).toBe(false);
    expect((await api.quests.getQuestHistory({ limit: 10 })).data).toHaveLength(2);
    expect(await hero()).toMatchObject({ status: "BATTLE", battleId: null });
  });

  it("repairs an old completed tracker without releasing a new active battle", async () => {
    const { client } = await start();
    await client
      .update(questHistory)
      .set({ completed: 1, endAt: new Date(Date.now() - 60_000) })
      .where(eq(questHistory.questId, "pyramid"));
    const repaired = await fetchUpdatedUser({ client, userId: "hero" });
    expect(repaired.user).toMatchObject({ status: "AWAKE", battleId: null });
    await client
      .update(userData)
      .set({ status: "BATTLE", battleId: "active-battle" })
      .where(eq(userData.userId, "hero"));
    const active = await fetchUpdatedUser({ client, userId: "hero" });
    expect(active.user).toMatchObject({ status: "BATTLE", battleId: "active-battle" });
  });

  for (const state of ["hidden", "edited"] as const) {
    it(`keeps a ${state} run locked, rejects continuation and allows abandonment`, async () => {
      const { api, client } = await start();
      const authored = await client.query.quest.findFirst({
        where: eq(quest.id, "pyramid"),
      });
      await client
        .update(quest)
        .set(
          state === "hidden"
            ? { hidden: true }
            : { updatedAt: new Date(authored!.updatedAt.getTime() + 1000) },
        )
        .where(eq(quest.id, "pyramid"));
      expect(
        (
          await api.quests.checkRewards({
            questId: "pyramid",
            nextObjectiveId: "floor1",
          })
        ).success,
      ).toBe(false);
      expect((await api.quests.retryBattle({ questId: "pyramid" })).success).toBe(
        false,
      );
      expect(await hero()).toMatchObject({ status: "BATTLE", battleId: null });
      expect((await api.quests.abandon({ id: "pyramid" })).success).toBe(true);
      expect(await hero()).toMatchObject({ status: "AWAKE", battleId: null });
    });
  }

  it("does not finish or unlock the run if a battle claims the player before completion", async () => {
    const { client } = await start();
    await finishTracker();
    const raced = beforeStatements(client, userData, [
      async () => {
        await client
          .update(userData)
          .set({ battleId: "concurrent-floor" })
          .where(eq(userData.userId, "hero"));
      },
    ]);
    const result = await callerForDatabase(router, "hero", raced).quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(result.success).toBe(false);
    expect(await hero()).toMatchObject({
      status: "BATTLE",
      battleId: "concurrent-floor",
      curEnergy: 10,
    });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 0, endAt: null });
  });

  it("keeps completion and its account claim atomic when a profile reads before the write", async () => {
    const { client } = await start();
    // Snapshot stamps may be ahead of the wall clock after a same-millisecond claim.
    const stampedAt = new Date(Date.now() + 60_000);
    await client
      .update(userData)
      .set({ updatedAt: stampedAt })
      .where(eq(userData.userId, "hero"));
    await finishTracker();
    const raced = beforeStatements(client, userData, [
      async () => {
        const completed = await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, "pyramid"),
        });
        expect(completed).toMatchObject({ completed: 0, endAt: null });
        const read = await fetchUpdatedUser({ client, userId: "hero" });
        expect(read.user).toMatchObject({ status: "BATTLE", battleId: null });
      },
    ]);
    const result = await callerForDatabase(router, "hero", raced).quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(result).toMatchObject({ success: true, resolved: true });
    expect(await hero()).toMatchObject({ status: "AWAKE", battleId: null });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 1 });
  });

  it("does not unlock a new isolated run when an older completion payout is delayed", async () => {
    const { client } = await start();
    await finishTracker();
    await insertQuests([
      {
        id: "next-pyramid",
        name: "Next Pyramid",
        questType: "battlepyramid",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content,
      },
    ]);
    const raced = beforeStatements(client, userData, [
      async () => {},
      async () => {
        const read = await fetchUpdatedUser({ client, userId: "hero" });
        expect(read.user?.status).toBe("AWAKE");
        expect(
          (
            await callerForDatabase(router, "hero", client).quests.startQuest({
              questId: "next-pyramid",
              userSector: 0,
            })
          ).success,
        ).toBe(true);
      },
    ]);
    const result = await callerForDatabase(router, "hero", raced).quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(result).toMatchObject({ success: true, resolved: true });
    expect(await hero()).toMatchObject({ status: "BATTLE", battleId: null });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "next-pyramid"),
      }),
    ).toMatchObject({ completed: 0, endAt: null, isolated: true });
  });

  it("only admits the matching isolated attempt when BATTLE has no battleId", async () => {
    const { client } = await start();
    const { user } = await fetchUpdatedUser({ client, userId: "hero" });
    const attempt = user!.userQuests.find((entry) => entry.questId === "pyramid")!;
    const common = {
      client,
      userIds: ["hero"],
      targetIds: ["foe"],
      biome: "default" as const,
    };
    expect((await initiateBattle(common, "ARENA")).success).toBe(false);
    expect(
      (
        await initiateBattle(
          {
            ...common,
            questAttempt: attempt,
            questBattleSource: { questId: "other", objectiveId: "floor1" },
          },
          "QUEST",
        )
      ).success,
    ).toBe(false);
    expect(
      (
        await initiateBattle(
          {
            ...common,
            questAttempt: attempt,
            questBattleSource: { questId: "pyramid", objectiveId: "floor1" },
          },
          "QUEST",
        )
      ).success,
    ).toBe(true);
  });

  for (const end of ["abandon", "complete", "retire"] as const) {
    it(`preserves earned Energy and resets the pool recovery clock on ${end}`, async () => {
      const { api, client } = await start();
      await client
        .update(userData)
        .set({
          regeneration: 10,
          regenAt: new Date(Date.now() - 125_000),
          curHealth: 700,
        })
        .where(eq(userData.userId, "hero"));
      if (end === "abandon")
        expect((await api.quests.abandon({ id: "pyramid" })).success).toBe(true);
      if (end === "complete") {
        await finishTracker();
        expect(
          (
            await api.quests.checkRewards({
              questId: "pyramid",
              nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
            })
          ).success,
        ).toBe(true);
      }
      if (end === "retire") {
        await client
          .update(questHistory)
          .set({ endAt: new Date() })
          .where(eq(questHistory.questId, "pyramid"));
        await fetchUpdatedUser({ client, userId: "hero" });
      }
      const released = await hero();
      expect(released).toMatchObject({
        status: "AWAKE",
        battleId: null,
        curHealth: 700,
        curEnergy:
          30 + (end === "complete" ? (ENERGY_QUEST_REWARDS.battlepyramid ?? 0) : 0),
      });
      expect(released!.regenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  }

  it("serializes parallel completion claims and grants the reward once", async () => {
    const { api, client } = await start();
    await finishTracker();
    await Promise.all([
      api.quests.checkRewards({
        questId: "pyramid",
        nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
      }),
      api.quests.checkRewards({
        questId: "pyramid",
        nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
      }),
    ]);
    expect(await hero()).toMatchObject({
      status: "AWAKE",
      curEnergy: 10 + (ENERGY_QUEST_REWARDS.battlepyramid ?? 0),
    });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 1, previousCompletes: 1 });
  });

  for (const period of ["missing", "expired", "current"] as const) {
    it(`counts isolated completions with a ${period} retry period`, async () => {
      const client = await getTestDatabase();
      await client
        .update(quest)
        .set({ retryDelay: "daily" })
        .where(eq(quest.id, "pyramid"));
      const { api } = await start();
      const current = periodStart("daily", new Date());
      await client
        .update(questHistory)
        .set({
          periodCompletes: 2,
          periodStartAt:
            period === "missing"
              ? null
              : period === "expired"
                ? new Date(current.getTime() - 86_400_000)
                : current,
        })
        .where(eq(questHistory.questId, "pyramid"));
      await finishTracker();
      expect(
        (
          await api.quests.checkRewards({
            questId: "pyramid",
            nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
          })
        ).success,
      ).toBe(true);
      expect(
        await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, "pyramid"),
        }),
      ).toEqual(
        expect.objectContaining({
          completed: 1,
          previousCompletes: 1,
          periodCompletes: period === "current" ? 3 : 1,
          periodStartAt: current,
        }),
      );
    });
  }

  it("stores an isolated completion's reward choice once and permits claiming it after release", async () => {
    const client = await getTestDatabase();
    await client
      .update(quest)
      .set({
        content: {
          ...content,
          rewardMode: "choose",
          rewardPickCount: 1,
          reward: ObjectiveReward.parse({ reward_money: 25, reward_exp: 100 }),
        },
      })
      .where(eq(quest.id, "pyramid"));
    const { api } = await start();
    const initialMoney = (await hero())!.money;
    await finishTracker();
    const finished = await api.quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(finished).toMatchObject({
      success: true,
      resolved: true,
      rewardChoicePending: true,
    });
    const pending = (await client.query.questHistory.findFirst({
      where: eq(questHistory.questId, "pyramid"),
    }))!.pendingRewardChoice!;
    expect(pending.cards.map((entry) => entry.field)).toEqual([
      "reward_money",
      "reward_exp",
    ]);
    expect(await hero()).toMatchObject({ status: "AWAKE", money: initialMoney });
    const pick = {
      questId: "pyramid",
      choiceId: pending.id,
      cardIds: ["reward_money"],
    };
    expect((await api.quests.claimRewardChoice(pick)).success).toBe(true);
    expect((await api.quests.claimRewardChoice(pick)).success).toBe(false);
    expect(await hero()).toMatchObject({ money: initialMoney + 25 });
  });

  it("keeps a failed completion claim open and abandonable without granting rewards", async () => {
    const { client, api } = await start();
    await finishTracker();
    const failing = failStatements(client, userData);
    await expect(
      callerForDatabase(router, "hero", failing).quests.checkRewards({
        questId: "pyramid",
        nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
      }),
    ).rejects.toThrow("Statement failed on purpose");
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 0, endAt: null, previousCompletes: 0 });
    for (let i = 0; i < 3; i++) {
      const read = await fetchUpdatedUser({ client, userId: "hero" });
      expect(read.user).toMatchObject({ status: "BATTLE", battleId: null });
      expect(read.user?.userQuests.map((entry) => entry.questId)).toEqual(["pyramid"]);
    }
    expect(await hero()).toMatchObject({ curEnergy: 10 });
    expect((await api.quests.abandon({ id: "pyramid" })).success).toBe(true);
    expect((await fetchUpdatedUser({ client, userId: "hero" })).user).toMatchObject({
      status: "AWAKE",
      battleId: null,
    });
  });

  it("allows a failed completion claim to retry and pays its reward once", async () => {
    const { client, api } = await start();
    await finishTracker();
    await expect(
      callerForDatabase(
        router,
        "hero",
        failStatements(client, userData),
      ).quests.checkRewards({
        questId: "pyramid",
        nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
      }),
    ).rejects.toThrow("Statement failed on purpose");
    expect(
      (
        await api.quests.checkRewards({
          questId: "pyramid",
          nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
        })
      ).success,
    ).toBe(true);
    await api.quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(await hero()).toMatchObject({
      status: "AWAKE",
      curEnergy: 10 + (ENERGY_QUEST_REWARDS.battlepyramid ?? 0),
    });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 1, previousCompletes: 1 });
  });

  it("recovers after completion commits but its payout fails without replaying the reward", async () => {
    const { client, api } = await start();
    await finishTracker();
    const failing = beforeStatements(client, userData, [
      async () => {},
      async () => {
        throw new Error("Payout interrupted");
      },
    ]);
    await expect(
      callerForDatabase(router, "hero", failing).quests.checkRewards({
        questId: "pyramid",
        nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
      }),
    ).rejects.toThrow("Payout interrupted");
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 1, previousCompletes: 1 });
    const read = await fetchUpdatedUser({ client, userId: "hero" });
    expect(read.user).toMatchObject({ status: "AWAKE", battleId: null });
    expect(read.user?.userQuests).toHaveLength(0);
    await api.quests.checkRewards({
      questId: "pyramid",
      nextObjectiveId: `${TERMINAL_DIALOG_PREFIX}finish`,
    });
    expect(await hero()).toMatchObject({ curEnergy: 10 });
  });

  it("releases an orphaned completion marker from a failed older claim", async () => {
    const { client } = await start();
    await finishTracker();
    const saved = await hero();
    await client
      .update(questHistory)
      .set({ completed: 1, endAt: new Date(saved!.updatedAt.getTime() + 60_000) })
      .where(eq(questHistory.questId, "pyramid"));
    expect((await fetchUpdatedUser({ client, userId: "hero" })).user).toMatchObject({
      status: "AWAKE",
      battleId: null,
    });
  });

  it("retires deleted-definition isolation so abandonment and outside activities recover", async () => {
    const { client, api } = await start();
    await client.delete(quest).where(eq(quest.id, "pyramid"));
    expect((await api.quests.abandon({ id: "pyramid" })).success).toBe(true);
    const recovered = await fetchUpdatedUser({ client, userId: "hero" });
    expect(recovered.user).toMatchObject({ status: "AWAKE", battleId: null });
    expect(recovered.user?.userQuests).toHaveLength(0);
    expect(
      (
        await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, "pyramid"),
        })
      )?.endAt,
    ).not.toBeNull();
    await client
      .update(quest)
      .set({ questType: "battlepyramid" })
      .where(eq(quest.id, "other"));
    expect(
      (await api.quests.startQuest({ questId: "other", userSector: 0 })).success,
    ).toBe(true);
  });

  it("does not unlock a new live run while retiring deleted-definition history", async () => {
    const { client } = await start();
    await client.delete(quest).where(eq(quest.id, "pyramid"));
    await insertQuests([
      {
        id: "next-pyramid",
        name: "Next Pyramid",
        questType: "battlepyramid",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content,
      },
    ]);
    const raced = beforeStatements(client, userData, [
      async () => {
        await fetchUpdatedUser({ client, userId: "hero" });
        expect(
          (
            await callerForDatabase(router, "hero", client).quests.startQuest({
              questId: "next-pyramid",
              userSector: 0,
            })
          ).success,
        ).toBe(true);
      },
    ]);
    const recovered = await fetchUpdatedUser({ client: raced, userId: "hero" });
    expect(recovered.user).toMatchObject({ status: "BATTLE", battleId: null });
    expect(recovered.user?.userQuests.map((entry) => entry.questId)).toEqual([
      "next-pyramid",
    ]);
    expect(
      (
        await callerForDatabase(router, "hero", client).quests.startQuest({
          questId: "other",
          userSector: 0,
        })
      ).success,
    ).toBe(false);
  });

  it("keeps a definition restored before orphan retirement locked and abandonable", async () => {
    const { client, api } = await start();
    const definition = await client.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    });
    await client.delete(quest).where(eq(quest.id, "pyramid"));
    const raced = beforeStatements(client, questHistory, [
      async () => {
        await client.insert(quest).values(definition!);
      },
    ]);
    const recovered = await fetchUpdatedUser({ client: raced, userId: "hero" });
    expect(recovered.user).toMatchObject({ status: "BATTLE", battleId: null });
    expect(
      await client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ).toMatchObject({ completed: 0, endAt: null });
    expect((await api.quests.abandon({ id: "pyramid" })).success).toBe(true);
    expect(await hero()).toMatchObject({ status: "AWAKE", battleId: null });
  });
});
