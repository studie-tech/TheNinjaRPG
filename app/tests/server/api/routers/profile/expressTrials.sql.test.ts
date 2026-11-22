import { beforeEach, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  MAP_WAKE_ISLAND_SECTOR,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import { quest, questHistory, userData, userVote } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { requireUser } from "../../../../setup/userReads";

const USER_ID = "returning";

const objective = (id: string) => ({
  id,
  task: "bank_deposit",
  value: 1,
  description: "",
  successDescription: "",
});

const seed = async () => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Returning",
      status: "AWAKE",
      rank: "STUDENT",
      level: 1,
      playedBefore: true,
      questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals: [] }],
    } as never,
  ]);
  await insertUserVotes([{ userId: USER_ID }]);
  await insertQuests([
    {
      id: TUTORIAL_STARTER_QUEST_ID,
      questType: "story",
      content: { objectives: [objective("starter")] as never },
    },
    {
      id: TUTORIAL_GENIN_EXAM_QUEST_ID,
      questType: "story",
      content: { objectives: [objective("exam")] as never },
    },
  ]);
  await insertQuestHistory([
    { userId: USER_ID, questId: TUTORIAL_STARTER_QUEST_ID, questType: "story" },
  ]);
};

describeWithDatabase("profile startExpressTrials", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userVote, userData);
  });

  it("hands out the Road to Genin and returns it in the profile patch", async () => {
    await seed();
    const caller = await callerFor(profileRouter, USER_ID);
    const result = await caller.startExpressTrials({ step: 33 });
    expect(result.success).toBe(true);

    const database = await getTestDatabase();
    const history = await database
      .select()
      .from(questHistory)
      .where(eq(questHistory.userId, USER_ID));
    expect(
      history.find((row) => row.questId === TUTORIAL_STARTER_QUEST_ID)?.completed,
    ).toBe(1);
    expect(
      history.find((row) => row.questId === TUTORIAL_GENIN_EXAM_QUEST_ID)?.endAt,
    ).toBeNull();
    const saved = await requireUser(USER_ID);
    expect(saved.questData?.map((tracker) => tracker.id)).toEqual([
      TUTORIAL_GENIN_EXAM_QUEST_ID,
    ]);

    expect(result.userPatch).toMatchObject({
      tutorialStep: 33,
      sector: MAP_WAKE_ISLAND_SECTOR,
      guidanceLevel: "HINTS",
      earnedExperience: saved.earnedExperience,
    });
    expect(result.userPatch?.updatedAt?.getTime()).toBe(saved.updatedAt.getTime());
    expect(result.userPatch?.questData?.map((tracker) => tracker.id)).toEqual([
      TUTORIAL_GENIN_EXAM_QUEST_ID,
    ]);
    expect(result.userPatch?.userQuests?.map((entry) => entry.questId)).toEqual([
      TUTORIAL_GENIN_EXAM_QUEST_ID,
    ]);
  });

  it("rejects a second start once the trials are behind the player", async () => {
    await seed();
    const caller = await callerFor(profileRouter, USER_ID);
    expect((await caller.startExpressTrials({ step: 33 })).success).toBe(true);
    const again = await caller.startExpressTrials({ step: 33 });
    expect(again.success).toBe(false);
    const database = await getTestDatabase();
    const exams = await database
      .select()
      .from(questHistory)
      .where(
        and(
          eq(questHistory.userId, USER_ID),
          eq(questHistory.questId, TUTORIAL_GENIN_EXAM_QUEST_ID),
        ),
      );
    expect(exams).toHaveLength(1);
  });
});
