import { defineHex, Grid, Orientation, rectangle, ring } from "honeycomb-grid";
import { describe, expect, it } from "vitest";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";

/**
 * The heuristic is only allowed to guide the search, never to change what it finds, so the tests
 * that matter here compare against an independent Dijkstra rather than against a stored path.
 */
const makeGrid = (
  width: number,
  height: number,
  costOf: (col: number, row: number) => number,
  blockedOf: (col: number, row: number) => boolean = () => false,
) => {
  const Tile = defineHex({
    dimensions: { width: 10, height: 10 },
    origin: { x: -5, y: -5 },
    orientation: Orientation.FLAT,
  });
  return new Grid(Tile, rectangle({ width, height })).map((tile) => {
    const hex = tile as unknown as TerrainHex;
    hex.cost = costOf(tile.col, tile.row);
    hex.blocked = blockedOf(tile.col, tile.row);
    return tile;
  }) as unknown as Grid<TerrainHex>;
};

const at = (grid: Grid<TerrainHex>, col: number, row: number) =>
  grid.getHex({ col, row }) as TerrainHex;

const neighbours = (grid: Grid<TerrainHex>, center: TerrainHex) =>
  grid
    .traverse(ring({ radius: 1, center }))
    .toArray()
    .filter((tile) => !tile.blocked);

const stepCost = (from: TerrainHex, to: TerrainHex) => to.cost + from.cost;

const pathCost = (path: TerrainHex[] | undefined) =>
  path === undefined
    ? Number.POSITIVE_INFINITY
    : path
        .slice(1)
        .reduce((total, tile, index) => total + stepCost(path[index] as TerrainHex, tile), 0);

/** Deliberately naive and heuristic-free, so it agrees with A* only if A* is right. */
const optimalCost = (grid: Grid<TerrainHex>, start: TerrainHex, goal: TerrainHex) => {
  const best = new Map<TerrainHex, number>([[start, 0]]);
  const settled = new Set<TerrainHex>();
  const frontier: TerrainHex[] = [start];
  while (frontier.length > 0) {
    frontier.sort(
      (a, b) =>
        (best.get(a) ?? Number.POSITIVE_INFINITY) -
        (best.get(b) ?? Number.POSITIVE_INFINITY),
    );
    const current = frontier.shift() as TerrainHex;
    if (current === goal) return best.get(goal) ?? Number.POSITIVE_INFINITY;
    if (settled.has(current)) continue;
    settled.add(current);
    for (const next of neighbours(grid, current)) {
      const candidate =
        (best.get(current) ?? Number.POSITIVE_INFINITY) + stepCost(current, next);
      if (candidate < (best.get(next) ?? Number.POSITIVE_INFINITY)) {
        best.set(next, candidate);
        frontier.push(next);
      }
    }
  }
  return Number.POSITIVE_INFINITY;
};

/**
 * Narrows away the `undefined` a missing path would return, so the assertions that follow are
 * reached rather than skipped — a loop over an absent path passes without checking anything.
 */
const found = (path: TerrainHex[] | undefined) => {
  expect(path).toBeDefined();
  return path as TerrainHex[];
};

/** Fixed seed: a failure has to be reproducible to be worth anything. */
const randomiser = (seed: number): (() => number) => () =>
  ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

describe("PathCalculator.minStepCost", () => {
  it("is twice the tile cost on a combat grid", () => {
    expect(new PathCalculator(makeGrid(5, 5, () => 1)).minStepCost).toBe(2);
  });

  it("is twice the cheapest tile on a sector grid", () => {
    expect(new PathCalculator(makeGrid(5, 5, () => 2)).minStepCost).toBe(4);
  });

  it("follows the cheapest passable tile when terrain is mixed", () => {
    const grid = makeGrid(5, 5, (col) => (col === 0 ? 2 : 5));
    expect(new PathCalculator(grid).minStepCost).toBe(4);
  });

  it("ignores blocked tiles, however cheap they claim to be", () => {
    // A wall carries cost 9999 in the window grid, but a cheap blocked tile would be worse:
    // it would drag the bound down and cost the search its guidance
    const grid = makeGrid(
      5,
      5,
      (col) => (col === 0 ? 1 : 3),
      (col) => col === 0,
    );
    expect(new PathCalculator(grid).minStepCost).toBe(6);
  });

  it("falls back to zero — a plain Dijkstra — when no tile is passable", () => {
    expect(new PathCalculator(makeGrid(4, 4, () => 2, () => true)).minStepCost).toBe(0);
  });

  it("falls back to zero rather than trusting a nonsense cost", () => {
    expect(new PathCalculator(makeGrid(4, 4, () => Number.NaN)).minStepCost).toBe(0);
    expect(new PathCalculator(makeGrid(4, 4, () => 0)).minStepCost).toBe(0);
  });
});

