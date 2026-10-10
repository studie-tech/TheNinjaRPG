// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { COOKING_BASE_SLOTS, JUTSU_LEVEL_CAP } from "@/drizzle/constants";
import { beforeEach, expect, it } from "vitest";
import {
  bloodline,
  craftingRequirement,
  item,
  jutsu,
  trainingLog,
  userData,
  userItem,
  userJutsu,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { getMasteryQueue } from "@/libs/queue";
import { calcJutsuTrainCost, calcJutsuTrainTime, findJutsuInTraining } from "@/libs/train";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { occupationRouter } from "@/server/api/routers/occupation";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import {
  settleCraftingQueue,
  settleJutsuTrainingQueue,
} from "@/server/utils/userQueue";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { queueMasteries } from "../../setup/queues";
import type { MasteryTrainingQueueEntry } from "@/validators/train";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
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

const insertUser = async ({
  masteryQueue,
  ...patch
}: Record<string, unknown> & { masteryQueue?: MasteryTrainingQueueEntry[] } = {}) => {
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
  if (masteryQueue) await queueMasteries(USER_ID, masteryQueue);
};

const setFederalStatus = async (federalStatus: "NONE" | "NORMAL" | "SILVER" | "GOLD") => {
  const database = await getTestDatabase();
  await database.update(userData).set({ federalStatus }).where(eq(userData.userId, USER_ID));
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

const readQueue = async (kind: (typeof userQueue.$inferSelect)["kind"]) => {
  const database = await getTestDatabase();
  return database
    .select()
    .from(userQueue)
    .where(and(eq(userQueue.userId, USER_ID), eq(userQueue.kind, kind)))
    .orderBy(userQueue.position);
};

const readJutsuQueue = () => readQueue("JUTSU");

/** The live mastery queue, as the client derives it. */
const liveMasteryQueue = async () =>
  getMasteryQueue({ ...(await readUser()), queue: await readQueue("MASTERY") });

/** Next free position of a kind, as `appendQueueEntries` would pick it. */
const nextPosition = async (kind: (typeof userQueue.$inferSelect)["kind"]) =>
  (await readQueue(kind)).reduce((max, row) => Math.max(max, row.position), 0) + 1;

const queueJutsu = async (
  id: string,
  jutsuId: string,
  startsAt: Date,
  patch: Partial<typeof userQueue.$inferInsert> = {},
) => {
  const database = await getTestDatabase();
  await database.insert(userQueue).values({
    id,
    userId: USER_ID,
    kind: "JUTSU",
    position: await nextPosition("JUTSU"),
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
    await resetTables(userQueue, userJutsu, jutsu, userVote, userData, bloodline);
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
    // Only the refund changed the profile, so the client applies it as a delta.
    expect(result.userDelta).toEqual({ money: 700 });
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

  it("queues several successive levels of the same jutsu in one request", async () => {
    await insertUser({ federalStatus: "SILVER" });
    const finish = minutesFromNow(10);
    await trainingJutsuA(finish);
    const caller = await callerFor(jutsuRouter, USER_ID);
    const result = await caller.startTraining({ jutsuId: "jutsu-a", levels: 3 });
    expect(result).toMatchObject({ success: true, message: "Queued Jutsu jutsu-a levels 3-5" });
    const queue = await readJutsuQueue();
    // jutsu-a is at level 2 (in training), so the queued entries train levels 3, 4 and 5.
    const costs = [2, 3, 4].map((level) =>
      calcJutsuTrainCost(jutsuRow("jutsu-a") as never, level),
    );
    expect(queue.map((entry) => entry.reservedRyo)).toEqual(costs);
    expect(queue[0]?.startsAt).toEqual(finish);
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i]?.startsAt).toEqual(queue[i - 1]?.finishesAt);
    }
    expect((await readUser()).money).toBe(START_MONEY - costs.reduce((a, b) => a + b, 0));
    // The queue view reports the level each entry trains to.
    const view = await caller.getTrainingQueue();
    expect(view.waiting.map((entry) => entry.level)).toEqual([3, 4, 5]);
    // A later request for the same jutsu continues from the last queued level.
    await setFederalStatus("GOLD");
    expect(await caller.startTraining({ jutsuId: "jutsu-a" })).toMatchObject({
      success: true,
      message: "Queued Jutsu jutsu-a level 6",
    });
  });

  it("starts the first level and queues the rest when nothing is training", async () => {
    await insertUser({ federalStatus: "NORMAL" });
    const database = await getTestDatabase();
    await database.insert(jutsu).values(jutsuRow("jutsu-b"));
    const result = await (await callerFor(jutsuRouter, USER_ID)).startTraining({
      jutsuId: "jutsu-b",
      levels: 3,
    });
    expect(result.success).toBe(true);
    const learned = await readUserJutsu("jutsu-b");
    expect(learned?.level).toBe(1);
    const queue = await readJutsuQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0]?.startsAt).toEqual(learned?.finishTraining);
    const costs = [0, 1, 2].map((level) =>
      calcJutsuTrainCost(jutsuRow("jutsu-b") as never, level),
    );
    expect(queue.map((entry) => entry.reservedRyo)).toEqual(costs.slice(1));
    expect((await readUser()).money).toBe(START_MONEY - costs.reduce((a, b) => a + b, 0));
  });

  it("rejects more levels than the free queue slots without charging", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(10));
    const result = await (await callerFor(jutsuRouter, USER_ID)).startTraining({
      jutsuId: "jutsu-a",
      levels: 2,
    });
    expect(result).toMatchObject({
      success: false,
      message: "Not enough room in your jutsu training queue for that many levels",
    });
    expect((await readUser()).money).toBe(START_MONEY);
    expect(await readJutsuQueue()).toEqual([]);
  });

  it("rejects levels past the level cap, counting levels already queued", async () => {
    await insertUser({ federalStatus: "GOLD" });
    await trainingJutsuA(minutesFromNow(10));
    const database = await getTestDatabase();
    await database
      .update(userJutsu)
      .set({ level: JUTSU_LEVEL_CAP - 2 })
      .where(eq(userJutsu.id, "uj-a"));
    await queueJutsu("q-1", "jutsu-a", minutesFromNow(10));
    const caller = await callerFor(jutsuRouter, USER_ID);
    expect(await caller.startTraining({ jutsuId: "jutsu-a", levels: 2 })).toMatchObject({
      success: false,
      message: "Only 1 more level of this jutsu can be trained",
    });
    expect((await readUser()).money).toBe(START_MONEY);
    expect((await caller.startTraining({ jutsuId: "jutsu-a" })).success).toBe(true);
    expect(await caller.startTraining({ jutsuId: "jutsu-a" })).toMatchObject({
      success: false,
      message: "Jutsu is already at max level",
    });
    expect(await readJutsuQueue()).toHaveLength(2);
  });

  it("shows the next queued level on the dashboard once its turn has come", async () => {
    await insertUser();
    // Half a minute ago, so the started one-minute level is still running.
    await trainingJutsuA(minutesFromNow(-0.5));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(-0.5));
    const timers = await (await callerFor(profileRouter, USER_ID)).getSidebarTimers();
    expect(timers.jutsuTraining).toMatchObject({ name: "Jutsu jutsu-b", level: 1 });
    expect(timers.jutsuQueue).toEqual({ count: 0, next: null });
    expect(await readJutsuQueue()).toEqual([]);
  });

  it("reports levels waiting behind the active training to the dashboard", async () => {
    await insertUser();
    const finish = minutesFromNow(10);
    await trainingJutsuA(finish);
    await queueJutsu("q-1", "jutsu-b", finish);
    const timers = await (await callerFor(profileRouter, USER_ID)).getSidebarTimers();
    expect(timers.jutsuTraining).toMatchObject({ name: "Jutsu jutsu-a", level: 2 });
    expect(timers.jutsuQueue).toEqual({
      count: 1,
      next: { name: "Jutsu jutsu-b", level: 1, startsAt: finish },
    });
  });

  it("does not overfill the queue under concurrent requests", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(10));
    const caller = await callerFor(jutsuRouter, USER_ID);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => caller.startTraining({ jutsuId: "jutsu-b" })),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await readJutsuQueue()).toHaveLength(1);
    const cost = calcJutsuTrainCost(jutsuRow("jutsu-b") as never, 0);
    expect((await readUser()).money).toBe(START_MONEY - cost);
  });

  it("refunds a level once under concurrent cancellations", async () => {
    await insertUser();
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(10), { reservedRyo: 700 });
    const caller = await callerFor(jutsuRouter, USER_ID);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => caller.cancelQueuedTraining({ queueId: "q-1" })),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await readUser()).money).toBe(START_MONEY + 700);
    expect(await readJutsuQueue()).toEqual([]);
  });

  it("either starts or refunds a due level when cancellation and settlement race", async () => {
    await insertUser();
    const finished = minutesFromNow(-5);
    await trainingJutsuA(finished);
    await queueJutsu("q-1", "jutsu-b", finished, { reservedRyo: 700 });
    const database = await getTestDatabase();
    const caller = await callerFor(jutsuRouter, USER_ID);
    const [cancelled, started] = await Promise.all([
      caller.cancelQueuedTraining({ queueId: "q-1" }),
      settleJutsuTrainingQueue(database, USER_ID),
    ]);
    const learned = await readUserJutsu("jutsu-b");
    const money = (await readUser()).money;
    if (cancelled.success) {
      expect(started).toBe(0);
      expect(learned).toBeUndefined();
      expect(money).toBe(START_MONEY + 700);
    } else {
      expect(started).toBe(1);
      expect(learned?.level).toBe(1);
      const cost = calcJutsuTrainCost(jutsuRow("jutsu-b") as never, 0);
      expect(money).toBe(START_MONEY + 700 - cost);
    }
    expect(await readJutsuQueue()).toEqual([]);
  });

  it("shows the next active jutsu when ownership is read after queue settlement", async () => {
    await insertUser();
    const finished = minutesFromNow(-0.5);
    await trainingJutsuA(finished);
    await queueJutsu("q-1", "jutsu-b", finished);
    const caller = await callerFor(jutsuRouter, USER_ID);
    expect((await caller.getTrainingQueue()).waiting).toEqual([]);
    const owned = await caller.getUserJutsus({});
    expect(findJutsuInTraining(owned, Date.now())?.jutsuId).toBe("jutsu-b");
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

const readCraftQueue = () => readQueue("CRAFT");

describeWithDatabase("crafting queue", () => {
  beforeEach(async () => {
    await resetTables(userQueue, craftingRequirement, userItem, item, userVote, userData);
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
      { userItemId: "ore-stack", itemId: "ore", name: "Ore", quantity: 6, storedAtHome: false },
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
      .update(userQueue)
      .set({ startsAt: finished })
      .where(and(eq(userQueue.userId, USER_ID), eq(userQueue.kind, "CRAFT")));
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

  it("returns the materials of a queued cooking craft that no longer fits the bucket", async () => {
    await insertUser(CRAFTER);
    await insertItems([
      { id: "ore", name: "Ore", stackSize: 50 },
      { id: "stew", name: "Stew", itemType: "COOKING", canBeCrafted: true, stackSize: 1 },
    ]);
    // The carried cooking bucket filled up while the craft was waiting.
    await insertUserItems(
      Array.from({ length: COOKING_BASE_SLOTS }, (_, i) => ({
        id: `stew-${i}`,
        userId: USER_ID,
        itemId: "stew",
        quantity: 1,
      })),
    );
    const database = await getTestDatabase();
    const startsAt = minutesFromNow(-1);
    await database.insert(userQueue).values({
      id: "cq-1",
      userId: USER_ID,
      kind: "CRAFT",
      position: 1,
      itemId: "stew",
      quantity: 1,
      materials: [{ userItemId: "gone", itemId: "ore", quantity: 3, storedAtHome: false }],
      durationSeconds: 60,
      startsAt,
      finishesAt: new Date(startsAt.getTime() + 60_000),
    });
    expect(await settleCraftingQueue(database, USER_ID)).toBe(0);
    const items = await readItems();
    expect(items.filter((row) => row.itemId === "stew")).toHaveLength(COOKING_BASE_SLOTS);
    expect(
      items.filter((row) => row.itemId === "ore").reduce((sum, row) => sum + row.quantity, 0),
    ).toBe(3);
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

  it("returns materials once under concurrent cancellations", async () => {
    await insertUser(CRAFTER);
    await setupRecipe();
    await insertUserItems([
      { id: "ore-stack", userId: USER_ID, itemId: "ore", quantity: 10 },
      { id: "busy", userId: USER_ID, itemId: "blade", craftingFinishedAt: minutesFromNow(15) },
    ]);
    const caller = await callerFor(occupationRouter, USER_ID);
    expect((await caller.craftItem({ itemId: "blade", quantity: 1 })).success).toBe(true);
    const [queued] = await readCraftQueue();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => caller.cancelQueuedCraft({ queueId: queued?.id ?? "" })),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const ore = (await readItems()).filter((row) => row.itemId === "ore");
    expect(ore.reduce((sum, row) => sum + row.quantity, 0)).toBe(10);
  });

  it("queues one craft and keeps the other materials under concurrent requests", async () => {
    await insertUser(CRAFTER);
    await setupRecipe();
    await insertUserItems([
      { id: "ore-stack", userId: USER_ID, itemId: "ore", quantity: 30 },
      { id: "busy", userId: USER_ID, itemId: "blade", craftingFinishedAt: minutesFromNow(15) },
    ]);
    const caller = await callerFor(occupationRouter, USER_ID);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => caller.craftItem({ itemId: "blade", quantity: 1 })),
    );
    const queued = await readCraftQueue();
    expect(queued).toHaveLength(results.filter((result) => result.success).length);
    // Every queued craft holds its materials; the rest stayed in the inventory.
    const ore = (await readItems()).filter((row) => row.itemId === "ore");
    const held = queued.reduce(
      (sum, row) => sum + (row.materials ?? []).reduce((total, m) => total + m.quantity, 0),
      0,
    );
    expect(ore.reduce((sum, row) => sum + row.quantity, 0) + held).toBe(30);
  });

  it("starts a queued craft once under concurrent settlement", async () => {
    await insertUser(CRAFTER);
    await setupRecipe();
    const database = await getTestDatabase();
    const finished = minutesFromNow(-10);
    await insertUserItems([
      { id: "busy", userId: USER_ID, itemId: "blade", craftingFinishedAt: finished },
    ]);
    await database.insert(userQueue).values({
      id: "cq-1",
      userId: USER_ID,
      kind: "CRAFT",
      position: 1,
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
    await resetTables(userQueue, trainingLog, userVote, userData);
  });

  it("collects the finished session and starts the queued one when the account refreshes", async () => {
    const startedAt = minutesFromNow(-20);
    await insertUser({
      trainingSpeed: "15min",
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: startedAt,
      masteryQueue: [{ stat: "genjutsuMastery", speed: "1hr" }],
    });
    await fetchUpdatedUser({ client: await getTestDatabase(), userId: USER_ID });
    const user = await readUser();
    expect(user.ninjutsuMastery).toBeGreaterThan(0);
    expect(user.currentlyTrainingMastery).toBe("genjutsuMastery");
    expect(user.trainingSpeed).toBe("1hr");
    expect(user.masteryTrainingStartedAt?.getTime()).toBe(startedAt.getTime() + 15 * MINUTE);
    expect(await liveMasteryQueue()).toEqual([]);
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
      masteryQueue: [{ stat: "taijutsuMastery", speed: "15min" }],
    });
    const result = await (await callerFor(trainRouter, USER_ID)).stopMasteryTraining({ stat: "ninjutsuMastery", startedAt: (await readUser()).masteryTrainingStartedAt! });
    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user.currentlyTrainingMastery).toBe("taijutsuMastery");
    expect(user.trainingSpeed).toBe("15min");
    expect(await liveMasteryQueue()).toEqual([]);
  });

  it("limits waiting masteries to the federal waiting slots", async () => {
    await insertUser({
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: new Date(),
    });
    const caller = await callerFor(trainRouter, USER_ID);
    const one = [{ stat: "genjutsuMastery" as const, speed: "15min" as const }];
    // The first saved refresh assigns the Genin's elements, which needs a full profile read.
    await fetchUpdatedUser({ client: await getTestDatabase(), userId: USER_ID, forceRegen: true });
    const saved = await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries: one });
    expect(saved.success).toBe(true);
    // The saved queue comes back as a cache patch instead of a profile refetch.
    expect(getMasteryQueue(saved.userPatch as never)).toEqual(one);
    const two = [...one, { stat: "sageMastery" as const, speed: "8hrs" as const }];
    expect(
      await caller.updateMasteryTrainingQueue({ expectedEntries: one, entries: two }),
    ).toMatchObject({ success: false, message: "Mastery queue is full" });
    // A stale view of the queue is rejected rather than overwriting it.
    expect(
      (await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries: [] }))
        .success,
    ).toBe(false);
    expect(await liveMasteryQueue()).toEqual(one);
  });

  it("validates a changed entry even when the queue length stays the same", async () => {
    await insertUser({
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: new Date(),
      genjutsuMastery: 1_000_000_000,
    });
    const caller = await callerFor(trainRouter, USER_ID);
    const one = [{ stat: "taijutsuMastery" as const, speed: "15min" as const }];
    expect(
      (await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries: one }))
        .success,
    ).toBe(true);
    expect(
      await caller.updateMasteryTrainingQueue({
        expectedEntries: one,
        entries: [{ stat: "genjutsuMastery", speed: "15min" }],
      }),
    ).toMatchObject({ success: false, message: "A queued mastery is already capped" });
    // Removing entries needs no validation.
    expect(
      (await caller.updateMasteryTrainingQueue({ expectedEntries: one, entries: [] }))
        .success,
    ).toBe(true);
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

