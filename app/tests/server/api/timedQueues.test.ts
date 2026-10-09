// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  bloodline,
  craftingRequirement,
  item,
  jutsu,
  trainingLog,
  userCraftingQueue,
  userData,
  userItem,
  userJutsu,
  userJutsuTrainingQueue,
  userVote,
} from "@/drizzle/schema";
import { calcJutsuTrainCost, calcJutsuTrainTime } from "@/libs/train";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { occupationRouter } from "@/server/api/routers/occupation";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import {
  settleCraftingQueue,
  settleJutsuTrainingQueue,
} from "@/server/utils/timedQueue";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "queuer";
const MINUTE = 60_000;
const START_MONEY = 100_000;
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

const jutsuRow = (id: string, patch: Partial<typeof jutsu.$inferInsert> = {}) => ({
  id,
  name: `Jutsu ${id}`,
  description: id,
  battleDescription: id,
  effects: [],
  target: "SELF" as const,
  range: 0,
  requiredRank: "STUDENT" as const,
  jutsuRank: "D" as const,
  jutsuType: "NORMAL" as const,
  image: `/${id}.png`,
  ...patch,
});

const insertUser = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Queuer",
      status: "AWAKE",
      rank: "GENIN",
      level: 20,
      isOutlaw: true,
      money: START_MONEY,
      federalStatus: "NONE",
      ...patch,
    } as never,
  ]);
  // fetchUpdatedUser creates a missing vote row, and parallel requests would race on it
  const database = await getTestDatabase();
  await database
    .insert(userVote)
    .values({ id: "vote-queuer", userId: USER_ID, secret: "secret01", lastVoteAt: new Date() });
};

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database.select().from(userData).where(eq(userData.userId, USER_ID));
  if (!user) throw new Error("user missing");
  return user;
};

const readUserJutsu = async (jutsuId: string) => {
  const database = await getTestDatabase();
  const [row] = await database
    .select()
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, USER_ID), eq(userJutsu.jutsuId, jutsuId)));
  return row;
};

const readJutsuQueue = async () => {
  const database = await getTestDatabase();
  return database
    .select()
    .from(userJutsuTrainingQueue)
    .where(eq(userJutsuTrainingQueue.userId, USER_ID))
    .orderBy(userJutsuTrainingQueue.startsAt);
};

const queueJutsu = async (
  id: string,
  jutsuId: string,
  startsAt: Date,
  patch: Partial<typeof userJutsuTrainingQueue.$inferInsert> = {},
) => {
  const database = await getTestDatabase();
  await database.insert(userJutsuTrainingQueue).values({
    id,
    userId: USER_ID,
    jutsuId,
    reservedRyo: 500,
    durationSeconds: 60,
    startsAt,
    finishesAt: new Date(startsAt.getTime() + 60_000),
    ...patch,
  });
};

/** jutsu-a is in training until `finishTraining`. */
const trainingJutsuA = async (finishTraining: Date) => {
  const database = await getTestDatabase();
  await database.insert(jutsu).values([jutsuRow("jutsu-a"), jutsuRow("jutsu-b")]);
  await database.insert(userJutsu).values({
    id: "uj-a",
    userId: USER_ID,
    jutsuId: "jutsu-a",
    level: 2,
    finishTraining,
  });
};

