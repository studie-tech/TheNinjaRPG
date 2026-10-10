import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { userData, userQueue, userVote } from "@/drizzle/schema";
import { getMasteryQueue } from "@/libs/queue";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  recordQueries,
} from "../../setup/testDatabase";

const userId = "queue-publication";
const genjutsu = { stat: "genjutsuMastery" as const, speed: "15min" as const };
const taijutsu = { stat: "taijutsuMastery" as const, speed: "15min" as const };
const bukijutsu = { stat: "bukijutsuMastery" as const, speed: "15min" as const };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// Delay only dispatch; the transaction, predicates and rows execute on real SQL.
const delayReplacementInsert = (database: DrizzleClient, fail = false) => {
  const entered = deferred();
  const release = deferred();
  const client = new Proxy(database, {
    get(target, property) {
      if (property !== "transaction") return Reflect.get(target, property);
      return (callback: Parameters<typeof target.transaction>[0]) =>
        target.transaction(async (tx) => {
          const gated = new Proxy(tx, {
            get(transaction, key) {
              if (key !== "insert") return Reflect.get(transaction, key);
              return (table: Parameters<typeof tx.insert>[0]) => {
                const builder = transaction.insert(table);
                if (table !== userQueue) return builder;
                return {
                  values: (values: (typeof userQueue.$inferInsert)[]) => ({
                    then: async (
                      resolve: (value: unknown) => unknown,
                      reject: (error: unknown) => unknown,
                    ) => {
                      entered.resolve();
                      await release.promise;
                      try {
                        if (fail) throw new Error("Replacement insert unavailable");
                        return resolve(await builder.values(values));
                      } catch (error) {
                        return reject(error);
                      }
                    },
                  }),
                };
              };
            },
          });
          return callback(gated);
        });
    },
  });
  return { client, entered: entered.promise, release: release.resolve };
};

const delayFirstUserWrite = (database: DrizzleClient) => {
  const entered = deferred();
  const release = deferred();
  let delayed = false;
  const wrap = <T extends object>(builder: T): T =>
    new Proxy(builder, {
      get(target, property) {
        if (property === "then")
          return async (
            resolve: (value: unknown) => unknown,
            reject: (error: unknown) => unknown,
          ) => {
            if (!delayed) {
              delayed = true;
              entered.resolve();
              await release.promise;
            }
            try {
              return resolve(await (target as unknown as PromiseLike<unknown>));
            } catch (error) {
              return reject(error);
            }
          };
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = value.apply(target, args);
          return next && typeof next === "object" ? wrap(next) : next;
        };
      },
    });
  const client = new Proxy(database, {
    get(target, property) {
      if (property !== "update") return Reflect.get(target, property);
      return (table: Parameters<typeof database.update>[0]) => {
        const builder = target.update(table);
        return table === userData ? wrap(builder) : builder;
      };
    },
  });
  return { client, entered: entered.promise, release: release.resolve };
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

