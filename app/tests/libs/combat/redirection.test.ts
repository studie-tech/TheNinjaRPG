import { describe, expect, it } from "bun:test";
import { redirection } from "@/libs/combat/tags";
import type {
  BattleUserState,
  GroundEffect,
  ReturnedBattle,
} from "@/libs/combat/types";
import { oddQHexDistance } from "@/libs/hexgrid";
import { makeBattleUser, makeEffect } from "../../setup/combat";

const WIDTH = 13;
const HEIGHT = 9;
const battle = { width: WIDTH, height: HEIGHT } as ReturnedBattle;

type Tile = { col: number; row: number };

const user = (id: string, { col, row }: Tile) =>
  makeBattleUser(id, { longitude: col, latitude: row });

const redirect = (
  casterTile: Tile,
  targetTile: Tile,
  power: number,
  direction: "pull" | "push",
  bystanders: BattleUserState[] = [],
  groundEffects: GroundEffect[] = [],
) => {
  const caster = user("attacker", casterTile);
  const target = user("defender", targetTile);
  const effect = makeEffect(
    "redirection",
    { power, direction },
    {
      creatorId: "attacker",
      targetId: "defender",
      targetType: "user",
      isNew: true,
      castThisRound: true,
    },
  );
  const info = redirection(
    battle,
    effect,
    [],
    caster,
    target,
    [caster, target, ...bystanders],
    groundEffects,
  );
  return { col: target.longitude, row: target.latitude, txt: info?.txt };
};

const tiles = Array.from({ length: WIDTH }, (_, col) =>
  Array.from({ length: HEIGHT }, (_, row) => ({ col, row })),
).flat();

const distance = (a: Tile, b: Tile) => oddQHexDistance(a.col, a.row, b.col, b.row);

describe("redirection", () => {
  it("pulls by power along the grid, stopping next to the caster", () => {
    const caster = { col: 6, row: 4 };
    for (const target of tiles) {
      const before = distance(caster, target);
      if (before === 0) continue;
      for (const power of [1, 2, 3, 20]) {
        const moved = redirect(caster, target, power, "pull");
        expect(distance(moved, caster)).toBe(before - Math.min(power, before - 1));
      }
    }
  });

  it("pushes by power along the grid", () => {
    const caster = { col: 6, row: 4 };
    for (const target of tiles) {
      const before = distance(caster, target);
      if (before === 0 || before > 2) continue;
      const moved = redirect(caster, target, 2, "push");
      expect(distance(moved, caster)).toBe(before + 2);
      expect(distance(moved, target)).toBe(2);
    }
  });

  it("lands next to a caster diagonal to the target", () => {
    expect(redirect({ col: 0, row: 0 }, { col: 4, row: 2 }, 4, "pull")).toMatchObject({
      col: 1,
      row: 0,
      txt: "defender is pulled towards attacker by 3 spaces",
    });
  });

  it("clamps a push at the arena edge", () => {
    const moved = redirect({ col: 2, row: 4 }, { col: 1, row: 4 }, 5, "push");
    expect(moved.col).toBe(0);
    expect(moved.row).toBeGreaterThanOrEqual(0);
    expect(moved.row).toBeLessThan(HEIGHT);
  });

  it("steps back along the line from an occupied landing tile", () => {
    const moved = redirect({ col: 0, row: 0 }, { col: 6, row: 3 }, 3, "pull", [
      user("blocker", { col: 3, row: 1 }),
    ]);
    expect(distance(moved, { col: 6, row: 3 })).toBe(2);
    expect(distance(moved, { col: 0, row: 0 })).toBe(4);
  });

  it("steps back from a barrier", () => {
    const barrier = {
      longitude: 3,
      latitude: 1,
      curHealth: 10,
    } as unknown as GroundEffect;
    const moved = redirect(
      { col: 0, row: 0 },
      { col: 6, row: 3 },
      3,
      "pull",
      [],
      [barrier],
    );
    expect(distance(moved, { col: 6, row: 3 })).toBe(2);
  });

  it("stays put when every tile on the way is occupied", () => {
    const moved = redirect({ col: 0, row: 3 }, { col: 0, row: 7 }, 2, "pull", [
      user("near", { col: 0, row: 6 }),
      user("far", { col: 0, row: 5 }),
    ]);
    expect(moved).toMatchObject({ col: 0, row: 7 });
  });

  it("carries ground entry timers to the landing tile", () => {
    const ground = (col: number, row: number, timeTracker: Record<string, number>) =>
      ({
        ...makeEffect("damage", { rounds: 3 }),
        longitude: col,
        latitude: row,
        timeTracker,
      }) as GroundEffect;
    const casterTile = { col: 0, row: 4 };
    const start = { col: 6, row: 4 };
    const { col, row } = redirect(casterTile, start, 2, "pull");
    const left = ground(start.col, start.row, { defender: 1, attacker: 1 });
    const entered = ground(col, row, {});
    redirect(casterTile, start, 2, "pull", [], [left, entered]);
    expect(left.timeTracker).toEqual({ attacker: 1 });
    expect(Object.keys(entered.timeTracker ?? {})).toEqual(["defender"]);
  });
});
