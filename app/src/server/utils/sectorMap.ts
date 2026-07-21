import { and, eq, inArray } from "drizzle-orm";
import * as globalMapData from "@/data/hexasphere.json";
import { MAP_SECTOR_ID_MAX, MAP_SECTOR_ID_MIN } from "@/drizzle/constants";
import { sectorMap } from "@/drizzle/schema";
import {
  type EdgeIndex,
  resolveSectorMapEdgeCrossing,
  seamRotation,
} from "@/libs/sector-map/crossing";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { GlobalMapData } from "@/libs/threejs/types";
import type { DrizzleClient } from "@/server/db";

const globalMap = globalMapData as unknown as GlobalMapData;

// A sector's published map is immutable per version (publishing inserts a new
// row and archives the old), so cache the deserialized normalizedJson blob to
// spare a DB round-trip + ~30-80KB transfer on every travel step / battle start.
// A short TTL bounds cross-process staleness (serverless runs many instances);
// same-process publishes call invalidatePublishedMapCache for instant freshness.
const PUBLISHED_MAP_TTL_MS = 60_000;
const publishedMapCache = new Map<number, { map: NormalizedSectorMap; at: number }>();
// Bumped on every invalidation. A read captures it before its DB query and only
// caches the row if it is still current, so a read that started before a publish
// committed can't re-populate the cache with the now-stale map after the publish
// handler already invalidated it (classic read-through stale-set race).
let cacheGeneration = 0;

/**
 * Evict a single sector from the published-map cache, or the whole cache when
 * no sector is given. Always bumps cacheGeneration so in-flight reads that
 * started before this invalidation cannot re-populate the cache with stale data.
 */
export const invalidatePublishedMapCache = (sector?: number) => {
  cacheGeneration += 1;
  if (sector === undefined) publishedMapCache.clear();
  else publishedMapCache.delete(sector);
};

/**
 * TTL-checked cache read (PUBLISHED_MAP_TTL_MS); eagerly deletes an expired
 * entry as a side effect.
 */
const getCachedPublishedMap = (sector: number): NormalizedSectorMap | undefined => {
  const entry = publishedMapCache.get(sector);
  if (entry && Date.now() - entry.at < PUBLISHED_MAP_TTL_MS) return entry.map;
  if (entry) publishedMapCache.delete(sector);
  return undefined;
};

/**
 * Generation-guarded cache write: `generation` must be captured from
 * cacheGeneration before the DB read, and the entry is silently dropped if an
 * invalidation happened in between (i.e. the read raced a publish).
 */
const setCachedPublishedMap = (
  sector: number,
  map: NormalizedSectorMap,
  generation: number,
) => {
  if (generation !== cacheGeneration) return; // an invalidation raced this read
  publishedMapCache.set(sector, { map, at: Date.now() });
};

export const SectorNeighborDirections = ["north", "east", "south", "west"] as const;
export type SectorNeighborDirection = (typeof SectorNeighborDirections)[number];
export type SectorDiagonalDirection =
  | "northeast"
  | "southeast"
  | "southwest"
  | "northwest";

/** Globe cardinal direction index, aligned with the tile `n`/`ne` arrays */
const DIRECTION_TO_EDGE: Record<SectorNeighborDirection, EdgeIndex> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
};

/**
 * Diagonal neighbors for the preview ring: the common neighbor of the two
 * adjacent cardinals; -1 where a polar edge leaves no diagonal.
 */
export const getSectorDiagonalIds = (
  sector: number,
): Record<SectorDiagonalDirection, number> => {
  const direct = getSectorNeighborIds(sector);
  // The diagonal across cardinals `a` and `b`: their common neighbor that is
  // not this sector; -1 when either cardinal is missing (polar edge)
  const corner = (a: number, b: number) => {
    if (a < 0 || b < 0) return -1;
    const aNeighbors = Object.values(getSectorNeighborIds(a));
    const bNeighbors = Object.values(getSectorNeighborIds(b));
    return (
      aNeighbors.find((id) => id >= 0 && id !== sector && bNeighbors.includes(id)) ?? -1
    );
  };
  return {
    northeast: corner(direct.north, direct.east),
    northwest: corner(direct.north, direct.west),
    southeast: corner(direct.south, direct.east),
    southwest: corner(direct.south, direct.west),
  };
};

/** Globe terrain type for a sector (0=ocean, 1=land, 2=desert, 3=ice) */
export const getSectorTileType = (sector: number): number => {
  return globalMap.tiles[sector]?.t ?? 1;
};

/**
 * Grid-globe neighbor sector ids in [north, east, south, west] order.
 * East/west wrap around the planet; -1 marks the polar edges where no
 * neighbor exists.
 */
export const getSectorNeighborIds = (
  sector: number,
): Record<SectorNeighborDirection, number> => {
  const neighbors = globalMap.tiles[sector]?.n;
  if (neighbors?.length !== 4) {
    throw new Error(`Sector ${sector} has no grid neighbor data`);
  }
  return {
    north: neighbors[0]!,
    east: neighbors[1]!,
    south: neighbors[2]!,
    west: neighbors[3]!,
  };
};

/**
 * Entry edge (0=N,1=E,2=S,3=W) of the neighbour reached by crossing each of this
 * sector's edges. Within a cube face this is the opposite edge; across the 12
 * cube-edge seams it encodes the 90/270 rotation. Reciprocal with the neighbour
 * graph: globalMap.tiles[n[e]].n[ne[e]] === sector.
 */