describeWithDatabase("Training queue atomic publication", () => {
  beforeEach(async () => {
    await resetTables(userQueue, userVote, userData);
    const now = new Date();
    await insertUsers([
      {
        userId,
        username: userId,
        status: "AWAKE",
        rank: "GENIN",
        level: 20,
        isOutlaw: true,
        federalStatus: "GOLD",
        updatedAt: now,
        regenAt: now,
        currentlyTrainingMastery: "ninjutsuMastery",
        masteryTrainingStartedAt: now,
        trainingSpeed: "15min",
        curEnergy: 0,
        maxEnergy: 100,
      },
    ]);
    await (await getTestDatabase())
      .insert(userVote)
      .values({ id: "publication-vote", userId, secret: "secret01", lastVoteAt: now });
  });

  it("saves and clears a mastery queue sequentially", async () => {
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId,
      forceRegen: true,
    });
    const normal = callerForDatabase(trainRouter, userId, await getTestDatabase());
    const saved = await recordQueries(() =>
      normal.updateMasteryTrainingQueue({ expectedEntries: [], entries: [genjutsu] }),
    );
    expect(saved.result.success).toBe(true);
    expect(saved.roundTrips).toBe(7);
    expect(
      (
        await normal.updateMasteryTrainingQueue({
          expectedEntries: [genjutsu],
          entries: [],
        })
      ).success,
    ).toBe(true);
    expect(getMasteryQueue(await readUser())).toEqual([]);
  });

  it("publishes an Energy entry in seven round trips", async () => {
    const normal = callerForDatabase(trainRouter, userId, await getTestDatabase());
    const saved = await recordQueries(() =>
      normal.updateEnergyTrainingQueue({
        expectedEntries: [],
        entries: [{ stat: "strength", energy: 100 }],
      }),
    );
    expect(saved.result.success).toBe(true);
    expect(saved.roundTrips).toBe(7);
  });

  it.each(["ENERGY", "MASTERY"] as const)("rejects a %s addition if the player falls asleep before publication", async (kind) => {
    const database = await getTestDatabase();
    const client = new Proxy(database, {
      get(target, property) {
        if (property !== "transaction") return Reflect.get(target, property);
        return async (callback: Parameters<typeof target.transaction>[0]) => {
          // Sleep changes status without updating the snapshot timestamp.
          await database.update(userData).set({ status: "ASLEEP" }).where(eq(userData.userId, userId));
          return target.transaction(callback);
        };
      },
    });
    const caller = callerForDatabase(trainRouter, userId, client);
    const result = kind === "ENERGY"
      ? await caller.updateEnergyTrainingQueue({ expectedEntries: [], entries: [{ stat: "strength", energy: 100 }] })
      : await caller.updateMasteryTrainingQueue({ expectedEntries: [], entries: [genjutsu] });
    expect(result).toMatchObject({ success: false });
    const user = await readUser();
    expect(user.status).toBe("ASLEEP");
    expect(user.queue).toEqual([]);
    expect(user.energyQueueHead).toBe(0);
    expect(user.energyQueueTail).toBe(0);
    expect(user.masteryQueueHead).toBe(0);
  });

  it("retains the old queue until replacement rows commit and rejects an overlapping add", async () => {
    const database = await getTestDatabase();
    const normal = callerForDatabase(trainRouter, userId, database);
    expect(
      (
        await normal.updateMasteryTrainingQueue({
          expectedEntries: [],
          entries: [genjutsu],
        })
      ).success,
    ).toBe(true);
    const delayed = delayReplacementInsert(database);
    const slow = callerForDatabase(trainRouter, userId, delayed.client);
    const first = slow.updateMasteryTrainingQueue({
      expectedEntries: [genjutsu],
      entries: [genjutsu, taijutsu],
    });
    await delayed.entered;
    expect(getMasteryQueue(await readUser())).toEqual([genjutsu]);
    const second = normal.updateMasteryTrainingQueue({
      expectedEntries: [genjutsu],
      entries: [genjutsu, bukijutsu],
    });
    delayed.release();
    expect((await first).success).toBe(true);
    expect((await second).success).toBe(false);
    expect(getMasteryQueue(await readUser())).toEqual([genjutsu, taijutsu]);
  });

  it("rejects a stale overlapping clear and allows clearing the committed replacement", async () => {
    const database = await getTestDatabase();
    const delayed = delayReplacementInsert(database);
    const slow = callerForDatabase(trainRouter, userId, delayed.client);
    const delayedRegen = delayFirstUserWrite(database);
    const normal = callerForDatabase(trainRouter, userId, delayedRegen.client);
    const first = slow.updateMasteryTrainingQueue({
      expectedEntries: [],
      entries: [genjutsu],
    });
    await delayed.entered;
    expect(getMasteryQueue(await readUser())).toEqual([]);
    const clear = normal.updateMasteryTrainingQueue({
      expectedEntries: [],
      entries: [],
    });
    // Force the clear to load the old rows, then lose its regen CAS to publication.
    await delayedRegen.entered;
    delayed.release();
    expect((await first).success).toBe(true);
    delayedRegen.release();
    expect((await clear).success).toBe(false);
    expect(
      (
        await normal.updateMasteryTrainingQueue({
          expectedEntries: [genjutsu],
          entries: [],
        })
      ).success,
    ).toBe(true);
    expect(getMasteryQueue(await readUser())).toEqual([]);
  });

  it("retains the accepted queue and head when replacement insertion fails", async () => {
    const database = await getTestDatabase();
    const normal = callerForDatabase(trainRouter, userId, database);
    await normal.updateMasteryTrainingQueue({
      expectedEntries: [],
      entries: [genjutsu],
    });
    const before = await readUser();
    const delayed = delayReplacementInsert(database, true);
    const slow = callerForDatabase(trainRouter, userId, delayed.client);
    const failure = slow
      .updateMasteryTrainingQueue({ expectedEntries: [genjutsu], entries: [taijutsu] })
      .then(
        () => null,
        (error) => error,
      );
    await delayed.entered;
    delayed.release();
    expect(await failure).toBeInstanceOf(Error);
    const after = await readUser();
    expect(after.masteryQueueHead).toBe(before.masteryQueueHead);
    expect(getMasteryQueue(after)).toEqual([genjutsu]);
  });
});
