import { expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, questParty, userData } from "@/drizzle/schema";
import { projectPartyTracker } from "@/libs/questParty";
import { questPartyRelations } from "@/queries/questParty";
import type { UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { commitQuestObjectiveRewards } from "@/server/utils/questConsequences";
import {
  synchronizeQuestParty,
  type LoadedQuestParty,
  saveQuestPartyMember,
} from "@/server/utils/questParty";
import { AllObjectives, ObjectiveTracker, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward, PostProcessedRewardSchema } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

it("keeps committed terminal progress when its party CAS must retry", async () => {
  const goal = ObjectiveTracker.parse({ id: "goal" });
  const member = {
    userId: "one",
    questData: [
      QuestTracker.parse({
        id: "quest",
        goals: [{ ...goal, value: 10, done: true }],
        party: {
          id: "party",
          generation: 0,
          contributions: [{ ...goal, value: 10, done: true }],
        },
      }),
    ],
  } as LoadedQuestParty["members"][number];
  const party = {
    id: "party",
    questId: "quest",
    memberIds: ["one"],
    leaderId: "one",
    version: 0,
    battleId: null,
    contributions: {},
    tracker: QuestTracker.parse({ id: "quest", goals: [goal] }),
    members: [member],
    quest: {
      content: {
        objectives: [
          AllObjectives.parse({ id: "goal", task: "stats_trained", value: 10 }),
        ],
      },
    },
  } as LoadedQuestParty;
  const fresh = { ...party, version: 1, members: [{ ...member, questData: [] }] };
  let writes = 0;
  const client = {
    update: () => ({
      set: () => ({ where: async () => ({ rowsAffected: ++writes === 1 ? 0 : 1 }) }),
    }),
    query: { questParty: { findFirst: async () => fresh } },
  } as unknown as DrizzleClient;
  const result = await synchronizeQuestParty(client, party, member);
  expect(writes).toBe(2);
  expect(result.tracker.goals[0]?.value).toBe(10);
  expect(result.tracker.goals[0]?.done).toBe(true);
});

it.each([
  ["encounter", "encounter", "encounter"],
  ["fresh", "unrelated", "fresh"],
  ["claiming:1:reserved", "reserved", "reserved"],
  ["claiming:1:reserved", "unrelated", null],
])(
  "reconciles the exact encounter while preserving fresh claims (%s, %s)",
  async (battleId, memberBattleId, expected) => {
    if (battleId === "fresh") battleId = `claiming:${Date.now()}:reserved`;
    const member = {
      userId: "one",
      questData: [],
      battleId: memberBattleId,
    } as unknown as LoadedQuestParty["members"][number];
    const party = {
      id: "party",
      questId: "quest",
      memberIds: ["one"],
      leaderId: "one",
      version: 0,
      battleId,
      contributions: {},
      tracker: QuestTracker.parse({ id: "quest" }),
      members: [member],
      quest: { content: { objectives: [] } },
    } as unknown as LoadedQuestParty;
    const client = {
      update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 1 }) }) }),
    } as unknown as DrizzleClient;
    const result = await synchronizeQuestParty(client, party);
    expect(result.battleId).toBe(expected === "fresh" ? battleId : expected);
  },
);

