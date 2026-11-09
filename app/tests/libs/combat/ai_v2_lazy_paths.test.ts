import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type { GroundEffect } from "@/libs/combat/types";
import { TerrainHex } from "@/libs/hexgrid";
import {
  ActionEndTurn,
  ActionMoveTowardsOpponent,
  ActionWithEffectHighestPower,
  ConditionDistanceHigherThan,
  ConditionDistanceLowerThan,
  ConditionHealthBelow,
  ConditionSpecificRound,
  type AiRuleType,
} from "@/validators/ai";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const PROFILE = "lazy-path-profile";
const endTurn = { conditions: [], action: ActionEndTurn.parse({}) };

const setup = (rules: AiRuleType[] = [endTurn], count = 2) => {
  const usersState = Array.from({ length: count }, (_, index) =>
    makeBattleUser(index === 0 ? "actor" : `enemy-${index}`, {
      isAi: true,
      isSummon: false,
      isPiloted: false,
      aiProfileId: PROFILE,
      direction: index === 0 ? "left" : "right",
      longitude: index === 0 ? 0 : 2 + (index % 10),
      latitude: index === 0 ? 0 : Math.floor(index / 10),
    }),
  );
  const battle = makeCompleteBattle({
    usersState,
    width: 13,
    height: 9,
    activeUserId: "actor",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    roundStartAt: new Date(0),
    extraState: {
      aiProfiles: {
        [PROFILE]: { id: PROFILE, userId: "actor", includeDefaultRules: false, rules },
      },
    },
  });
  const grid = new Grid(TerrainHex, rectangle({ width: 13, height: 9 }));
  grid.forEach((hex) => {
    hex.cost = 1;
  });
  return { battle, grid, run: () => performAIaction(battle, grid, "actor") };
};

const barrier = (longitude: number, latitude: number): GroundEffect =>
  makeEffect(
    "barrier",
    {
      power: 100,
      rounds: 10,
      absorbPercentage: 50,
      curHealth: 10_000,
      maxHealth: 10_000,
    },
    { creatorId: "enemy-1", longitude, latitude },
  );

afterEach(() => {
  // Bun shares the module registry between suites; restore every local spy.
  for (const restore of restores.splice(0)) restore();
});
const restores: (() => void)[] = [];
const observe = (grid: Grid<TerrainHex>) => {
  const distance = spyOn(Grid.prototype, "distance");
  const map = spyOn(grid, "map");
  restores.push(
    () => distance.mockRestore(),
    () => map.mockRestore(),
  );
  return { distance, map };
};

