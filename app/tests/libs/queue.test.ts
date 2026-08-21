import { describe, expect, it } from "vitest";
import { getNextQueueSchedule, getQueueState, rescheduleQueue } from "@/libs/queue";
import { getQueueTotalCapacity, getQueueWaitingSlots } from "@/utils/paypal";

const user = (federalStatus: "NONE" | "NORMAL" | "SILVER" | "GOLD", staffAccount = false) =>
  ({ federalStatus, staffAccount }) as const;

describe("federal queue capacity", () => {
  it.each([
    ["NONE", 1, 2],
    ["NORMAL", 2, 3],
    ["SILVER", 3, 4],
    ["GOLD", 4, 5],
  ] as const)("maps %s to %i waiting and %i total", (status, waiting, total) => {
    expect(getQueueWaitingSlots(user(status))).toBe(waiting);
    expect(getQueueTotalCapacity(user(status))).toBe(total);
  });

  it("gives staff Gold capacity", () => {
    expect(getQueueWaitingSlots(user("NONE", true))).toBe(4);
    expect(getQueueTotalCapacity(user("NONE", true))).toBe(5);
  });
});

describe("queue scheduling", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("starts after the final unfinished job", () => {
    const result = getNextQueueSchedule(
      60,
      new Date("2026-01-01T00:02:00.000Z"),
      now,
    );
    expect(result.startsAt.toISOString()).toBe("2026-01-01T00:02:00.000Z");
    expect(result.finishesAt.toISOString()).toBe("2026-01-01T00:03:00.000Z");
  });

  it("closes gaps without changing durations", () => {
    const result = rescheduleQueue(
      [{ durationSeconds: 30 }, { durationSeconds: 90 }],
      now,
    );
    expect(result.map((job) => job.startsAt.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:30.000Z",
    ]);
    expect(result[1]?.finishesAt.toISOString()).toBe("2026-01-01T00:02:00.000Z");
  });

  it("derives waiting, active, due, completed, and cancelled states", () => {
    const base = {
      startsAt: now,
      finishesAt: new Date(now.getTime() + 60_000),
      completedAt: null,
      cancelledAt: null,
    };
    expect(getQueueState({ ...base, startsAt: new Date(now.getTime() + 1) }, now)).toBe(
      "WAITING",
    );
    expect(getQueueState(base, now)).toBe("ACTIVE");
    expect(getQueueState(base, new Date(now.getTime() + 60_000))).toBe("DUE");
    expect(getQueueState({ ...base, completedAt: now }, now)).toBe("COMPLETED");
    expect(getQueueState({ ...base, cancelledAt: now }, now)).toBe("CANCELLED");
  });
});
