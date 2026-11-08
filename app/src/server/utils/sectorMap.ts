import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import * as globalMapData from "@/data/hexasphere.json";
import {
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  type OverworldHabitat,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import { sectorMap } from "@/drizzle/schema";
import { isPlaceableSector } from "@/libs/overworldAi";
import {
  type EdgeIndex,
  resolveSectorMapEdgeCrossing,
} from "@/libs/sector-map/crossing";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { GlobalMapData } from "@/libs/sector-map/world-types";
import {
  findSectorMapForFetchUncachedPublishedMaps,
  listSectorMapForFetchPublishedSectorMaps,
  listSectorMapForFetchUncachedPublishedMaps,
  listVillagesForSectorWindow,
} from "@/queries/worldMap";
import type { DrizzleClient } from "@/server/db";

const globalMap = globalMapData as unknown as GlobalMapData;

/**
 * sha256 hex digest of the JSON.stringify'd upload, stored as the row's
 * sourceHash. Not canonicalized, so the same logical document with different
 * key ordering hashes differently.
 */
export const hashTiledJson = (json: unknown) =>
  createHash("sha256").update(JSON.stringify(json)).digest("hex");

// A sector's published map is immutable per version (publishing inserts a new
// row and archives the old), so cache the deserialized normalizedJson blob to
// spare a DB round-trip and blob transfer on every travel step / battle start.
// Revalidate versions after a short TTL to bound cross-process staleness without
// downloading unchanged blobs. Same-process publishes invalidate immediately.
const PUBLISHED_MAP_TTL_MS = 60_000;
const PUBLISHED_MAP_CACHE_LIMIT = 200;
type PublishedMapCacheEntry = { map: NormalizedSectorMap; version: number; at: number };
const publishedMapCache = new Map<number, PublishedMapCacheEntry>();
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
 * Touch the entry's LRU position, retaining expired maps for version validation.
 */
const getCachedPublishedMap = (sector: number): PublishedMapCacheEntry | undefined => {
  const entry = publishedMapCache.get(sector);
  if (entry) {
    publishedMapCache.delete(sector);
    publishedMapCache.set(sector, entry);
  }
  return entry;
};

/**
 * Generation-guarded cache write: `generation` must be captured from
 * cacheGeneration before the DB read, and the entry is silently dropped if an
 * invalidation happened in between (i.e. the read raced a publish).
 */
const setCachedPublishedMap = (
  sector: number,
  map: NormalizedSectorMap,
  version: number,
  generation: number,
  at: number,
) => {
  if (generation !== cacheGeneration) return; // an invalidation raced this read
  publishedMapCache.delete(sector);
  publishedMapCache.set(sector, { map, version, at });
  while (publishedMapCache.size > PUBLISHED_MAP_CACHE_LIMIT) {
    const oldestSector = publishedMapCache.keys().next().value;
    if (oldestSector !== undefined) publishedMapCache.delete(oldestSector);
  }
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

/** Globe terrain type of each habitat an overworld AI can be restricted to. */
const HABITAT_TILE_TYPES: Record<OverworldHabitat, number> = {
  grassland: 1,
  desert: 2,
  snow: 3,
};
const habitatPools = new Map<string, number[]>();

/**
 * Placeable sectors in any of the given habitats, in sector order. An empty list returns an
 * empty pool, which callers treat as "anywhere".
 */
export const habitatSectorPool = (habitats: readonly OverworldHabitat[]): number[] => {
  const key = [...habitats].sort().join(",");
  let pool = habitatPools.get(key);
  if (!pool) {
    const types = new Set(habitats.map((habitat) => HABITAT_TILE_TYPES[habitat]));
    pool = types.size
      ? globalMap.tiles.flatMap((tile, sector) =>
          types.has(tile.t) && isPlaceableSector(sector) ? [sector] : [],
        )
      : [];
    habitatPools.set(key, pool);
  }
  return pool;
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
 * Sectors whose published maps a moveInSector call should load together.
 * When the destination is exactly one step past a default-sized (26×26)
 * border, include that neighbour so the crossing does not wait on a second
 * sequential query. Authored maps with a different size, diagonals, and
 * polar gaps fall back to just the current sector; the router then loads
 * the real neighbour after it sees the actual map dimensions.
 */
export const publishedMapsToPrefetchForMove = (
  sector: number,
  dest: { x: number; y: number },
): number[] => {
  const outWest = dest.x === -1;
  const outEast = dest.x === SECTOR_WIDTH;
  const outSouth = dest.y === -1;
  const outNorth = dest.y === SECTOR_HEIGHT;
  const outCount = [outWest, outEast, outNorth, outSouth].filter(Boolean).length;
  if (outCount !== 1) return [sector];
  const direction = outWest ? "west" : outEast ? "east" : outNorth ? "north" : "south";
  const neighbor = getSectorNeighborIds(sector)[direction];
  return neighbor >= 0 ? [sector, neighbor] : [sector];
};

/**
 * Entry edge (0=N,1=E,2=S,3=W) of the neighbor reached across each edge.
 * Cylindrical-grid neighbors always use the opposite edge; -1 marks a blocked
 * north/south polar boundary.
 */
export const getSectorEntryEdges = (
  sector: number,
): Record<SectorNeighborDirection, number> => {
  const entries = globalMap.tiles[sector]?.ne;
  if (entries?.length !== 4) {
    throw new Error(`Sector ${sector} has no entry-edge data`);
  }
  return {
    north: entries[0]!,
    east: entries[1]!,
    south: entries[2]!,
    west: entries[3]!,
  };
};

/**
 * Resolve a cross-border move from rendered sector-map coordinates. Exiting
 * `sector` toward `direction` from the visible edge cell (x, y) lands in the
 * neighbor at the returned rendered-map entry cell. The only coordinate adapter
 * is the map/globe vertical-axis reflection; all real sector edges are aligned.
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
  if (toSector < 0 || globeEntryEdge < 0) {
    throw new Error(`Cannot cross ${direction} from sector ${sector}: polar boundary`);
  }
  const { entryEdge, entryX, entryY } = resolveSectorMapEdgeCrossing(
    exitEdge,
    x,
    y,
    fromWidth,
    fromHeight,
    globeEntryEdge as EdgeIndex,
    toWidth,
    toHeight,
  );
  return { toSector, entryEdge, entryX, entryY };
};

export interface SectorWindowEntry {
  sector: number;
  dx: number;
  dy: number;
}

/**
 * The unrotated 3x3 rendered window around a sector. Longitude wraps at the
 * east/west edge, while missing neighbors beyond the polar caps are filtered
 * out. Pure over the baked globe data so it is unit-testable; the
 * worldMap.getSectorWindow endpoint builds its response from this. Rendered y
 * increases upward, so north is dy=+1 and south is dy=-1.
 */
export const buildSectorWindowLayout = (sector: number): SectorWindowEntry[] => {
  const cardinals = getSectorNeighborIds(sector);
  const diagonals = getSectorDiagonalIds(sector);
  return [
    { sector, dx: 0, dy: 0 },
    { sector: cardinals.north, dx: 0, dy: 1 },
    { sector: cardinals.south, dx: 0, dy: -1 },
    { sector: cardinals.west, dx: -1, dy: 0 },
    { sector: cardinals.east, dx: 1, dy: 0 },
    { sector: diagonals.northeast, dx: 1, dy: 1 },
    { sector: diagonals.northwest, dx: -1, dy: 1 },
    { sector: diagonals.southeast, dx: 1, dy: -1 },
    { sector: diagonals.southwest, dx: -1, dy: -1 },
  ].filter((entry) => entry.sector >= 0);
};

/** Fetch missing maps and revalidate expired entries without unchanged blobs. */
export const fetchPublishedSectorMaps = async (
  client: DrizzleClient,
  sectors: number[],
): Promise<Map<number, NormalizedSectorMap>> => {
  const result = new Map<number, NormalizedSectorMap>();
  const missing: number[] = [];
  const expired = new Map<number, PublishedMapCacheEntry>();
  for (const sector of new Set(sectors)) {
    const cached = getCachedPublishedMap(sector);
    if (!cached) missing.push(sector);
    else if (Date.now() - cached.at < PUBLISHED_MAP_TTL_MS) {
      result.set(sector, cached.map);
    } else expired.set(sector, cached);
  }
  if (missing.length === 0 && expired.size === 0) return result;

  const generation = cacheGeneration;
  // A slow probe must not extend the lifetime of its older snapshot.
  const checkedAt = Date.now();
  // Cold loads and version probes are independent; only a changed version needs
  // a subsequent blob query. Selecting metadata alone also handles overlapping
  // publishes: compare the highest PUBLISHED version, never an archived version.
  const [loaded, versions] = await Promise.all([
    fetchUncachedPublishedMaps(client, missing, generation),
    expired.size > 0
      ? listSectorMapForFetchPublishedSectorMaps(client, expired)
      : Promise.resolve([]),
  ]);
  const latestVersions = new Map<number, number>();
  for (const row of versions) {
    latestVersions.set(
      row.sector,
      Math.max(latestVersions.get(row.sector) ?? 0, row.version),
    );
  }
  const changed: number[] = [];
  for (const [sector, entry] of expired) {
    const version = latestVersions.get(sector);
    if (version === entry.version) {
      setCachedPublishedMap(sector, entry.map, entry.version, generation, checkedAt);
      result.set(sector, entry.map);
    } else if (version !== undefined) changed.push(sector);
    else if (
      generation === cacheGeneration &&
      publishedMapCache.get(sector) === entry
    ) {
      publishedMapCache.delete(sector);
    }
  }
  const updated = await fetchUncachedPublishedMaps(client, changed, generation);
  for (const [sector, map] of [...loaded, ...updated]) result.set(sector, map);
  return result;
};

/** Download blobs only for cold or changed sectors; empty sets need no query. */
const fetchUncachedPublishedMaps = async (
  client: DrizzleClient,
  sectors: number[],
  generation: number,
): Promise<Map<number, NormalizedSectorMap>> => {
  const result = new Map<number, NormalizedSectorMap>();
  if (sectors.length === 0) return result;
  const checkedAt = Date.now();
  const columns = { sector: true, version: true, normalizedJson: true } as const;
  const where = and(
    inArray(sectorMap.sector, sectors),
    eq(sectorMap.status, "PUBLISHED"),
  );
  const rows =
    sectors.length === 1
      ? [
          await findSectorMapForFetchUncachedPublishedMaps(client, columns, where),
        ].filter((row) => row !== undefined)
      : await listSectorMapForFetchUncachedPublishedMaps(client, columns, where);
  const bySector = new Map<number, { version: number; map: NormalizedSectorMap }>();
  rows.forEach((row) => {
    const existing = bySector.get(row.sector);
    if (!existing || row.version > existing.version) {
      bySector.set(row.sector, { version: row.version, map: row.normalizedJson });
    }
  });
  for (const [sector, { map, version }] of bySector) {
    setCachedPublishedMap(sector, map, version, generation, checkedAt);
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

  const published = (await fetchPublishedSectorMaps(client, [sector])).get(sector);
  if (!published) {
    throw new Error(
      `No published sector map for sector ${sector}; run scripts/publish-sector-maps.ts`,
    );
  }

  return published;
};

/**
 * The per-sector window data (published map, global tile type, village
 * structures/type) for a set of sectors in one parallel fetch. Sectors without
 * a published map are simply absent from the returned Map — callers decide
 * whether that is fatal (window center) or ignorable (neighbors).
 */
export const fetchSectorWindowEntries = async (
  client: DrizzleClient,
  sectors: number[],
) => {
  const [maps, villages] = await Promise.all([
    fetchPublishedSectorMaps(client, sectors),
    listVillagesForSectorWindow(client, sectors),
  ]);
  const entries = new Map<
    number,
    {
      sector: number;
      map: NonNullable<ReturnType<(typeof maps)["get"]>>;
      globalTileType: number;
      structures: (typeof villages)[number]["structures"];
      villageType: (typeof villages)[number]["type"] | null;
    }
  >();
  for (const sector of new Set(sectors)) {
    const map = maps.get(sector);
    if (!map) continue;
    const village = villages.find((v) => v.sector === sector);
    entries.set(sector, {
      sector,
      map,
      globalTileType: getSectorTileType(sector),
      structures: village?.structures ?? [],
      villageType: village?.type ?? null,
    });
  }
  return entries;
};
