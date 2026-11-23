import { beforeEach, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  MAP_WAKE_ISLAND_SECTOR,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import {
  item,
  jutsu,
  jutsuLoadout,
  quest,
  questHistory,
  userData,
  userItem,
  userJutsu,
  userVote,
} from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import {
  insertItems,
  insertJutsus,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
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

const seed = async (overrides: { jutsuLoadout?: string } = {}) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Returning",
      status: "AWAKE",
      rank: "STUDENT",
      level: 1,
      playedBefore: true,
      questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals: [] }],
      ...overrides,
    } as never,
  ]);
  await insertUserVotes([{ userId: USER_ID }]);
  await insertJutsus([{ id: TUTORIAL_JUTSU_ID, name: "Sonic Slash" }]);
  await insertItems([
    {
      id: TUTORIAL_ITEM_ID,
      name: "Shuriken",
      itemType: "WEAPON",
      slot: "THROWN",
      canStack: true,
      stackSize: 50,
    },
  ]);
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
    await resetTables(
      questHistory,
      quest,
      userVote,
      userJutsu,
      jutsu,
      userItem,
      item,
      jutsuLoadout,
      userData,
    );
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

  it("grants Sonic Slash equipped and shuriken in a free slot, and returns them", async () => {
    await seed();
    const caller = await callerFor(profileRouter, USER_ID);
    const result = await caller.startExpressTrials({ step: 33 });
    expect(result.success).toBe(true);

    const database = await getTestDatabase();
    const jutsus = await database
      .select()
      .from(userJutsu)
      .where(eq(userJutsu.userId, USER_ID));
    expect(jutsus).toHaveLength(1);
    expect(jutsus[0]).toEqual(
      expect.objectContaining({
        jutsuId: TUTORIAL_JUTSU_ID,
        level: 1,
        equipped: true,
        finishTraining: null,
      }),
    );
    const items = await database
      .select()
      .from(userItem)
      .where(eq(userItem.userId, USER_ID));
    expect(items).toHaveLength(1);
    expect(items[0]?.itemId).toBe(TUTORIAL_ITEM_ID);
    expect(items[0]?.quantity).toBeGreaterThan(0);
    expect(items[0]?.equipped).not.toBe("NONE");

    expect(
      result.userPatch?.items?.map((entry) => [
        entry.id,
        entry.equipped,
        entry.item.id,
      ]),
    ).toEqual([[items[0]?.id ?? "", items[0]?.equipped ?? "NONE", TUTORIAL_ITEM_ID]]);
  });

  it("adds Sonic Slash to the active loadout and projects it", async () => {
    await seed({ jutsuLoadout: "loadout" });
    const database = await getTestDatabase();
    await database
      .insert(jutsuLoadout)
      .values({ id: "loadout", userId: USER_ID, jutsuIds: [] });
    const caller = await callerFor(profileRouter, USER_ID);
    const result = await caller.startExpressTrials({ step: 33 });
    expect(result.success).toBe(true);

    const [saved] = await database
      .select()
      .from(jutsuLoadout)
      .where(eq(jutsuLoadout.id, "loadout"));
    expect(saved?.jutsuIds).toEqual([TUTORIAL_JUTSU_ID]);
    expect(result.userPatch?.loadout).toEqual({ jutsuIds: [TUTORIAL_JUTSU_ID] });
  });

  it("leaves a jutsu and shuriken the player already owns as they are", async () => {
    await seed();
    const database = await getTestDatabase();
    await database.insert(userJutsu).values({
      id: "owned-jutsu",
      userId: USER_ID,
      jutsuId: TUTORIAL_JUTSU_ID,
      level: 2,
      equipped: false,
    });
    await insertUserItems([
      { id: "owned-shuriken", userId: USER_ID, itemId: TUTORIAL_ITEM_ID, quantity: 2 },
    ]);
    const caller = await callerFor(profileRouter, USER_ID);
    expect((await caller.startExpressTrials({ step: 33 })).success).toBe(true);

    const jutsus = await database
      .select()
      .from(userJutsu)
      .where(eq(userJutsu.userId, USER_ID));
    expect(jutsus.map((row) => [row.id, row.level, row.equipped])).toEqual([
      ["owned-jutsu", 2, false],
    ]);
    const items = await database
      .select()
      .from(userItem)
      .where(eq(userItem.userId, USER_ID));
    expect(items.map((row) => [row.id, row.quantity])).toEqual([["owned-shuriken", 2]]);
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
    const [jutsus, items] = await Promise.all([
      database.select().from(userJutsu).where(eq(userJutsu.userId, USER_ID)),
      database.select().from(userItem).where(eq(userItem.userId, USER_ID)),
    ]);
    expect(jutsus).toHaveLength(1);
    expect(items).toHaveLength(1);
  });
});