describe("PathCalculator.getShortestPath", () => {
  it("returns a contiguous path from origin to target", () => {
    const grid = makeGrid(9, 9, () => 2);
    const path = found(
      new PathCalculator(grid).getShortestPath(at(grid, 0, 0), at(grid, 8, 8)),
    );
    expect(path[0]).toBe(at(grid, 0, 0));
    expect(path[path.length - 1]).toBe(at(grid, 8, 8));
    path.slice(1).forEach((tile, index) => {
      expect(grid.distance(path[index] as TerrainHex, tile)).toBe(1);
    });
  });

  it("gives up when the origin or the target is blocked", () => {
    const grid = makeGrid(5, 5, () => 1, (col, row) => col === 4 && row === 4);
    const finder = new PathCalculator(grid);
    expect(finder.getShortestPath(at(grid, 0, 0), at(grid, 4, 4))).toBeUndefined();
    expect(finder.getShortestPath(at(grid, 4, 4), at(grid, 0, 0))).toBeUndefined();
  });

  it("gives up when a wall separates the two tiles", () => {
    const grid = makeGrid(9, 9, () => 1, (col) => col === 4);
    const path = new PathCalculator(grid).getShortestPath(at(grid, 0, 0), at(grid, 8, 8));
    expect(path).toBeUndefined();
  });

  it("answers a repeated query from the cache", () => {
    const grid = makeGrid(6, 6, () => 2);
    const finder = new PathCalculator(grid);
    const first = finder.getShortestPath(at(grid, 0, 0), at(grid, 5, 5));
    expect(finder.getShortestPath(at(grid, 0, 0), at(grid, 5, 5))).toBe(first);
  });

  it("walks around a costly tile rather than through it", () => {
    // ai_v2 marks tiles holding a user or a barrier as cost 100 instead of blocking them
    const grid = makeGrid(7, 3, (col, row) => (col === 3 && row === 1 ? 100 : 1));
    const path = found(
      new PathCalculator(grid).getShortestPath(at(grid, 0, 1), at(grid, 6, 1)),
    );
    expect(path).not.toContain(at(grid, 3, 1));
  });

  it.each([
    ["combat, every tile cost 1", 13, "combat", 0.15],
    ["sector, every tile cost 2", 26, "sector", 0.15],
    ["window, mixed terrain cost", 40, "window", 0.12],
  ] as const)(
    "matches Dijkstra's cost on every reachable pair (%s)",
    (_shape, size, terrain, blockRate) => {
      const random = randomiser(size * 7919);
      const costs = new Map<string, number>();
      const blocked = new Map<string, boolean>();
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          costs.set(`${col},${row}`, 2 + Math.floor(random() * 3));
          blocked.set(`${col},${row}`, random() < blockRate);
        }
      }
      const grid = makeGrid(
        size,
        size,
        (col, row) => {
          if (terrain === "combat") return 1;
          if (terrain === "sector") return 2;
          return costs.get(`${col},${row}`) ?? 2;
        },
        (col, row) => blocked.get(`${col},${row}`) ?? false,
      );
      const finder = new PathCalculator(grid);
      let compared = 0;
      for (let attempt = 0; attempt < 60; attempt++) {
        const start = at(grid, ~~(random() * size), ~~(random() * size));
        const goal = at(grid, ~~(random() * size), ~~(random() * size));
        if (!start || !goal || start.blocked || goal.blocked || start === goal) continue;
        const want = optimalCost(grid, start, goal);
        const path = finder.getShortestPath(start, goal);
        if (want === Number.POSITIVE_INFINITY) {
          expect(path).toBeUndefined();
          continue;
        }
        compared++;
        expect(pathCost(path)).toBe(want);
      }
      expect(compared).toBeGreaterThan(20);
    },
  );
});
