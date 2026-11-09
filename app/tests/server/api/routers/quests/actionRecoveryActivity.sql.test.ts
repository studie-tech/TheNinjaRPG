import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  item,
  quest,
  questHistory,
  userCookingJob,
  userData,
  userItem,
  userVote,
} from "@/drizzle/schema";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { IncreaseMaxPoolsTag } from "@/validators/combat";
import {
  DialogObjective,
  InstantNewQuestObjective,
  InstantStartBattleObjective,
  QuestTracker,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertDefaultAiProfile,
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const playerId = "quest-recovery-player";
const questId = "quest-recovery-quest";

describeWithDatabase("quest recovery committed activity", () => {
  beforeEach(async () => {
    await resetTables(
      aiProfile,
      battle,
      battleHistory,
      questHistory,
      quest,
      userCookingJob,
      userItem,
      item,
      userVote,
      userData,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in quest recovery tests",
    });
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "isolated start",
    "retry",
    "reward combat",
    "reward isolated start",
    "rejected combat",
  ] as const)(
    "applies the confirmed activity for %s without a profile request",
    async (scenario) => {
      const database = await getTestDatabase();
      const now = new Date();
      const start = scenario === "isolated start";
      const retry = scenario === "retry";
      const rejected = scenario === "rejected combat";
      const grantsIsolated = scenario === "reward isolated start";
      const combat = !start && !rejected && !grantsIsolated;
      const objectiveId = grantsIsolated ? "grant" : "fight";
      await insertUsers([
        {
          userId: playerId,
          username: "QuestRecovery",
          status: "ASLEEP",
          rank: "JONIN",
          level: 50,
          isOutlaw: true,
          primaryElement: "Fire",
          secondaryElement: "Water",
          regeneration: 0,
          updatedAt: now,
          regenAt: now,
          curHealth: 1000,
          maxHealth: 1000,
          curChakra: 1000,
          maxChakra: 1000,
          curStamina: 1000,
          maxStamina: 1000,
          questData: start
            ? []
            : [
                QuestTracker.parse({
                  id: questId,
                  goals: [
                    retry
                      ? { id: "fight", recentlyDied: true }
                      : { id: "entry", value: 0 },
                  ],
                }),
              ],
        },
        { userId: "quest-recovery-foe", isAi: true },
      ]);
      const fight = InstantStartBattleObjective.parse({
        id: "fight",
        task: "start_battle",
        opponentAIs: [{ ids: ["quest-recovery-foe"], number: 1 }],
        ...(rejected
          ? { allyAIs: [{ ids: ["missing-recovery-ally"], number: 1 }] }
          : {}),
      });
      await insertQuests([
        {
          id: questId,
          name: "Recovery quest",
          questType: start ? "battlepyramid" : "story",
          hidden: false,
          content: {
            isolated: start,
            entryItems: combat ? [{ ids: ["recovery-ticket"], number: 1 }] : [],
            objectives:
              start || retry
                ? [fight]
                : [
                    DialogObjective.parse({
                      id: "entry",
                      task: "dialog",
                      nextObjectiveId: [
                        { text: "Continue", nextObjectiveId: objectiveId },
                      ],
                    }),
                    grantsIsolated
                      ? InstantNewQuestObjective.parse({
                          id: "grant",
                          task: "new_quest",
                          newQuestIds: ["recovery-pyramid"],
                        })
                      : fight,
                  ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      if (grantsIsolated)
        await insertQuests([
          {
            id: "recovery-pyramid",
            name: "Recovery Pyramid",
            questType: "battlepyramid",
            hidden: false,
            content: {
              isolated: true,
              entryItems: [],
              objectives: [fight],
              reward: ObjectiveReward.parse({}),
              sceneBackground: "",
              sceneCharacters: [],
            },
          },
        ]);
      if (!start)
        await insertQuestHistory([
          { userId: playerId, questId, questType: "story", startedAt: now },
        ]);
      await insertDefaultAiProfile({ userId: "quest-recovery-foe" });
      await insertUserVotes([{ userId: playerId, lastVoteAt: now }]);
      if (combat) {
        await insertItems([
          {
            id: "recovery-ticket",
            itemType: "ARMOR",
            slot: "CHEST",
            maxDurability: 100,
            effects: [
              IncreaseMaxPoolsTag.parse({
                power: 100,
                calculation: "static",
                poolsAffected: ["Energy"],
              }),
            ],
          },
        ]);
        await insertUserItems([
          {
            id: "recovery-worn-ticket",
            userId: playerId,
            itemId: "recovery-ticket",
            equipped: "CHEST",
            durability: 100,
            quantity: 1,
          },
        ]);
      }
      const profile = callerForDatabase(profileRouter, playerId, database);
      const initial = await profile.getUser();
      expect(initial.userData?.status).toBe("ASLEEP");
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const key = ["quest-recovery-profile"];
      const refetch = vi.fn(() => profile.getUser());
      client.setQueryData(key, initial);
      const observer = new QueryObserver(client, {
        queryKey: key,
        queryFn: refetch,
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => {});
      try {
        const revision = prepareUserUpdate(client, key);
        const api = callerForDatabase(questsRouter, playerId, database);
        const response = start
          ? await api.startQuest({ questId, userSector: 0 })
          : retry
            ? await api.retryBattle({ questId })
            : await api.checkRewards({ questId, nextObjectiveId: objectiveId });
        expect(response).toMatchObject({
          success: true,
          actionNotice: AUTO_WAKE_MESSAGE,
        });
        const saved = await database.query.userData.findFirst({
          where: eq(userData.userId, playerId),
        });
        const expected = {
          status: rejected ? "AWAKE" : "BATTLE",
          battleId: saved!.battleId,
        };
        expect(response.userRecovery?.activity).toMatchObject(expected);
        expect(saved).toMatchObject(expected);
        if (start || !rejected) expect(response.userPatch).toBeUndefined();
        if (combat) expect(saved?.battleId).toEqual(expect.any(String));
        else expect(saved?.battleId).toBeNull();
        await updateUserCache(client, key, response, { revision });
        expect(client.getQueryData<typeof initial>(key)?.userData).toMatchObject(
          expected,
        );
        expect(refetch).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        client.clear();
      }
    },
  );
});