describeWithDatabase("jutsu training queue", () => {
  beforeEach(async () => {
    await resetTables(userJutsuTrainingQueue, userJutsu, jutsu, userVote, userData, bloodline);
  });

  it("queues a level behind the active training and reserves its ryo", async () => {
    await insertUser();
    const finish = minutesFromNow(10);
    await trainingJutsuA(finish);
    const result = await (await callerFor(jutsuRouter, USER_ID)).startTraining({
      jutsuId: "jutsu-b",
    });
    expect(result.success).toBe(true);
    const cost = calcJutsuTrainCost(jutsuRow("jutsu-b") as never, 0);
    const [queued] = await readJutsuQueue();
    expect(queued?.reservedRyo).toBe(cost);
    expect(queued?.startsAt).toEqual(finish);
    expect((await readUser()).money).toBe(START_MONEY - cost);
    // Nothing is learned until the level starts.
    expect(await readUserJutsu("jutsu-b")).toBeUndefined();
  });

  it("rejects levels beyond the federal queue capacity without charging", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-a", minutesFromNow(10));
    const result = await (await callerFor(jutsuRouter, USER_ID)).startTraining({
      jutsuId: "jutsu-b",
    });
    expect(result).toMatchObject({ success: false, message: "Your jutsu training queue is full" });
    expect((await readUser()).money).toBe(START_MONEY);
    expect(await readJutsuQueue()).toHaveLength(1);
  });

  it("allows a waiting slot per federal tier", async () => {
    await insertUser({ federalStatus: "GOLD" });
    await trainingJutsuA(minutesFromNow(10));
    const caller = await callerFor(jutsuRouter, USER_ID);
    for (let i = 0; i < 4; i++) {
      expect((await caller.startTraining({ jutsuId: "jutsu-b" })).success).toBe(true);
    }
    expect((await caller.startTraining({ jutsuId: "jutsu-b" })).success).toBe(false);
    const queue = await readJutsuQueue();
    expect(queue).toHaveLength(4);
    // Each queued level is priced at the level it trains, and the levels run back to back.
    expect(queue.map((entry) => entry.reservedRyo)).toEqual(
      [0, 1, 2, 3].map((level) => calcJutsuTrainCost(jutsuRow("jutsu-b") as never, level)),
    );
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i]?.startsAt).toEqual(queue[i - 1]?.finishesAt);
    }
  });

  it("starts queued levels back to back from when the previous training finished", async () => {
    await insertUser();
    const finished = minutesFromNow(-30);
    await trainingJutsuA(finished);
    await queueJutsu("q-1", "jutsu-b", finished);
    await queueJutsu("q-2", "jutsu-a", minutesFromNow(-29));
    const client = await getTestDatabase();
    expect(await settleJutsuTrainingQueue(client, USER_ID)).toBe(2);
    const user = await readUser();
    const learned = await readUserJutsu("jutsu-b");
    const firstFinish = finished.getTime() + calcJutsuTrainTime(jutsuRow("jutsu-b"), 0, user);
    expect(learned?.level).toBe(1);
    expect(learned?.finishTraining?.getTime()).toBe(firstFinish);
    const leveled = await readUserJutsu("jutsu-a");
    expect(leveled?.level).toBe(3);
    expect(leveled?.finishTraining?.getTime()).toBe(
      firstFinish + calcJutsuTrainTime(jutsuRow("jutsu-a"), 2, user),
    );
    expect(await readJutsuQueue()).toEqual([]);
    // The level-0 price is below the 500 ryo reserved; the difference comes back.
    const refund =
      500 - calcJutsuTrainCost(jutsuRow("jutsu-b") as never, 0) +
      (500 - calcJutsuTrainCost(jutsuRow("jutsu-a") as never, 2));
    expect(user.money).toBe(START_MONEY + refund);
  });

  it("starts a queued level once under concurrent settlement", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(-5));
    await queueJutsu("q-1", "jutsu-a", minutesFromNow(-5), { reservedRyo: 1 });
    const client = await getTestDatabase();
    const started = await Promise.all(
      Array.from({ length: 4 }, () => settleJutsuTrainingQueue(client, USER_ID)),
    );
    expect(started.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect((await readUserJutsu("jutsu-a"))?.level).toBe(3);
    expect(await readJutsuQueue()).toEqual([]);
  });

  it("moves waiting levels behind a running training instead of starting them", async () => {
    await insertUser();
    const finish = minutesFromNow(20);
    await trainingJutsuA(finish);
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(-1));
    expect(await settleJutsuTrainingQueue(await getTestDatabase(), USER_ID)).toBe(0);
    const [queued] = await readJutsuQueue();
    expect(queued?.startsAt).toEqual(finish);
  });

  it("refunds a cancelled level and moves the rest up", async () => {
    await insertUser();
    const finish = minutesFromNow(10);
    await trainingJutsuA(finish);
    await queueJutsu("q-1", "jutsu-b", finish, { reservedRyo: 700 });
    await queueJutsu("q-2", "jutsu-a", new Date(finish.getTime() + 60_000));
    const caller = await callerFor(jutsuRouter, USER_ID);
    const result = await caller.cancelQueuedTraining({ queueId: "q-1" });
    expect(result.success).toBe(true);
    expect((await readUser()).money).toBe(START_MONEY + 700);
    const queue = await readJutsuQueue();
    expect(queue.map((entry) => [entry.id, entry.startsAt])).toEqual([["q-2", finish]]);
    // A second cancellation of the same row refunds nothing.
    expect((await caller.cancelQueuedTraining({ queueId: "q-1" })).success).toBe(false);
    expect((await readUser()).money).toBe(START_MONEY + 700);
  });

  it("starts the next level immediately when the active training is stopped", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(30));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(30));
    const before = Date.now();
    await (await callerFor(jutsuRouter, USER_ID)).stopTraining();
    const learned = await readUserJutsu("jutsu-b");
    const trainTime = calcJutsuTrainTime(jutsuRow("jutsu-b"), 0, await readUser());
    expect(learned?.finishTraining?.getTime()).toBeGreaterThanOrEqual(before + trainTime);
    expect(learned?.finishTraining?.getTime()).toBeLessThan(Date.now() + trainTime);
    expect((await readUserJutsu("jutsu-a"))?.level).toBe(1);
  });

  it("refunds a level the player can no longer train", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(-5));
    const database = await getTestDatabase();
    await database.insert(jutsu).values(jutsuRow("jutsu-bl", { bloodlineId: "bloodline-x" }));
    await queueJutsu("q-1", "jutsu-bl", minutesFromNow(-5), { reservedRyo: 900 });
    expect(await settleJutsuTrainingQueue(database, USER_ID)).toBe(0);
    expect(await readUserJutsu("jutsu-bl")).toBeUndefined();
    expect((await readUser()).money).toBe(START_MONEY + 900);
    expect(await readJutsuQueue()).toEqual([]);
  });

  it("guards forgetting, evolving and transferring a jutsu with queued levels", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-a", minutesFromNow(10));
    const caller = await callerFor(jutsuRouter, USER_ID);
    expect(await caller.forget({ id: "uj-a" })).toMatchObject({
      success: false,
      message: "Cancel queued training of this jutsu before forgetting it",
    });
    expect(
      await caller.transferLevel({
        fromJutsuId: "jutsu-a",
        toJutsuId: "jutsu-b",
        transferLevels: 1,
      }),
    ).toMatchObject({ success: false });
    expect(await readUserJutsu("jutsu-a")).toBeDefined();
  });
});

