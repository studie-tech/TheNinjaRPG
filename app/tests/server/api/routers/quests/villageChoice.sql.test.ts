import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData, village } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { villageFullMessage } from "@/libs/villageChoice";
import { questsRouter } from "@/routers/quests";
import { villageRouter } from "@/routers/village";
import { DialogObjective, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

// Akikaze's 30 players this week exceed the quietest village's 1 by more than the ratio
// and the minimum gap, so it closes; Hyorin and Akasumi are the two that always stay open.
const ACTIVE_PLAYERS = { aki: 30, hyo: 2, aka: 1 } as const;

const membershipObjective = (id: string, membership: "AKIKAZE" | "HYORIN") =>
  DialogObjective.parse({
    id,
    task: "dialog",
    description: "Travel home",
    nextObjectiveId: [{ text: "Travel home" }],
    ...ObjectiveReward.parse({ reward_village_membership: membership }),
  });

const content = {
  objectives: [
    DialogObjective.parse({
      id: "choose",
      task: "dialog",
      description: "Which will you call home?",
      nextObjectiveId: [
        { text: "Akikaze", nextObjectiveId: "akikaze" },
        { text: "Hyorin", nextObjectiveId: "hyorin" },
      ],
    }),
    membershipObjective("akikaze", "AKIKAZE"),
    membershipObjective("hyorin", "HYORIN"),
  ],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: [],
};

const readGoals = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({
      where: eq(userData.userId, "genin"),
    })
  )?.questData?.find((tracker) => tracker.id === "exam")?.goals;

describeWithDatabase("village choice for new Genin", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(questHistory, quest, village, userData);
    const database = await getTestDatabase();
    await database.insert(village).values([
      { id: "aki", name: "Akikaze", sector: 1, kageId: "kage" },
      { id: "hyo", name: "Hyorin", sector: 2, kageId: "kage" },
      { id: "aka", name: "Akasumi", sector: 3, kageId: "kage" },
      { id: "horizon", name: "Horizon", sector: 4, kageId: "kage", joinable: false },
    ]);
    await insertUsers([
      ...Object.entries(ACTIVE_PLAYERS).flatMap(([villageId, players]) =>
        Array.from({ length: players }, (_, index) => ({
          userId: `${villageId}-${index}`,
          villageId,
          lastActiveAt: new Date(),
        })),
      ),
      {
        userId: "genin",
        rank: "STUDENT",
        level: 5,
        status: "AWAKE",
        villageId: "horizon",
        lastActiveAt: new Date(),
        questData: [
          QuestTracker.parse({
            id: "exam",
            goals: content.objectives.map((objective) => ({ id: objective.id })),
          }),
        ],
      },
    ]);
    await insertQuests([
      {
        id: "exam",
        name: "Exam",
        questType: "tier",
        consecutiveObjectives: true,
        content,
      },
    ]);
    await insertQuestHistory([
      { userId: "genin", questId: "exam", questType: "tier", startedAt: new Date() },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("marks the busiest village full and the quietest as needing shinobi", async () => {
    const api = await callerFor(villageRouter, "genin");
    expect(await api.getVillageChoices()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Akikaze", isFull: true, needsShinobi: false }),
        expect.objectContaining({ name: "Hyorin", isFull: false, needsShinobi: false }),
        expect.objectContaining({ name: "Akasumi", isFull: false, needsShinobi: true }),
      ]),
    );
  });

  it("refuses an answer into a full village before the dialog advances", async () => {
    const api = await callerFor(questsRouter, "genin");
    expect(
      await api.checkRewards({ questId: "exam", nextObjectiveId: "akikaze" }),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: villageFullMessage("Akikaze"),
      }),
    );
    expect((await readGoals())?.find((goal) => goal.id === "choose")).toEqual(
      expect.objectContaining({ done: false }),
    );
  });

  it("accepts an answer into an open village", async () => {
    const api = await callerFor(questsRouter, "genin");
    expect(
      (await api.checkRewards({ questId: "exam", nextObjectiveId: "hyorin" })).success,
    ).toBe(true);
    expect((await readGoals())?.find((goal) => goal.id === "choose")).toEqual(
      expect.objectContaining({ done: true, selectedNextObjectiveId: "hyorin" }),
    );
  });
});
