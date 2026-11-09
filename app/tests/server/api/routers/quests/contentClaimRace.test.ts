import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { TERMINAL_DIALOG_PREFIX } from "@/drizzle/constants";
import { item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import * as socials from "@/libs/socials";
import { itemRouter } from "@/server/api/routers/item";
import { questsRouter } from "@/server/api/routers/quests";
import { createTRPCRouter } from "@/server/api/trpc";
import { HealTag } from "@/validators/combat";
import {
  DialogObjective,
  InstantStartBattleObjective,
  InstantWinLoseObjective,
  QuestTracker,
  QuestValidator,
  SimpleObjective,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
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

const router = createTRPCRouter({ quests: questsRouter, item: itemRouter });
describeWithDatabase("Pyramid reward and content publication races", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await resetTables(questHistory, quest, userItem, item, userData);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
        money: 1000,
        curHealth: 100,
        maxHealth: 1000,
        curChakra: 100,
        maxChakra: 1000,
        curStamina: 100,
        maxStamina: 1000,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    await insertQuests([
      {
        id: "pyramid",
        questType: "battlepyramid",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content: {
          isolated: true,
          entryItems: [],
          reward: ObjectiveReward.parse({ reward_money: 100 }),
          sceneBackground: "",
          sceneCharacters: ["character"],
          objectives: [
            InstantWinLoseObjective.parse({ id: "finish", task: "win_quest" }),
          ],
        },
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  for (const change of ["hidden", "edited"] as const) {
    for (const claimPoint of ["completion", "account", "progress"] as const) {
      it(`rejects ${claimPoint} claim after late ${change} content`, async () => {
        const db = await getTestDatabase();
        if (claimPoint === "progress") {
          const original = (await db.query.quest.findFirst({
            where: eq(quest.id, "pyramid"),
          }))!;
          await db
            .update(quest)
            .set({
              consecutiveObjectives: true,
              content: {
                ...original.content,
                objectives: [
                  DialogObjective.parse({
                    id: "enter",
                    task: "dialog",
                    reward_money: 25,
                    nextObjectiveId: [{ text: "Continue", nextObjectiveId: "wait" }],
                  }),
                  SimpleObjective.parse({
                    id: "wait",
                    task: "stats_trained",
                    value: 100,
                  }),
                ],
              },
            })
            .where(eq(quest.id, "pyramid"));
        }
        const api = callerForDatabase(router, "hero", db);
        expect(
          (await api.quests.startQuest({ questId: "pyramid", userSector: 0 })).success,
        ).toBe(true);
        const authored = await db.query.quest.findFirst({
          where: eq(quest.id, "pyramid"),
        });
        let interposed = false;
        const raced = beforeStatements(
          db,
          claimPoint === "completion" ? questHistory : userData,
          [
            async () => {
              interposed = true;
              await db
                .update(quest)
                .set(
                  change === "hidden"
                    ? { hidden: true }
                    : { updatedAt: new Date(authored!.updatedAt.getTime() + 1000) },
                )
                .where(eq(quest.id, "pyramid"));
            },
          ],
        );
        const result = await callerForDatabase(
          router,
          "hero",
          raced,
        ).quests.checkRewards({
          questId: "pyramid",
          nextObjectiveId:
            claimPoint === "progress" ? "wait" : `${TERMINAL_DIALOG_PREFIX}finish`,
        });
        const [hero, history] = await Promise.all([
          db.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
          db.query.questHistory.findFirst({
            where: eq(questHistory.questId, "pyramid"),
          }),
        ]);
        expect(interposed).toBe(true);
        expect(result.success).toBe(false);
        expect(history).toMatchObject({ completed: 0, endAt: null });
        expect(hero).toMatchObject({ money: 1000, status: "BATTLE" });
      });
    }
  }

  for (const quantity of [1, 2]) {
    it(`rejects a stale potion claim from a ${quantity}-item stack after isolation begins without consuming it`, async () => {
      const db = await getTestDatabase();
      await insertItems([
        {
          id: "potion",
          itemType: "CONSUMABLE",
          effects: [
            HealTag.parse({
              power: 400,
              calculation: "static",
              poolsAffected: ["Health"],
            }),
          ],
        },
      ]);
      await insertUserItems([
        { id: "hero-potion", userId: "hero", itemId: "potion", quantity },
      ]);
      const api = callerForDatabase(router, "hero", db);
      const raced = beforeStatements(db, userItem, [
        async () => {
          expect(
            (await api.quests.startQuest({ questId: "pyramid", userSector: 0 }))
              .success,
          ).toBe(true);
          expect(
            await db.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
          ).toMatchObject({ status: "BATTLE", battleId: null, curHealth: 100 });
        },
      ]);
      const result = await callerForDatabase(router, "hero", raced).item.consume({
        userItemId: "hero-potion",
      });
      const [hero, potion, history] = await Promise.all([
        db.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
        db.query.userItem.findFirst({ where: eq(userItem.id, "hero-potion") }),
        db.query.questHistory.findFirst({ where: eq(questHistory.questId, "pyramid") }),
      ]);
      expect(result.success).toBe(false);
      expect(hero).toMatchObject({ status: "BATTLE", battleId: null, curHealth: 100 });
      expect(potion?.quantity).toBe(quantity);
      expect(history?.isolated).toBe(true);
    });
  }

  it("preserves paused checkpoints across a visibility-only save", async () => {
    const db = await getTestDatabase();
    const original = (await db.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    }))!;
    await db
      .update(quest)
      .set({
        consecutiveObjectives: true,
        content: {
          ...original.content,
          isolated: false,
          objectives: [
            DialogObjective.parse({
              id: "enter",
              task: "dialog",
              nextObjectiveId: [{ text: "Enter", nextObjectiveId: "floor" }],
            }),
            DialogObjective.parse({
              id: "floor",
              task: "dialog",
              nextObjectiveId: [{ text: "Fight", nextObjectiveId: "fight" }],
            }),
            InstantStartBattleObjective.parse({
              id: "fight",
              task: "start_battle",
              opponentAIs: [{ ids: ["foe"], number: 1 }],
            }),
          ],
        },
      })
      .where(eq(quest.id, "pyramid"));
    await insertUsers([
      { userId: "editor", username: "Editor", role: "OWNER" },
      { userId: "foe", username: "Foe", isAi: true },
    ]);
    await insertQuests([
      {
        id: "other",
        questType: "mission",
        questRank: "A",
        hidden: false,
        content: {
          reward: ObjectiveReward.parse({}),
          objectives: [
            SimpleObjective.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ],
          sceneCharacters: ["character"],
          sceneBackground: "",
        },
      },
    ]);
    const api = callerForDatabase(router, "hero", db);
    expect(
      (await api.quests.startQuest({ questId: "pyramid", userSector: 0 })).success,
    ).toBe(true);
    const checkpoint = QuestTracker.parse({
      id: "pyramid",
      startAt: "2026-01-01T00:00:00.000Z",
      goals: [
        { id: "enter", done: true, selectedNextObjectiveId: "floor" },
        { id: "floor", value: 77 },
        { id: "fight" },
      ],
    });
    await db
      .update(userData)
      .set({ questData: [checkpoint] })
      .where(eq(userData.userId, "hero"));
    const authored = (await db.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    }))!;
    let sawSplitRevision = false;
    const split = beforeStatements(db, questHistory, [
      async () => {
        const deadline = Date.now() + 200;
        while (Date.now() < deadline) {
          const changed = await db.query.quest.findFirst({
            where: eq(quest.id, "pyramid"),
          });
          if (
            changed?.hidden &&
            changed.updatedAt.getTime() !== authored.updatedAt.getTime()
          ) {
            sawSplitRevision = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(
          (await api.quests.startQuest({ questId: "other", userSector: 0 })).success,
        ).toBe(true);
      },
    ]);
    const saved = await callerForDatabase(router, "editor", split).quests.update({
      id: "pyramid",
      data: QuestValidator.parse({ ...authored, hidden: true }),
    });
    expect(saved.success).toBe(true);
    const [hero, history, definition] = await Promise.all([
      db.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
      db.query.questHistory.findFirst({ where: eq(questHistory.questId, "pyramid") }),
      db.query.quest.findFirst({ where: eq(quest.id, "pyramid") }),
    ]);
    expect(sawSplitRevision).toBe(false);
    expect(history!.questVersion).toEqual(definition!.updatedAt);
    expect(hero?.questData?.find((tracker) => tracker.id === "pyramid")).toEqual(
      checkpoint,
    );
  });
});