export const getSectorEntryEdges = (
  sector: number,
): Record<SectorNeighborDirection, EdgeIndex> => {
  const entries = globalMap.tiles[sector]?.ne;
  if (entries?.length !== 4) {
    throw new Error(`Sector ${sector} has no entry-edge data`);
  }
  return {
    north: entries[0]! as EdgeIndex,
    east: entries[1]! as EdgeIndex,
    south: entries[2]! as EdgeIndex,
    west: entries[3]! as EdgeIndex,
  };
};

/**
 * Resolve a cross-border move from rendered sector-map coordinates. Exiting
 * `sector` toward `direction` from the visible edge cell (x, y) lands in the
 * neighbour at the returned rendered-map entry cell. Handles both the map/globe
 * vertical-axis reflection and cube-sphere seam rotation in one code path.
 */
export const resolveSectorCrossing = (
  sector: number,
  direction: SectorNeighborDirection,
  x: number,
  y: number,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): { toSector: number; entryEdge: EdgeIndex; entryX: number; entryY: number } => {
  const exitEdge = DIRECTION_TO_EDGE[direction];
  const toSector = getSectorNeighborIds(sector)[direction];
  const globeEntryEdge = getSectorEntryEdges(sector)[direction];
  const { entryEdge, entryX, entryY } = resolveSectorMapEdgeCrossing(
    exitEdge,
    x,
    y,
    fromWidth,
    fromHeight,
    globeEntryEdge,
    toWidth,
    toHeight,
  );
  return { toSector, entryEdge, entryX, entryY };
};

export interface SectorWindowEntry {
  sector: number;
  dx: number;
  dy: number;
  rotation: number;
}

/**
 * The 3x3 rendered window layout around a sector: the center, its cardinal neighbors
 * (with their quarter-turn seam rotation relative to the center - 0 within a
 * cube face, 1 or 3 across the rotated cube-edge seams), and its diagonals
 * (rotation 0; used only for rendering). Missing polar/edge sectors are
 * filtered out. Pure over the baked globe data so it is unit-testable; the
 * worldMap.getSectorWindow endpoint builds its response from this. Rendered y
 * increases upward, so north is dy=+1 and south is dy=-1.
 */
export const buildSectorWindowLayout = (sector: number): SectorWindowEntry[] => {
  const cardinals = getSectorNeighborIds(sector);
  const diagonals = getSectorDiagonalIds(sector);
  const centerEdges = getSectorEntryEdges(sector);
  const rotationFor = (edge: EdgeIndex, direction: SectorNeighborDirection) =>
    seamRotation(edge, centerEdges[direction]);
  return [
    { sector, dx: 0, dy: 0, rotation: 0 },
    { sector: cardinals.north, dx: 0, dy: 1, rotation: rotationFor(0, "north") },
    { sector: cardinals.south, dx: 0, dy: -1, rotation: rotationFor(2, "south") },
    { sector: cardinals.west, dx: -1, dy: 0, rotation: rotationFor(3, "west") },
    { sector: cardinals.east, dx: 1, dy: 0, rotation: rotationFor(1, "east") },
    { sector: diagonals.northeast, dx: 1, dy: 1, rotation: 0 },
    { sector: diagonals.northwest, dx: -1, dy: 1, rotation: 0 },
    { sector: diagonals.southeast, dx: 1, dy: -1, rotation: 0 },
    { sector: diagonals.southwest, dx: -1, dy: -1, rotation: 0 },
  ].filter((entry) => entry.sector >= 0);
};

/** Fetch the published maps for several sectors in a single query */
export const fetchPublishedSectorMaps = async (
  client: DrizzleClient,
  sectors: number[],
): Promise<Map<number, NormalizedSectorMap>> => {
  const result = new Map<number, NormalizedSectorMap>();
  const missing: number[] = [];
  for (const sector of new Set(sectors)) {
    const cached = getCachedPublishedMap(sector);
    if (cached) result.set(sector, cached);
    else missing.push(sector);
  }
  if (missing.length === 0) return result;

  const generation = cacheGeneration;
  const rows = await client.query.sectorMap.findMany({
    columns: { sector: true, version: true, normalizedJson: true },
    where: and(inArray(sectorMap.sector, missing), eq(sectorMap.status, "PUBLISHED")),
  });
  const bySector = new Map<number, { version: number; map: NormalizedSectorMap }>();
  rows.forEach((row) => {
    const existing = bySector.get(row.sector);
    if (!existing || row.version > existing.version) {
      bySector.set(row.sector, { version: row.version, map: row.normalizedJson });
    }
  });
  for (const [sector, { map }] of bySector) {
    setCachedPublishedMap(sector, map, generation);
    result.set(sector, map);
  }
  return result;
};

/**
 * Single-sector counterpart of fetchPublishedSectorMaps: validates the sector
 * id, serves from the TTL cache, and picks the highest published version.
 * THROWS when the sector has no published map — callers on player-facing paths
 * must .catch and return a graceful response.
 */
export const fetchPublishedSectorMap = async (
  client: DrizzleClient,
  sector: number,
): Promise<NormalizedSectorMap> => {
  if (!isValidSectorId(sector)) {
    throw new Error(
      `Sector must be between ${MAP_SECTOR_ID_MIN} and ${MAP_SECTOR_ID_MAX}`,
    );
  }

  const cached = getCachedPublishedMap(sector);
  if (cached) return cached;

  const generation = cacheGeneration;
  const published = await client.query.sectorMap.findFirst({
    columns: { normalizedJson: true },
    where: and(eq(sectorMap.sector, sector), eq(sectorMap.status, "PUBLISHED")),
    orderBy: (table, { desc }) => [desc(table.version)],
  });
  if (!published) {
    throw new Error(
      `No published sector map for sector ${sector}; run scripts/publish-sector-maps.ts`,
    );
  }

  setCachedPublishedMap(sector, published.normalizedJson, generation);
  return published.normalizedJson;
};
