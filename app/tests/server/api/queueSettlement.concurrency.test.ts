import { and, eq, gt } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { getUserCaps } from "@/drizzle/constants";
import {
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
import { calcJutsuTrainCost, settleMasteryTrainingQueue } from "@/libs/train";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import type { DrizzleClient } from "@/server/db";
import {
  fetchJutsuTrainingQueue,
  settleCraftingQueue,
  settleJutsuTrainingQueue,
} from "@/server/utils/userQueue";
import { insertItems, insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const userId = "queue-settlement";
const minute = 60_000;
const initialMoney = 100_000;
const jutsuRow = (id: string) => ({
  id,
  name: id,
  description: id,
  battleDescription: id,
  effects: [],
  target: "SELF" as const,
  range: 0,
  requiredRank: "STUDENT" as const,
  jutsuRank: "D" as const,
  jutsuType: "NORMAL" as const,
  image: `/${id}.png`,
});
const costs = [10, 11].map((level) =>
  calcJutsuTrainCost(jutsuRow("b") as never, level),
);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// Alter dispatch timing only: all reads, writes and transactions execute on real MySQL.
const delayQueueRead = (database: DrizzleClient) => {
  const activeRead = deferred();
  const release = deferred();
  const wrapBuilder = <T extends object>(builder: T): T =>
    new Proxy(builder, {
      get(target, property) {
        if (property === "then") {
          return async (
            resolve: (result: unknown) => unknown,
            reject: (error: unknown) => unknown,
          ) => {
            try {
              const result = await (target as unknown as PromiseLike<unknown>);
              activeRead.resolve();
              await release.promise;
              return resolve(result);
            } catch (error) {
              return reject(error);
            }
          };
        }
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === "object" ? wrapBuilder(result) : result;
        };
      },
    });
  const client = new Proxy(database, {
    get(target, property) {
      if (property === "query")
        return {
          ...target.query,
          userQueue: {
            ...target.query.userQueue,
            findMany: async (
              ...args: Parameters<typeof target.query.userQueue.findMany>
            ) => {
              await release.promise;
              return target.query.userQueue.findMany(...args);
            },
          },
        };
      if (property === "select")
        return (...args: unknown[]) =>
          wrapBuilder(Reflect.get(target, property).apply(target, args as never));
      return Reflect.get(target, property);
    },
  });
  return { client, activeRead: activeRead.promise, release: release.resolve };
};

const gateEnqueueWrites = (database: DrizzleClient) => {
  const ready = deferred();
  let arrivals = 0;
  const wrap = <T extends object>(builder: T): T =>
    new Proxy(builder, {
      get(target, property) {
        if (property === "then")
          return async (
            resolve: (value: unknown) => unknown,
            reject: (error: unknown) => unknown,
          ) => {
            arrivals++;
            if (arrivals === 2) ready.resolve();
            await ready.promise;
            try {
              return resolve(await (target as unknown as PromiseLike<unknown>));
            } catch (error) {
              return reject(error);
            }
          };
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === "object" ? wrap(result) : result;
        };
      },
    });
  return new Proxy(database, {
    get(target, property) {
      if (property !== "update") return Reflect.get(target, property);
      return (table: Parameters<typeof target.update>[0]) =>
        table === userData ? wrap(target.update(table)) : target.update(table);
    },
  });
};

const readUser = async () => {
  const database = await getTestDatabase();
  const user = await database.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: { queue: true },
  });
  if (!user) throw new Error("Missing queue owner");
  return user;
};

const seedActiveAndTarget = async () => {
  const database = await getTestDatabase();
  await database.insert(userJutsu).values([
    {
      id: "active",
      userId,
      jutsuId: "a",
      level: 2,
      finishTraining: new Date(Date.now() + 10 * minute),
    },
    { id: "target", userId, jutsuId: "b", level: 10 },
  ]);
};

const seedDueJutsus = async (now: Date) => {
  const database = await getTestDatabase();
  await database
    .insert(userJutsu)
    .values({ id: "finished", userId, jutsuId: "a", level: 2, finishTraining: now });
  await database.insert(userQueue).values(
    ["b", "c"].map((id, index) => ({
      id: `queued-${id}`,
      userId,
      kind: "JUTSU" as const,
      position: index + 1,
      jutsuId: id,
      reservedRyo: 50,
      durationSeconds: 60,
      startsAt: new Date(now.getTime() + index * minute),
      finishesAt: new Date(now.getTime() + (index + 1) * minute),
    })),
  );
};