describeWithDatabase("lazy queue settlement", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userJutsu, jutsu, trainingLog, userVote, userData, bloodline);
  });

  it("starts a level that came due while offline, backdated, on the next refresh", async () => {
    await insertUser();
    const finished = minutesFromNow(-30);
    await trainingJutsuA(finished);
    await queueJutsu("q-1", "jutsu-b", finished, { reservedRyo: 0 });
    const database = await getTestDatabase();
    const { user } = await fetchUpdatedUser({ client: database, userId: USER_ID });
    const learned = await readUserJutsu("jutsu-b");
    expect(learned?.level).toBe(1);
    // It started when jutsu-a finished, not when the player came back.
    expect(learned?.finishTraining?.getTime()).toBe(
      finished.getTime() + calcJutsuTrainTime(jutsuRow("jutsu-b"), 0, await readUser()),
    );
    expect(await readJutsuQueue()).toEqual([]);
    // The refresh returns the user as it is after the start.
    expect(user?.queue).toEqual([]);
  });

  it("leaves a waiting level alone while the active training runs", async () => {
    await insertUser();
    const finish = minutesFromNow(10);
    await trainingJutsuA(finish);
    await queueJutsu("q-1", "jutsu-b", finish);
    await fetchUpdatedUser({ client: await getTestDatabase(), userId: USER_ID });
    expect((await readJutsuQueue()).map((row) => row.id)).toEqual(["q-1"]);
    expect(await readUserJutsu("jutsu-b")).toBeUndefined();
  });

  it("costs no extra query for queues that are empty or not due", async () => {
    await insertUser();
    const database = await getTestDatabase();
    const refresh = () => fetchUpdatedUser({ client: database, userId: USER_ID });
    await refresh();
    const empty = await recordQueries(refresh);
    // A waiting level behind a running training is only read, inside the user query.
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(10));
    await queueMasteries(USER_ID, [{ stat: "genjutsuMastery", speed: "1hr" }]);
    const waiting = await recordQueries(refresh);
    expect(waiting.statements.length).toBe(empty.statements.length);
    expect([empty.roundTrips, waiting.roundTrips]).toEqual([1, 1]);
    // The rows ride along in the user query rather than a statement of their own.
    expect(
      waiting.statements.filter((sql) => /^select [^()]* from `UserQueue`/i.test(sql)),
    ).toEqual([]);
  });
});

