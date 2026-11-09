import { describe, expect, it } from "bun:test";
import {
  ELEMENTAL_MASTERY_CAP,
  MASTERY_RANK_CAPS,
  MAX_DAILY_TRAININGS,
  type MasteryQueueKind,
  TOTAL_MASTERY_CAP,
} from "@/drizzle/constants";
import type { UserQueue } from "@/drizzle/schema";
import {
  applyMasteryTrainingGains,
  calcMasteryTrainingAmount,
  getMasteryQueueSchedule,
  settleMasteryTrainingQueue,
  settleQueuedTraining,
  trainingSpeedSeconds,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import type { MasteryTrainingQueueEntry } from "@/validators/train";

const MINUTE = 60_000;
const start = new Date(Date.UTC(2026, 0, 1, 12, 0));
const after = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);
const mastery_cap = MASTERY_RANK_CAPS.NONE;

const trainee = (patch: Record<string, unknown> = {}) =>
  ({
    userId: "trainee",
    rank: "GENIN",
    status: "AWAKE",
    isOutlaw: true,
    isBanned: false,
    villageId: null,
    village: null,
    clan: null,
    dailyTrainings: 0,
    trainingSpeed: "15min",
    currentlyTrainingMastery: "ninjutsuMastery",
    masteryTrainingStartedAt: start,
    currentlyTrainingElement: "Wind",
    elementalTrainingStartedAt: start,
    elementalTrainingSpeed: "15min",
    elementalMastery: {},
    masteryQueueHead: 0,
    elementalQueueHead: 0,
    energyQueueHead: 0,
    ninjutsuMastery: 0,
    genjutsuMastery: 0,
    taijutsuMastery: 0,
    bukijutsuMastery: 0,
    bloodlineMastery: 0,
    sageMastery: 0,
    ...patch,
  }) as unknown as NonNullable<UserWithRelations>;

const fullSession = (speed: "15min" | "1hr") =>
  calcMasteryTrainingAmount(
    trainee({ trainingSpeed: speed }),
    [],
    trainingSpeedSeconds(speed),
  );

type Queue = MasteryTrainingQueueEntry[];
const genjutsuHour: Queue = [{ stat: "genjutsuMastery", speed: "1hr" }];

const queueRows = (kind: MasteryQueueKind, entries: Queue): UserQueue[] =>
  entries.map((entry, index) => ({
    id: `${kind}-${index}`,
    userId: "trainee",
    kind,
    position: index + 1,
    stat: entry.stat,
    speed: entry.speed,
    jutsuId: null,
    itemId: null,
    energy: null,
    reservedRyo: null,
    quantity: null,
    materials: null,
    durationSeconds: null,
    startsAt: null,
    finishesAt: null,
    createdAt: start,
  }));

const refreshQueues = (
  user: NonNullable<UserWithRelations>,
  rows: UserQueue[],
  minutes: number[],
) =>
  minutes.reduce((current, minute) => {
    const result = settleQueuedTraining(current, rows, [], 0, after(minute)).mastery;
    return result
      ? {
          ...current,
          ...applyMasteryTrainingGains(current, result.gains),
          ...result.update,
        }
      : current;
  }, user);

