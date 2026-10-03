// @vitest-environment node

import { eq } from "drizzle-orm";
import { setSystemTime } from "bun:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CombatStatNames, getUserCaps, MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import { quest, questHistory, trainingLog, userData, userVote } from "@/drizzle/schema";
import { trainRouter } from "@/server/api/routers/train";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * Both training slots against a real MySQL: the slot claim is a compare-and-swap in the
 * stop's WHERE and the mastery cap is a GREATEST/LEAST in its SET, so only the engine can
 * say which row they end up with.
 *
 * The trainee is an outlaw GENIN on the 15min speed with no village, clan or sensei, so a
 * session started over 15 minutes ago always pays exactly SESSION_GAIN.
 */
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

describeWithDatabase("train router against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(trainingLog, questHistory, quest, userVote, userData);
  });

  it.each(CombatStatNames)("credits only the trained %s stat", async (stat) => {
    await trainee({
      offence: 10,
      defence: 20,
      strength: 30,
      intelligence: 40,
      willpower: 50,
      speed: 60,
      experience: 0,
      currentlyTraining: stat,
      trainingStartedAt: minutesAgo(30),
    });
    const before = await readUser();
    expect((await (await caller()).stopTraining({ villageId: null })).success).toBe(
      true,
    );
    const after = await readUser();
    for (const combatStat of CombatStatNames) {
      expect(after[combatStat]).toBe(
        before[combatStat] + (combatStat === stat ? SESSION_GAIN : 0),
      );
    }
    expect(after.experience).toBe(SESSION_GAIN);
    expect(after.dailyTrainings).toBe(1);
    expect((await readLogs()).map((log) => [log.stat, log.amount])).toEqual([
      [stat, SESSION_GAIN],
    ]);
  });

  it("runs the combat and mastery slots side by side and pays each its own gain", async () => {
    await trainee({ offence: 50, experience: 0, taijutsuMastery: 10 });
    const api = await caller();

    expect((await api.startTraining({ stat: "offence" })).success).toBe(true);
    expect((await api.startMasteryTraining({ stat: "taijutsuMastery" })).success).toBe(
      true,
    );
    const started = await readUser();
    expect(started.currentlyTraining).toBe("offence");
    expect(started.currentlyTrainingMastery).toBe("taijutsuMastery");

    await backdate({
      trainingStartedAt: minutesAgo(30),
      masteryTrainingStartedAt: minutesAgo(30),
    });

    const combat = await api.stopTraining({ villageId: null });
    expect(combat.success).toBe(true);
    const afterCombat = await readUser();
    expect(afterCombat.offence).toBe(50 + SESSION_GAIN);
    expect(afterCombat.experience).toBe(SESSION_GAIN);
    expect(afterCombat.dailyTrainings).toBe(1);
    expect(afterCombat.lastCombatTrainingFinishedAt).not.toBeNull();
    // The mastery slot keeps running through a combat stop
    expect(afterCombat.currentlyTrainingMastery).toBe("taijutsuMastery");

    const mastery = await api.stopMasteryTraining({ villageId: null });
    expect(mastery.success).toBe(true);
    expect(mastery.data?.amount).toBe(SESSION_GAIN);
    const afterMastery = await readUser();
    expect(afterMastery.taijutsuMastery).toBe(10 + SESSION_GAIN);
    // Masteries never pay experience, but they share the daily allowance
    expect(afterMastery.experience).toBe(SESSION_GAIN);
    expect(afterMastery.dailyTrainings).toBe(2);
    expect(afterMastery.currentlyTrainingMastery).toBeNull();

    const logs = await readLogs();
    expect(logs.map((log) => [log.stat, log.amount]).sort()).toEqual([
      ["offence", SESSION_GAIN],
      ["taijutsuMastery", SESSION_GAIN],
    ]);
  });

  it("allows only one parallel start when a single daily training remains", async () => {
    await trainee({
      dailyTrainings: MAX_DAILY_TRAININGS - 1,
      offence: 50,
      taijutsuMastery: 10,
    });
    const api = await caller();
    const results = await Promise.all([
      api.startTraining({ stat: "offence" }),
      api.startMasteryTraining({ stat: "taijutsuMastery" }),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)?.message).toContain(
      String(MAX_DAILY_TRAININGS),
    );
    const user = await readUser();
    expect(
      Number(!!user.currentlyTraining) + Number(!!user.currentlyTrainingMastery),
    ).toBe(1);
  });

  it("starts both slots when two daily trainings remain", async () => {
    await trainee({
      dailyTrainings: MAX_DAILY_TRAININGS - 2,
      offence: 50,
      taijutsuMastery: 10,
    });
    const api = await caller();
    const results = await Promise.all([
      api.startTraining({ stat: "offence" }),
      api.startMasteryTraining({ stat: "taijutsuMastery" }),
    ]);

    expect(results.every((result) => result.success)).toBe(true);
    const user = await readUser();
    expect(user.currentlyTraining).toBe("offence");
    expect(user.currentlyTrainingMastery).toBe("taijutsuMastery");
  });

  it("clamps a mastery gain at the rank cap and reports only what landed", async () => {
    const start = GENIN_MASTERY_CAP - 40;
    await trainee({
      ninjutsuMastery: start,
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: minutesAgo(30),
    });
    const result = await (await caller()).stopMasteryTraining({ villageId: null });

    expect(result.success).toBe(true);
    expect(result.data?.amount).toBe(40);
    expect(result.message).toContain(GENIN_MASTERY_CAP.toLocaleString());
    const user = await readUser();
    expect(user.ninjutsuMastery).toBe(GENIN_MASTERY_CAP);
    expect(user.dailyTrainings).toBe(1);
    const logs = await readLogs();
    expect(logs.map((log) => log.amount)).toEqual([40]);
  });

  it("never lowers a mastery stored above the cap, and a zero gain spends nothing", async () => {
    const overCap = GENIN_MASTERY_CAP + 90_000;
    await trainee({
      ninjutsuMastery: overCap,
      dailyTrainings: 5,
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: minutesAgo(30),
    });
    const result = await (await caller()).stopMasteryTraining({ villageId: null });

    expect(result.success).toBe(true);
    expect(result.data?.amount).toBe(0);
    const user = await readUser();
    expect(user.ninjutsuMastery).toBe(overCap);
    expect(user.dailyTrainings).toBe(5);
    expect(user.currentlyTrainingMastery).toBeNull();
    expect(await readLogs()).toHaveLength(0);
  });

  it("refuses to start a mastery that is already at the rank cap", async () => {
    await trainee({ genjutsuMastery: GENIN_MASTERY_CAP });
    const result = await (await caller()).startMasteryTraining({
      stat: "genjutsuMastery",
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Already capped");
    expect((await readUser()).currentlyTrainingMastery).toBeNull();
  });

  it("does not let a stale mastery stop credit twice or end the next session", async () => {
    await trainee({
      ninjutsuMastery: 100,
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: minutesAgo(30),
    });
    const database = await getTestDatabase();
    const api = await caller();
    // The stale stop's first write to UserData is fetchUpdatedUser's regen claim, after its
    // read; the competing stop and restart run before its second write, the slot claim.
    let competingStop: Awaited<ReturnType<typeof api.stopMasteryTraining>> | undefined;
    let restart: Awaited<ReturnType<typeof api.startMasteryTraining>> | undefined;
    const stale = callerForDatabase(
      trainRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => undefined,
        async () => {
          competingStop = await api.stopMasteryTraining({ villageId: null });
          restart = await api.startMasteryTraining({ stat: "ninjutsuMastery" });
        },
      ]),
    );
    const result = await stale.stopMasteryTraining({ villageId: null });

    expect(competingStop?.success).toBe(true);
    expect(restart?.success).toBe(true);
    expect(result.success).toBe(false);
    const user = await readUser();
    expect(user.ninjutsuMastery).toBe(100 + SESSION_GAIN);
    expect(user.dailyTrainings).toBe(1);
    expect(user.currentlyTrainingMastery).toBe("ninjutsuMastery");
    expect(user.masteryTrainingStartedAt).not.toBeNull();
    expect(await readLogs()).toHaveLength(1);
  });

  it("does not let a stale combat stop credit twice or end the next session", async () => {
    await trainee({
      offence: 50,
      experience: 0,
      currentlyTraining: "offence",
      trainingStartedAt: minutesAgo(30),
    });
    const database = await getTestDatabase();
    const api = await caller();
    let competingStop: Awaited<ReturnType<typeof api.stopTraining>> | undefined;
    let restart: Awaited<ReturnType<typeof api.startTraining>> | undefined;
    const stale = callerForDatabase(
      trainRouter,
      USER_ID,
      beforeStatements(database, userData, [
        async () => undefined,
        async () => {
          competingStop = await api.stopTraining({ villageId: null });
          restart = await api.startTraining({ stat: "strength" });
        },
      ]),
    );
    const result = await stale.stopTraining({ villageId: null });

    expect(competingStop?.success).toBe(true);
    expect(restart?.success).toBe(true);
    expect(result.success).toBe(false);
    const user = await readUser();
    expect(user.offence).toBe(50 + SESSION_GAIN);
    expect(user.experience).toBe(SESSION_GAIN);
    expect(user.dailyTrainings).toBe(1);
    expect(user.currentlyTraining).toBe("strength");
    expect(await readLogs()).toHaveLength(1);
  });

  it("pays one session once when two stops race", async () => {
    await trainee({
      ninjutsuMastery: 100,
      currentlyTrainingMastery: "ninjutsuMastery",
      masteryTrainingStartedAt: minutesAgo(30),
    });
    const api = await caller();
    const results = await Promise.all([
      api.stopMasteryTraining({ villageId: null }),
      api.stopMasteryTraining({ villageId: null }),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    const user = await readUser();
    expect(user.ninjutsuMastery).toBe(100 + SESSION_GAIN);
    expect(user.dailyTrainings).toBe(1);
    expect(await readLogs()).toHaveLength(1);
  });

  describe("minutes_training credit from the mastery slot", () => {
    const trackedMinutes = async () => {
      const tracker = (await readUser()).questData?.find(
        (entry) => entry.id === "q-train",
      );
      return tracker?.goals.find((goal) => goal.id === "o1")?.value ?? 0;
    };

    beforeEach(async () => {
      await insertQuests([
        {
          id: "q-train",
          questType: "daily",
          content: {
            objectives: [
              SimpleObjective.parse({
                id: "o1",
                task: "minutes_training",
                value: 10_000,
              }),
            ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      await insertQuestHistory([
        { userId: USER_ID, questId: "q-train", questType: "daily" },
      ]);
    });

    it("credits only the minutes after the combat finish stored on the user", async () => {
      await trainee({
        taijutsuMastery: 10,
        currentlyTrainingMastery: "taijutsuMastery",
        masteryTrainingStartedAt: minutesAgo(60),
        lastCombatTrainingFinishedAt: minutesAgo(20),
      });
      const database = await getTestDatabase();
      await database.insert(trainingLog).values({
        userId: USER_ID,
        amount: SESSION_GAIN,
        stat: "offence",
        speed: "15min",
        trainingFinishedAt: minutesAgo(50),
      });
      const result = await (await caller()).stopMasteryTraining({ villageId: null });

      expect(result.success).toBe(true);
      expect(result.data?.creditedMinutes).toBeCloseTo(20, 0);
      expect(await trackedMinutes()).toBeCloseTo(20, 0);
    });

    it("does not credit the combat session again when mastery stops after it", async () => {
      await trainee({
        offence: 50,
        taijutsuMastery: 10,
        currentlyTraining: "offence",
        trainingStartedAt: minutesAgo(30),
        currentlyTrainingMastery: "taijutsuMastery",
        masteryTrainingStartedAt: minutesAgo(30),
      });
      const api = await caller();

      expect((await api.stopTraining({ villageId: null })).success).toBe(true);
      const mastery = await api.stopMasteryTraining({ villageId: null });

      expect(mastery.success).toBe(true);
      expect(mastery.data?.creditedMinutes ?? 0).toBeLessThan(1);
      expect(await trackedMinutes()).toBeCloseTo(30, 0);
    });

    it.each([
      { windows: [[40, 50]] },
      {
        windows: [
          [10, 20],
          [40, 50],
        ],
      },
    ])(
      "credits a 60-minute mastery session around combat windows $windows",
      async ({ windows }) => {
        const beginning = Date.now();
        setSystemTime(new Date(beginning));
        try {
          await trainee({ offence: 50, taijutsuMastery: 10 });
          const api = await caller();
          expect(
            (await api.startMasteryTraining({ stat: "taijutsuMastery" })).success,
          ).toBe(true);
          for (const window of windows) {
            const [start, finish] = window as [number, number];
            setSystemTime(new Date(beginning + start * MINUTE));
            expect((await api.startTraining({ stat: "offence" })).success).toBe(true);
            setSystemTime(new Date(beginning + finish * MINUTE));
            expect((await api.stopTraining({ villageId: null })).success).toBe(true);
          }
          setSystemTime(new Date(beginning + 60 * MINUTE));
          expect((await api.stopMasteryTraining({ villageId: null })).success).toBe(
            true,
          );
          expect(await trackedMinutes()).toBeCloseTo(60, 6);
        } finally {
          setSystemTime();
        }
      },
    );

    it.each(["combat", "mastery"] as const)(
      "preserves the mastery-only prefix when %s stops first",
      async (first) => {
        await trainee({
          offence: 50,
          taijutsuMastery: 10,
          currentlyTrainingMastery: "taijutsuMastery",
          masteryTrainingStartedAt: minutesAgo(60),
          currentlyTraining: "offence",
          trainingStartedAt: minutesAgo(20),
        });
        const api = await caller();
        if (first === "combat") {
          expect((await api.stopTraining({ villageId: null })).success).toBe(true);
          expect(await trackedMinutes()).toBeCloseTo(60, 0);
          expect((await api.stopMasteryTraining({ villageId: null })).success).toBe(
            true,
          );
        } else {
          const mastery = await api.stopMasteryTraining({ villageId: null });
          expect(mastery.success).toBe(true);
          expect(mastery.data?.creditedMinutes).toBeCloseTo(40, 0);
          expect((await api.stopTraining({ villageId: null })).success).toBe(true);
        }
        expect(await trackedMinutes()).toBeCloseTo(60, 0);
        expect((await readUser()).dailyTrainings).toBe(2);
      },
    );

    it.each(["combat", "mastery"] as const)(
      "rejects stale %s quest minutes after the other slot stops, then permits retry",
      async (first) => {
        await trainee({
          offence: 50,
          taijutsuMastery: 10,
          currentlyTrainingMastery: "taijutsuMastery",
          masteryTrainingStartedAt: minutesAgo(60),
          currentlyTraining: "offence",
          trainingStartedAt: minutesAgo(20),
        });
        const database = await getTestDatabase();
        const api = await caller();
        const stale = callerForDatabase(
          trainRouter,
          USER_ID,
          beforeStatements(database, userData, [
            async () => undefined,
            async () => {
              const other =
                first === "combat"
                  ? await api.stopMasteryTraining({ villageId: null })
                  : await api.stopTraining({ villageId: null });
              expect(other.success).toBe(true);
            },
          ]),
        );
        const rejected =
          first === "combat"
            ? await stale.stopTraining({ villageId: null })
            : await stale.stopMasteryTraining({ villageId: null });
        expect(rejected.success).toBe(false);
        expect(rejected.message).toContain("try again");
        const retry =
          first === "combat"
            ? await api.stopTraining({ villageId: null })
            : await api.stopMasteryTraining({ villageId: null });
        expect(retry.success).toBe(true);
        expect(await trackedMinutes()).toBeCloseTo(60, 0);
        expect(await readLogs()).toHaveLength(2);
      },
    );

    it("leaves overlapping minutes to the combat slot while it is still running", async () => {
      await trainee({
        taijutsuMastery: 10,
        currentlyTrainingMastery: "taijutsuMastery",
        masteryTrainingStartedAt: minutesAgo(60),
        currentlyTraining: "strength",
        trainingStartedAt: minutesAgo(60),
      });
      const result = await (await caller()).stopMasteryTraining({ villageId: null });

      expect(result.success).toBe(true);
      expect(result.data?.amount).toBe(SESSION_GAIN);
      expect(result.data?.creditedMinutes).toBe(0);
      expect(await trackedMinutes()).toBe(0);
    });
  });
});
