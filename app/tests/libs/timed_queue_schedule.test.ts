import { describe, expect, it } from "bun:test";
import {
  getNextQueueSchedule,
  getQueuedJobStart,
  latestDate,
  rescheduleQueue,
} from "@/libs/queue";

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes));
const now = at(30);

describe("timed queue scheduling", () => {
  it("places a new job behind the job that finishes last", () => {
    expect(getNextQueueSchedule(600, at(40), now)).toEqual({
      startsAt: at(40),
      finishesAt: at(50),
    });
    // Nothing running any more: the job starts immediately.
    expect(getNextQueueSchedule(600, at(10), now)).toEqual({
      startsAt: now,
      finishesAt: at(40),
    });
  });

  it("chains waiting jobs back to back", () => {
    const moved = rescheduleQueue(
      [{ durationSeconds: 300 }, { durationSeconds: 120 }],
      at(0),
    );
    expect(moved.map(({ startsAt, finishesAt }) => [startsAt, finishesAt])).toEqual([
      [at(0), at(5)],
      [at(5), at(7)],
    ]);
  });

  it("waits while an earlier job is still running", () => {
    expect(
      getQueuedJobStart({
        scheduledStart: at(40),
        lastFinish: at(40),
        chainedFinish: null,
        now,
      }),
    ).toBeNull();
    expect(
      getQueuedJobStart({
        scheduledStart: at(10),
        lastFinish: null,
        chainedFinish: at(35),
        now,
      }),
    ).toBeNull();
  });

  it("backdates a job to the finish of the job before it", () => {
    // Settled late: the job ran from its slot, not from when settlement happened.
    expect(
      getQueuedJobStart({
        scheduledStart: at(10),
        lastFinish: at(10),
        chainedFinish: null,
        now,
      }),
    ).toEqual(at(10));
    // Within one settlement pass the next job follows the one just started.
    expect(
      getQueuedJobStart({
        scheduledStart: at(5),
        lastFinish: at(0),
        chainedFinish: at(20),
        now,
      }),
    ).toEqual(at(20));
  });

  it("starts now instead of idling when the job ahead was stopped early", () => {
    expect(
      getQueuedJobStart({
        scheduledStart: at(45),
        lastFinish: at(0),
        chainedFinish: null,
        now,
      }),
    ).toEqual(now);
  });

  it("never starts before a recorded finish", () => {
    expect(
      getQueuedJobStart({
        scheduledStart: at(5),
        lastFinish: at(20),
        chainedFinish: null,
        now,
      }),
    ).toEqual(at(20));
  });

  it("picks the latest of the recorded finishes", () => {
    expect(latestDate([null, at(3), undefined, at(9), at(1)])).toEqual(at(9));
    expect(latestDate([])).toBeNull();
  });
});