describe("combined mastery and elemental queue settlement", () => {
  it("shares the last daily allowance between standalone sessions in finish order", () => {
    const user = trainee({ dailyTrainings: MAX_DAILY_TRAININGS - 1 });
    const result = settleQueuedTraining(user, [], [], 0, after(16)).mastery;
    expect(result?.gains).toEqual({ ninjutsuMastery: fullSession("15min") });
    expect(result?.completed.map((entry) => entry.stat)).toEqual(["ninjutsuMastery"]);
    expect(result?.update).toMatchObject({
      dailyTrainings: MAX_DAILY_TRAININGS,
      currentlyTrainingMastery: null,
      masteryTrainingStartedAt: null,
      currentlyTrainingElement: null,
      elementalTrainingStartedAt: null,
    });
    const earlierElement = settleQueuedTraining(
      { ...user, trainingSpeed: "1hr" },
      [],
      [],
      0,
      after(61),
    ).mastery;
    expect(earlierElement?.gains).toEqual({ Wind: fullSession("15min") });
    expect(earlierElement?.update.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
  });

  it("uses the shared daily allowance in finish order regardless of refresh cadence", () => {
    const user = trainee({
      dailyTrainings: MAX_DAILY_TRAININGS - 2,
      trainingSpeed: "1hr",
    });
    const rows = [
      ...queueRows("MASTERY", genjutsuHour),
      ...queueRows("ELEMENT", [{ stat: "Earth", speed: "1hr" }]),
    ];
    const offline = refreshQueues(user, rows, [61]);
    expect(offline).toEqual(refreshQueues(user, rows, [16, 61]));
    expect(offline).toEqual(
      expect.objectContaining({
        dailyTrainings: MAX_DAILY_TRAININGS - 1,
        ninjutsuMastery: 0,
        currentlyTrainingMastery: "ninjutsuMastery",
        masteryQueueHead: 0,
        elementalMastery: expect.objectContaining({ Wind: fullSession("15min") }),
        currentlyTrainingElement: "Earth",
        elementalTrainingStartedAt: after(15),
        elementalQueueHead: 1,
      }),
    );
  });

  it("reselects the next finish after each handoff and stops at the shared allowance", () => {
    const user = trainee({
      dailyTrainings: MAX_DAILY_TRAININGS - 3,
      trainingSpeed: "1hr",
      federalStatus: "GOLD",
    });
    const rows = [
      ...queueRows("MASTERY", genjutsuHour),
      ...queueRows("ELEMENT", [
        { stat: "Earth", speed: "15min" },
        { stat: "Lightning", speed: "15min" },
        { stat: "Wind", speed: "15min" },
      ]),
    ];
    const offline = refreshQueues(user, rows, [61]);
    expect(offline).toEqual(refreshQueues(user, rows, [16, 31, 46, 61]));
    expect(offline).toEqual(
      expect.objectContaining({
        dailyTrainings: MAX_DAILY_TRAININGS - 1,
        ninjutsuMastery: 0,
        masteryQueueHead: 0,
        elementalMastery: expect.objectContaining({
          Wind: fullSession("15min"),
          Earth: fullSession("15min"),
        }),
        currentlyTrainingElement: "Lightning",
        elementalTrainingStartedAt: after(30),
        elementalQueueHead: 2,
      }),
    );
  });

  it("keeps mastery first for tied finishes at the shared daily limit", () => {
    const user = trainee({ dailyTrainings: MAX_DAILY_TRAININGS - 2 });
    const rows = [
      ...queueRows("ELEMENT", [{ stat: "Earth", speed: "1hr" }]),
      ...queueRows("MASTERY", genjutsuHour),
    ];
    const result = refreshQueues(user, rows, [16]);
    expect(result).toMatchObject({
      dailyTrainings: MAX_DAILY_TRAININGS - 1,
      ninjutsuMastery: fullSession("15min"),
      currentlyTrainingMastery: "genjutsuMastery",
      masteryQueueHead: 1,
      elementalMastery: {},
      currentlyTrainingElement: "Wind",
      elementalQueueHead: 0,
    });
  });

  it("accumulates repeated gains, drops capped repeats and collects final sessions", () => {
    const user = trainee({
      trainingSpeed: "1hr",
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP - 150 },
      federalStatus: "GOLD",
    });
    const rows = [
      ...queueRows("MASTERY", genjutsuHour),
      ...queueRows("ELEMENT", [
        { stat: "Wind", speed: "15min" },
        { stat: "Wind", speed: "15min" },
        { stat: "Earth", speed: "15min" },
      ]),
    ];
    const offline = refreshQueues(user, rows, [180]);
    expect(offline).toEqual(refreshQueues(user, rows, [16, 31, 61, 180]));
    expect(offline).toMatchObject({
      dailyTrainings: 5,
      ninjutsuMastery: fullSession("1hr"),
      genjutsuMastery: fullSession("1hr"),
      currentlyTrainingMastery: null,
      masteryTrainingStartedAt: null,
      masteryQueueHead: 1,
      elementalMastery: { Wind: ELEMENTAL_MASTERY_CAP, Earth: fullSession("15min") },
      currentlyTrainingElement: null,
      elementalTrainingStartedAt: null,
      elementalQueueHead: 3,
    });
  });
});