const activeJutsus = async (now: Date) => {
  const database = await getTestDatabase();
  return database
    .select()
    .from(userJutsu)
    .where(and(eq(userJutsu.userId, userId), gt(userJutsu.finishTraining, now)));
};

const masteryUser = (start: Date) => ({
  userId,
  rank: "GENIN" as const,
  status: "AWAKE" as const,
  isOutlaw: true,
  isBanned: false,
  dailyTrainings: 0,
  trainingSpeed: "15min" as const,
  currentlyTrainingMastery: "ninjutsuMastery" as const,
  masteryTrainingStartedAt: start,
  ninjutsuMastery: 375000 - 0.5,
  genjutsuMastery: 0,
  taijutsuMastery: 0,
  bukijutsuMastery: 0,
  bloodlineMastery: 0,
  sageMastery: 0,
});

const masteryEntries = [
  { stat: "ninjutsuMastery" as const, speed: "24hrs" as const },
  { stat: "genjutsuMastery" as const, speed: "15min" as const },
];

describeWithDatabase("Queue settlement concurrency and caps", () => {
  beforeEach(async () => {
    await resetTables(
      userQueue,
      userJutsu,
      jutsu,
      trainingLog,
      userItem,
      item,
      userVote,
      userData,
    );
    const now = new Date();
    await insertUsers([
      {
        userId,
        username: userId,
        status: "AWAKE",
        rank: "GENIN",
        level: 20,
        isOutlaw: true,
        money: initialMoney,
        federalStatus: "GOLD",
        updatedAt: now,
        regenAt: now,
      },
    ]);
    const database = await getTestDatabase();
    await database.insert(userVote).values({
      id: "queue-settlement-vote",
      userId,
      secret: "secret01",
      lastVoteAt: now,
    });
    await database.insert(jutsu).values([jutsuRow("a"), jutsuRow("b"), jutsuRow("c")]);
  });

  it("sequential jutsu purchases reserve the correct successive prices", async () => {
    await seedActiveAndTarget();
    const caller = await callerFor(jutsuRouter, userId);
    expect((await caller.startTraining({ jutsuId: "b" })).success).toBe(true);
    expect((await caller.startTraining({ jutsuId: "b" })).success).toBe(true);
    const database = await getTestDatabase();
    const queue = await fetchJutsuTrainingQueue(database, userId);
    expect(queue.map((row) => row.reservedRyo)).toEqual(costs);
    expect((await readUser()).money).toBe(
      initialMoney - costs.reduce((sum, cost) => sum + cost, 0),
    );
  });

  it("rejects a stale concurrent enqueue without undercharging", async () => {
    await seedActiveAndTarget();
    const database = await getTestDatabase();
    const caller = callerForDatabase(jutsuRouter, userId, gateEnqueueWrites(database));
    const results = await Promise.all([
      caller.startTraining({ jutsuId: "b" }),
      caller.startTraining({ jutsuId: "b" }),
    ]);
    const before = await fetchJutsuTrainingQueue(database, userId);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(before.map((row) => row.reservedRyo)).toEqual<Array<number | undefined>>([costs[0]]);
    expect((await readUser()).money).toBe(initialMoney - costs[0]!);
  });

  it("repeated settlement reads keep a single jutsu active", async () => {
    const now = new Date();
    await seedDueJutsus(now);
    const database = await getTestDatabase();
    expect(await settleJutsuTrainingQueue(database, userId, now)).toBe(1);
    expect(await settleJutsuTrainingQueue(database, userId, now)).toBe(0);
    expect(await activeJutsus(now)).toHaveLength(1);
    expect(await fetchJutsuTrainingQueue(database, userId)).toHaveLength(1);
  });

  it("serializes jutsu starts despite mixed upfront read snapshots", async () => {
    const now = new Date();
    await seedDueJutsus(now);
    const database = await getTestDatabase();
    const delayed = delayQueueRead(database);
    const second = settleJutsuTrainingQueue(delayed.client, userId, now);
    await delayed.activeRead;
    expect(await settleJutsuTrainingQueue(database, userId, now)).toBe(1);
    expect(await activeJutsus(now)).toHaveLength(1);
    delayed.release();
    expect(await second).toBe(0);
    const active = await activeJutsus(now);
    expect(await fetchJutsuTrainingQueue(database, userId)).toHaveLength(1);
    expect(active).toHaveLength(1);
  });

  it("serializes craft starts despite mixed upfront read snapshots", async () => {
    const now = new Date();
    const database = await getTestDatabase();
    await insertItems([
      {
        id: "blade",
        name: "Blade",
        itemType: "WEAPON",
        canBeCrafted: true,
        craftingExperience: 10,
        stackSize: 1,
      },
    ]);
    await database.insert(userItem).values({
      id: "finished-craft",
      userId,
      itemId: "blade",
      quantity: 1,
      craftingFinishedAt: now,
    });
    await database.insert(userQueue).values(
      [0, 1].map((index) => ({
        id: `craft-${index}`,
        userId,
        kind: "CRAFT" as const,
        position: index + 1,
        itemId: "blade",
        quantity: 1,
        materials: [],
        durationSeconds: 60,
        startsAt: new Date(now.getTime() + index * minute),
        finishesAt: new Date(now.getTime() + (index + 1) * minute),
      })),
    );
    const delayed = delayQueueRead(database);
    const second = settleCraftingQueue(delayed.client, userId, now);
    await delayed.activeRead;
    expect(await settleCraftingQueue(database, userId, now)).toBe(1);
    delayed.release();
    expect(await second).toBe(0);
    const active = await database
      .select()
      .from(userItem)
      .where(and(eq(userItem.userId, userId), gt(userItem.craftingFinishedAt, now)));
    expect((await readUser()).craftingExperience).toBe(10);
    expect(active).toHaveLength(1);
  });

  it("skips a queued repeat capped by the completed session on profile refresh", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set(masteryUser(new Date()))
      .where(eq(userData.userId, userId));
    const saved = await (
      await callerFor(trainRouter, userId)
    ).updateMasteryTrainingQueue({ expectedEntries: [], entries: masteryEntries });
    expect(saved.success).toBe(true);
    expect(getMasteryQueue(await readUser())).toEqual(masteryEntries);
    const start = new Date(Date.now() - 20 * minute);
    await database
      .update(userData)
      .set({ masteryTrainingStartedAt: start })
      .where(eq(userData.userId, userId));
    await fetchUpdatedUser({ client: database, userId, forceRegen: true });
    const first = await readUser();
    expect(first.ninjutsuMastery).toBe(375000);
    expect(first.masteryQueueHead).toBe(2);
    expect(first.masteryTrainingStartedAt?.getTime()).toBe(
      start.getTime() + 15 * minute,
    );
    expect(getMasteryQueue(first)).toEqual([]);
    await fetchUpdatedUser({ client: database, userId, forceRegen: true });
    const second = await readUser();
    expect(second.ninjutsuMastery).toBe(first.ninjutsuMastery);
    expect(second.masteryQueueHead).toBe(first.masteryQueueHead);
    expect(second.genjutsuMastery).toBe(0);
    expect(second.currentlyTrainingMastery).toBe("genjutsuMastery");
  });
});

it("a different queued mastery starts when the original reaches its cap", () => {
  const start = new Date(Date.UTC(2026, 0, 1, 12));
  const result = settleMasteryTrainingQueue(
    masteryUser(start) as never,
    [masteryEntries[1]!],
    [],
    new Date(start.getTime() + 20 * minute),
  );
  expect(result.gains.ninjutsuMastery).toBe(0.5);
  expect(result.currentlyTrainingMastery).toBe("genjutsuMastery");
  expect(result.trainingSpeed).toBe("15min");
});

it("skips a repeat capped by the completed session", () => {
  const start = new Date(Date.UTC(2026, 0, 1, 12));
  const result = settleMasteryTrainingQueue(
    masteryUser(start) as never,
    masteryEntries,
    [],
    new Date(start.getTime() + 20 * minute),
  );
  expect(result.gains.ninjutsuMastery).toBe(0.5);
  expect(result.remaining).toEqual([]);
  expect(result.currentlyTrainingMastery).toBe("genjutsuMastery");
});