/**
 * Sequential database round trips of the polled and refreshed paths. Function time is
 * billed, so these pin the cost: nothing extra while no job is due, and a bounded
 * settlement when one is.
 */
describeWithDatabase("queue round trips", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userJutsu, jutsu, trainingLog, userVote, userData, bloodline);
  });

  const trips = async (work: () => Promise<unknown>) => (await recordQueries(work)).roundTrips;
  const makeDue = async () => {
    const database = await getTestDatabase();
    await database.update(userJutsu).set({ finishTraining: minutesFromNow(-0.5) });
    await database.update(userQueue).set({ startsAt: minutesFromNow(-0.5) });
  };

  it("fetchUpdatedUser: one round trip unless a job is due", async () => {
    await insertUser();
    const database = await getTestDatabase();
    const refresh = () => fetchUpdatedUser({ client: database, userId: USER_ID });
    await refresh();
    expect(await trips(refresh)).toBe(1);
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(10));
    expect(await trips(refresh)).toBe(1);
    await makeDue();
    // Parallel reads, serialized start transaction (owner lock and fresh deadline), reread.
    expect(await trips(refresh)).toBe(11);
  });

  it("getSidebarTimers: one round trip unless a level is due", async () => {
    await insertUser();
    const timers = async () => (await callerFor(profileRouter, USER_ID)).getSidebarTimers();
    expect(await trips(timers)).toBe(1);
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(10));
    expect(await trips(timers)).toBe(1);
    await makeDue();
    expect(await trips(timers)).toBe(11);
  });

  it("queue views: one round trip per poll unless a job is due", async () => {
    await insertUser();
    const jutsuQueue = async () => (await callerFor(jutsuRouter, USER_ID)).getTrainingQueue();
    const craftQueue = async () =>
      (await callerFor(occupationRouter, USER_ID)).getCraftingQueue();
    expect(await trips(jutsuQueue)).toBe(1);
    expect(await trips(craftQueue)).toBe(1);
    await trainingJutsuA(minutesFromNow(10));
    await queueJutsu("q-1", "jutsu-b", minutesFromNow(10));
    expect(await trips(jutsuQueue)).toBe(1);
    await makeDue();
    expect(await trips(jutsuQueue)).toBe(11);
  });
});
