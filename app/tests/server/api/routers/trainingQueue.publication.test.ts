import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { quest, questHistory, userData, userQueue, userVote } from "@/drizzle/schema";
import { getMasteryQueue } from "@/libs/queue";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { trainRouter } from "@/server/api/routers/train";
import type { DrizzleClient } from "@/server/db";
import { insertUsers, insertUserVotes } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  recordQueries,
} from "../../../setup/testDatabase";
import { deferred } from "../../../setup/deferred";
import {
  beforeTransaction,
  aroundStatements,
  inTransactions,
  beforeStatements,
} from "../../../setup/statements";

const userId = "queue-publication";
const genjutsu = { stat: "genjutsuMastery" as const, speed: "15min" as const };
const taijutsu = { stat: "taijutsuMastery" as const, speed: "15min" as const };
const bukijutsu = { stat: "bukijutsuMastery" as const, speed: "15min" as const };
// Delay only dispatch; the transaction, predicates and rows execute on real SQL.
const delayReplacementInsert = (database: DrizzleClient, fail = false) => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const gate = async (run: () => Promise<unknown>) => {
    entered.resolve();
    await release.promise;
    if (fail) throw new Error("Replacement insert unavailable");
    return run();
  };
  const client = inTransactions(database, (tx) =>
    aroundStatements(tx, userQueue, gate, { operations: ["insert"] }),
  );
  return { client, entered: entered.promise, release: release.resolve };
};

const delayFirstUserWrite = (database: DrizzleClient) => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const client = beforeStatements(
    database,
    userData,
    [
      async () => {
        entered.resolve();
        await release.promise;
      },
    ],
    { operations: ["update"] },
  );
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
    // Queue publication's query budget assumes no quest bootstrapping.
    await resetTables(userQueue, userVote, questHistory, quest, userData);
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
    await insertUserVotes([{ userId, lastVoteAt: now }]);
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
    expect(saved.roundTrips, saved.statements.join("\n")).toBe(7);
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

  it.each(["ENERGY", "MASTERY"] as const)(
    "keeps %s removals passive and prepares recovery for additions",
    async (kind) => {
      const database = await getTestDatabase();
      const caller = callerForDatabase(trainRouter, userId, database);
      const energy = [
        { stat: "strength" as const, energy: 100 },
        { stat: "offence" as const, energy: 100 },
      ];
      const mastery = [genjutsu, taijutsu];
      const saved =
        kind === "ENERGY"
          ? await caller.updateEnergyTrainingQueue({
              expectedEntries: [],
              entries: energy,
            })
          : await caller.updateMasteryTrainingQueue({
              expectedEntries: [],
              entries: mastery,
            });
      expect(saved.success).toBe(true);
      await database
        .update(userData)
        .set({ status: "ASLEEP", autoWakeUp: true, regeneration: 0 })
        .where(eq(userData.userId, userId));
      const removed =
        kind === "ENERGY"
          ? await caller.updateEnergyTrainingQueue({
              expectedEntries: energy,
              entries: [energy[1]!],
            })
          : await caller.updateMasteryTrainingQueue({
              expectedEntries: mastery,
              entries: [taijutsu],
            });
      expect(removed.success).toBe(true);
      expect(removed.actionNotice).toBeUndefined();
      expect((await readUser()).status).toBe("ASLEEP");
      const cleared =
        kind === "ENERGY"
          ? await caller.updateEnergyTrainingQueue({
              expectedEntries: [energy[1]!],
              entries: [],
            })
          : await caller.updateMasteryTrainingQueue({
              expectedEntries: [taijutsu],
              entries: [],
            });
      expect(cleared.success).toBe(true);
      expect(cleared.actionNotice).toBeUndefined();
      expect((await readUser()).status).toBe("ASLEEP");
      const added =
        kind === "ENERGY"
          ? await caller.updateEnergyTrainingQueue({
              expectedEntries: [],
              entries: energy,
            })
          : await caller.updateMasteryTrainingQueue({
              expectedEntries: [],
              entries: mastery,
            });
      expect(added).toMatchObject({
        success: true,
        actionNotice: "This action woke you up.",
      });
      expect((await readUser()).status).toBe("AWAKE");
    },
  );

  it("publishes an Energy entry with isolation validation in seven round trips", async () => {
    const normal = callerForDatabase(trainRouter, userId, await getTestDatabase());
    const saved = await recordQueries(() =>
      normal.updateEnergyTrainingQueue({
        expectedEntries: [],
        entries: [{ stat: "strength", energy: 100 }],
      }),
    );
    expect(saved.result.success).toBe(true);
    expect(saved.roundTrips, saved.statements.join("\n")).toBe(7);
  });

  it.each(["ENERGY", "MASTERY"] as const)(
    "rejects a %s addition if the player falls asleep before publication",
    async (kind) => {
      const database = await getTestDatabase();
      // Sleep changes status without updating the snapshot timestamp.
      const client = beforeTransaction(database, () =>
        database
          .update(userData)
          .set({ status: "ASLEEP" })
          .where(eq(userData.userId, userId)),
      );
      const caller = callerForDatabase(trainRouter, userId, client);
      const result =
        kind === "ENERGY"
          ? await caller.updateEnergyTrainingQueue({
              expectedEntries: [],
              entries: [{ stat: "strength", energy: 100 }],
            })
          : await caller.updateMasteryTrainingQueue({
              expectedEntries: [],
              entries: [genjutsu],
            });
      expect(result).toMatchObject({ success: false });
      const user = await readUser();
      expect(user.status).toBe("ASLEEP");
      expect(user.queue).toEqual([]);
      expect(user.energyQueueHead).toBe(0);
      expect(user.energyQueueTail).toBe(0);
      expect(user.masteryQueueHead).toBe(0);
    },
  );

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
