// @vitest-environment node
import {eq} from "drizzle-orm";
import {beforeEach, expect, it} from "vitest";
import {CombatStatNames, getUserCaps} from "@/drizzle/constants";
import {bloodline, item, userItem, quest, questHistory, trainingLog, userData, userVote} from "@/drizzle/schema";
import {fetchUpdatedUser} from "@/server/api/routers/profile";
import {trainRouter} from "@/server/api/routers/train";
import {SimpleObjective} from "@/validators/objectives";
import {ObjectiveReward} from "@/validators/rewards";
import {insertItems, insertUserItems, insertUsers, insertQuests, insertQuestHistory} from "../../setup/factories";
import {callerFor, describeWithDatabase, getTestDatabase, resetTables} from "../../setup/testDatabase";
const USER_ID = "trainee";
const SESSION_GAIN = 100;
const MINUTE = 60 * 1000;
const { mastery_cap: GENIN_MASTERY_CAP } = getUserCaps("GENIN");

const caller = () => callerFor(trainRouter, USER_ID);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE);

const trainee = async (patch: Record<string, unknown> = {}) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Trainee",
      status: "AWAKE",
      rank: "GENIN",
      isOutlaw: true,
      trainingSpeed: "15min",
      ...patch,
    } as never,
  ]);
  // fetchUpdatedUser creates a missing vote row, and parallel requests would race on it
  const database = await getTestDatabase();
  await database
    .insert(userVote)
    .values({
      id: "vote-trainee",
      userId: USER_ID,
      secret: "secret01",
      lastVoteAt: new Date(),
    });
};

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database
    .select()
    .from(userData)
    .where(eq(userData.userId, USER_ID));
  if (!user) throw new Error("trainee missing");
  return user;
};

const readLogs = async () => {
  const database = await getTestDatabase();
  return database.select().from(trainingLog).where(eq(trainingLog.userId, USER_ID));
};

const backdate = async (patch: Partial<typeof userData.$inferInsert>) => {
  const database = await getTestDatabase();
  await database.update(userData).set(patch).where(eq(userData.userId, USER_ID));
};

