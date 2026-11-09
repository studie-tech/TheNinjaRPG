import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { getTargetTiles } from "@/libs/combat/targeting";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import type { TerrainHex } from "@/libs/hexgrid";
import { BarrierTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
} from "../../setup/combat";

// Adamantine Fortress as configured in prod: a large wall stretched by two rows.
const fortress = (overrides: Partial<CombatAction> = {}): CombatAction =>
  makeCombatAction({
    id: "adamantine-fortress",
    name: "Adamantine Fortress",
    method: "AOE_LARGE_WALL_SHOOT",
    target: "EMPTY_GROUND",
    methodSize: { x: 0, y: 2 },
    effects: [BarrierTag.parse({ target: "INHERIT", rounds: 2, power: 100 })],
    ...overrides,
  });

const CASTERS = [
  { col: 6, row: 7 },
  { col: 7, row: 7 },
];

const setup = (caster: { col: number; row: number }) => {
  const user = makeBattleUser("actor", {
    longitude: caster.col,
    latitude: caster.row,
    direction: "left",
  });
  const battle = makeCompleteBattle({
    width: 15,
    height: 15,
    createdAt: new Date(0),
    updatedAt: new Date(),
    usersState: [user],
    activeUserId: "actor",
    roundStartAt: new Date(),
  });
  const grid = getBattleGrid(20, battle as ReturnedBattle);
  const a = grid.getHex(caster) as TerrainHex;
  return { battle, grid, a };
};

const positions = (tiles: Iterable<{ col: number; row: number }>) =>
  [...tiles].map((tile) => `${tile.col},${tile.row}`).sort();

/** A straight wall: unique tiles all sharing one column, or all sharing one row. */
const expectStraightWall = (tiles: TerrainHex[], length: number) => {
  expect(new Set(positions(tiles)).size).toBe(tiles.length);
  expect(tiles).toHaveLength(length);
  const cols = new Set(tiles.map((t) => t.col));
  const rows = new Set(tiles.map((t) => t.row));
  expect(cols.size === 1 || rows.size === 1).toBe(true);
};

describe("wall orientation", () => {
  for (const caster of CASTERS) {
    const { grid, a } = setup(caster);
    const neighbours = grid
      .toArray()
      .filter(
        (t) =>
          t !== a &&
          Math.abs(t.q - a.q) <= 1 &&
          Math.abs(t.r - a.r) <= 1 &&
          Math.abs(t.q + t.r - a.q - a.r) <= 1,
      );

    it(`has six neighbours around ${caster.col},${caster.row}`, () => {
      expect(neighbours).toHaveLength(6);
    });

    for (const method of ["AOE_WALL_SHOOT", "AOE_LARGE_WALL_SHOOT"] as const) {
      const baseLength = method === "AOE_WALL_SHOOT" ? 3 : 5;
      for (const methodSize of [undefined, { x: 0, y: 2 }, { x: 0, y: 1 }]) {
        it(`${method} size ${JSON.stringify(methodSize)} from ${caster.col},${caster.row} is one straight wall in all six directions`, () => {
          const action = fortress({ method, methodSize });
          const lengths = neighbours.map((b) => {
            const tiles = getTargetTiles({ a, b, action, grid });
            expectStraightWall(tiles, baseLength + 2 * (methodSize?.y ?? 0));
            expect(tiles).toContain(b);
            return tiles.length;
          });
          expect(new Set(lengths).size).toBe(1);
        });
      }
    }

    it(`targeting straight up or down from ${caster.col},${caster.row} builds a horizontal line`, () => {
      const action = fortress();
      for (const row of [caster.row - 1, caster.row + 1]) {
        const b = grid.getHex({ col: caster.col, row }) as TerrainHex;
        const tiles = getTargetTiles({ a, b, action, grid });
        expect(new Set(tiles.map((t) => t.row))).toEqual(new Set([row]));
        expect(positions(tiles)).toEqual(
          positions(
            [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((dc) => ({
              col: caster.col + dc,
              row,
            })),
          ),
        );
      }
    });

    it(`x thickens the wall across its length from ${caster.col},${caster.row}`, () => {
      const action = fortress({ methodSize: { x: 1, y: 0 } });
      const up = grid.getHex({ col: caster.col, row: caster.row - 1 }) as TerrainHex;
      const side = grid.getHex({ col: caster.col + 1, row: caster.row }) as TerrainHex;
      for (const b of [up, side]) {
        const tiles = getTargetTiles({ a, b, action, grid });
        expect(tiles).toHaveLength(15);
      }
      const upTiles = getTargetTiles({ a, b: up, action, grid });
      expect(new Set(upTiles.map((t) => t.row)).size).toBe(3);
      expect(new Set(upTiles.map((t) => t.col)).size).toBe(5);
    });
  }

  it("spawns the same number of barriers casting up as casting sideways", () => {
    const count = (target: { col: number; row: number }) => {
      const { battle, grid } = setup({ col: 6, row: 7 });
      const ok = insertAction({
        battle,
        grid,
        action: fortress(),
        actorId: "actor",
        longitude: target.col,
        latitude: target.row,
      });
      expect(ok).toBeTruthy();
      const barriers = battle.groundEffects.filter((e) => e.type === "barrier");
      return {
        size: barriers.length,
        rows: new Set(barriers.map((e) => e.latitude)).size,
        cols: new Set(barriers.map((e) => e.longitude)).size,
      };
    };
    const side = count({ col: 7, row: 7 });
    const up = count({ col: 6, row: 6 });
    const down = count({ col: 6, row: 8 });
    expect(side).toEqual({ size: 9, rows: 9, cols: 1 });
    expect(up).toEqual({ size: 9, rows: 1, cols: 9 });
    expect(down).toEqual({ size: 9, rows: 1, cols: 9 });
  });
});
