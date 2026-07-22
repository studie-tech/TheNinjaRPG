import { describe, expect, it } from "vitest";
import globe from "@/data/hexasphere.json";
import {
  MAP_NAVIGABLE_LATITUDE_LIMIT,
  MAP_TOTAL_SECTORS,
  MAP_WORLD_COLUMNS,
  MAP_WORLD_ROWS,
} from "@/drizzle/constants";
import {
  EDGE_EAST,
  EDGE_NORTH,
  EDGE_SOUTH,
  EDGE_WEST,
  edgeCell,
  edgeLength,
  edgeParam,
  mapParam,
  paramFlips,
  resolveEdgeCrossing,
  resolveSectorMapEdgeCrossing,
  seamRotation,
  sectorMapEdgeForGlobeEdge,
  type EdgeIndex,
} from "@/libs/sector-map/crossing";
import {
  sectorGridEntryEdges,
  sectorGridNeighbors,
  sectorGridPosition,
  sectorIdAt,
} from "@/libs/sector-map/world-grid";
import {
  globalBiomeType,
  globalContinentalness,
  globalMoisture,
  globalTemperature,
} from "@/libs/sector-map/worldgen";
import {
  getSectorEntryEdges,
  getSectorNeighborIds,
  resolveSectorCrossing,
  SectorNeighborDirections,
} from "@/server/utils/sectorMap";

const tiles = globe.tiles as {
  n: number[];
  ne: number[];
  t: number;
  v: number[];
  vc: number[];
}[];
const W = 26;
const H = 26;

describe("crossing edge primitives", () => {
  it("places and reads cells on every edge", () => {
    expect(edgeCell(EDGE_NORTH, 5, W, H)).toEqual({ x: 5, y: 0 });
    expect(edgeCell(EDGE_SOUTH, 5, W, H)).toEqual({ x: 5, y: H - 1 });
    expect(edgeCell(EDGE_WEST, 7, W, H)).toEqual({ x: 0, y: 7 });
    expect(edgeCell(EDGE_EAST, 7, W, H)).toEqual({ x: W - 1, y: 7 });
    expect(edgeParam(EDGE_NORTH, 5, 0)).toBe(5);
    expect(edgeParam(EDGE_EAST, W - 1, 7)).toBe(7);
  });

  it("keeps aligned parameters and scales differently sized maps", () => {
    expect(paramFlips(EDGE_NORTH, EDGE_SOUTH)).toBe(false);
    expect(paramFlips(EDGE_EAST, EDGE_WEST)).toBe(false);
    expect(seamRotation(EDGE_NORTH, EDGE_SOUTH)).toBe(0);
    expect(seamRotation(EDGE_EAST, EDGE_WEST)).toBe(0);
    expect(mapParam(2, 4, 8, false)).toBe(5);
    expect(
      resolveSectorMapEdgeCrossing(
        EDGE_EAST,
        3,
        1,
        4,
        6,
        EDGE_WEST,
        8,
        10,
      ),
    ).toEqual({ entryEdge: EDGE_WEST, entryX: 0, entryY: 2 });
  });
});

