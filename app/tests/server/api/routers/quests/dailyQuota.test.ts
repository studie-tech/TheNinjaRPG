import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ERRANDS_PER_DAY,
  MEDICAL_MISSIONS_PER_DAY,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import {
  item,
  overworldAiPlacement,
  overworldAiPlacementQuest,
  quest,
  questHistory,
  userData,
  userItem,
  userQuestAttempt,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { overworldAiRouter } from "@/routers/overworldAi";
import { fetchUpdatedUser } from "@/routers/profile";
import { questsRouter } from "@/routers/quests";
import { assignQuestToUser } from "@/server/utils/questAssignment";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const quotas = [
  { type: "mission", field: "dailyMissions", limit: MISSIONS_PER_DAY, rank: "A" },
  { type: "crime", field: "dailyMissions", limit: MISSIONS_PER_DAY, rank: "A" },
  { type: "errand", field: "dailyErrands", limit: ERRANDS_PER_DAY, rank: "D" },
  {
    type: "medical",
    field: "dailyMedicalMissions",
    limit: MEDICAL_MISSIONS_PER_DAY,
    rank: "D",
  },
  { type: "pvp", field: "dailyPvpMissions", limit: PVP_MISSIONS_PER_DAY, rank: "S" },
] as const;
const content = {
  objectives: [
    SimpleObjective.parse({ id: "train", task: "stats_trained", value: 100 }),
  ],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: [],
};

const readUser = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, "hero"),
  });

