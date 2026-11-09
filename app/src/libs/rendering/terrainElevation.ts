import alea from "alea";
import { type Grid, ring } from "honeycomb-grid";
import { createNoise3D } from "simplex-noise";
import type { TerrainHex } from "@/libs/hexgrid";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import {
  globalElevation,
  sectorGeometry,
  tilePosition,
} from "@/libs/sector-map/worldgen";

/** Visible rise of one land terrace, as a fraction of the hex height. */
export const LAND_STEP = 0.22;
/** Visible drop of one seabed terrace below the water surface, as a fraction of the hex height. */
export const SEABED_STEP = 0.19;
export const MAX_LAND_TERRACE = 3;
export const MAX_SEABED_DEPTH = 5;
/** One number per axial coordinate; travel windows span far fewer than 2^15 hexes per axis. */
const axialKey = (q: number, r: number) => (q + 32768) * 65536 + (r + 32768);

/** Axial steps to a hex's six neighbours. */
const AXIAL_NEIGHBOURS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;
/** Offshore reach of an icy coast's frozen sheet, in hexes; open water lies beyond it. */
export const WATER_FIELD_REACH = 6;
const SHORE_REACH = 4;

/**
 * Per-tile inputs to the terrain field. relief is the macro height in [-1, 1]
 * from the global world-generation field; flat tiles (roads, foundations,
 * settlements) stay at sea level; past a two-hex apron their surroundings rise one
 * terrace per hex.
 */
export type TerrainCell = {
  isWater?: boolean;
  frost?: "snow" | "ice";
  flat?: boolean;
  relief?: number;
};

export type WaterSample = { depth: number; frozen: number };

/**
 * Integer terraces and shared-vertex water samples for one grid. Land terraces
 * are 0..MAX_LAND_TERRACE; stock water reports its seabed as -1..-MAX_SEABED_DEPTH.
 */
export type TerrainField = {
  level: (tile: TerrainHex) => number;
  sample: (point: { x: number; y: number }) => WaterSample;
  /** The cell containing a point, which may lie in a neighbouring sector; null past the field's edge. */
  at: (point: { x: number; y: number }) => { water: boolean; level: number } | null;
};

/**
 * A two-noise height profile in the manner of stepped isometric terrain: the
 * macro relief passes through a stepped curve into plateaus, capped so beaches
 * and settlements stay low and terraces climb at most one level per hex away
 * from them. The seabed deepens with distance offshore and with low relief.
 * Bounded flood fills keep values local, so retained sectors keep their terraces
 * as the window moves.
 */
