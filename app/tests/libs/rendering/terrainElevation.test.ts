import { describe, expect, it } from "bun:test";
import { ring } from "honeycomb-grid";
import { createHexGrid, type TerrainHex } from "@/libs/hexgrid";
import {
  applyTerrainField,
  createTerrainField,
  MAX_LAND_TERRACE,
  MAX_SEABED_DEPTH,
  objectFootprints,
  sectorRelief,
  type TerrainCell,
  waterSampleKey,
} from "@/libs/rendering/terrainElevation";

const grid = (width: number, height: number) =>
  createHexGrid(40, width, height, { x: -20, y: -20 });
const neighbours = (tiles: ReturnType<typeof grid>, tile: TerrainHex) => [
  ...tiles.traverse(ring({ center: tile, radius: 1 })),
];

describe("terrain field", () => {
  it("keeps coasts and settlements level and rises at most one terrace per hex from them", () => {
    const tiles = grid(20, 12);
    const cells = new Map<TerrainHex, TerrainCell>();
    for (const tile of tiles)
      cells.set(tile, {
        isWater: tile.col < 3,
        flat: tile.col === 16 && tile.row === 6,
        relief: 1,
      });
    const field = createTerrainField(tiles, cells);
    for (const tile of tiles) {
      const level = field.level(tile);
      if (tile.col < 3) {
        expect(level).toBeLessThanOrEqual(-1);
        expect(level).toBeGreaterThanOrEqual(-MAX_SEABED_DEPTH);
        continue;
      }
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(MAX_LAND_TERRACE);
      if (neighbours(tiles, tile).some((other) => cells.get(other)?.isWater))
        expect(level).toBe(0);
    }
    expect(field.level(tiles.getHex({ col: 16, row: 6 })!)).toBe(0);
    expect(field.level(tiles.getHex({ col: 10, row: 6 })!)).toBe(MAX_LAND_TERRACE);
    for (const tile of neighbours(tiles, tiles.getHex({ col: 16, row: 6 })!))
      expect(field.level(tile)).toBeLessThanOrEqual(0);
  });

  it("steps the seabed down offshore, never deeper than the distance to land", () => {
    const tiles = grid(16, 6);
    const cells = new Map<TerrainHex, TerrainCell>(
      [...tiles].map((tile) => [tile, { isWater: tile.col > 0, relief: -1 }]),
    );
    const field = createTerrainField(tiles, cells);
    const depths = Array.from(
      { length: 15 },
      (_, index) => -field.level(tiles.getHex({ col: index + 1, row: 3 })!),
    );
    expect(depths[0]).toBe(1);
    expect(Math.max(...depths)).toBe(MAX_SEABED_DEPTH);
    depths.forEach((depth, index) => expect(depth).toBeLessThanOrEqual(index + 1));
    for (let index = 1; index < depths.length; index++)
      expect(depths[index]!).toBeGreaterThanOrEqual(depths[index - 1]!);
  });

  it("levels a lone column into the plain around it", () => {
    const tiles = grid(9, 9);
    const peak = tiles.getHex({ col: 4, row: 4 })!;
    const cells = new Map<TerrainHex, TerrainCell>(
      [...tiles].map((tile) => [tile, { relief: tile === peak ? 1 : 0 }]),
    );
    expect(createTerrainField(tiles, cells).level(peak)).toBe(0);
  });

  it("records terraces and frozen water on the grid for actors and scenery", () => {
    const tiles = grid(12, 4);
    const cells = new Map<TerrainHex, TerrainCell>(
      [...tiles].map((tile) => [
        tile,
        tile.col < 2 ? { frost: "snow" } : { isWater: true },
      ]),
    );
    applyTerrainField(tiles, createTerrainField(tiles, cells), (tile) => tile.col >= 2);
    expect(tiles.getHex({ col: 0, row: 1 })!.terrace).toBe(0);
    expect(tiles.getHex({ col: 3, row: 1 })!.frozen).toBe(true);
    expect(tiles.getHex({ col: 11, row: 1 })!.frozen).toBe(false);
    expect(tiles.getHex({ col: 11, row: 1 })!.terrace).toBeLessThan(-1);
  });

  it("freezes water equally near an icy and an open coast whatever order the tiles arrive in", () => {
    const tiles = grid(5, 4);
    const cell = (tile: TerrainHex): TerrainCell =>
      tile.col === 0 ? { frost: "snow" } : tile.col === 4 ? {} : { isWater: true };
    const samples = (order: TerrainHex[]) => {
      const field = createTerrainField(
        tiles,
        new Map(order.map((tile) => [tile, cell(tile)])),
      );
      return [...tiles].flatMap((tile) =>
        tile.corners.map((corner) => field.sample(corner).frozen),
      );
    };
    const forward = [...tiles];
    expect(samples(forward)).toEqual(samples([...forward].reverse()));
    expect(samples(forward)).toEqual(
      samples([...forward].sort((a, b) => b.col - a.col || a.row - b.row)),
    );
  });

  it("keys corner samples exactly, so averaged frost and depth never collide", () => {
    const keys = [0, 1 / 3, 1 / 2, 2 / 3, 1].flatMap((frozen) =>
      [0, 1 / 12, 1 / 8, 1 / 6, 1].map((depth) => waterSampleKey({ depth, frozen })),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("samples relief deterministically and keeps unknown sectors flat", () => {
    const relief = sectorRelief(724, 26, 26);
    expect(relief(5, 5)).toBe(sectorRelief(724, 26, 26)(5, 5));
    expect(
      new Set(Array.from({ length: 26 }, (_, col) => relief(col, 13).toFixed(3))).size,
    ).toBeGreaterThan(5);
    expect(sectorRelief(-1, 26, 26)(5, 5)).toBe(0);
  });

  it("flattens the hexes under and around authored buildings, landmarks and shrines only", () => {
    const tiles = grid(8, 8);
    const flat = objectFootprints(tiles, [
      { type: "structure", x: 3, y: 3 },
      { type: "decoration", x: 6, y: 6 },
    ]);
    expect(flat.size).toBe(7);
    expect(flat.has(tiles.getHex({ col: 3, row: 3 })!)).toBe(true);
    expect(flat.has(tiles.getHex({ col: 6, row: 6 })!)).toBe(false);
  });
});
