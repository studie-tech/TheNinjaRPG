import { describe, expect, it } from "bun:test";
import type { UserQueue } from "@/drizzle/schema";
import {
  getEnergyQueue,
  getMasteryQueue,
  hasEnergyQueue,
  isOrderedSubsequence,
  liveQueueRows,
  queueHeadAfter,
} from "@/libs/queue";

const row = (kind: UserQueue["kind"], position: number, patch: Partial<UserQueue> = {}) =>
  ({ kind, position, stat: "offence", energy: 10, speed: "1hr", ...patch }) as UserQueue;

describe("queue rows", () => {
  it("keeps the live rows of one kind in position order", () => {
    const rows = [row("ENERGY", 3), row("MASTERY", 1), row("ENERGY", 1), row("ENERGY", 2)];
    expect(liveQueueRows(rows, "ENERGY", 1).map((r) => r.position)).toEqual([2, 3]);
    expect(liveQueueRows(rows, "MASTERY").map((r) => r.position)).toEqual([1]);
  });

  it("moves the head past consumed rows only", () => {
    const rows = [row("ENERGY", 4), row("ENERGY", 7)];
    expect(queueHeadAfter(rows, 0, 3)).toBe(3);
    expect(queueHeadAfter(rows, 1, 3)).toBe(4);
    expect(queueHeadAfter(rows, 2, 3)).toBe(7);
  });

  it("derives the entries the client edits", () => {
    const user = {
      energyQueueHead: 1,
      masteryQueueHead: 0,
      queue: [
        row("ENERGY", 1, { stat: "defence" }),
        row("ENERGY", 2, { stat: "speed", energy: 25 }),
        row("MASTERY", 1, { stat: "genjutsuMastery", speed: "15min" }),
      ],
    };
    expect(getEnergyQueue(user)).toEqual([{ stat: "speed", energy: 25 }]);
    expect(getMasteryQueue(user)).toEqual([{ stat: "genjutsuMastery", speed: "15min" }]);
  });

  it("guards Energy settlement from UserData columns alone", () => {
    expect(hasEnergyQueue({ energyQueueHead: 2, energyQueueTail: 2 })).toBe(false);
    expect(hasEnergyQueue({ energyQueueHead: 2, energyQueueTail: 3 })).toBe(true);
  });
});

describe("pure removals", () => {
  const a = { stat: "offence", energy: 1 };
  const b = { stat: "defence", energy: 2 };
  const c = { stat: "speed", energy: 3 };

  it("accepts entries removed in order", () => {
    expect(isOrderedSubsequence([], [a, b, c])).toBe(true);
    expect(isOrderedSubsequence([a, c], [a, b, c])).toBe(true);
    expect(isOrderedSubsequence([a, b, c], [a, b, c])).toBe(true);
  });

  it("rejects additions, changes and reordering", () => {
    expect(isOrderedSubsequence([a, b, c], [a, b])).toBe(false);
    expect(isOrderedSubsequence([{ ...a, energy: 5 }], [a])).toBe(false);
    expect(isOrderedSubsequence([b, a], [a, b])).toBe(false);
    expect(isOrderedSubsequence([a, a], [a])).toBe(false);
  });
});
