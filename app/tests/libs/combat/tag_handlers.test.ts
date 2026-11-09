import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  cleanse,
  clear,
  curse,
  decreaseStats,
  heal,
  increaseStats,
  move,
  wound,
} from "@/libs/combat/tags";
import type { Consequence, GroundEffect, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeEffect } from "../../setup/combat";

const ROUND = 5;
const target = () => makeBattleUser("defender", { longitude: 1, latitude: 1 });
const cast = {
  creatorId: "attacker",
  targetId: "defender",
  targetType: "user" as const,
  createdRound: ROUND,
  isNew: true,
  castThisRound: true,
};
const preventTag = (
  type: "buffprevent" | "debuffprevent" | "healprevent",
  createdRound: number,
) =>
  makeEffect(
    type,
    { power: 100, rounds: 3 },
    {
      ...cast,
      id: "prevent",
      createdRound,
      isNew: false,
      castThisRound: false,
    },
  );

afterEach(() => vi.restoreAllMocks());

describe("prevent tag age", () => {
  const handlers = [
    {
      kind: "buffprevent" as const,
      message: "defender cannot be buffed",
      run: (effects: UserEffect[]) => {
        const effect = makeEffect(
          "increasestat",
          { rounds: 1, power: 10, generalTypes: ["Strength"] },
          cast,
        );
        return { effect, info: increaseStats(effect, effects, target()) };
      },
    },
    {
      kind: "debuffprevent" as const,
      message: "defender cannot be debuffed",
      run: (effects: UserEffect[]) => {
        const effect = makeEffect(
          "decreasestat",
          { rounds: 1, power: 10, generalTypes: ["Strength"] },
          cast,
        );
        return { effect, info: decreaseStats(effect, effects, target()) };
      },
    },
    {
      kind: "healprevent" as const,
      message: "defender cannot be healed",
      run: (effects: UserEffect[]) => {
        const effect = makeEffect(
          "heal",
          { rounds: 1, power: 10, calculation: "percentage" },
          cast,
        );
        return { effect, info: heal(effect, effects, target(), new Map(), 1) };
      },
    },
    {
      kind: "buffprevent" as const,
      message: "defender cannot be buffed",
      run: (effects: UserEffect[]) => {
        const effect = makeEffect("curse", { rounds: 3, power: 10 }, cast);
        return { effect, info: curse(effect, effects, target(), ROUND) };
      },
    },
  ];

  it.each(handlers)("rolls $message only for older tags", ({ kind, message, run }) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const older = run([preventTag(kind, ROUND - 1)]);
    expect(older.info?.txt).toBe(message);
    expect(older.effect.rounds).toBe(0);
    for (const age of [ROUND, ROUND + 1]) {
      const newer = run([preventTag(kind, age)]);
      expect(newer.info?.txt).not.toBe(message);
      expect(newer.effect.rounds).not.toBe(0);
    }
  });

  it.each(handlers)("lets $message pass a failed roll", ({ kind, message, run }) => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const weak = preventTag(kind, ROUND - 1);
    weak.power = 40;
    expect(run([weak]).info?.txt).not.toBe(message);
  });
});

describe("Clear and Cleanse text", () => {
  const scenarios = [
    { name: "clear", run: clear, type: "positive" },
    { name: "cleanse", run: cleanse, type: "negative" },
  ] as const;

  it.each(scenarios)(
    "announces upcoming rounds when a new $name misses",
    ({ name, run, type }) => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const effect = makeEffect(name, { power: 10, rounds: 3 }, cast);
      expect(run(effect, [], target()).txt).toBe(
        `All ${type} status effects may be cleared from defender during the next 3 rounds. defender could not be cleared of ${type} status effects this round. `,
      );
      expect(effect).toMatchObject({ rounds: 3, power: 10 });
    },
  );

  it.each(scenarios)(
    "reports only the miss for a running or instant $name",
    ({ name, run, type }) => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const miss = `defender could not be cleared of ${type} status effects this round. `;
      const running = makeEffect(
        name,
        { power: 10, rounds: 3 },
        { ...cast, isNew: false },
      );
      expect(run(running, [], target()).txt).toBe(miss);
      const instant = makeEffect(name, { power: 10, rounds: 0 }, cast);
      expect(run(instant, [], target()).txt).toBe(miss);
    },
  );

  it.each(scenarios)("expires a successful $name at once", ({ name, run, type }) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const effect = makeEffect(name, { power: 10, rounds: 3 }, cast);
    expect(run(effect, [], target()).txt).toBe(
      `defender was cleared of all ${type} status effects. `,
    );
    expect(effect).toMatchObject({ rounds: 0, power: 100 });
  });

  it.each(scenarios)(
    "treats an authored power of 100 as a success when the roll misses ($name)",
    ({ name, run, type }) => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const effect = makeEffect(
        name,
        { power: 100, rounds: 3 },
        { ...cast, level: 50 },
      );
      effect.powerPerLevel = -1;
      expect(run(effect, [], target()).txt).toBe(
        `defender was cleared of all ${type} status effects. `,
      );
      expect(effect.rounds).toBe(0);
    },
  );
});

describe("wound ticks", () => {
  const tick = (originalDamage: number) => {
    const effect = makeEffect(
      "wound",
      { power: 20, rounds: 2 },
      {
        ...cast,
        isNew: false,
        castThisRound: false,
      },
    );
    effect.timeTracker = { originalDamage };
    const consequences = new Map<string, Consequence>();
    wound(effect, [], consequences, target());
    return consequences;
  };

  it("leaves no consequence when the tick rounds to zero", () => {
    expect(tick(1).size).toBe(0);
    expect(tick(0).size).toBe(0);
  });

  it("creates a consequence for a positive tick", () => {
    expect([...tick(100).values()][0]?.wound).toBe(20);
  });
});

describe("move", () => {
  const ground = (
    longitude: number,
    latitude: number,
    timeTracker?: Record<string, number>,
  ) =>
    ({
      ...makeEffect("damage", { rounds: 3 }),
      longitude,
      latitude,
      timeTracker,
    }) as GroundEffect;
  const mover = () => makeBattleUser("mover", { longitude: 0, latitude: 0 });
  const step = () =>
    ({
      ...makeEffect("move", { rounds: 0 }, { creatorId: "mover", createdRound: ROUND }),
      longitude: 2,
      latitude: 3,
    }) as GroundEffect;

  it("carries ground entry timers to the destination tile", () => {
    const user = mover();
    const left = ground(0, 0, { mover: 1, other: 1 });
    const entered = ground(2, 3, {});
    const untracked = ground(2, 3);
    move(step(), [], [user], [left, entered, untracked]);
    expect(user).toMatchObject({ longitude: 2, latitude: 3 });
    expect(left.timeTracker).toEqual({ other: 1 });
    expect(entered.timeTracker).toEqual({ mover: ROUND });
    expect(untracked.timeTracker).toBeUndefined();
  });

  it("keeps a prevented mover and its timers in place", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = mover();
    const left = ground(0, 0, { mover: 1 });
    const effect = step();
    const prevent = makeEffect(
      "moveprevent",
      { power: 100, rounds: 3 },
      {
        ...cast,
        targetId: "mover",
        isNew: false,
        castThisRound: false,
      },
    );
    move(effect, [prevent], [user], [left]);
    expect(user).toMatchObject({ longitude: 0, latitude: 0 });
    expect(left.timeTracker).toEqual({ mover: 1 });
    expect(effect.rounds).toBe(0);
  });
});
