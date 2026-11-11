import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { questsRouter } from "@/server/api/routers/quests";
import { DialogObjective, InstantWinLoseObjective } from "@/validators/objectives";
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

describeWithDatabase("tutorial conversion receipts", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(questHistory, quest, userData);
    await insertUsers([
      {
        userId: "graduate",
        rank: "GENIN",
        level: 5,
        status: "AWAKE",
        sector: 0,
        isOutlaw: true,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    await insertQuests(
      [TUTORIAL_GENIN_EXAM_QUEST_ID, TUTORIAL_STARTER_QUEST_ID].map((id) => ({
        id,
        questType: "starter" as const,
        consecutiveObjectives: true,
        hidden: false,
        maxAttempts: 1,
        maxCompletes: 1,
        content: {
          objectives: [
            DialogObjective.parse({
              id: "talk",
              task: "dialog",
              nextObjectiveId: [{ text: "Graduate", nextObjectiveId: "win" }],
            }),
            InstantWinLoseObjective.parse({ id: "win", task: "win_quest" }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })),
    );
    await insertQuestHistory(
      [TUTORIAL_GENIN_EXAM_QUEST_ID, TUTORIAL_STARTER_QUEST_ID].map((questId) => ({
        userId: "graduate",
        questId,
        questType: "starter",
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns a graduation receipt only for the first committed Genin completion", async () => {
    const api = await callerFor(questsRouter, "graduate");
    const progress = await api.checkRewards({ questId: TUTORIAL_GENIN_EXAM_QUEST_ID });
    expect(progress.tutorialCompletionId).toBeUndefined();
    const completed = await api.checkRewards({
      questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
      nextObjectiveId: "win",
    });
    expect(completed.success).toBe(true);
    expect(completed.resolved).toBe(true);
    const history = await (await getTestDatabase()).query.questHistory.findFirst({
      where: (row, { eq }) => eq(row.questId, TUTORIAL_GENIN_EXAM_QUEST_ID),
    });
    expect(completed.tutorialCompletionId).toBe(history?.id);
    expect(completed.tutorialCompletionId).toBeDefined();
    const repeated = await api.checkRewards({
      questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
      nextObjectiveId: "win",
    });
    expect(repeated.tutorialCompletionId).toBeUndefined();
  });

  it("does not count the Academy Trials or an invalid claim as graduation", async () => {
    const api = await callerFor(questsRouter, "graduate");
    const other = await api.checkRewards({
      questId: TUTORIAL_STARTER_QUEST_ID,
      nextObjectiveId: "win",
    });
    expect(other.success).toBe(true);
    expect(other.resolved).toBe(true);
    expect(other.tutorialCompletionId).toBeUndefined();
    expect(
      (await api.checkRewards({ questId: "missing" })).tutorialCompletionId,
    ).toBeUndefined();
  });

  it("returns one receipt when graduation is claimed concurrently", async () => {
    const api = await callerFor(questsRouter, "graduate");
    const results = await Promise.all([
      api.checkRewards({
        questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
        nextObjectiveId: "win",
      }),
      api.checkRewards({
        questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
        nextObjectiveId: "win",
      }),
    ]);
    expect(results.filter((result) => result.tutorialCompletionId)).toHaveLength(1);
  });
});