export const createTerrainField = (
  grid: Grid<TerrainHex>,
  cells: ReadonlyMap<TerrainHex, TerrainCell>,
): TerrainField => {
  // Every flood and the smoothing pass walk the same neighbours, so each ring is found once.
  // Neighbours come from an axial index of the field's own tiles, never from grid lookups.
  const byAxial = new Map<number, TerrainHex>();
  for (const tile of cells.keys()) byAxial.set(axialKey(tile.q, tile.r), tile);
  const rings = new Map<TerrainHex, TerrainHex[]>();
  const around = (tile: TerrainHex) => {
    let neighbours = rings.get(tile);
    if (!neighbours) {
      neighbours = [];
      for (const [dq, dr] of AXIAL_NEIGHBOURS) {
        const neighbour = byAxial.get(axialKey(tile.q + dq, tile.r + dr));
        if (neighbour) neighbours.push(neighbour);
      }
      rings.set(tile, neighbours);
    }
    return neighbours;
  };
  const flood = (seeds: TerrainHex[], reach: number) => {
    const distances = new Map(seeds.map((tile) => [tile, 0]));
    const queue = [...seeds];
    for (let index = 0; index < queue.length; index++) {
      const tile = queue[index];
      const distance = tile && distances.get(tile);
      if (!tile || distance === undefined || distance >= reach) continue;
      for (const neighbor of around(tile))
        if (!distances.has(neighbor)) {
          distances.set(neighbor, distance + 1);
          queue.push(neighbor);
        }
    }
    return distances;
  };
  const water: TerrainHex[] = [],
    land: TerrainHex[] = [],
    flat: TerrainHex[] = [];
  for (const [tile, cell] of cells) {
    if (cell.isWater) water.push(tile);
    else land.push(tile);
    if (cell.flat && !cell.isWater) flat.push(tile);
  }
  const toWater = flood(water, SHORE_REACH);
  const toFlat = flood(flat, SHORE_REACH);
  // Offshore distance carries the nearest coast's frost, so icy shores freeze their own water.
  // Water equally near an icy and an open coast freezes, whatever order the tiles arrive in:
  // every tile at one distance is expanded before any tile at the next.
  const offshore = new Map<TerrainHex, { distance: number; frozen: number }>();
  const queue = [...land];
  for (const tile of land)
    offshore.set(tile, { distance: 0, frozen: cells.get(tile)?.frost ? 1 : 0 });
  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index];
    const value = tile && offshore.get(tile);
    if (!tile || !value || value.distance >= WATER_FIELD_REACH) continue;
    for (const neighbor of around(tile)) {
      const reached = offshore.get(neighbor);
      if (!reached) {
        offshore.set(neighbor, { distance: value.distance + 1, frozen: value.frozen });
        queue.push(neighbor);
      } else if (reached.distance === value.distance + 1)
        reached.frozen = Math.max(reached.frozen, value.frozen);
    }
  }
  const levels = new Map<TerrainHex, number>();
  const caps = new Map<TerrainHex, number>();
  for (const [tile, cell] of cells) {
    const relief = cell.relief ?? 0;
    if (cell.isWater) {
      const distance = offshore.get(tile)?.distance ?? WATER_FIELD_REACH;
      const profile =
        1 +
        Math.floor(Math.max(0, (distance - 1) * 0.8 + Math.max(0, 0.15 - relief) * 3));
      levels.set(tile, -Math.max(1, Math.min(MAX_SEABED_DEPTH, distance, profile)));
      continue;
    }
    // A stepped height profile: broad lowlands, then progressively rarer plateaus.
    const plateau =
      relief < 0.05 ? 0 : relief < 0.3 ? 1 : relief < 0.5 ? 2 : MAX_LAND_TERRACE;
    const coast = (toWater.get(tile) ?? SHORE_REACH + 1) - 1;
    // Two level hexes around flat ground keep forecourts, shoulders and paths flush.
    const settled = (toFlat.get(tile) ?? SHORE_REACH + 2) - 2;
    const cap = cell.flat ? 0 : Math.max(0, Math.min(coast, settled));
    caps.set(tile, cap);
    levels.set(tile, Math.min(plateau, cap));
  }
  // Lone columns and single-hex pits read as noise; level them into their surroundings.
  const smoothed = new Map(levels);
  for (const [tile, level] of levels) {
    if (cells.get(tile)?.isWater) continue;
    const landAround = around(tile)
      .filter((neighbor) => !cells.get(neighbor)?.isWater)
      .map((neighbor) => levels.get(neighbor) ?? 0);
    if (landAround.length < 3) continue;
    const highest = Math.max(...landAround),
      lowest = Math.min(...landAround);
    if (level > highest) smoothed.set(tile, highest);
    else if (level < lowest) smoothed.set(tile, Math.min(lowest, caps.get(tile) ?? 0));
  }
  for (const [tile, level] of smoothed) levels.set(tile, level);
  const vertices = new Map<number, { depth: number; frozen: number; count: number }>();
  for (const tile of cells.keys()) {
    const value = offshore.get(tile);
    const depth = Math.min(SHORE_REACH, value?.distance ?? SHORE_REACH);
    for (const point of tile.corners) {
      const key = vertexKey(point);
      const sample = vertices.get(key) ?? { depth: 0, frozen: 0, count: 0 };
      sample.depth += depth;
      sample.frozen += value?.frozen ?? 0;
      sample.count++;
      vertices.set(key, sample);
    }
  }
  return {
    level: (tile) => levels.get(tile) ?? 0,
    at: (point) => {
      const tile = grid.pointToHex(point, { allowOutside: false });
      const cell = tile && cells.get(tile);
      return tile && cell
        ? { water: !!cell.isWater, level: levels.get(tile) ?? 0 }
        : null;
    },
    sample: (point) => {
      const sample = vertices.get(vertexKey(point));
      return sample
        ? {
            depth: Math.min(1, sample.depth / sample.count / SHORE_REACH),
            frozen: sample.frozen / sample.count,
          }
        : { depth: 1, frozen: 0 };
    },
  };
};

