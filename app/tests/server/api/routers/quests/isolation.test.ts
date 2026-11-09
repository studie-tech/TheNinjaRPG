import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  type AiProfile,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  questHistory,
  userData,
} from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { calcEnergy } from "@/libs/profile";
import { Pusher } from "@/libs/pusher";
import { processUsersForBattle } from "@/server/api/routers/combat";
import { overworldAiRouter } from "@/server/api/routers/overworldAi";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { upsertQuestEntry } from "@/server/utils/questAssignment";
import {
  DialogObjective,
  InstantNewQuestObjective,
  InstantStartBattleObjective,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import { failCommits } from "../../../../setup/statements";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("Pyramid entry recovery", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      quest,
      questHistory,
      userData,
      overworldAiPlacement,
      overworldAiPlacementQuest,
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });
  for (const [source, isolated, alreadySettled] of [
    ["npc", true, false],
    ["npc", false, false],
    ["ui", true, false],
    ["ui", false, false],
    ["story", true, false],
    ["story", false, false],
    ["story", true, true],
  ] as const) {
    it(`preserves ${alreadySettled ? "settled" : "pending"} recovery for ${isolated ? "isolated" : "ordinary"} ${source} Pyramids`, async () => {
      const client = await getTestDatabase();
      const prior = new Date(Date.now() - 125_000);
      await insertUsers([
        {
          userId: "pool-hero",
          status: "AWAKE",
          rank: "JONIN",
          level: 50,
          sector: 0,
          longitude: 0,
          latitude: 0,
          isOutlaw: true,
          regeneration: 10,
          updatedAt: alreadySettled ? new Date(Date.now() - 350_000) : prior,
          regenAt: prior,
          curHealth: 500,
          maxHealth: 1000,
          curChakra: 990,
          maxChakra: 1000,
          curStamina: 1,
          maxStamina: 1000,
          curEnergy: source === "story" ? calcEnergy(50) - 10 : 10,
          primaryElement: "Fire",
          secondaryElement: "Water",
        },
        { userId: "friendly-npc", isAi: true },
      ]);
      await insertQuests([
        {
          id: "pool-pyramid",
          questType: "battlepyramid",
          hidden: false,
          maxAttempts: 100,
          maxCompletes: 100,
          consecutiveObjectives: true,
          content: {
            isolated,
            entryItems: [],
            sceneBackground: "",
            sceneCharacters: [],
            reward: ObjectiveReward.parse({}),
            objectives: [
              DialogObjective.parse({
                id: "enter",
                task: "dialog",
                nextObjectiveId: [{ text: "Enter", nextObjectiveId: "floor" }],
              }),
              InstantStartBattleObjective.parse({
                id: "floor",
                task: "start_battle",
                opponentAIs: [{ ids: ["foe"], number: 1 }],
              }),
            ],
          },
        },
      ]);
      await client.insert(overworldAiPlacement).values({
        id: "friendly",
        aiTemplateUserId: "friendly-npc",
        interactionType: "FRIENDLY",
        sectorList: [],
        sector: 0,
        longitude: 0,
        latitude: 0,
        positionVersion: 0,
      });
      await client.insert(overworldAiPlacementQuest).values({
        placementId: "friendly",
        questId: "pool-pyramid",
        chance: 100,
      });
      const { user, settings } = await fetchUpdatedUser({
        client,
        userId: "pool-hero",
      });
      if (!user) throw new Error("Missing fixture");
      const preload = (input: typeof user) =>
        processUsersForBattle(client, {
          users: [{ ...input, jutsus: [], effects: [] } as unknown as CombatQueryUser],
          settings,
          relations: [],
          wars: [],
          villages: [],
          battleType: "QUEST",
          leftSideUserIds: [user.userId],
          hide: false,
          isSummon: false,
          width: 10,
          height: 10,
          defaultProfile: { id: "default" } as AiProfile,
        });
      const recoveredBeforeEntry = (await preload(user)).usersState[0]!.curHealth;
      if (source === "npc") {
        const caller = await callerFor(overworldAiRouter, user.userId);
        const assigned = await caller.interactWithOverworldAi({
          placementId: "friendly",
          positionVersion: 0,
        });
        expect(assigned.success).toBe(true);
        expect(assigned.grantedQuestId).toBe("pool-pyramid");
      } else if (source === "ui") {
        const caller = await callerFor(questsRouter, user.userId);
        const assigned = await caller.startQuest({
          questId: "pool-pyramid",
          userSector: 0,
        });
        expect(assigned.success).toBe(true);
      } else {
        await insertQuests([
          {
            id: "grant-pyramid",
            questType: "story",
            hidden: false,
            content: {
              reward: ObjectiveReward.parse({}),
              sceneBackground: "",
              sceneCharacters: [],
              objectives: [
                InstantNewQuestObjective.parse({
                  id: "grant",
                  task: "new_quest",
                  newQuestIds: ["pool-pyramid"],
                }),
              ],
            },
          },
        ]);
        await insertQuestHistory([
          { userId: user.userId, questId: "grant-pyramid", questType: "story" },
        ]);
        const caller = await callerFor(profileRouter, user.userId);
        await caller.getUser();
      }
      const started = await fetchUpdatedUser({ client, userId: user.userId });
      if (!started.user) throw new Error("Missing started user");
      const afterEntry = (await preload(started.user)).usersState[0]!.curHealth;
      expect(recoveredBeforeEntry).toBeGreaterThan(500);
      expect(afterEntry).toBe(recoveredBeforeEntry);
      expect(
        started.user.userQuests.find((entry) => entry.questId === "pool-pyramid")
          ?.isolated,
      ).toBe(isolated);
      if (isolated) {
        const stored = await client.query.userData.findFirst({
          where: eq(userData.userId, user.userId),
        });
        expect(stored?.curHealth).toBe(520);
        expect(stored?.curChakra).toBe(1000);
        expect(stored?.curStamina).toBe(21);
        // Energy shares the clock and must retain its earned recovery too.
        expect(stored?.curEnergy).toBe(source === "story" ? calcEnergy(50) : 30);
        expect(stored?.regenAt.getTime()).toBe(prior.getTime() + 120_000);
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_000);
        const later = await fetchUpdatedUser({ client, userId: user.userId });
        if (!later.user) throw new Error("Missing isolated user");
        expect((await preload(later.user)).usersState[0]?.curHealth).toBe(520);
      }
    });
  }
  for (const entryPaid of [false, true]) {
    it(`keeps an open story-granted attempt's pools and receipt, paid=${entryPaid}`, async () => {
      const client = await getTestDatabase();
      const prior = new Date(Date.now() - 125_000);
      const version = new Date("2025-01-01T00:00:00Z");
      await insertUsers([
        {
          userId: "pool-hero",
          status: "BATTLE",
          updatedAt: prior,
          regenAt: prior,
          regeneration: 10,
          curHealth: 500,
          maxHealth: 1000,
          curChakra: 990,
          maxChakra: 1000,
          curStamina: 1,
          maxStamina: 1000,
          curEnergy: 10,
          questData: [
            {
              id: "pool-pyramid",
              goals: [
                {
                  id: "wait",
                  done: false,
                  value: 0,
                  collected: false,
                  recentlyDied: false,
                },
              ],
              startAt: prior.toISOString(),
            },
          ],
        },
      ]);
      await insertQuests([
        {
          id: "pool-pyramid",
          questType: "battlepyramid",
          updatedAt: version,
          hidden: false,
          maxAttempts: 100,
          maxCompletes: 100,
          content: {
            isolated: true,
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
            objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
          },
        },
        {
          id: "grant-pyramid",
          questType: "story",
          hidden: false,
          content: {
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
            objectives: [
              InstantNewQuestObjective.parse({
                id: "grant",
                task: "new_quest",
                newQuestIds: ["pool-pyramid"],
              }),
            ],
          },
        },
      ]);
      await insertQuestHistory([
        {
          id: "open-pyramid",
          userId: "pool-hero",
          questId: "pool-pyramid",
          questType: "battlepyramid",
          startedAt: prior,
          isolated: true,
          entryPaid,
          questVersion: version,
        },
        { userId: "pool-hero", questId: "grant-pyramid", questType: "story" },
      ]);
      const caller = await callerFor(profileRouter, "pool-hero");
      await caller.getUser();
      const [stored, attempt] = await Promise.all([
        client.query.userData.findFirst({ where: eq(userData.userId, "pool-hero") }),
        client.query.questHistory.findFirst({
          where: eq(questHistory.id, "open-pyramid"),
        }),
      ]);
      expect(stored).toEqual(
        expect.objectContaining({
          curHealth: 500,
          curChakra: 990,
          curStamina: 1,
          curEnergy: 10,
          regenAt: prior,
        }),
      );
      expect(attempt).toEqual(
        expect.objectContaining({ entryPaid, isolated: true, questVersion: version }),
      );
      expect(
        stored?.questData?.find((tracker) => tracker.id === "pool-pyramid")?.startAt,
      ).toBe(prior.toISOString());
    });
  }

  for (const scenario of [
    "pools changed",
    "already recovered",
    "deadlock retry",
  ] as const) {
    it(`settles fresh isolation safely after ${scenario}`, async () => {
      const client = await getTestDatabase();
      const prior = new Date(Date.now() - 125_000);
      await insertUsers([
        {
          userId: "pool-hero",
          status: "AWAKE",
          updatedAt: prior,
          regenAt: prior,
          regeneration: 10,
          curHealth: 500,
          maxHealth: 1000,
        },
      ]);
      await insertQuests([
        {
          id: "pool-pyramid",
          questType: "battlepyramid",
          content: {
            isolated: true,
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
            objectives: [DialogObjective.parse({ id: "wait", task: "dialog" })],
          },
        },
      ]);
      const [{ user }, pyramid] = await Promise.all([
        fetchUpdatedUser({ client, userId: "pool-hero" }),
        client.query.quest.findFirst({ where: eq(quest.id, "pool-pyramid") }),
      ]);
      if (!user || !pyramid) throw new Error("Missing fixture");
      const retrying = failCommits(
        client,
        scenario === "deadlock retry" ? 1 : 0,
        "Deadlock found when trying to get lock",
      );
      if (scenario !== "deadlock retry")
        await client
          .update(userData)
          .set({
            updatedAt: new Date(),
            curHealth: scenario === "pools changed" ? 700 : 520,
            ...(scenario === "already recovered"
              ? { regenAt: new Date(prior.getTime() + 120_000) }
              : {}),
          })
          .where(eq(userData.userId, user.userId));
      await upsertQuestEntry(retrying.client, user, pyramid, "quest_objective", null);
      expect(await client.query.questHistory.findMany()).toHaveLength(1);
      expect(
        await client.query.userData.findFirst({
          where: eq(userData.userId, user.userId),
        }),
      ).toEqual(
        expect.objectContaining({
          curHealth: scenario === "pools changed" ? 720 : 520,
          regenAt: new Date(prior.getTime() + 120_000),
        }),
      );
      expect(user.userQuests).toHaveLength(1);
      expect(typeof user.curHealth).toBe("number");
      expect(user.regenAt).toBeInstanceOf(Date);
      if (scenario === "deadlock retry") expect(retrying.attempts()).toBe(2);
    });
  }
});
