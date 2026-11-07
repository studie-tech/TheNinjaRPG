import { describe, expect, it } from "bun:test";
import { buildWindowNav, type WindowNavEntry } from "@/libs/sector-map/navigation";
import { sectorMap } from "../setup/sectorMap";

const makeMap = (
  width: number,
  height: number,
  blocked: (x: number, y: number) => boolean = () => false,
  ocean: (x: number, y: number) => boolean = () => false,
) =>
  sectorMap(
    width,
    height,
    (x, y) => {
      if (blocked(x, y)) return { walkCost: 0, blocked: true };
      return ocean(x, y) ? { terrain: "ocean", battleBiome: "ocean" } : {};
    },
    { sector: 0, name: "test" },
  );

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
    const nav = buildWindowNav([{ dx: 0, dy: 0, map: makeMap(4, 4) }], HEXSIZE);
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 0, 1);
    const goalInMissing = nav.toUnified(1, 0, 0, 1);
    if (!start || !goalInMissing) throw new Error("coords");
    expect(goalInMissing.blocked).toBe(true);
    expect(nav.pathFinder.getShortestPath(start, goalInMissing)).toBeUndefined();
  });

  it("crosses freely into an aligned neighbor", () => {
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(4, 4) },
        { dx: 1, dy: 0, map: makeMap(4, 4) },
      ],
      HEXSIZE,
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 0, 1);
    const goal = nav.toUnified(1, 0, 3, 1);
    if (!start || !goal) throw new Error("coords");
    expect(goal.blocked).toBe(false);
    expect(nav.pathFinder.getShortestPath(start, goal)).toBeDefined();
  });

  it("crosses shaded terrain on a neighbor's map at the standard walking cost", () => {
    const nav = buildWindowNav(
      [
        { dx: 0, dy: 0, map: makeMap(5, 5) },
        { dx: 1, dy: 0, map: makeMap(5, 5, () => true) },
      ],
      HEXSIZE,
    );
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 2, 2);
    const goal = nav.toUnified(1, 0, 3, 2);
    if (!start || !goal) throw new Error("coords");
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    for (const tile of path) {
      const local = nav.fromUnified(tile);
      if (local.dx === 1) {
        expect(tile.blocked).toBe(false);
        expect(tile.cost).toBe(2);
      }
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

  it("takes the shortest route through water at the same cost as ground", () => {
    // A 2-wide ocean strip cuts the direct route; the only dry way around is
    // via the bottom row. Equal land/water costs should choose the wet shortcut.
    const isOcean = (x: number, y: number) => (x === 3 || x === 4) && y <= 2;
    const map = makeMap(8, 4, () => false, isOcean);
    const nav = buildWindowNav([{ dx: 0, dy: 0, map }], HEXSIZE);
    if (!nav) throw new Error("no nav");
    const start = nav.toUnified(0, 0, 1, 1);
    const goal = nav.toUnified(0, 0, 6, 1);
    if (!start || !goal) throw new Error("coords");
    const path = nav.pathFinder.getShortestPath(start, goal);
    expect(path).toBeDefined();
    if (!path) return;
    expect(
      path.some((tile) => {
        const local = nav.fromUnified(tile);
        return isOcean(local.col, local.row);
      }),
    ).toBe(true);
    expect(path.length).toBeLessThanOrEqual(6);
  });
});
