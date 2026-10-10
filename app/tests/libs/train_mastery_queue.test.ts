import { describe, expect, it } from "bun:test";
import { getUserCaps, MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import {
  calcMasteryTrainingAmount,
  getMasteryQueueSchedule,
  settleMasteryTrainingQueue,
  trainingSpeedSeconds,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import type { MasteryTrainingQueueEntry } from "@/validators/train";

const MINUTE = 60_000;
const start = new Date(Date.UTC(2026, 0, 1, 12, 0));
const after = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);
const mastery_cap = 375000;

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

  it("leaves a running session and the last session for the player to collect", () => {
    const running = settleMasteryTrainingQueue(
      trainee(),
      [{ stat: "genjutsuMastery", speed: "15min" }],
      [],
      after(10),
    );
    expect(running.consumed).toBe(0);
    expect(running.completed).toEqual([]);
    const last = settleMasteryTrainingQueue(trainee(), [], [], after(600));
    expect(last.currentlyTrainingMastery).toBe("ninjutsuMastery");
    expect(last.completed).toEqual([]);
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