describe("mastery training queue settlement", () => {
  it("collects finished sessions and starts each queued one at the previous end", () => {
    const queue: Queue = [...genjutsuHour, { stat: "taijutsuMastery", speed: "15min" }];
    // 15min ninjutsu ends at +15, 1hr genjutsu at +75; taijutsu is running at +80.
    const result = settleMasteryTrainingQueue(trainee(), queue, [], after(80));
    expect(result.completed.map((e) => [e.stat, e.finishedAt])).toEqual([
      ["ninjutsuMastery", after(15)],
      ["genjutsuMastery", after(75)],
    ]);
    expect(result.gains.ninjutsuMastery).toBeCloseTo(fullSession("15min"));
    expect(result.gains.genjutsuMastery).toBeCloseTo(fullSession("1hr"));
    expect(result.currentlyTrainingMastery).toBe("taijutsuMastery");
    expect(result.masteryTrainingStartedAt).toEqual(after(75));
    expect(result.trainingSpeed).toBe("15min");
    expect(result.remaining).toEqual([]);
    expect(result.dailyTrainings).toBe(2);
    expect(result.consumed).toBe(2);
  });

  it("gives the same result however late it runs", () => {
    const early = settleMasteryTrainingQueue(trainee(), genjutsuHour, [], after(16));
    const late = settleMasteryTrainingQueue(trainee(), genjutsuHour, [], after(70));
    expect(late).toEqual(early);
  });

  it("leaves a running session unchanged and collects the final session at its deadline", () => {
    const running = settleMasteryTrainingQueue(
      trainee(),
      [{ stat: "genjutsuMastery", speed: "15min" }],
      [],
      after(10),
    );
    expect(running.consumed).toBe(0);
    expect(running.completed).toEqual([]);
    const last = settleMasteryTrainingQueue(trainee(), [], [], after(15));
    expect(last.currentlyTrainingMastery).toBeNull();
    expect(last.masteryTrainingStartedAt).toBeNull();
    expect(last.gains.ninjutsuMastery).toBeCloseTo(fullSession("15min"));
    expect(last.completed.map((entry) => entry.finishedAt)).toEqual([after(15)]);
    expect(last.dailyTrainings).toBe(1);
    expect(last.consumed).toBe(0);
    expect(settleMasteryTrainingQueue(trainee(), [], [], after(600))).toEqual(last);
  });

  it("collects every queued session including the final one when catching up offline", () => {
    const result = settleMasteryTrainingQueue(
      trainee(),
      [...genjutsuHour, { stat: "taijutsuMastery", speed: "15min" }],
      [],
      after(600),
    );
    expect(result.completed.map((entry) => [entry.stat, entry.finishedAt])).toEqual([
      ["ninjutsuMastery", after(15)],
      ["genjutsuMastery", after(75)],
      ["taijutsuMastery", after(90)],
    ]);
    expect(result.currentlyTrainingMastery).toBeNull();
    expect(result.masteryTrainingStartedAt).toBeNull();
    expect(result.remaining).toEqual([]);
    expect(result.dailyTrainings).toBe(3);
    expect(result.consumed).toBe(2);
  });

  it("returns final-session completion without waiting rows and cannot credit it twice", () => {
    const user = trainee({
      masteryQueueHead: 2,
      energyQueueHead: 0,
      currentlyTrainingElement: null,
    });
    expect(settleQueuedTraining(user, [], [], 0, after(10)).mastery).toBeNull();
    const result = settleQueuedTraining(user, [], [], 0, after(15)).mastery;
    expect(result?.update.masteryQueueHead).toBe(2);
    expect(result?.completed).toHaveLength(1);
    expect(result?.update.currentlyTrainingMastery).toBeNull();
    expect(
      settleQueuedTraining({ ...user, ...result?.update }, [], [], 0, after(600))
        .mastery,
    ).toBeNull();
  });

  it("clears a capped final session without granting gains or counting another session", () => {
    const user = trainee({
      ninjutsuMastery: mastery_cap,
      masteryQueueHead: 0,
      energyQueueHead: 0,
      currentlyTrainingElement: null,
    });
    const result = settleQueuedTraining(user, [], [], 0, after(15)).mastery;
    expect(result?.update.currentlyTrainingMastery).toBeNull();
    expect(result?.update.masteryTrainingStartedAt).toBeNull();
    expect(result?.gains).toEqual({});
    expect(result?.completed).toEqual([]);
    expect(result?.update.dailyTrainings).toBe(0);
  });

  it("collects the final authorized session at the daily limit without starting another", () => {
    const result = settleMasteryTrainingQueue(
      trainee({ dailyTrainings: MAX_DAILY_TRAININGS - 1 }),
      [],
      [],
      after(15),
    );
    expect(result.currentlyTrainingMastery).toBeNull();
    expect(result.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
    expect(result.completed).toHaveLength(1);
  });

  it("clears an exhausted final session but keeps a queued successor paused", () => {
    const user = trainee({ dailyTrainings: MAX_DAILY_TRAININGS });
    const final = settleMasteryTrainingQueue(user, [], [], after(16));
    expect(final.currentlyTrainingMastery).toBeNull();
    expect(final.masteryTrainingStartedAt).toBeNull();
    expect(final.gains).toEqual({});
    expect(final.completed).toEqual([]);
    expect(final.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
    const paused = settleMasteryTrainingQueue(user, genjutsuHour, [], after(16));
    expect(paused.currentlyTrainingMastery).toBe("ninjutsuMastery");
    expect(paused.remaining).toEqual(genjutsuHour);
    expect(paused.consumed).toBe(0);
    expect(paused.gains).toEqual({});
    expect(paused.dailyTrainings).toBe(MAX_DAILY_TRAININGS);
  });

  it("drops capped masteries and caps the collected gain", () => {
    const result = settleMasteryTrainingQueue(
      trainee({ ninjutsuMastery: mastery_cap - 0.5, genjutsuMastery: mastery_cap }),
      [
        { stat: "genjutsuMastery", speed: "15min" },
        { stat: "sageMastery", speed: "15min" },
      ],
      [],
      after(20),
    );
    expect(result.gains.ninjutsuMastery).toBeCloseTo(0.5);
    expect(result.currentlyTrainingMastery).toBe("sageMastery");
    expect(result.remaining).toEqual([]);
    expect(result.consumed).toBe(2);
  });

  it("collects the active session and drops its only repeat when that gain caps it", () => {
    const result = settleMasteryTrainingQueue(
      trainee({ ninjutsuMastery: mastery_cap - 0.5 }),
      [{ stat: "ninjutsuMastery", speed: "1hr" }],
      [],
      after(20),
    );
    expect(result.gains.ninjutsuMastery).toBeCloseTo(0.5);
    expect(result.currentlyTrainingMastery).toBeNull();
    expect(result.masteryTrainingStartedAt).toBeNull();
    expect(result.remaining).toEqual([]);
    expect(result.consumed).toBe(1);
    expect(result.completed).toHaveLength(1);
    expect(result.dailyTrainings).toBe(1);
  });

  it("pauses at the daily session limit and for banned non-8hr intervals", () => {
    const queue: Queue = [{ stat: "genjutsuMastery", speed: "15min" }];
    const capped = settleMasteryTrainingQueue(
      trainee({ dailyTrainings: MAX_DAILY_TRAININGS - 1 }),
      queue,
      [],
      after(20),
    );
    expect(capped.consumed).toBe(0);
    expect(capped.currentlyTrainingMastery).toBe("ninjutsuMastery");
    const banned = settleMasteryTrainingQueue(
      trainee({ isBanned: true }),
      queue,
      [],
      after(20),
    );
    expect(banned.consumed).toBe(0);
  });

  it("drops other queued disciplines when the active gain fills the shared cap", () => {
    const result = settleMasteryTrainingQueue(
      trainee({
        ninjutsuMastery: TOTAL_MASTERY_CAP / 6 - 1,
        genjutsuMastery: TOTAL_MASTERY_CAP / 6,
        taijutsuMastery: TOTAL_MASTERY_CAP / 6,
        bukijutsuMastery: TOTAL_MASTERY_CAP / 6,
        bloodlineMastery: TOTAL_MASTERY_CAP / 6,
        sageMastery: TOTAL_MASTERY_CAP / 6,
        masteryRanks: {
          ninjutsuMastery: "MASTER",
          genjutsuMastery: "MASTER",
          taijutsuMastery: "MASTER",
          bukijutsuMastery: "MASTER",
          bloodlineMastery: "MASTER",
          sageMastery: "MASTER",
        },
      }),
      [
        { stat: "genjutsuMastery", speed: "15min" },
        { stat: "taijutsuMastery", speed: "15min" },
      ],
      [],
      after(20),
    );
    expect(result.gains).toEqual({ ninjutsuMastery: 1 });
    expect(result.currentlyTrainingMastery).toBeNull();
    expect(result.masteryTrainingStartedAt).toBeNull();
    expect(result.remaining).toEqual([]);
    expect(result.consumed).toBe(2);
    expect(result.completed).toHaveLength(1);
    expect(result.dailyTrainings).toBe(1);
  });

  it("schedules queued sessions behind the active one for display", () => {
    const schedule = getMasteryQueueSchedule(trainee(), [
      ...genjutsuHour,
      { stat: "sageMastery", speed: "15min" },
    ]);
    expect(schedule).toEqual([
      {
        stat: "genjutsuMastery",
        speed: "1hr",
        startsAt: after(15),
        finishesAt: after(75),
      },
      {
        stat: "sageMastery",
        speed: "15min",
        startsAt: after(75),
        finishesAt: after(90),
      },
    ]);
    // Without an active session the chain starts now.
    const idle = getMasteryQueueSchedule(
      trainee({ currentlyTrainingMastery: null, masteryTrainingStartedAt: null }),
      genjutsuHour,
      after(5),
    );
    expect(idle).toEqual([
      {
        stat: "genjutsuMastery",
        speed: "1hr",
        startsAt: after(5),
        finishesAt: after(65),
      },
    ]);
  });
});