describeWithDatabase("Energy and mastery training against a real MySQL", () => {
  beforeEach(async () => { await resetTables(trainingLog, questHistory, quest, userVote, userItem, item, userData, bloodline); });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "settles one-time %s queues offline without losing regenerated Energy to capacity",
    async (status) => {
      await trainee({
        status,
        level: 1,
        curEnergy: 0,
        regeneration: 100,
        energyTrainingQueue: [
          { stat: "offence", energy: 100 },
          { stat: "defence", energy: 100 },
        ],
        regenAt: new Date(Date.now() - 195_000),
      });
      const before = await readUser();
      await fetchUpdatedUser({
        client: await getTestDatabase(),
        userId: USER_ID,
        forceRegen: true,
      });
      const after = await readUser();
      expect(after.offence - before.offence).toBeCloseTo(130);
      expect(after.defence - before.defence).toBeCloseTo(130);
      expect(after.curEnergy).toBe(100);
      expect(after.energyTrainingQueue).toEqual([]);
      expect(after.experience - before.experience).toBeCloseTo(260);
      await fetchUpdatedUser({
        client: await getTestDatabase(),
        userId: USER_ID,
        forceRegen: true,
      });
      expect((await readUser()).experience).toBe(after.experience);
      expect(await readLogs()).toHaveLength(2);
    },
  );

  it("skips capped queued stats and spends only the Energy required for a partial cap", async () => {
    const cap = getUserCaps("GENIN").stats_cap;
    await trainee({
      curEnergy: 100,
      regeneration: 0,
      offence: cap,
      defence: cap - 1.3,
      energyTrainingQueue: [
        { stat: "offence", energy: 50 },
        { stat: "defence", energy: 50 },
      ],
    });
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER_ID,
      forceRegen: true,
    });
    const after = await readUser();
    expect(after.offence).toBe(cap);
    expect(after.defence).toBeCloseTo(cap);
    expect(after.curEnergy).toBeCloseTo(99);
    expect(after.energyTrainingQueue).toEqual([]);
    expect(await readLogs()).toHaveLength(1);
  });

  it("does not write an unaffordable queue again before a recovery tick", async () => {
    await trainee({
      curEnergy: 0,
      energyTrainingQueue: [{ stat: "offence", energy: 100 }],
      regenAt: new Date(),
    });
    const database = await getTestDatabase();
    await fetchUpdatedUser({ client: database, userId: USER_ID, forceRegen: true });
    const before = await readUser();
    await fetchUpdatedUser({ client: database, userId: USER_ID });
    await fetchUpdatedUser({ client: database, userId: USER_ID });
    const after = await readUser();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.regenAt.getTime()).toBe(before.regenAt.getTime());
    expect(after.energyTrainingQueue).toEqual(before.energyTrainingQueue);
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(await readLogs()).toHaveLength(0);
  });

  it("claims queued spending once across concurrent profile refreshes", async () => {
    await trainee({
      curEnergy: 100,
      regeneration: 0,
      energyTrainingQueue: [{ stat: "offence", energy: 40 }],
    });
    const before = await readUser();
    const database = await getTestDatabase();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        fetchUpdatedUser({ client: database, userId: USER_ID, forceRegen: true }),
      ),
    );
    const after = await readUser();
    expect(after.curEnergy).toBe(60);
    expect(after.offence - before.offence).toBeCloseTo(52);
    expect(after.experience - before.experience).toBeCloseTo(52);
    expect(await readLogs()).toHaveLength(1);
  });

  it("does not expose quest credit from queued training when its write fails", async () => {
    await insertQuests([{
      id: "queued-stat-quest", questType: "daily",
      content: { objectives: [SimpleObjective.parse({ id: "queued-stat-goal", task: "stats_trained", value: 1000, description: "Train stats", successDescription: "Done" })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    }]);
    await insertQuestHistory([{userId: USER_ID, questId: "queued-stat-quest", questType: "daily"}]);
    await trainee({
      curEnergy: 100, regeneration: 0,
      energyTrainingQueue: [{stat: "offence", energy: 40}],
      questData: [{ id: "queued-stat-quest", goals: [{ id: "queued-stat-goal", value: 0, done: false }] }],
    });
    const database = await getTestDatabase();
    const before = await readUser();
    const failedDatabase = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof database.update>[0]) => {
          const builder = database.update(table);
          return {
            set(values: Parameters<typeof builder.set>[0]) {
              if (table === userData && "energyTrainingQueue" in values)
                throw new Error("Simulated queued training write failure");
              return builder.set(values);
            },
          };
        };
      },
    });
    const refreshed = await fetchUpdatedUser({client: failedDatabase, userId: USER_ID, forceRegen: true});
    expect(refreshed.user?.questData?.find(t => t.id === "queued-stat-quest")?.goals.find(g => g.id === "queued-stat-goal")?.value).toBe(0);
    expect(refreshed.user?.offence).toBe(before.offence);
    expect((await readUser()).curEnergy).toBe(100);
    expect(await readLogs()).toHaveLength(0);
  });

  it("rejects queued settlement when movement changes its eligible location", async () => {
    await trainee({curEnergy: 100, regeneration: 0, energyTrainingQueue: [{stat: "offence", energy: 40}]});
    const database = await getTestDatabase();
    const before = await readUser();
    let moved = false;
    const movingDatabase = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof database.update>[0]) => {
          const builder = database.update(table);
          return {
            set(values: Parameters<typeof builder.set>[0]) {
              const update = builder.set(values);
              return {
                async where(condition: Parameters<typeof update.where>[0]) {
                  if (table === userData && "energyTrainingQueue" in values && !moved) {
                    moved = true;
                    await backdate({longitude: before.longitude + 1});
                  }
                  return update.where(condition);
                },
              };
            },
          };
        };
      },
    });
    const refreshed = await fetchUpdatedUser({client: movingDatabase, userId: USER_ID, forceRegen: true});
    expect(moved).toBe(true);
    expect(refreshed.user?.offence).toBe(before.offence);
    expect((await readUser()).curEnergy).toBe(100);
    expect((await readUser()).energyTrainingQueue).toEqual(before.energyTrainingQueue);
    expect(await readLogs()).toHaveLength(0);
  });

  it("waits for the queued amount and respects capacity and federal slots", async () => {
    await trainee({ level: 1, curEnergy: 0, regeneration: 0 });
    const api = await caller();
    const entries = [{ stat: "offence" as const, energy: 100 }];
    expect(
      (await api.updateEnergyTrainingQueue({ entries, expectedEntries: [] })).success,
    ).toBe(true);
    await fetchUpdatedUser({
      client: await getTestDatabase(),
      userId: USER_ID,
      forceRegen: true,
    });
    expect((await readUser()).energyTrainingQueue).toEqual(entries);
    expect(await readLogs()).toHaveLength(0);
    expect(
      (
        await api.updateEnergyTrainingQueue({
          entries: [{ stat: "offence", energy: 151 }],
          expectedEntries: entries,
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await api.updateEnergyTrainingQueue({
          entries: [...entries, ...entries, ...entries],
          expectedEntries: entries,
        })
      ).success,
    ).toBe(false);
    expect(
      (await api.updateEnergyTrainingQueue({ entries: [], expectedEntries: entries }))
        .success,
    ).toBe(true);
    expect((await readUser()).energyTrainingQueue).toEqual([]);
  });

  it("rejects a stale edit that would re-add a completed queue entry", async () => {
    const entries = [{ stat: "offence" as const, energy: 40 }];
    await trainee({ curEnergy: 100, regeneration: 0, energyTrainingQueue: entries });
    const result = await (await caller()).updateEnergyTrainingQueue({
      entries: [...entries, { stat: "defence", energy: 40 }],
      expectedEntries: entries,
    });
    expect(result.success).toBe(false);
    expect((await readUser()).energyTrainingQueue).toEqual([]);
    expect((await readUser()).curEnergy).toBe(60);
    expect(await readLogs()).toHaveLength(1);
  });

  it("returns effective profile masteries from bloodline and eligible equipment without changing stored stats", async () => {
    const database = await getTestDatabase();
    const tag = {type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 100, powerPerLevel: 0, calculation: "static", rounds: 1} as const;
    await database.insert(bloodline).values({id: "mastery-line", name: "Mastery Line", rank: "D", image: "", description: "", effects: [tag as never]});
    await trainee({bloodlineId: "mastery-line", ninjutsuMastery: 10});
    await insertItems([{id: "mastery-armor", itemType: "ARMOR", effects: [{...tag, power: 500}], requiredNinjutsuMastery: 100} as never]);
    await insertUserItems([{id: "worn-armor", userId: USER_ID, itemId: "mastery-armor", equipped: "CHEST", durability: 100, level: 1}]);
    const refreshed = await fetchUpdatedUser({client: database, userId: USER_ID});
    expect(refreshed.user?.effectiveMasteries.ninjutsuMastery).toBe(610);
    expect(refreshed.user?.ninjutsuMastery).toBe(10);
    expect((await readUser()).ninjutsuMastery).toBe(10);
  });

  it.each(CombatStatNames)("spends Energy only on %s and grants matching XP", async stat => {
    await trainee({curEnergy: 100, regeneration: 0});
    const before = await readUser();
    const result = await (await caller()).startTraining({stat, energy: 10});
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.curEnergy).toBe(90);
    expect(after.experience - before.experience).toBeCloseTo(13);
    for (const other of CombatStatNames) expect(after[other] - before[other]).toBeCloseTo(other === stat ? 13 : 0);
    expect(await readLogs()).toHaveLength(1);
  });

  it("Energy training retains the Genin sensei bonus", async () => {
    await trainee({ curEnergy: 100, regeneration: 0, senseiId: "sensei" });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.offence - before.offence).toBeCloseTo(136.5);
    expect(after.curEnergy).toBe(0);
  });

  it("Energy training retains reduced gains after joining a village", async () => {
    await trainee({ rank: "JONIN", curEnergy: 100, regeneration: 0, joinedVillageAt: new Date() });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.offence - before.offence).toBeCloseTo(65);
    expect(after.curEnergy).toBe(0);
  });

  it("rejects overspending without granting stats", async () => {
    await trainee({curEnergy: 5, regeneration: 0});
    const before = await readUser();
    expect((await (await caller()).startTraining({stat: "offence", energy: 6})).success).toBe(false);
    expect((await readUser()).offence).toBe(before.offence);
    expect((await readUser()).curEnergy).toBe(5);
  });

  it.each([
    { curEnergy: 0, energy: 0, message: "No Energy available. Wait for Energy to recover before training." },
    { curEnergy: 0, energy: 5, message: "No Energy available. Wait for Energy to recover before training." },
    { curEnergy: 50, energy: 0, message: "Enter an Energy amount greater than zero to train." },
    { curEnergy: 50, energy: -3, message: "Enter an Energy amount greater than zero to train." },
  ])("answers $energy Energy with $curEnergy available by a message, not a validation error", async ({curEnergy, energy, message}) => {
    await trainee({curEnergy, regeneration: 0});
    const before = await readUser();
    const result = await (await caller()).startTraining({stat: "offence", energy});
    expect(result).toMatchObject({success: false, message});
    const after = await readUser();
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.offence).toBe(before.offence);
    expect(await readLogs()).toHaveLength(0);
  });

  it("rejects a spend too small to reduce the stored Energy balance", async () => {
    await trainee({curEnergy: 100, regeneration: 0});
    const before = await readUser();
    const result = await (await caller()).startTraining({stat: "offence", energy: 4e-15});
    expect(result.success).toBe(false);
    const after = await readUser();
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.offence).toBe(before.offence);
    expect(after.experience).toBe(before.experience);
    expect(await readLogs()).toHaveLength(0);
  });

  it("concurrent spends cannot reuse the same Energy", async () => {
    await trainee({curEnergy: 10, regeneration: 0});
    const api = await caller();
    const results = await Promise.all([api.startTraining({stat: "offence", energy: 10}), api.startTraining({stat: "defence", energy: 10})]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    const after = await readUser();
    expect(after.curEnergy).toBe(0);
    expect(after.experience).toBeCloseTo(13);
    expect(await readLogs()).toHaveLength(1);
  });

  it("does not let a delayed profile refresh restore Energy already spent on training", async () => {
    await trainee({curEnergy: 10, regeneration: 0});
    const database = await getTestDatabase();
    await fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
    const api = await caller();
    let spent = false;
    const delayedDatabase = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof database.update>[0]) => {
          const builder = database.update(table);
          return {
            set(values: Parameters<typeof builder.set>[0]) {
              const update = builder.set(values);
              return {
                async where(condition: Parameters<typeof update.where>[0]) {
                  if (table === userData && "primaryElement" in values && !spent) {
                    spent = true;
                    expect((await api.startTraining({stat: "offence", energy: 10})).success).toBe(true);
                  }
                  return update.where(condition);
                },
              };
            },
          };
        };
      },
    });
    const refreshed = await fetchUpdatedUser({client: delayedDatabase, userId: USER_ID, forceRegen: true});
    expect(spent).toBe(true);
    expect(refreshed.user?.curEnergy).toBe(0);
    expect((await readUser()).curEnergy).toBe(0);
    expect((await api.startTraining({stat: "defence", energy: 10})).success).toBe(false);
    expect((await readUser()).experience).toBeCloseTo(13);
    expect(await readLogs()).toHaveLength(1);
  });

  it("credits an elapsed regeneration interval once across simultaneous profile refreshes", async () => {
    await trainee({level: 2, curEnergy: 0, regeneration: 5});
    const database = await getTestDatabase();
    const hydrated = await fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
    const regenAt = new Date(Date.now() - 135_000);
    await backdate({curEnergy: 0, regenAt});
    await Promise.all(Array.from({length: 8}, () => fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true})));
    const after = await readUser();
    expect(after.curEnergy).toBe(2 * hydrated.user!.regeneration);
    expect(after.regenAt.getTime()).toBe(regenAt.getTime() + 120_000);
  });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "%s Energy recovery shares bloodline and housing bonuses", async (status) => {
      const database = await getTestDatabase();
      await database.insert(bloodline).values({
        id: "regen-line", name: "Regen Line", rank: "D",
        image: "", description: "", effects: [], regenIncrease: 100,
      });
      await trainee({
        level: 100, status, bloodlineId: "regen-line",
        homeType: "MARSHMALLOWOPOLIS", regeneration: 60,
        curEnergy: 0, curHealth: 0, maxHealth: 2000,
        regenAt: new Date(Date.now() - 75_000),
      });
      const hydrated = await fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
      const after = await readUser();
      expect(after.curEnergy).toBe(hydrated.user?.regeneration);
      expect(after.curEnergy).toBeGreaterThan(60);
      expect(after.curHealth).toBe(hydrated.user?.regeneration);
      expect(after.curHealth).toBe(after.curEnergy);
    },
  );

  it("Energy recovery retains the recent village-transfer penalty", async () => {
    await trainee({rank: "JONIN", level: 100, regeneration: 60, joinedVillageAt: new Date(), curEnergy: 0, regenAt: new Date(Date.now() - 75_000)});
    const hydrated = await fetchUpdatedUser({client: await getTestDatabase(), userId: USER_ID, forceRegen: true});
    expect(hydrated.user?.regeneration).toBe(30);
    expect((await readUser()).curEnergy).toBe(30);
  });

  it("spends only enough Energy to reach the cap and preserves stored overflow", async () => {
    const cap = getUserCaps("GENIN").stats_cap;
    await trainee({offence: cap - 1.3, curEnergy: 100, regeneration: 0});
    expect((await (await caller()).startTraining({stat: "offence", energy: 100})).success).toBe(true);
    const after = await readUser();
    expect(after.offence).toBeCloseTo(cap);
    expect(after.curEnergy).toBeCloseTo(99);
    await backdate({offence: cap + 100});
    expect((await (await caller()).startTraining({stat: "offence", energy: 1})).success).toBe(false);
    expect((await readUser()).offence).toBe(cap + 100);
  });

  it("timed mastery costs no Energy or XP and can run alongside instant stat training", async () => {
    await trainee({curEnergy: 100, regeneration: 0});
    const api = await caller();
    expect((await api.startMasteryTraining({stat: "ninjutsuMastery"})).success).toBe(true);
    expect((await api.startTraining({stat: "offence", energy: 10})).success).toBe(true);
    await backdate({masteryTrainingStartedAt: minutesAgo(30)});
    const before = await readUser();
    const result = await api.stopMasteryTraining({});
    expect(result.success).toBe(true);
    expect(result.data?.amount).toBe(100);
    expect(result.data?.creditedMinutes).toBeCloseTo(30, 0);
    const after = await readUser();
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.experience).toBe(before.experience);
    expect(after.dailyTrainings).toBe(1);
    expect((await api.stopMasteryTraining({})).success).toBe(false);
  });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "%s profile refreshes preserve unfinished regeneration ticks", async status => {
      const regenAt = new Date(Date.now() - 75000);
      await trainee({level: 2, status, curEnergy: 0, curHealth: 0, curChakra: 0, curStamina: 0, regeneration: 5, regenAt});
      const database = await getTestDatabase();
      const fetch = () => fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
      const hydrated = await fetch();
      const first = await readUser();
      expect(first.curEnergy).toBe(hydrated.user?.regeneration);
      expect(first.regenAt.getTime()).toBe(regenAt.getTime() + 60000);
      await fetch();
      const second = await readUser();
      expect(second.regenAt.getTime()).toBe(first.regenAt.getTime());
      for (const pool of ["curEnergy", "curHealth", "curChakra", "curStamina"] as const) {
        expect(second[pool]).toBe(first[pool]);
      }
    },
  );

  it("Energy regenerates while mastery runs, capped at level capacity", async () => {
    await trainee({level: 2, curEnergy: 0, regeneration: 60, regenAt: minutesAgo(10), currentlyTrainingMastery: "ninjutsuMastery", masteryTrainingStartedAt: minutesAgo(5)});
    expect((await (await caller()).startTraining({stat: "offence", energy: 10})).success).toBe(true);
    expect((await readUser()).curEnergy).toBeCloseTo(140);
  });
});