describe("cylindrical world topology", () => {
  it("stores the configured projection and stable 72x27 id space", () => {
    expect(globe.projection).toBe("cylindrical");
    expect(globe.generation).toBe("hierarchical-climate-v7-continuous-protection");
    expect(globe.visualScale).toBe(6);
    expect(globe.polarCapColumns).toBe(MAP_WORLD_COLUMNS * globe.visualScale);
    expect(globe.polarCapRows).toBe(32);
    expect(globe.landThreshold).toBe(-0.2);
    expect(globe.columns).toBe(MAP_WORLD_COLUMNS);
    expect(globe.rows).toBe(MAP_WORLD_ROWS);
    expect(globe.latitudeLimit).toBe(MAP_NAVIGABLE_LATITUDE_LIMIT);
    expect(MAP_NAVIGABLE_LATITUDE_LIMIT).toBe(65);
    expect(tiles).toHaveLength(MAP_TOTAL_SECTORS);
    expect(tiles.every((tile) => tile.v.length === 36)).toBe(true);
    expect(tiles.every((tile) => tile.vc.length === 49)).toBe(true);
  });

  it("continues biome colors across smooth edge-free polar caps", () => {
    const polarRows = globe.polarCapRows;
    const polarColumns = globe.polarCapColumns;
    const sectorScale = globe.visualScale;
    const sectorStride = sectorScale + 1;
    const expectedPolarColors = (polarRows + 1) * (polarColumns + 1);
    expect(globe.polarCapColors.north).toHaveLength(expectedPolarColors);
    expect(globe.polarCapColors.south).toHaveLength(expectedPolarColors);
    expect(new Set(globe.polarCapColors.north).size).toBeGreaterThan(500);
    expect(new Set(globe.polarCapColors.south).size).toBeGreaterThan(500);

    const lastRowStart = (MAP_WORLD_ROWS - 1) * MAP_WORLD_COLUMNS;
    for (let column = 0; column <= polarColumns; column++) {
      const sectorColumn = Math.min(
        MAP_WORLD_COLUMNS - 1,
        Math.floor(column / sectorScale),
      );
      const localColumn = column - sectorColumn * sectorScale;
      expect(globe.polarCapColors.north[column]).toBe(
        tiles[sectorColumn]!.vc[localColumn],
      );
      expect(globe.polarCapColors.south[column]).toBe(
        tiles[lastRowStart + sectorColumn]!.vc[
          sectorScale * sectorStride + localColumn
        ],
      );
    }
  });

  it("keeps water below one third of the visual world", () => {
    const visualTerrain = tiles.flatMap((tile) => tile.v);
    const water = visualTerrain.filter((terrain) => terrain === 0).length;
    expect(water / visualTerrain.length).toBeLessThan(1 / 3);
    expect(new Set(visualTerrain)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("uses irregular climate regions instead of latitude-wide biome bands", () => {
    const rowBiomes = Array.from({ length: MAP_WORLD_ROWS }, (_, row) =>
      new Set(
        tiles
          .slice(row * MAP_WORLD_COLUMNS, (row + 1) * MAP_WORLD_COLUMNS)
          .map((tile) => tile.t)
          .filter((terrain) => terrain !== 0),
      ),
    );
    const mixedClimateRows = rowBiomes.filter((biomes) => biomes.size > 1).length;
    const desertRows = rowBiomes.filter((biomes) => biomes.has(2)).length;
    const irregularIceEdges = rowBiomes.filter(
      (biomes) => biomes.has(3) && [...biomes].some((terrain) => terrain !== 3),
    ).length;

    expect(mixedClimateRows).toBeGreaterThan(10);
    expect(desertRows).toBeGreaterThan(10);
    expect(irregularIceEdges).toBeGreaterThan(5);
  });

  it("shares exact visual colors across ordinary sector boundaries", () => {
    const scale = globe.visualScale;
    const stride = scale + 1;
    for (let sector = 0; sector < tiles.length; sector++) {
      const tile = tiles[sector]!;
      const east = tile.n[EDGE_EAST]!;
      if (east >= 0) {
        for (let y = 0; y <= scale; y++) {
          expect(tile.vc[y * stride + scale]).toBe(tiles[east]!.vc[y * stride]);
        }
      }
      const south = tile.n[EDGE_SOUTH]!;
      if (south >= 0) {
        for (let x = 0; x <= scale; x++) {
          expect(tile.vc[scale * stride + x]).toBe(tiles[south]!.vc[x]);
        }
      }
    }
  });

  it("matches the independent row-major graph for every sector", () => {
    let missingEdges = 0;
    for (let sector = 0; sector < tiles.length; sector++) {
      expect(sectorGridPosition(sector)).toEqual({
        column: sector % MAP_WORLD_COLUMNS,
        row: Math.floor(sector / MAP_WORLD_COLUMNS),
      });
      expect(tiles[sector]!.n).toEqual(sectorGridNeighbors(sector));
      expect(tiles[sector]!.ne).toEqual(sectorGridEntryEdges(sector));
      for (let edge = 0; edge < 4; edge++) {
        const neighbor = tiles[sector]!.n[edge]!;
        const entryEdge = tiles[sector]!.ne[edge]!;
        if (neighbor < 0) {
          expect(entryEdge).toBe(-1);
          expect(edge === EDGE_NORTH || edge === EDGE_SOUTH).toBe(true);
          missingEdges++;
          continue;
        }
        expect(entryEdge).toBe((edge + 2) % 4);
        expect(tiles[neighbor]!.n[entryEdge]).toBe(sector);
        expect(tiles[neighbor]!.ne[entryEdge]).toBe(edge);
      }
    }
    expect(missingEdges).toBe(MAP_WORLD_COLUMNS * 2);
  });

  it("wraps longitude without rotation and blocks both polar caps", () => {
    const middleRow = Math.floor(MAP_WORLD_ROWS / 2);
    const first = sectorIdAt(0, middleRow);
    const last = sectorIdAt(MAP_WORLD_COLUMNS - 1, middleRow);
    expect(getSectorNeighborIds(first).west).toBe(last);
    expect(getSectorNeighborIds(last).east).toBe(first);
    expect(getSectorEntryEdges(first).west).toBe(EDGE_EAST);
    expect(getSectorEntryEdges(last).east).toBe(EDGE_WEST);

    expect(getSectorNeighborIds(sectorIdAt(0, 0)).north).toBe(-1);
    expect(getSectorNeighborIds(sectorIdAt(0, MAP_WORLD_ROWS - 1)).south).toBe(-1);
  });

  it("round-trips every cell on every real sector edge", () => {
    let checked = 0;
    for (let sector = 0; sector < tiles.length; sector++) {
      for (let edge = 0; edge < 4; edge++) {
        const exitEdge = edge as EdgeIndex;
        const neighbor = tiles[sector]!.n[edge]!;
        if (neighbor < 0) continue;
        const entryEdge = tiles[sector]!.ne[edge]! as EdgeIndex;
        for (let parameter = 0; parameter < W; parameter++) {
          const exit = edgeCell(exitEdge, parameter, W, H);
          const landed = resolveEdgeCrossing(
            exitEdge,
            exit.x,
            exit.y,
            W,
            H,
            entryEdge,
            W,
            H,
          );
          const backEntry = tiles[neighbor]!.ne[entryEdge]! as EdgeIndex;
          const back = resolveEdgeCrossing(
            entryEdge,
            landed.entryX,
            landed.entryY,
            W,
            H,
            backEntry,
            W,
            H,
          );
          expect(back.entryX).toBe(exit.x);
          expect(back.entryY).toBe(exit.y);
          checked++;
        }
      }
    }
    expect(checked).toBe((MAP_TOTAL_SECTORS * 4 - MAP_WORLD_COLUMNS * 2) * W);
  }, 20_000);
});

describe("deterministic spherical climate", () => {
  it("keeps fixed-seed climate samples stable", () => {
    const sample = { x: 30, y: 0, z: 0 };
    expect(globalContinentalness(sample)).toBeCloseTo(0.2324878045, 9);
    expect(globalTemperature(sample)).toBeCloseTo(0.7726227208, 9);
    expect(globalMoisture(sample)).toBeCloseTo(0.3138042204, 9);
    expect(globalBiomeType(sample, true)).toBe(1);
  });

  it("is continuous across the wrapped antimeridian", () => {
    const epsilon = 1e-7;
    const latitude = 0.37;
    const point = (longitude: number) => ({
      x: Math.cos(longitude) * Math.cos(latitude) * 30,
      y: Math.sin(latitude) * 30,
      z: Math.sin(longitude) * Math.cos(latitude) * 30,
    });
    const west = point(-Math.PI + epsilon);
    const east = point(Math.PI - epsilon);
    expect(Math.abs(globalContinentalness(west) - globalContinentalness(east))).toBeLessThan(
      0.00001,
    );
    expect(Math.abs(globalTemperature(west) - globalTemperature(east))).toBeLessThan(0.00001);
    expect(Math.abs(globalMoisture(west) - globalMoisture(east))).toBeLessThan(0.00001);
  });
});

describe("game crossing wrapper", () => {
  it("maps every rendered edge through the baked graph and back", () => {
    let checked = 0;
    for (let sector = 0; sector < tiles.length; sector++) {
      const neighbors = getSectorNeighborIds(sector);
      const entryEdges = getSectorEntryEdges(sector);
      SectorNeighborDirections.forEach((direction, index) => {
        expect(neighbors[direction]).toBe(tiles[sector]!.n[index]);
        expect(entryEdges[direction]).toBe(tiles[sector]!.ne[index]);
        if (neighbors[direction] < 0) return;

        const globeExitEdge = index as EdgeIndex;
        const mapExitEdge = sectorMapEdgeForGlobeEdge(globeExitEdge);
        const globeEntryEdge = entryEdges[direction] as EdgeIndex;
        const mapEntryEdge = sectorMapEdgeForGlobeEdge(globeEntryEdge);
        for (let parameter = 0; parameter < edgeLength(mapExitEdge, W, H); parameter++) {
          const exit = edgeCell(mapExitEdge, parameter, W, H);
          const result = resolveSectorCrossing(
            sector,
            direction,
            exit.x,
            exit.y,
            W,
            H,
            W,
            H,
          );
          expect(result.toSector).toBe(neighbors[direction]);
          expect(result.entryEdge).toBe(mapEntryEdge);
          const back = resolveSectorCrossing(
            result.toSector,
            SectorNeighborDirections[globeEntryEdge]!,
            result.entryX,
            result.entryY,
            W,
            H,
            W,
            H,
          );
          expect(back).toMatchObject({
            toSector: sector,
            entryX: exit.x,
            entryY: exit.y,
          });
          checked++;
        }
      });
    }
    expect(checked).toBe((MAP_TOTAL_SECTORS * 4 - MAP_WORLD_COLUMNS * 2) * W);
  }, 20_000);

  it("keeps Shirohana and the former 1620 seam in the same orientation", () => {
    expect(getSectorNeighborIds(1631)).toEqual({
      north: 1559,
      east: 1632,
      south: 1703,
      west: 1630,
    });
    expect(getSectorNeighborIds(1620).west).toBe(1619);
    const south = resolveSectorCrossing(1631, "south", 13, 0, W, H, W, H);
    expect(south).toEqual({
      toSector: 1703,
      entryEdge: EDGE_SOUTH,
      entryX: 13,
      entryY: H - 1,
    });
  });

  it("rejects attempts to resolve a crossing into a polar cap", () => {
    expect(() =>
      resolveSectorCrossing(sectorIdAt(0, 0), "north", 13, H - 1, W, H, W, H),
    ).toThrow(/polar boundary/);
  });
});