describe("AI prepares paths only for rules that consume them", () => {
  it.each([2, 8, 24])(
    "ends a turn with %s combatants without A* or obstacle passes",
    (count) => {
      const { grid, run } = setup([endTurn], count);
      const { distance, map } = observe(grid);
      expect(run().nextActionId).toBe("wait");
      expect(distance).not.toHaveBeenCalled();
      // The remaining pass restores the caller's reusable grid.
      expect(map).toHaveBeenCalledTimes(1);
      expect(grid.toArray().every((hex) => hex.cost === 1)).toBe(true);
    },
  );

  it("checks health and short-circuits rejected rules without preparing paths", () => {
    const { grid, run } = setup([
      {
        conditions: [
          ConditionSpecificRound.parse({ value: 99 }),
          ConditionDistanceHigherThan.parse({ target: "CLOSEST_OPPONENT" }),
        ],
        action: ActionMoveTowardsOpponent.parse({}),
      },
      {
        conditions: [ConditionHealthBelow.parse({ value: 101 })],
        action: ActionEndTurn.parse({}),
      },
    ]);
    const { distance } = observe(grid);
    expect(run().nextActionId).toBe("wait");
    expect(distance).not.toHaveBeenCalled();
  });

  it("memoizes a selected target's distance across conditions and rejected rules", () => {
    const condition = ConditionDistanceHigherThan.parse({
      target: "RANDOM_OPPONENT",
      value: 100,
    });
    const single = setup([
      { conditions: [condition], action: ActionEndTurn.parse({}) },
      endTurn,
    ]);
    const repeated = setup([
      ...Array.from({ length: 5 }, () => ({
        conditions: [condition],
        action: ActionEndTurn.parse({}),
      })),
      endTurn,
    ]);
    const first = observe(single.grid);
    expect(single.run().nextActionId).toBe("wait");
    const calls = first.distance.mock.calls.length;
    first.distance.mockClear();
    expect(repeated.run().nextActionId).toBe("wait");
    expect(calls).toBeGreaterThan(0);
    expect(first.distance.mock.calls.length).toBe(calls);
  });

  it("keeps SELF distance zero and includes the origin in CLOSEST_ALLY paths", () => {
    for (const target of ["SELF", "CLOSEST_ALLY"] as const) {
      const { battle, run } = setup([
        {
          conditions: [ConditionDistanceHigherThan.parse({ target, value: 1 })],
          action: ActionWithEffectHighestPower.parse({
            effect: "heal",
            target: "SELF",
          }),
        },
      ]);
      battle.usersState[0]!.curHealth = 1000;
      expect(run().nextActionId).toBe(target === "SELF" ? "wait" : "meditate");
    }
  });

  it("retains zero distance for an unreachable target", () => {
    const { battle, grid, run } = setup([
      {
        conditions: [
          ConditionDistanceLowerThan.parse({ target: "CLOSEST_OPPONENT", value: 1 }),
        ],
        action: ActionWithEffectHighestPower.parse({ effect: "heal", target: "SELF" }),
      },
    ]);
    battle.usersState[0]!.curHealth = 1000;
    grid.getHex({ col: 3, row: 0 })!.blocked = true;
    expect(run().nextActionId).toBe("meditate");
  });

  it("keeps the last opponent on an equal-distance tie", () => {
    const { battle, run } = setup(
      [
        {
          conditions: [],
          action: ActionWithEffectHighestPower.parse({
            effect: "damage",
            target: "CLOSEST_OPPONENT",
          }),
        },
      ],
      3,
    );
    Object.assign(battle.usersState[1]!, { longitude: 1, latitude: 0 });
    Object.assign(battle.usersState[2]!, { longitude: 0, latitude: 1 });
    const { nextBattle, nextActionId } = run();
    expect(nextActionId).toBe("basicAttack");
    expect(nextBattle.usersState[1]!.curHealth).toBe(5000);
    expect(nextBattle.usersState[2]!.curHealth).toBeLessThan(5000);
  });

  it("keeps the opponent draw before the ally draw", () => {
    const { battle, run } = setup(
      [
        {
          conditions: [],
          action: ActionWithEffectHighestPower.parse({
            effect: "damage",
            target: "RANDOM_OPPONENT",
          }),
        },
      ],
      3,
    );
    Object.assign(battle.usersState[1]!, { longitude: 1, latitude: 0 });
    Object.assign(battle.usersState[2]!, { longitude: 0, latitude: 1 });
    const random = spyOn(Math, "random")
      .mockReturnValue(0.5)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0);
    restores.push(() => random.mockRestore());
    const { nextBattle, nextActionId } = run();
    expect(nextActionId).toBe("basicAttack");
    expect(nextBattle.usersState[1]!.curHealth).toBe(5000);
    expect(nextBattle.usersState[2]!.curHealth).toBeLessThan(5000);
  });

  it("uses the weighted path length for distance conditions around a wall", () => {
    const { battle, run } = setup([
      {
        conditions: [
          ConditionDistanceHigherThan.parse({ target: "CLOSEST_OPPONENT", value: 5 }),
        ],
        action: ActionMoveTowardsOpponent.parse({ target: "CLOSEST_OPPONENT" }),
      },
      endTurn,
    ]);
    Object.assign(battle.usersState[0]!, { longitude: 0, latitude: 4 });
    Object.assign(battle.usersState[1]!, { longitude: 2, latitude: 4 });
    battle.groundEffects = Array.from({ length: 7 }, (_, index) => ({
      ...barrier(1, index + 1),
      id: `wall-${index}`,
    }));
    const { nextBattle, nextActionId } = run();
    expect(nextActionId).toBe("move");
    expect(nextBattle.usersState[0]!.longitude).toBe(0);
  });

  it("checks absent barriers without preparing a closest opponent", () => {
    const { grid, run } = setup(
      [
        {
          conditions: [
            ConditionDistanceHigherThan.parse({
              target: "BARRIER_BLOCKING_CLOSEST_OPPONENT",
            }),
          ],
          action: ActionEndTurn.parse({}),
        },
        endTurn,
      ],
      8,
    );
    const { distance } = observe(grid);
    expect(run().nextActionId).toBe("wait");
    expect(distance).not.toHaveBeenCalled();
  });

  it("targets the blocking barrier using the cleared path and restores grid costs", () => {
    const { battle, grid, run } = setup([
      {
        conditions: [],
        action: ActionWithEffectHighestPower.parse({
          effect: "damage",
          target: "BARRIER_BLOCKING_CLOSEST_OPPONENT",
        }),
      },
      endTurn,
    ]);
    Object.assign(battle.usersState[1]!, { longitude: 2, latitude: 0 });
    battle.groundEffects = [barrier(1, 0)];
    const { nextBattle, nextActionId } = run();
    expect(nextActionId).toBe("basicAttack");
    const hitBarrier = nextBattle.groundEffects[0];
    expect(hitBarrier?.type).toBe("barrier");
    if (hitBarrier?.type === "barrier") {
      expect(hitBarrier.curHealth).toBeLessThan(10_000);
    }
    expect(grid.toArray().every((hex) => hex.cost === 1)).toBe(true);
  });

  it("restores weighted movement after a rejected barrier-targeting rule", () => {
    const { battle, grid, run } = setup([
      {
        conditions: [],
        action: ActionWithEffectHighestPower.parse({
          effect: "damage",
          target: "BARRIER_BLOCKING_CLOSEST_OPPONENT",
        }),
      },
      {
        conditions: [],
        action: ActionMoveTowardsOpponent.parse({ target: "CLOSEST_OPPONENT" }),
      },
      endTurn,
    ]);
    Object.assign(battle.usersState[1]!, { longitude: 5, latitude: 0 });
    battle.groundEffects = [barrier(2, 0)];
    const { nextBattle, nextActionId } = run();
    const actor = nextBattle.usersState[0]!;
    expect(nextActionId).toBe("move");
    expect(actor.longitude !== 2 || actor.latitude !== 0).toBe(true);
    expect(nextBattle.groundEffects[0]).toMatchObject({
      type: "barrier",
      curHealth: 10_000,
    });
    expect(grid.toArray().every((hex) => hex.cost === 1)).toBe(true);
  });
});
