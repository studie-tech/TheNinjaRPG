import { describe, expect, it } from "vitest";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { buildWindowNav, type WindowNavEntry } from "@/libs/threejs/sector";

const makeMap = (
  width: number,
  height: number,
  blocked: (x: number, y: number) => boolean = () => false,
  ocean: (x: number, y: number) => boolean = () => false,
): NormalizedSectorMap => {
  const tiles: NormalizedSectorTile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBlocked = blocked(x, y);
      const isOcean = !isBlocked && ocean(x, y);
      tiles.push({
        x,
        y,
        terrain: isOcean ? "ocean" : "ground",
        walkCost: isBlocked ? 0 : isOcean ? 3 : 1,
        blocked: isBlocked,
        zone: "wilderness",
        battleBiome: isOcean ? "ocean" : "ground",
      });
    }
  }
  return {
    formatVersion: SECTOR_MAP_VERSION,
    sector: 0,
    name: "test",
    width,
    height,
    tiles,
    objects: [],
    anchors: [{ key: "spawn.default", x: 0, y: 0 }],
    exits: [],
    metadata: { importedAt: "2026-01-01T00:00:00.000Z", source: "tiled" },
  };
};

const HEXSIZE = 10;

describe("buildWindowNav", () => {
  it("round-trips unified <-> local coordinates (non-square maps)", () => {
    // Non-square so any width/height transposition in the unified-grid math fails
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 6) },
        { dx: 1, dy: 0, map: makeMap(4, 6) },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    expect(nav).not.toBeNull();
    if (!nav) return;
    const cases: Array<[number, number, number, number]> = [
      [0, 0, 0, 0],
      [0, 0, 3, 5],
      [1, 0, 2, 1],
      [-1, 1, 3, 4],
    ];
    for (const [dx, dy, col, row] of cases) {
      const unified = nav.toUnified(dx, dy, col, row);
      expect(unified).toBeDefined();
      if (!unified) continue;
      expect(nav.fromUnified(unified)).toEqual({ dx, dy, col, row });
    }
  });

  it("finds a walkable path that crosses from the center into the east neighbor", () => {
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 4) },
        { dx: 1, dy: 0, map: makeMap(4, 4) },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 0, 1);
    const goal = nav.toUnified(1, 0, 3, 1);
    expect(start && goal).toBeTruthy();
    if (!start || !goal) return;
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    const sectorsVisited = new Set(path.map((tile) => nav.fromUnified(tile).dx));
    // The path must span both the center (dx 0) and the east neighbor (dx 1)
    expect(sectorsVisited.has(0)).toBe(true);
    expect(sectorsVisited.has(1)).toBe(true);
    // Endpoints are correct
    expect(nav.fromUnified(path[0]!)).toEqual({ dx: 0, dy: 0, col: 0, row: 1 });
    expect(nav.fromUnified(path[path.length - 1]!)).toEqual({
      dx: 1,
      dy: 0,
      col: 3,
      row: 1,
    });
  });

  it("treats a missing (polar) neighbor as an impassable wall", () => {
    // Only the center sector is present; the east neighbor is absent
    const nav = buildWindowNav([{ dx: 0, dy: 0, map: makeMap(4, 4) }], HEXSIZE, mergeTerrainSpecs([]));
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 0, 1);
    const goalInMissing = nav.toUnified(1, 0, 0, 1);
    if (!start || !goalInMissing) throw new Error("coords");
    expect(goalInMissing.blocked).toBe(true);
    expect(nav.pathFinder.getShortestPath(start, goalInMissing)).toBeUndefined();
  });

  it("treats a rotated-seam neighbor as an impassable wall (no wrapping paths)", () => {
    // The east neighbor is present but reached across a rotated cube-edge seam;
    // the axis-aligned unified grid can't represent its rotation, so it must be
    // impassable - hover/optimistic paths stop cleanly at the border.
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 4) },
        { dx: 1, dy: 0, map: makeMap(4, 4), rotation: 1 },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 0, 1);
    const goalInRotated = nav.toUnified(1, 0, 3, 1);
    if (!start || !goalInRotated) throw new Error("coords");
    expect(goalInRotated.blocked).toBe(true);
    expect(nav.pathFinder.getShortestPath(start, goalInRotated)).toBeUndefined();
  });

  it("still crosses freely into an aligned (rotation 0) neighbor", () => {
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 4) },
        { dx: 1, dy: 0, map: makeMap(4, 4), rotation: 0 },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 0, 1);
    const goal = nav.toUnified(1, 0, 3, 1);
    if (!start || !goal) throw new Error("coords");
    expect(goal.blocked).toBe(false);
    expect(nav.pathFinder.getShortestPath(start, goal)).toBeDefined();
  });

  it("routes around blocked tiles composed from a neighbor's map", () => {
    // Wall down the east neighbor's entry column except one gap at row 2
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(5, 5) },
        { dx: 1, dy: 0, map: makeMap(5, 5, (x, y) => x === 0 && y !== 2) },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 2, 2);
    const goal = nav.toUnified(1, 0, 3, 2);
    if (!start || !goal) throw new Error("coords");
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    // Every east-neighbor tile the path uses on the entry column must be the gap
    for (const tile of path) {
      const local = nav.fromUnified(tile);
      if (local.dx === 1 && local.col === 0) expect(local.row).toBe(2);
    }
  });

  it("crosses north from the top row into the neighbor's bottom row", () => {
    // Non-square maps + a vertical crossing: exercises the dy/localRow window
    // composition that the east-crossing tests never touch. Rendered y grows
    // northward, so the north neighbor is dy=+1.
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 6) },
        { dx: 0, dy: 1, map: makeMap(4, 6) },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 1, 5);
    const goal = nav.toUnified(0, 1, 1, 0);
    expect(start && goal).toBeTruthy();
    if (!start || !goal) return;
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    const rowsVisited = new Set(path.map((tile) => nav.fromUnified(tile).dy));
    expect(rowsVisited.has(0)).toBe(true);
    expect(rowsVisited.has(1)).toBe(true);
    expect(nav.fromUnified(path[0]!)).toEqual({ dx: 0, dy: 0, col: 1, row: 5 });
    expect(nav.fromUnified(path[path.length - 1]!)).toEqual({
      dx: 0,
      dy: 1,
      col: 1,
      row: 0,
    });
  });

  it("crosses south from the bottom row into the neighbor's top row", () => {
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 6) },
        { dx: 0, dy: -1, map: makeMap(4, 6) },
      ],
      HEXSIZE,
      mergeTerrainSpecs([]),
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 1, 0);
    const goal = nav.toUnified(0, -1, 1, 5);
    expect(start && goal).toBeTruthy();
    if (!start || !goal) return;
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    const rowsVisited = new Set(path.map((tile) => nav.fromUnified(tile).dy));
    expect(rowsVisited.has(0)).toBe(true);
    expect(rowsVisited.has(-1)).toBe(true);
    expect(nav.fromUnified(path[0]!)).toEqual({ dx: 0, dy: 0, col: 1, row: 0 });
    expect(nav.fromUnified(path[path.length - 1]!)).toEqual({
      dx: 0,
      dy: -1,
      col: 1,
      row: 5,
    });
  });

  it("prefers a dry detour over a shorter route through water (cost weighting)", () => {
    // A 2-wide swimmable ocean strip cuts the direct route; the only dry way
    // around is via the bottom row (~3 extra steps). With the real costs
    // (walkCost + isWater surcharge) the detour is cheaper; if the surcharge or
    // walkCost is dropped, the shorter wet route wins and this test fails.
    const isOcean = (x: number, y: number) => (x === 3 || x === 4) && y <= 2;
    const map = makeMap(8, 4, () => false, isOcean);
    const nav = buildWindowNav([{ dx: 0, dy: 0, map }], HEXSIZE, mergeTerrainSpecs([]));
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 1, 1);
    const goal = nav.toUnified(0, 0, 6, 1);
    if (!start || !goal) throw new Error("coords");
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    // No tile on the chosen path is ocean
    for (const tile of path) {
      const local = nav.fromUnified(tile);
      expect(isOcean(local.col, local.row)).toBe(false);
    }
    // And it really is a detour: longer than the straight wet line
    expect(path.length).toBeGreaterThan(6);
  });
});
