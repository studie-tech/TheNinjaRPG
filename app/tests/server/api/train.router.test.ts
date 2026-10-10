import {eq} from "drizzle-orm";
import {afterEach, beforeEach, expect, it, vi} from "bun:test";
import {CombatStatNames, getUserCaps, MAX_MASTERY_CAP} from "@/drizzle/constants";
import {bloodline, gameSetting, item, userItem, quest, questHistory, trainingLog, userData, userQueue, userVote} from "@/drizzle/schema";
import {getEnergyQueue} from "@/libs/queue";
import {fetchUpdatedUser} from "@/server/api/routers/profile";
import {trainRouter} from "@/server/api/routers/train";
import {InstantNewQuestObjective, SimpleObjective} from "@/validators/objectives";
import {ObjectiveReward} from "@/validators/rewards";
import {insertItems, insertUserItems, insertUsers, insertQuests, insertQuestHistory} from "../../setup/factories";
import {queueEnergy, readEnergyQueue} from "../../setup/queues";
import {callerFor, describeWithDatabase, getTestDatabase, resetTables} from "../../setup/testDatabase";
import type {EnergyTrainingQueueEntry} from "@/validators/train";
const USER_ID = "trainee";
const SESSION_GAIN = 100;
const MINUTE = 60 * 1000;