const CRAFTER = {
  occupation: "CRAFTING",
  craftingExperience: 0,
};

const setupRecipe = async () => {
  await insertItems([
    { id: "ore", name: "Ore", stackSize: 50 },
    {
      id: "blade",
      name: "Blade",
      itemType: "WEAPON",
      canBeCrafted: true,
      craftingExperience: 10,
      stackSize: 1,
    },
  ]);
  const database = await getTestDatabase();
  await database
    .insert(craftingRequirement)
    .values({ id: "req-1", craftItemId: "blade", requirementItemId: "ore", quantity: 3 });
};

const readItems = async () => {
  const database = await getTestDatabase();
  return database.select().from(userItem).where(eq(userItem.userId, USER_ID));
};

const readCraftQueue = async () => {
  const database = await getTestDatabase();
  return database
    .select()
    .from(userCraftingQueue)
    .where(eq(userCraftingQueue.userId, USER_ID));
};

describeWithDatabase("crafting queue", () => {
  beforeEach(async () => {
    await resetTables(userCraftingQueue, craftingRequirement, userItem, item, userVote, userData);
  });

  it("takes the materials of a queued craft and grants output and experience when it starts", async () => {
    await insertUser(CRAFTER);
    await setupRecipe();
    const finish = minutesFromNow(15);
    await insertUserItems([
      { id: "ore-stack", userId: USER_ID, itemId: "ore", quantity: 10 },
      { id: "busy", userId: USER_ID, itemId: "blade", craftingFinishedAt: finish },
    ]);
    const result = await (await callerFor(occupationRouter, USER_ID)).craftItem({
      itemId: "blade",
      quantity: 2,
    });
    expect(result.success).toBe(true);
    const [queued] = await readCraftQueue();
    expect(queued?.startsAt).toEqual(finish);
    expect(queued?.materials).toEqual([
      { userItemId: "ore-stack", itemId: "ore", quantity: 6, storedAtHome: false },
    ]);
    expect((await readItems()).find((row) => row.id === "ore-stack")?.quantity).toBe(4);
    expect((await readUser()).craftingExperience).toBe(0);

    // The running craft finishes; the queued one starts at that moment.
    const database = await getTestDatabase();
    const finished = minutesFromNow(-60);
    await database
      .update(userItem)
      .set({ craftingFinishedAt: finished })
      .where(eq(userItem.id, "busy"));
    await database
      .update(userCraftingQueue)
      .set({ startsAt: finished })
      .where(eq(userCraftingQueue.userId, USER_ID));
    expect(await settleCraftingQueue(database, USER_ID)).toBe(1);
    const outputs = (await readItems()).filter(
      (row) => row.itemId === "blade" && row.id !== "busy",
    );
    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.craftingFinishedAt?.getTime()).toBe(
      finished.getTime() + (queued?.durationSeconds ?? 0) * 1000,
    );
    expect((await readUser()).craftingExperience).toBe(20);
    expect(await readCraftQueue()).toEqual([]);
  });

  it("returns the materials of a cancelled craft", async () => {
    await insertUser(CRAFTER);
    await setupRecipe();
    await insertUserItems([
      { id: "ore-stack", userId: USER_ID, itemId: "ore", quantity: 3 },
      { id: "busy", userId: USER_ID, itemId: "blade", craftingFinishedAt: minutesFromNow(15) },
    ]);
    const caller = await callerFor(occupationRouter, USER_ID);
    expect((await caller.craftItem({ itemId: "blade", quantity: 1 })).success).toBe(true);
    // The emptied stack was deleted, so the ore comes back as a new stack.
    expect((await readItems()).some((row) => row.itemId === "ore")).toBe(false);
    const [queued] = await readCraftQueue();
    const result = await caller.cancelQueuedCraft({ queueId: queued?.id ?? "" });
    expect(result.success).toBe(true);
    const ore = (await readItems()).filter((row) => row.itemId === "ore");
    expect(ore.map((row) => row.quantity)).toEqual([3]);
    expect(await readCraftQueue()).toEqual([]);
    expect((await caller.cancelQueuedCraft({ queueId: queued?.id ?? "" })).success).toBe(
      false,
    );
    expect((await readItems()).filter((row) => row.itemId === "ore")).toHaveLength(1);
  });

  it("starts a queued craft once under concurrent settlement", async () => {
    await insertUser(CRAFTER);
    await setupRecipe();
    const database = await getTestDatabase();
    const finished = minutesFromNow(-10);
    await insertUserItems([
      { id: "busy", userId: USER_ID, itemId: "blade", craftingFinishedAt: finished },
    ]);
    await database.insert(userCraftingQueue).values({
      id: "cq-1",
      userId: USER_ID,
      itemId: "blade",
      quantity: 1,
      materials: [],
      durationSeconds: 60,
      startsAt: finished,
      finishesAt: new Date(finished.getTime() + 60_000),
    });
    const started = await Promise.all(
      Array.from({ length: 4 }, () => settleCraftingQueue(database, USER_ID)),
    );
    expect(started.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect((await readItems()).filter((row) => row.id !== "busy")).toHaveLength(1);
    expect((await readUser()).craftingExperience).toBe(10);
  });
});