describeWithDatabase("daily quest acquisition quotas", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      overworldAiPlacementQuest,
      overworldAiPlacement,
      userQuestAttempt,
      questHistory,
      quest,
      userItem,
      item,
      villageStructure,
      village,
      userData,
    );
    await insertUsers([
      {
        userId: "hero",
        rank: "ELITE JONIN",
        level: 100,
        status: "AWAKE",
        villageId: "home",
        sector: 0,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    const database = await getTestDatabase();
    await database
      .insert(village)
      .values({ id: "home", name: "Home", sector: 0, kageId: "kage" });
    await database.insert(villageStructure).values({
      id: "hall",
      villageId: "home",
      name: "Mission Hall",
      route: "/missionhall",
      image: "",
      curSp: 1000,
    });
    await insertQuests(
      quotas.map(({ type, rank }) => ({
        id: type,
        name: type,
        questType: type,
        questRank: rank,
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content,
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([...quotas])(
    "allows the final random $type slot and rejects at/above its cap",
    async ({ type, field, limit, rank }) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ [field]: limit - 1, isOutlaw: type === "crime" })
        .where(eq(userData.userId, "hero"));
      const api = await callerFor(questsRouter, "hero");
      const input = {
        type,
        rank,
        userLevel: 100,
        userSector: 0,
        userVillageId: "home",
      };
      const started = await api.startRandom(input);
      expect(started.success).toBe(true);
      expect(started.userPatch?.[field]).toBe(limit);
      expect((await readUser())?.[field]).toBe(limit);
      expect((await api.abandon({ id: type })).success).toBe(true);
      const history = await database.query.questHistory.findFirst({
        where: eq(questHistory.questId, type),
      });
      for (const count of [limit, limit + 2]) {
        await database
          .update(userData)
          .set({ [field]: count })
          .where(eq(userData.userId, "hero"));
        expect(await api.startRandom(input)).toMatchObject({
          success: false,
          message: expect.stringContaining("daily"),
        });
        expect((await readUser())?.[field]).toBe(count);
        expect(
          await database.query.questHistory.findFirst({
            where: eq(questHistory.questId, type),
          }),
        ).toEqual(history);
      }
    },
  );

  it.each(quotas.filter(({ type }) => type !== "errand"))(
    "enforces the specific $type start exposed through MCP",
    async ({ type, field, limit }) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ [field]: limit - 1, isOutlaw: true })
        .where(eq(userData.userId, "hero"));
      const api = await callerFor(questsRouter, "hero");
      expect((await api.startQuest({ questId: type, userSector: 0 })).success).toBe(
        true,
      );
      expect((await readUser())?.[field]).toBe(limit);
      expect((await api.abandon({ id: type })).success).toBe(true);
      const history = await database.query.questHistory.findFirst({
        where: eq(questHistory.questId, type),
      });
      expect(await api.startQuest({ questId: type, userSector: 0 })).toMatchObject({
        success: false,
        message: expect.stringContaining("daily"),
      });
      expect((await readUser())?.[field]).toBe(limit);
      expect(
        await database.query.questHistory.findFirst({
          where: eq(questHistory.questId, type),
        }),
      ).toEqual(history);
    },
  );

  it.each([...quotas])(
    "commits recovery with the final $type slot before publishing history",
    async ({ type, field, limit, rank }) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({
          status: "ASLEEP",
          autoWakeUp: true,
          [field]: limit - 1,
          isOutlaw: type === "crime",
        })
        .where(eq(userData.userId, "hero"));
      const interleaved = beforeStatements(database, questHistory, [
        async () => {
          expect(await readUser()).toMatchObject({ status: "AWAKE", [field]: limit });
          await database
            .update(userData)
            .set({ autoWakeUp: false })
            .where(eq(userData.userId, "hero"));
        },
      ]);
      const result = await callerForDatabase(
        questsRouter,
        "hero",
        interleaved,
      ).startRandom({
        type,
        rank,
        userLevel: 100,
        userSector: 0,
        userVillageId: "home",
      });
      expect(result).toMatchObject({
        success: true,
        actionNotice: "This action woke you up.",
      });
      expect(result.userPatch?.[field]).toBe(limit);
      expect(result.userRecovery?.activity).toMatchObject({
        status: "AWAKE",
        battleId: null,
      });
      expect(await readUser()).toMatchObject({
        status: "AWAKE",
        autoWakeUp: false,
        [field]: limit,
      });
      expect((await readUser())?.questData).toMatchObject([{ id: type }]);
      expect(await database.query.questHistory.findMany()).toMatchObject([
        { questId: type, previousAttempts: 1 },
      ]);
    },
  );

  it("grants only one mission/crime when stale requests compete for the last shared slot", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ dailyMissions: MISSIONS_PER_DAY - 1, isOutlaw: true })
      .where(eq(userData.userId, "hero"));
    const { user } = await fetchUpdatedUser({ client: database, userId: "hero" });
    const definitions = await database.query.quest.findMany();
    const results = await Promise.all(
      ["mission", "crime"].map((type) =>
        assignQuestToUser({
          client: database,
          user: structuredClone(user!),
          quest: definitions.find((row) => row.id === type)!,
          source: type === "mission" ? "ui" : "overworld_npc",
          prevAttempt: undefined,
        }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toMatchObject([
      { message: expect.stringContaining("daily") },
    ]);
    expect((await readUser())?.dailyMissions).toBe(MISSIONS_PER_DAY);
    expect(await database.query.questHistory.findMany()).toHaveLength(1);
  });

  it("does not spend an NPC roll or cooldown on a quest whose daily quota is exhausted", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "npc", username: "npc", isAi: true }]);
    await database
      .update(userData)
      .set({ dailyMissions: MISSIONS_PER_DAY })
      .where(eq(userData.userId, "hero"));
    await database
      .update(quest)
      .set({ attemptDelay: "daily" })
      .where(eq(quest.id, "mission"));
    const hero = await readUser();
    await database.insert(overworldAiPlacement).values({
      id: "giver",
      aiTemplateUserId: "npc",
      interactionType: "FRIENDLY",
      sectorList: [0],
      sector: 0,
      longitude: hero!.longitude,
      latitude: hero!.latitude,
    });
    await database
      .insert(overworldAiPlacementQuest)
      .values({ placementId: "giver", questId: "mission", chance: 100 });
    const api = await callerFor(overworldAiRouter, "hero");
    expect(
      await api.interactWithOverworldAi({ placementId: "giver", positionVersion: 0 }),
    ).toMatchObject({
      success: true,
      message: "The NPC has nothing available for you right now.",
    });
    expect((await readUser())?.dailyOverworldQuestRolls).toBe(0);
    expect(await database.query.userQuestAttempt.findMany()).toHaveLength(0);
    expect(await database.query.questHistory.findMany()).toHaveLength(0);
  });

  it("rolls back a ticketed start when a stale quota has already been consumed", async () => {
    const database = await getTestDatabase();
    await insertItems([{ id: "ticket" }]);
    await insertUserItems([
      { id: "tickets", userId: "hero", itemId: "ticket", quantity: 2 },
    ]);
    await database
      .update(quest)
      .set({ content: { ...content, entryItems: [{ ids: ["ticket"], number: 1 }] } })
      .where(eq(quest.id, "mission"));
    await database
      .update(userData)
      .set({ dailyMissions: MISSIONS_PER_DAY, isOutlaw: true })
      .where(eq(userData.userId, "hero"));
    const { user } = await fetchUpdatedUser({ client: database, userId: "hero" });
    user!.dailyMissions = MISSIONS_PER_DAY - 1;
    const definition = await database.query.quest.findFirst({
      where: eq(quest.id, "mission"),
    });
    const before = await readUser();
    expect(
      await assignQuestToUser({
        client: database,
        user: user!,
        quest: definition!,
        source: "ui",
        prevAttempt: undefined,
      }),
    ).toMatchObject({ success: false, message: expect.stringContaining("daily") });
    expect(await readUser()).toEqual(before);
    expect(await database.query.questHistory.findMany()).toHaveLength(0);
    expect((await database.query.userItem.findFirst())?.quantity).toBe(2);
    expect(user!.dailyMissions).toBe(MISSIONS_PER_DAY - 1);
  });
});