const caller = () => callerFor(trainRouter, USER_ID);
const masterySession = async () => ({
  stat: "ninjutsuMastery" as const,
  startedAt: (await readUser()).masteryTrainingStartedAt ?? new Date(0),
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE);

const trainee = async ({
  energyQueue,
  ...patch
}: Record<string, unknown> & { energyQueue?: EnergyTrainingQueueEntry[] } = {}) => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Trainee",
      status: "AWAKE",
      rank: "GENIN",
      primaryElement: "Fire",
      secondaryElement: "Water",
      isOutlaw: true,
      trainingSpeed: "15min",
      ...patch,
    } as never,
  ]);
  if (energyQueue) await queueEnergy(USER_ID, energyQueue);
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
  beforeEach(async () => { await resetTables(userQueue, trainingLog, questHistory, quest, userVote, userItem, item, userData, bloodline, gameSetting); });
  afterEach(() => vi.restoreAllMocks());

  it.each(["AWAKE", "ASLEEP"] as const)(
    "settles one-time %s queues offline without losing regenerated Energy to capacity",
    async (status) => {
      await trainee({
        status,
        level: 1,
        curEnergy: 0,
        regeneration: 100,
        energyQueue: [
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
      expect(after.offence - before.offence).toBeCloseTo(8.5);
      expect(after.defence - before.defence).toBeCloseTo(8.5);
      expect(after.curEnergy).toBe(100);
      expect(await readEnergyQueue(USER_ID)).toEqual([]);
      expect(after.experience - before.experience).toBeCloseTo(17);
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
      defence: cap - 0.085,
      energyQueue: [
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
    expect(await readEnergyQueue(USER_ID)).toEqual([]);
    expect(await readLogs()).toHaveLength(1);
  });

  it("does not write an unaffordable queue again before a recovery tick", async () => {
    await trainee({
      curEnergy: 0,
      energyQueue: [{ stat: "offence", energy: 100 }],
      regenAt: new Date(),
    });
    const database = await getTestDatabase();
    await fetchUpdatedUser({ client: database, userId: USER_ID, forceRegen: true });
    const before = await readUser();
    const queued = await readEnergyQueue(USER_ID);
    await fetchUpdatedUser({ client: database, userId: USER_ID });
    await fetchUpdatedUser({ client: database, userId: USER_ID });
    const after = await readUser();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.regenAt.getTime()).toBe(before.regenAt.getTime());
    expect(await readEnergyQueue(USER_ID)).toEqual(queued);
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(await readLogs()).toHaveLength(0);
  });

  it("claims queued spending once across concurrent profile refreshes", async () => {
    await trainee({
      curEnergy: 100,
      regeneration: 0,
      energyQueue: [{ stat: "offence", energy: 40 }],
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
    expect(after.offence - before.offence).toBeCloseTo(3.4);
    expect(after.experience - before.experience).toBe(3);
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
      energyQueue: [{stat: "offence", energy: 40}],
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
              if (table === userData && "energyQueueHead" in values)
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
    await trainee({curEnergy: 100, regeneration: 0, energyQueue: [{stat: "offence", energy: 40}]});
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
                  if (table === userData && "energyQueueHead" in values && !moved) {
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
    expect(await readEnergyQueue(USER_ID)).toEqual([{stat: "offence", energy: 40}]);
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
    expect(await readEnergyQueue(USER_ID)).toEqual(entries);
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
    expect(await readEnergyQueue(USER_ID)).toEqual([]);
  });

  it.each([
    { name: "a new queue", current: [], entries: [{ stat: "offence", energy: 40 }] },
    { name: "an appended entry", current: [{ stat: "offence", energy: 40 }], entries: [{ stat: "offence", energy: 40 }, { stat: "defence", energy: 40 }] },
    { name: "a changed stat", current: [{ stat: "offence", energy: 40 }], entries: [{ stat: "defence", energy: 40 }] },
    { name: "a changed threshold", current: [{ stat: "offence", energy: 40 }], entries: [{ stat: "offence", energy: 50 }] },
    { name: "reordered entries", current: [{ stat: "offence", energy: 40 }, { stat: "defence", energy: 40 }], entries: [{ stat: "defence", energy: 40 }, { stat: "offence", energy: 40 }] },
  ] satisfies { name: string; current: EnergyTrainingQueueEntry[]; entries: EnergyTrainingQueueEntry[] }[])("rejects $name while asleep without changing the Energy queue", async ({ current, entries }) => {
    await trainee({ status: "ASLEEP", curEnergy: 0, regeneration: 0, energyQueue: current });
    const before = await readUser();
    expect(await (await caller()).updateEnergyTrainingQueue({ expectedEntries: current, entries })).toMatchObject({ success: false, message: "Must be awake to train" });
    expect(await readEnergyQueue(USER_ID)).toEqual(current);
    expect(await readUser()).toMatchObject({ status: "ASLEEP", energyQueueHead: before.energyQueueHead, energyQueueTail: before.energyQueueTail, curEnergy: 0, offence: before.offence, defence: before.defence, experience: before.experience });
    expect(await readLogs()).toHaveLength(0);
  });

  it("allows removing and clearing Energy entries while asleep", async () => {
    const entries = [{ stat: "offence" as const, energy: 40 }, { stat: "defence" as const, energy: 40 }];
    await trainee({ status: "ASLEEP", curEnergy: 0, regeneration: 0, energyQueue: entries });
    const api = await caller();
    expect(await api.updateEnergyTrainingQueue({ expectedEntries: entries, entries: [entries[1]!] })).toMatchObject({ success: true });
    expect(await readEnergyQueue(USER_ID)).toEqual([entries[1]!]);
    expect(await api.updateEnergyTrainingQueue({ expectedEntries: [entries[1]!], entries: [] })).toMatchObject({ success: true });
    expect(await readEnergyQueue(USER_ID)).toEqual([]);
    expect((await readUser()).status).toBe("ASLEEP");
  });

  it("allows removing queued entries while adding is blocked", async () => {
    const entries = [
      { stat: "offence" as const, energy: 40 },
      { stat: "defence" as const, energy: 40 },
    ];
    await trainee({ curEnergy: 0, regeneration: 0, isBanned: true, energyQueue: entries });
    const api = await caller();
    expect(
      await api.updateEnergyTrainingQueue({
        entries: [...entries, { stat: "strength", energy: 10 }],
        expectedEntries: entries,
      }),
    ).toMatchObject({ success: false, message: "Cannot spend Energy while banned" });
    // A pure removal skips the checks for adding, including the captcha.
    expect(
      await api.updateEnergyTrainingQueue({ entries: [entries[1]!], expectedEntries: entries }),
    ).toMatchObject({ success: true, message: "Training queue saved" });
    expect(await readEnergyQueue(USER_ID)).toEqual<Array<(typeof entries)[number] | undefined>>([entries[1]]);
    // Reordering is not a removal.
    expect(
      (
        await api.updateEnergyTrainingQueue({
          entries: [entries[1]!, entries[0]!],
          expectedEntries: [entries[1]!],
        })
      ).success,
    ).toBe(false);
  });

  it("consumes settled rows through the queue head, and the next edit removes them", async () => {
    await trainee({
      curEnergy: 100,
      regeneration: 0,
      energyQueue: [
        { stat: "offence", energy: 40 },
        { stat: "defence", energy: 100 },
      ],
    });
    const database = await getTestDatabase();
    await fetchUpdatedUser({ client: database, userId: USER_ID, forceRegen: true });
    const after = await readUser();
    expect(after.energyQueueHead).toBe(1);
    expect(after.energyQueueTail).toBe(2);
    expect(await readEnergyQueue(USER_ID)).toEqual([{ stat: "defence", energy: 100 }]);
    // The consumed row stays until the next edit; settling writes nothing else.
    const rows = await database.select().from(userQueue).where(eq(userQueue.userId, USER_ID));
    expect(rows.map((row) => row.position).sort()).toEqual([1, 2]);
    // An edit retires every existing row by moving the head past them, without a
    // transaction, then writes the new queue after it; retired rows are deleted.
    const api = await caller();
    expect(
      (
        await api.updateEnergyTrainingQueue({
          entries: [{ stat: "defence", energy: 100 }, { stat: "speed", energy: 10 }],
          expectedEntries: [{ stat: "defence", energy: 100 }],
        })
      ).success,
    ).toBe(true);
    const edited = await database.select().from(userQueue).where(eq(userQueue.userId, USER_ID));
    expect(edited.map((row) => row.position).sort()).toEqual([3, 4]);
    expect(await readUser()).toMatchObject({ energyQueueHead: 2, energyQueueTail: 4 });
    expect(await readEnergyQueue(USER_ID)).toEqual([
      { stat: "defence", energy: 100 },
      { stat: "speed", energy: 10 },
    ]);
  });

  it("rejects a stale edit that would re-add a completed queue entry", async () => {
    const entries = [{ stat: "offence" as const, energy: 40 }];
    await trainee({ curEnergy: 100, regeneration: 0, energyQueue: entries });
    const result = await (await caller()).updateEnergyTrainingQueue({
      entries: [...entries, { stat: "defence", energy: 40 }],
      expectedEntries: entries,
    });
    expect(result.success).toBe(false);
    expect(await readEnergyQueue(USER_ID)).toEqual([]);
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


  it("returns saved queue and confirmed regenerated pools without a follow-up profile read", async () => {
    await trainee({ level: 2, curEnergy: 0, curHealth: 0, curChakra: 0, curStamina: 0, regeneration: 10, regenAt: minutesAgo(2) });
    const database = await getTestDatabase();
    const actualRead = database.query.userData.findFirst.bind(database.query.userData);
    let profileReads = 0;
    vi.spyOn(database.query.userData, "findFirst").mockImplementation(((config: Parameters<typeof actualRead>[0]) => {
      if (config?.with) profileReads += 1;
      return actualRead(config);
    }) as never);
    const entries = [{ stat: "offence" as const, energy: 100 }];
    const result = await (await caller()).updateEnergyTrainingQueue({ entries, expectedEntries: [] });
    expect(result.success).toBe(true);
    const saved = await readUser();
    expect(getEnergyQueue(result.userPatch as never)).toEqual(entries);
    expect(result.userPatch).toMatchObject({ curEnergy: saved.curEnergy, curHealth: saved.curHealth, curChakra: saved.curChakra, curStamina: saved.curStamina, regenAt: saved.regenAt, updatedAt: saved.updatedAt });
    expect(profileReads).toBe(1);
  });

  it("returns both queued gains and the subsequent instant spend in one patch", async () => {
    await trainee({ curEnergy: 100, regeneration: 0, energyQueue: [{ stat: "defence", energy: 40 }] });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 10 });
    expect(result.success).toBe(true);
    const saved = await readUser();
    expect(getEnergyQueue(result.userPatch as never)).toEqual([]);
    expect(result.userPatch).toMatchObject({ curEnergy: 50, energyQueueHead: 1, offence: saved.offence, defence: saved.defence, experience: saved.experience, updatedAt: saved.updatedAt });
    expect(result.userPatch?.defence).toBeCloseTo(before.defence + 3.4);
    expect(result.userPatch?.experience).toBeCloseTo(before.experience + 4);
    expect(await readLogs()).toHaveLength(2);
  });

  it.each(["queue", "instant"] as const)("matches persisted integer XP while keeping fractional %s stat gains", async (action) => {
    const cap = getUserCaps("GENIN").stats_cap;
    await trainee({ curEnergy: 100, regeneration: 0, offence: cap - 1.64, experience: 56,
      energyQueue: action === "queue" ? [{ stat: "offence", energy: 40 }] : [] });
    const result = action === "queue"
      ? await (await caller()).updateEnergyTrainingQueue({ entries: [], expectedEntries: [] })
      : await (await caller()).startTraining({ stat: "offence", energy: 40 });
    expect(result.success).toBe(true);
    const saved = await readUser();
    expect(saved.experience).toBe(58);
    expect(saved.offence).toBe(cap);
    expect(result.userPatch).toMatchObject({ experience: saved.experience, offence: saved.offence });
    expect(result.userPatch?.curEnergy).toBeCloseTo(saved.curEnergy, 10);
    expect((await readLogs())[0]?.amount).toBeCloseTo(1.64);
  });

  it("returns integer pools matching confirmed boosted regeneration without rounding Energy", async () => {
    await trainee({ level: 2, curEnergy: 0, curHealth: 0, curChakra: 0, curStamina: 0, regeneration: 10, regenAt: minutesAgo(2) });
    await (await getTestDatabase()).insert(gameSetting).values({ id: "fractional-regen", name: "regenGainMultiplier", value: 1.391, time: new Date(Date.now() + 60_000) });
    const result = await (await caller()).updateEnergyTrainingQueue({ entries: [], expectedEntries: [] });
    expect(result.success).toBe(true);
    const saved = await readUser();
    expect(result.userPatch).toMatchObject({ curHealth: saved.curHealth, curChakra: saved.curChakra, curStamina: saved.curStamina, curEnergy: saved.curEnergy });
    expect(saved.curHealth).toBe(28);
    expect(saved.curEnergy).toBeCloseTo(27.82);
  });

  it.each(["queue", "instant", "mastery"] as const)("keeps a full refresh for %s after automatic element assignment", async (action) => {
    await trainee({ primaryElement: null, curEnergy: 100, regeneration: 0 });
    const api = await caller();
    const result = action === "queue"
      ? await api.updateEnergyTrainingQueue({ entries: [], expectedEntries: [] })
      : action === "instant"
        ? await api.startTraining({ stat: "offence", energy: 10 })
        : await api.startMasteryTraining({ stat: "ninjutsuMastery" });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect((await readUser()).primaryElement).not.toBeNull();
  });


  it("patches a completed training goal while leaving consecutive quest actions pending", async () => {
    await insertQuests([{ id: "training-consequence", questType: "daily", consecutiveObjectives: true,
      content: { objectives: [
        SimpleObjective.parse({ id: "train-goal", task: "stats_trained", value: 5, description: "Train", successDescription: "Done" }),
        InstantNewQuestObjective.parse({ id: "next-quest", task: "new_quest", newQuestIds: ["follow-up-quest"] }),
      ], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    }]);
    await insertQuestHistory([{ userId: USER_ID, questId: "training-consequence", questType: "daily" }]);
    await trainee({ curEnergy: 100, regeneration: 0, questData: [{ id: "training-consequence", goals: [{ id: "train-goal", value: 0, done: false }] }] });
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    expect(result.userPatch?.questData?.find(tracker => tracker.id === "training-consequence")?.goals).toEqual(expect.arrayContaining([expect.objectContaining({ id: "train-goal", done: true, value: 8.5 }), expect.objectContaining({ id: "next-quest", done: false })]));
  });

  it("recomputes effective gear masteries when collecting timed training unlocks a worn item", async () => {
    await trainee({ ninjutsuMastery: 10, currentlyTrainingMastery: "ninjutsuMastery", masteryTrainingStartedAt: minutesAgo(30), regeneration: 0 });
    const tag = { type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 500, powerPerLevel: 0, calculation: "static", rounds: 1 } as const;
    await insertItems([{ id: "mastery-unlock-armor", itemType: "ARMOR", effects: [tag, { type: "increasemaxpools", poolsAffected: ["Energy"], power: 50, powerPerLevel: 0, calculation: "static", rounds: 1 }], requiredNinjutsuMastery: 100 } as never]);
    await insertUserItems([{ id: "unlock-armor", userId: USER_ID, itemId: "mastery-unlock-armor", equipped: "CHEST", durability: 100, level: 1 }]);
    const result = await (await caller()).stopMasteryTraining(await masterySession());
    expect(result.success).toBe(true);
    expect(result.userPatch?.ninjutsuMastery).toBe(110);
    expect(result.userPatch?.effectiveMasteries?.ninjutsuMastery).toBe(610);
    expect(result.userPatch?.maxEnergy).toBe(150);
    expect(result.userPatch?.currentlyTrainingMastery).toBeNull();
    expect(result.userPatch?.masteryTrainingStartedAt).toBeNull();
    expect(result.userPatch?.dailyTrainings).toBe(1);
    expect((await readUser()).ninjutsuMastery).toBe(110);
  });


  it("returns the guarded capped mastery gain without lowering an over-cap stored value", async () => {
    await trainee({ ninjutsuMastery: MAX_MASTERY_CAP + 10, currentlyTrainingMastery: "ninjutsuMastery", masteryTrainingStartedAt: minutesAgo(30), regeneration: 0 });
    const result = await (await caller()).stopMasteryTraining(await masterySession());
    expect(result.success).toBe(true);
    expect(result.userPatch?.ninjutsuMastery).toBe(MAX_MASTERY_CAP + 10);
    expect(result.userPatch?.effectiveMasteries?.ninjutsuMastery).toBe(MAX_MASTERY_CAP);
    expect(result.userPatch?.dailyTrainings).toBe(0);
    expect(result.userPatch?.currentlyTrainingMastery).toBeNull();
    expect((await readUser()).ninjutsuMastery).toBe(MAX_MASTERY_CAP + 10);
    expect(await readLogs()).toHaveLength(0);
  });

  it("does not patch an unclaimed concurrent mastery collection", async () => {
    await trainee({ ninjutsuMastery: 10, currentlyTrainingMastery: "ninjutsuMastery", masteryTrainingStartedAt: minutesAgo(30), regeneration: 0 });
    const api = await caller();
    const session = await masterySession();
    const results = await Promise.all([api.stopMasteryTraining(session), api.stopMasteryTraining(session)]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.find(result => !result.success)?.userPatch).toBeUndefined();
    expect((await readUser()).ninjutsuMastery).toBe(110);
    expect(await readLogs()).toHaveLength(1);
  });

  it.each([...CombatStatNames])("spends Energy only on %s and grants matching XP", async stat => {
    await trainee({curEnergy: 100, regeneration: 0});
    const before = await readUser();
    const result = await (await caller()).startTraining({stat, energy: 10});
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.curEnergy).toBe(90);
    expect(after.experience - before.experience).toBe(1);
    for (const other of CombatStatNames) expect(after[other] - before[other]).toBeCloseTo(other === stat ? 0.85 : 0);
    expect(await readLogs()).toHaveLength(1);
  });

  it("Energy training retains the Genin sensei bonus", async () => {
    await trainee({ curEnergy: 100, regeneration: 0, senseiId: "sensei" });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.offence - before.offence).toBeCloseTo(8.925);
    expect(after.curEnergy).toBe(0);
  });

  it("Energy training retains reduced gains after joining a village", async () => {
    await trainee({ rank: "JONIN", curEnergy: 100, regeneration: 0, joinedVillageAt: new Date() });
    const before = await readUser();
    const result = await (await caller()).startTraining({ stat: "offence", energy: 100 });
    expect(result.success).toBe(true);
    const after = await readUser();
    expect(after.offence - before.offence).toBeCloseTo(4.25);
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
    expect(after.experience).toBe(1);
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
    expect((await readUser()).experience).toBe(1);
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
      expect(after.curEnergy).toBe<number | undefined>(hydrated.user?.regeneration);
      expect(after.curEnergy).toBeGreaterThan(60);
      expect(after.curHealth).toBe<number | undefined>(hydrated.user?.regeneration);
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
    await trainee({offence: cap - 0.085, curEnergy: 100, regeneration: 0});
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
    const result = await api.stopMasteryTraining(await masterySession());
    expect(result.success).toBe(true);
    expect(result.userPatch?.ninjutsuMastery).toBe(before.ninjutsuMastery + 100);
    expect(result.userPatch?.currentlyTrainingMastery).toBeNull();
    const after = await readUser();
    expect(after.curEnergy).toBe(before.curEnergy);
    expect(after.experience).toBe(before.experience);
    expect(after.dailyTrainings).toBe(1);
    expect((await api.stopMasteryTraining(await masterySession())).success).toBe(false);
  });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "%s profile refreshes preserve unfinished regeneration ticks", async status => {
      const regenAt = new Date(Date.now() - 75000);
      await trainee({level: 2, status, curEnergy: 0, curHealth: 0, curChakra: 0, curStamina: 0, regeneration: 5, regenAt});
      const database = await getTestDatabase();
      const fetch = () => fetchUpdatedUser({client: database, userId: USER_ID, forceRegen: true});
      const hydrated = await fetch();
      const first = await readUser();
      expect(first.curEnergy).toBe<number | undefined>(hydrated.user?.regeneration);
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