describeWithDatabase("mastery training queue", () => {
  beforeEach(async () => {
    await resetTables(trainingLog, userVote, userData);
  });

  it("collects the finished session and starts the queued one when the account refreshes", async () => {
    const startedAt = minutesFromNow(-20);
    await insertUser({
      trainingSpeed: "15min",
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: startedAt,
      masteryTrainingQueue: [{ stat: "genjutsuMastery", speed: "1hr" }],
    });
    await fetchUpdatedUser({ client: await getTestDatabase(), userId: USER_ID });
    const user = await readUser();
    expect(user.ninjutsuMastery).toBeGreaterThan(0);
    expect(user.currentlyTrainingMastery).toBe("genjutsuMastery");
    expect(user.trainingSpeed).toBe("1hr");
    expect(user.masteryTrainingStartedAt?.getTime()).toBe(startedAt.getTime() + 15 * MINUTE);
    expect(user.masteryTrainingQueue).toEqual([]);
    expect(user.dailyTrainings).toBe(1);
    const database = await getTestDatabase();
    const logs = await database
      .select()
      .from(trainingLog)
      .where(eq(trainingLog.userId, USER_ID));
    expect(logs.map((log) => log.stat)).toEqual(["ninjutsuMastery"]);
    // A second refresh has nothing left to settle.
    await fetchUpdatedUser({ client: database, userId: USER_ID, forceRegen: true });
    expect((await readUser()).ninjutsuMastery).toBe(user.ninjutsuMastery);
  });

  it("starts the next queued mastery when the player collects early", async () => {
    await insertUser({
      trainingSpeed: "1hr",
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: minutesFromNow(-10),
      masteryTrainingQueue: [{ stat: "taijutsuMastery", speed: "15min" }],
    });
    const result = await (await callerFor(trainRouter, USER_ID)).stopMasteryTraining({});
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user.currentlyTrainingMastery).toBe("taijutsuMastery");
    expect(user.trainingSpeed).toBe("15min");
    expect(user.masteryTrainingQueue).toEqual([]);
  });

  it("limits waiting masteries to the federal waiting slots", async () => {
    await insertUser({
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: new Date(),
    });
    const caller = await callerFor(trainRouter, USER_ID);
    const one = [{ stat: "genjutsuMastery" as const, speed: "15min" as const }];
    expect(
      (await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries: one }))
        .success,
    ).toBe(true);
    const two = [...one, { stat: "sageMastery" as const, speed: "8hrs" as const }];
    expect(
      await caller.updateMasteryTrainingQueue({ expectedEntries: one, entries: two }),
    ).toMatchObject({ success: false, message: "Mastery queue is full" });
    // A stale view of the queue is rejected rather than overwriting it.
    expect(
      (await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries: [] }))
        .success,
    ).toBe(false);
    expect((await readUser()).masteryTrainingQueue).toEqual(one);
  });

  it("requires an active session to queue behind", async () => {
    await insertUser();
    const result = await (await callerFor(trainRouter, USER_ID)).updateMasteryTrainingQueue({
      expectedEntries: [],
      entries: [{ stat: "genjutsuMastery", speed: "15min" }],
    });
    expect(result).toMatchObject({ success: false });
  });
});
