import { describe, it, expect } from "vitest";
import {
  isOrphanedSummon,
  spliceOrphanedSummons,
  hasLiveSummon,
} from "@/libs/combat/summon";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";

// Minimal fixture: only the fields the helpers read.
const mk = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x",
    controllerId: "x",
    isSummon: false,
    curHealth: 100,
    fledBattle: false,
    leftBattle: false,
    ...over,
  }) as unknown as BattleUserState;

const noEffects: UserEffect[] = [];

describe("isOrphanedSummon", () => {
  const summon = mk({ userId: "s1", controllerId: "p1", isSummon: true });

  it("not orphaned when controller is alive and present", () => {
    const controller = mk({ userId: "p1", controllerId: "p1" });
    expect(isOrphanedSummon(summon, [summon, controller], noEffects)).toBe(false);
  });

  it("orphaned when controller is dead (curHealth 0)", () => {
    const controller = mk({ userId: "p1", controllerId: "p1", curHealth: 0 });
    expect(isOrphanedSummon(summon, [summon, controller], noEffects)).toBe(true);
  });

  it("orphaned when controller fled", () => {
    const controller = mk({ userId: "p1", controllerId: "p1", fledBattle: true });
    expect(isOrphanedSummon(summon, [summon, controller], noEffects)).toBe(true);
  });

  it("orphaned when controller LEFT (leftBattle) -- stillInBattle ignores this", () => {
    const controller = mk({ userId: "p1", controllerId: "p1", leftBattle: true });
    expect(isOrphanedSummon(summon, [summon, controller], noEffects)).toBe(true);
  });

  it("orphaned when controller is gone from usersState", () => {
    expect(isOrphanedSummon(summon, [summon], noEffects)).toBe(true);
  });

  it("never orphans a non-summon entity", () => {
    const notSummon = mk({ userId: "p2", controllerId: "missing", isSummon: false });
    expect(isOrphanedSummon(notSummon, [notSummon], noEffects)).toBe(false);
  });
});

describe("spliceOrphanedSummons", () => {
  it("does nothing when every summon's controller is alive", () => {
    const state = [
      mk({ userId: "u1", controllerId: "u1", curHealth: 100 }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects);
    expect(removed).toEqual([]);
    expect(state).toHaveLength(2);
  });

  it("splices a summon whose controller is dead (curHealth 0)", () => {
    const state = [
      mk({ userId: "u1", controllerId: "u1", curHealth: 0 }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects);
    expect(removed).toEqual(["s1"]);
    expect(state.map((u) => u.userId)).toEqual(["u1"]);
  });

  it("splices a summon whose controller has fled", () => {
    const state = [
      mk({ userId: "u1", controllerId: "u1", fledBattle: true }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects);
    expect(removed).toEqual(["s1"]);
    expect(state.map((u) => u.userId)).toEqual(["u1"]);
  });

  it("splices a summon whose controller has LEFT (leftBattle) even if still alive", () => {
    const state = [
      mk({ userId: "u1", controllerId: "u1", curHealth: 100, leftBattle: true }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects);
    expect(removed).toEqual(["s1"]);
    expect(state.map((u) => u.userId)).toEqual(["u1"]);
  });

  it("splices a summon whose controller is gone from the array entirely", () => {
    const state = [
      mk({ userId: "enemy", controllerId: "enemy", curHealth: 100 }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects);
    expect(removed).toEqual(["s1"]);
    expect(state.map((u) => u.userId)).toEqual(["enemy"]);
  });

  it("preserves relative order of survivors after a mid-array splice", () => {
    const state = [
      mk({ userId: "u1", controllerId: "u1", curHealth: 0 }),
      mk({ userId: "s1", controllerId: "u1", isSummon: true, curHealth: 50 }),
      mk({ userId: "enemy", controllerId: "enemy", curHealth: 100 }),
    ];
    spliceOrphanedSummons(state, noEffects);
    expect(state.map((u) => u.userId)).toEqual(["u1", "enemy"]);
  });

  it("never splices a non-summon even if its controller is dead", () => {
    const state = [
      mk({ userId: "u1", controllerId: "u1", curHealth: 0 }),
      mk({ userId: "u2", controllerId: "u1", isSummon: false, curHealth: 100 }),
    ];
    const removed = spliceOrphanedSummons(state, noEffects);
    expect(removed).toEqual([]);
    expect(state).toHaveLength(2);
  });
});

describe("hasLiveSummon one-per-controller cap", () => {
  const player = mk({ userId: "p1", controllerId: "p1" });

  it("true while a live summon for the controller exists (blocks 2nd cast)", () => {
    const summon = mk({ userId: "s1", controllerId: "p1", isSummon: true });
    expect(hasLiveSummon([player, summon], "p1", noEffects)).toBe(true);
  });

  it("false when no summon exists (allows first cast)", () => {
    expect(hasLiveSummon([player], "p1", noEffects)).toBe(false);
  });

  it("false once the prior summon is dead (allows re-summon)", () => {
    const dead = mk({ userId: "s1", controllerId: "p1", isSummon: true, curHealth: 0 });
    expect(hasLiveSummon([player, dead], "p1", noEffects)).toBe(false);
  });

  it("false once the prior summon has left (allows re-summon)", () => {
    const left = mk({ userId: "s1", controllerId: "p1", isSummon: true, leftBattle: true });
    expect(hasLiveSummon([player, left], "p1", noEffects)).toBe(false);
  });

  it("ignores a live summon owned by a different controller", () => {
    const other = mk({ userId: "s2", controllerId: "p2", isSummon: true });
    expect(hasLiveSummon([player, other], "p1", noEffects)).toBe(false);
  });

  it("ignores a live clone (isSummon + isOriginal=false) so summon and clone coexist", () => {
    const clone = mk({
      userId: "c1",
      controllerId: "p1",
      isSummon: true,
      isOriginal: false,
    });
    expect(hasLiveSummon([player, clone], "p1", noEffects)).toBe(false);
  });

  it("still caps when a real summon and a clone are both live for the controller", () => {
    const summon = mk({ userId: "s1", controllerId: "p1", isSummon: true });
    const clone = mk({
      userId: "c1",
      controllerId: "p1",
      isSummon: true,
      isOriginal: false,
    });
    expect(hasLiveSummon([player, summon, clone], "p1", noEffects)).toBe(true);
  });
});