/**
 * Exact key of a corner sample. Corners average the integer shore distances and frost of at
 * most three tiles, so depth and frost are whole multiples of these steps.
 */
export const waterSampleKey = (sample: WaterSample) =>
  String.fromCharCode(
    97 + Math.round(sample.depth * SHORE_REACH * 6) * 7 + Math.round(sample.frozen * 6),
  );

/** Records each tile's terrace and whether its stock water is frozen over. */
export const applyTerrainField = (
  grid: Grid<TerrainHex>,
  field: TerrainField,
  isStockWater: (tile: TerrainHex) => boolean,
) => {
  for (const tile of grid) {
    const water = isStockWater(tile);
    tile.terrace = water
      ? Math.min(-1, field.level(tile))
      : Math.max(0, field.level(tile));
    tile.frozen =
      water &&
      tile.corners.reduce((sum, point) => sum + field.sample(point).frozen, 0) /
        tile.corners.length >=
        0.5;
  }
};

/** World-unit lift of whatever stands on a tile: raised land carries it, water and seabed do not. */
export const standingOffset = (tile: TerrainHex) =>
  Math.max(0, tile.terrace ?? 0) * LAND_STEP * tile.height;

/** Raises scenery with the terrace beneath its ground contact, keeping its depth order consistent. */
export const liftSpritesToTerrain = (
  descriptions: WorldSpriteDescription[],
  grid: Grid<TerrainHex>,
) => {
  for (const description of descriptions) {
    const tile = grid.pointToHex(
      { x: description.x, y: description.groundY },
      { allowOutside: false },
    );
    const lift = tile ? standingOffset(tile) : 0;
    if (!lift) continue;
    description.y += lift;
    description.groundY += lift;
  }
  return descriptions;
};

const plateauNoise = createNoise3D(alea("terrain-plateaus-v1"));

/**
 * Macro relief of a sector's tiles, sampled at each tile's position on the world
 * sphere so neighbouring sectors agree. A sector spans about 2.5 sphere units, so
 * the plateau octaves form a few highlands per sector while the global
 * elevation lifts whole uplands and lowers coastal plains.
 */
export const sectorRelief = (sector: number, width: number, height: number) => {
  let corners: ReturnType<typeof sectorGeometry>["corners"] | null = null;
  try {
    corners = sectorGeometry(sector).corners;
  } catch {
    corners = null;
  }
  return (col: number, row: number) => {
    if (!corners) return 0;
    const p = tilePosition(corners, col, row, width, height);
    return (
      plateauNoise(p.x * 0.42, p.y * 0.42, p.z * 0.42) * 0.65 +
      plateauNoise(p.x * 1.1 + 17, p.y * 1.1, p.z * 1.1) * 0.15 +
      globalElevation(p) * 0.35
    );
  };
};

/** Hexes under and around authored buildings, landmarks and shrines, which stand on level ground. */
export const objectFootprints = (
  grid: Grid<TerrainHex>,
  objects: readonly { type: string; x: number; y: number }[],
) => {
  const tiles = new Set<TerrainHex>();
  for (const object of objects) {
    if (
      object.type !== "structure" &&
      object.type !== "landmark" &&
      object.type !== "shrine"
    )
      continue;
    const center = grid.getHex({
      col: Math.round(object.x),
      row: Math.round(object.y),
    });
    if (!center) continue;
    tiles.add(center);
    for (const neighbor of grid.traverse(ring({ center, radius: 1 })))
      tiles.add(neighbor);
  }
  return tiles;
};

/** Zones whose ground stays at sea level so paths, foundations and plazas remain flush. */
export const isFlatZone = (zone: string | undefined) =>
  zone === "road" ||
  zone === "village" ||
  zone === "safezone" ||
  zone === "structure" ||
  zone === "shrine";

/** Shared hex corners as one number, at 1/64-unit precision; the grids span well under 8,000 units. */
const vertexKey = (point: { x: number; y: number }) =>
  Math.round(point.x * 64) * 1048576 + Math.round(point.y * 64);
