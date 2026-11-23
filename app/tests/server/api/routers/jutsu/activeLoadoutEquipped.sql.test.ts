import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import {
  aiProfile,
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
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { profileRouter } from "@/server/api/routers/profile";
import {
  insertItems,
  insertJutsus,
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

const USER_ID = "fresh-student";

/** The loadout the profile points at, which the "No jutsu equipped!" notice reads. */
const activeLoadout = async () => {
  const db = await getTestDatabase();
  const user = await db.query.userData.findFirst({
    where: eq(userData.userId, USER_ID),
    columns: { jutsuLoadout: true },
    with: { loadout: { columns: { jutsuIds: true } } },
  });
  return { id: user?.jutsuLoadout, jutsuIds: user?.loadout?.jutsuIds };
};

const objective = (id: string) => ({
  id,
  task: "bank_deposit",
  value: 1,
  description: "",
  successDescription: "",
});

const seedStudent = async (overrides: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "FreshStudent",
      status: "AWAKE",
      rank: "STUDENT",
      level: 1,
      money: 10_000,
      ...overrides,
    } as never,
  ]);
  await insertUserVotes([{ userId: USER_ID }]);
  await insertJutsus([
    { id: TUTORIAL_JUTSU_ID, name: "Sonic Slash", requiredRank: "STUDENT" },
  ]);
};

describeWithDatabase("the active jutsu loadout lists equipped jutsu", () => {
  beforeEach(async () => {
    await resetTables(
      aiProfile,
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

  it("adds the tutorial jutsu learned after the first loadouts were made", async () => {
    await seedStudent();
    const api = await callerFor(jutsuRouter, USER_ID);
    await api.getLoadouts();
    expect(await activeLoadout()).toEqual({ id: `${USER_ID}-jutsu-0`, jutsuIds: [] });

    const learned = await api.startTraining({ jutsuId: TUTORIAL_JUTSU_ID });
    expect(learned.success, learned.message).toBe(true);
    expect((await activeLoadout()).jutsuIds).toEqual([TUTORIAL_JUTSU_ID]);
  });

  it("lists the Express grant in the loadouts made afterwards", async () => {
    await seedStudent({
      playedBefore: true,
      questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals: [] }],
    });
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
    const express = await (await callerFor(profileRouter, USER_ID)).startExpressTrials({
      step: 33,
    });
    expect(express.success, express.message).toBe(true);

    const rows = await (await callerFor(jutsuRouter, USER_ID)).getLoadouts();
    expect(rows[0]?.jutsuIds).toEqual([TUTORIAL_JUTSU_ID]);
    expect(await activeLoadout()).toEqual({
      id: `${USER_ID}-jutsu-0`,
      jutsuIds: [TUTORIAL_JUTSU_ID],
    });
  });

  it("lists a jutsu learned while no loadout was active once one becomes active", async () => {
    await seedStudent();
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values([
      { id: "first", userId: USER_ID, jutsuIds: [], createdAt: new Date("2026-01-01") },
      {
        id: "second",
        userId: USER_ID,
        jutsuIds: [],
        createdAt: new Date("2026-01-02"),
      },
    ]);
    const api = await callerFor(jutsuRouter, USER_ID);
    expect((await api.startTraining({ jutsuId: TUTORIAL_JUTSU_ID })).success).toBe(
      true,
    );
    expect(await activeLoadout()).toEqual({ id: null, jutsuIds: undefined });

    const rows = await api.getLoadouts();
    expect(rows.map((row) => [row.id, row.jutsuIds])).toEqual([
      ["first", [TUTORIAL_JUTSU_ID]],
      ["second", []],
    ]);
    expect(await activeLoadout()).toEqual({
      id: "first",
      jutsuIds: [TUTORIAL_JUTSU_ID],
    });
  });

  it("repairs an empty active loadout whose equipped jutsu never reached it", async () => {
    await seedStudent({ jutsuLoadout: "main" });
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values([
      { id: "main", userId: USER_ID, jutsuIds: [] },
      { id: "spare", userId: USER_ID, jutsuIds: [] },
    ]);
    await db.insert(userJutsu).values({
      id: "owned",
      userId: USER_ID,
      jutsuId: TUTORIAL_JUTSU_ID,
      equipped: true,
    });

    const rows = await (await callerFor(jutsuRouter, USER_ID)).getLoadouts();
    expect(rows.find((row) => row.id === "main")?.jutsuIds).toEqual([
      TUTORIAL_JUTSU_ID,
    ]);
    expect(rows.find((row) => row.id === "spare")?.jutsuIds).toEqual([]);
    expect(await activeLoadout()).toEqual({
      id: "main",
      jutsuIds: [TUTORIAL_JUTSU_ID],
    });
  });

  it("leaves an empty active loadout empty when nothing is equipped", async () => {
    await seedStudent({ jutsuLoadout: "main" });
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values({ id: "main", userId: USER_ID, jutsuIds: [] });
    await db.insert(userJutsu).values({
      id: "owned",
      userId: USER_ID,
      jutsuId: TUTORIAL_JUTSU_ID,
      equipped: false,
    });

    await (await callerFor(jutsuRouter, USER_ID)).getLoadouts();
    expect(await activeLoadout()).toEqual({ id: "main", jutsuIds: [] });
  });
});