describeWithDatabase("quest teams on real SQL", () => {
  it("merges concurrent member contributions exactly once", async () => {
    await resetTables(questParty, quest, userData);
    const client = await getTestDatabase();
    await insertQuests([
      {
        id: "team-quest",
        questType: "event",
        content: {
          objectives: [
            AllObjectives.parse({ id: "goal", task: "stats_trained", value: 10 }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await client.insert(questParty).values({
      id: "team",
      questId: "team-quest",
      leaderId: "one",
      isPublic: true,
      memberIds: ["one", "two"],
      invitedUserIds: [],
      tracker: QuestTracker.parse({
        id: "team-quest",
        goals: [ObjectiveTracker.parse({ id: "goal" })],
      }),
      contributions: {},
    });
    await insertUsers(
      [6, 4].map((value, index) => ({
        userId: index === 0 ? "one" : "two",
        questPartyId: "team",
        questData: [
          QuestTracker.parse({
            id: "team-quest",
            goals: [ObjectiveTracker.parse({ id: "goal", value })],
            party: {
              id: "team",
              generation: 0,
              contributions: [ObjectiveTracker.parse({ id: "goal", value })],
            },
          }),
        ],
      })),
    );
    const loaded = await client.query.questParty.findFirst({
      where: eq(questParty.id, "team"),
      with: questPartyRelations,
    });
    if (!loaded) throw new Error("Missing team fixture");
    await Promise.all([
      synchronizeQuestParty(client, structuredClone(loaded)),
      synchronizeQuestParty(client, structuredClone(loaded)),
    ]);
    const saved = await client.query.questParty.findFirst({
      where: eq(questParty.id, "team"),
    });
    expect(saved?.tracker.goals[0]?.value).toBe(10);
    expect(saved?.tracker.goals[0]?.done).toBe(true);
    expect(saved?.version).toBe(1);
  });

  it.each([true, false])(
    "a completed helper's failure cannot reopen its reward receipt (loaded party: %s)",
    async (hasLoadedParty) => {
      await resetTables(questParty, quest, questHistory, userData);
      const client = await getTestDatabase();
      await insertQuests([{ id: "helper-quest", questType: "event" }]);
      await client.insert(questParty).values({
        id: "team",
        questId: "helper-quest",
        leaderId: "helper",
        memberIds: ["helper"],
        invitedUserIds: [],
        tracker: QuestTracker.parse({ id: "helper-quest" }),
        contributions: {},
      });
      await insertUsers([{ userId: "helper", questPartyId: "team", money: 100 }]);
      await insertQuestHistory([
        {
          id: "receipt",
          userId: "helper",
          questId: "helper-quest",
          questType: "event",
          completed: 1,
          previousCompletes: 1,
          endAt: new Date(),
        },
      ]);
      const [helper, party] = await Promise.all([
        client.query.userData.findFirst({ where: eq(userData.userId, "helper") }),
        client.query.questParty.findFirst({
          where: eq(questParty.id, "team"),
          with: questPartyRelations,
        }),
      ]);
      if (!helper || !party) throw new Error("Missing helper fixture");
      const projection = {
        id: "party-team",
        userId: "helper",
        questId: "helper-quest",
        questType: "event",
        completed: 0,
        startedAt: new Date(),
        endAt: null,
        previousCompletes: 0,
        previousAttempts: 0,
        quest: party.quest,
      } as const;
      const tracker = projectPartyTracker(party);
      const user = {
        ...helper,
        questParty: hasLoadedParty ? party : undefined,
        questData: [tracker],
        userQuests: [projection],
        completedQuests: [{ id: "receipt", questId: "helper-quest", completed: 1 }],
        items: [],
      } as NonNullable<UserWithRelations>;
      const result = await commitQuestObjectiveRewards({
        client,
        userId: helper.userId,
        user,
        userQuest: projection,
        trackers: [tracker],
        rewards: PostProcessedRewardSchema.parse({}),
        resolved: false,
        notifications: [],
        consequences: [{ type: "fail_quest", ids: ["helper-quest"] }],
      });
      expect(result.outcome).toBe("claimed");
      const receipt = await client.query.questHistory.findFirst({
        where: eq(questHistory.id, "receipt"),
      });
      expect(receipt?.completed).toBe(1);
      expect(receipt?.previousCompletes).toBe(1);
      expect(
        (
          await client.query.userData.findFirst({
            where: eq(userData.userId, "helper"),
          })
        )?.money,
      ).toBe(100);
    },
  );
});

it("retries departure after a concurrent personal update and saves shared progress with the detach", async () => {
  const tracker = QuestTracker.parse({
    id: "quest",
    goals: [ObjectiveTracker.parse({ id: "goal", done: true, value: 10 })],
  });
  const party = { id: "party", questId: "quest", tracker };
  const first = {
    questPartyId: "party",
    updatedAt: new Date(1000),
    questData: [projectPartyTracker(party)],
  };
  const next = {
    ...first,
    updatedAt: new Date(2000),
    questData: [
      ...first.questData,
      QuestTracker.parse({
        id: "other",
        goals: [ObjectiveTracker.parse({ id: "other-goal", value: 7 })],
      }),
    ],
  };
  let reads = 0,
    writes = 0;
  const updates: Record<string, unknown>[] = [];
  const client = {
    query: { userData: { findFirst: async () => (++reads === 1 ? first : next) } },
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push(set);
        return { where: async () => ({ rowsAffected: ++writes === 1 ? 0 : 1 }) };
      },
    }),
  } as unknown as DrizzleClient;
  await saveQuestPartyMember(client, party, "one", true);
  expect(writes).toBe(2);
  expect(updates[1]?.questPartyId).toBeNull();
  expect(updates[1]?.updatedAt).toBeInstanceOf(Date);
  expect((updates[1]!.questData as typeof next.questData)[0]).toEqual(
    next.questData[1],
  );
  expect((updates[1]!.questData as typeof next.questData)[1]?.goals[0]).toMatchObject({
    done: true,
    value: 10,
  });
  expect((updates[1]!.questData as typeof next.questData)[1]?.party).toBeUndefined();
});
