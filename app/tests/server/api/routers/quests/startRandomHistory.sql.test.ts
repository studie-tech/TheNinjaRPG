import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  quest,
  questHistory,
  userData,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { questsRouter } from "@/routers/quests";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import { aroundStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const input = {
  type: "crime",
  rank: "A",
  userLevel: 50,
  userSector: 0,
  userVillageId: null,
} as const;
const questVersion = new Date("2026-01-01T00:00:00.000Z");
const startedAt = new Date("2026-02-01T00:00:00.000Z");
const endAt = new Date("2026-02-02T00:00:00.000Z");

/** Random starts reuse the history row read with the candidate pool. */
describeWithDatabase("startRandom attempt history", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(questHistory, quest, villageStructure, village, userData);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        sector: 0,
        villageId: null,
        isOutlaw: true,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    await insertQuests([
      {
        id: "crime",
        name: "Crime",
        questType: "crime",
        questRank: "A",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        retryDelay: "daily",
        updatedAt: questVersion,
        content: {
          objectives: [
            SimpleObjective.parse({ id: "train", task: "stats_trained", value: 100 }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("inserts a first attempt for a never-attempted quest", async () => {
    const result = await (await callerFor(questsRouter, "hero")).startRandom(input);
    expect(result).toMatchObject({ success: true, message: "Quest started: Crime" });
    const client = await getTestDatabase();
    const rows = await client.query.questHistory.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "hero",
      questId: "crime",
      questType: "crime",
      completed: 0,
      previousAttempts: 1,
      previousCompletes: 0,
    });
    expect(rows[0]?.endAt).toBeNull();
  });

  it("restarts the closed attempt in place and keeps its lifetime counters", async () => {
    await insertQuestHistory([
      {
        id: "attempt",
        userId: "hero",
        questId: "crime",
        questType: "crime",
        startedAt,
        endAt,
        completed: 1,
        previousCompletes: 3,
        previousAttempts: 4,
        periodCompletes: 0,
        periodStartAt: null,
        entryPaid: true,
        isolated: true,
        questVersion: new Date("2025-01-01T00:00:00.000Z"),
      },
    ]);
    const client = await getTestDatabase();
    let historyInserts = 0;
    const counted = aroundStatements(
      client,
      questHistory,
      (run) => {
        historyInserts += 1;
        return run();
      },
      { operations: ["insert"] },
    );
    const result = await callerForDatabase(questsRouter, "hero", counted).startRandom(
      input,
    );
    expect(result).toMatchObject({ success: true, message: "Quest started: Crime" });
    expect(historyInserts).toBe(0);
    const rows = await client.query.questHistory.findMany();
    expect(rows).toHaveLength(1);
    const saved = rows[0]!;
    expect(saved).toMatchObject({
      id: "attempt",
      completed: 0,
      previousCompletes: 3,
      previousAttempts: 5,
      entryPaid: false,
      isolated: false,
    });
    expect(saved.endAt).toBeNull();
    expect(saved.startedAt.getTime()).toBeGreaterThan(startedAt.getTime());
    expect(saved.questVersion?.getTime()).toBe(questVersion.getTime());
    const user = await client.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    });
    expect(user?.questData).toMatchObject([{ id: "crime" }]);
  });

  it("refuses a start while an attempt of the same type is open", async () => {
    await insertQuestHistory([
      {
        id: "attempt",
        userId: "hero",
        questId: "crime",
        questType: "crime",
        startedAt,
        endAt: null,
        completed: 0,
        previousCompletes: 1,
        previousAttempts: 2,
        entryPaid: true,
        questVersion,
      },
    ]);
    expect(
      await (await callerFor(questsRouter, "hero")).startRandom(input),
    ).toMatchObject({ success: false });
    const client = await getTestDatabase();
    expect(await client.query.questHistory.findFirst()).toMatchObject({
      previousAttempts: 2,
      entryPaid: true,
    });
  });

  it("applies the attempt's period counters when choosing candidates", async () => {
    await insertQuestHistory([
      {
        id: "attempt",
        userId: "hero",
        questId: "crime",
        questType: "crime",
        startedAt,
        endAt,
        completed: 1,
        previousCompletes: 1,
        previousAttempts: 1,
        periodCompletes: 100,
        periodStartAt: new Date(),
      },
    ]);
    expect(await (await callerFor(questsRouter, "hero")).startRandom(input)).toEqual({
      success: false,
      message: "No assignments at this level could be found",
    });
  });
});
