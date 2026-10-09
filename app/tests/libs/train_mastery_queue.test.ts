import { describe, expect, it } from "vitest";
import { getUserCaps, MAX_DAILY_TRAININGS } from "@/drizzle/constants";
import {
  calcMasteryTrainingAmount,
  getMasteryQueueSchedule,
  settleMasteryTrainingQueue,
  trainingSpeedSeconds,
} from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";

const MINUTE = 60_000;
const start = new Date(Date.UTC(2026, 0, 1, 12, 0));
const after = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);
const { mastery_cap } = getUserCaps("GENIN");

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
    masteryTrainingQueue: [],
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

describe("mastery training queue settlement", () => {
  it("collects finished sessions and starts each queued one at the previous end", () => {
    const user = trainee({
      masteryTrainingQueue: [
        { stat: "genjutsuMastery", speed: "1hr" },
        { stat: "taijutsuMastery", speed: "15min" },
      ],
    });
    // 15min ninjutsu ends at +15, 1hr genjutsu at +75; taijutsu is running at +80.
    const result = settleMasteryTrainingQueue(user, [], after(80));
    expect(result.completed.map((e) => [e.stat, e.finishedAt])).toEqual([
      ["ninjutsuMastery", after(15)],
      ["genjutsuMastery", after(75)],
    ]);
    expect(result.gains.ninjutsuMastery).toBeCloseTo(fullSession("15min"));
    expect(result.gains.genjutsuMastery).toBeCloseTo(fullSession("1hr"));
    expect(result.currentlyTrainingMastery).toBe("taijutsuMastery");
    expect(result.masteryTrainingStartedAt).toEqual(after(75));
    expect(result.trainingSpeed).toBe("15min");
    expect(result.masteryTrainingQueue).toEqual([]);
    expect(result.dailyTrainings).toBe(2);
    expect(result.advanced).toBe(true);
  });

  it("gives the same result however late it runs", () => {
    const user = trainee({
      masteryTrainingQueue: [{ stat: "genjutsuMastery", speed: "1hr" }],
    });
    const early = settleMasteryTrainingQueue(user, [], after(16));
    const late = settleMasteryTrainingQueue(user, [], after(70));
    expect(late).toEqual(early);
  });

  it("leaves a running session and the last session for the player to collect", () => {
    const running = settleMasteryTrainingQueue(
      trainee({ masteryTrainingQueue: [{ stat: "genjutsuMastery", speed: "15min" }] }),
      [],
      after(10),
    );
    expect(running.advanced).toBe(false);
    expect(running.completed).toEqual([]);
    const last = settleMasteryTrainingQueue(trainee(), [], after(600));
    expect(last.currentlyTrainingMastery).toBe("ninjutsuMastery");
    expect(last.completed).toEqual([]);
  });

  it("drops capped masteries and caps the collected gain", () => {
    const result = settleMasteryTrainingQueue(
      trainee({
        ninjutsuMastery: mastery_cap - 0.5,
        genjutsuMastery: mastery_cap,
        masteryTrainingQueue: [
          { stat: "genjutsuMastery", speed: "15min" },
          { stat: "sageMastery", speed: "15min" },
        ],
      }),
      [],
      after(20),
    );
    expect(result.gains.ninjutsuMastery).toBeCloseTo(0.5);
    expect(result.currentlyTrainingMastery).toBe("sageMastery");
    expect(result.masteryTrainingQueue).toEqual([]);
  });

  it("pauses at the daily session limit and for banned non-8hr intervals", () => {
    const capped = settleMasteryTrainingQueue(
      trainee({
        dailyTrainings: MAX_DAILY_TRAININGS - 1,
        masteryTrainingQueue: [{ stat: "genjutsuMastery", speed: "15min" }],
      }),
      [],
      after(20),
    );
    expect(capped.advanced).toBe(false);
    expect(capped.currentlyTrainingMastery).toBe("ninjutsuMastery");
    const banned = settleMasteryTrainingQueue(
      trainee({
        isBanned: true,
        masteryTrainingQueue: [{ stat: "genjutsuMastery", speed: "15min" }],
      }),
      [],
      after(20),
    );
    expect(banned.advanced).toBe(false);
  });

  it("schedules queued sessions behind the active one for display", () => {
    const schedule = getMasteryQueueSchedule(
      trainee({
        masteryTrainingQueue: [
          { stat: "genjutsuMastery", speed: "1hr" },
          { stat: "sageMastery", speed: "15min" },
        ],
      }),
    );
    expect(schedule.map((e) => [e.startsAt, e.finishesAt])).toEqual([
      [after(15), after(75)],
      [after(75), after(90)],
    ]);
  });
});
