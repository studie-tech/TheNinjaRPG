import {
  COMBAT_BIOMES,
  SECTOR_MAP_MAX_DIMENSION,
  SECTOR_MAP_VERSION,
} from "@/drizzle/constants";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type {
  NormalizedSectorAnchor,
  NormalizedSectorMap,
  NormalizedSectorTile,
  SectorCoordinate,
} from "@/libs/sector-map/types";

export interface SectorMapValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

/** Canonical "x,y" key used for tile indexes and BFS visited-tracking */
export const getSectorTileKey = (x: number, y: number) => `${x},${y}`;

/**
 * Bounds check for a sector coordinate. Non-integer coordinates are rejected
 * too - fractional values from bad input count as outside the map.
 */
export const isCoordinateInSectorMap = (
  map: Pick<NormalizedSectorMap, "width" | "height">,
  coordinate: SectorCoordinate,
) => {
  return (
    Number.isInteger(coordinate.x) &&
    Number.isInteger(coordinate.y) &&
    coordinate.x >= 0 &&
    coordinate.y >= 0 &&
    coordinate.x < map.width &&
    coordinate.y < map.height
  );
};

// Lazily index a map's tiles by "x,y" so repeated lookups (BFS reachability,
// per-step walkability, window pathfinding) are O(1) instead of a linear scan.
// Keyed on the map object; the immutable normalizedJson blob is reused across a
// whole move, so the index is built once and reused for every probe.
const tileIndexCache = new WeakMap<object, Map<string, NormalizedSectorTile>>();

/**
 * The "x,y" -> tile index for a map, memoized per map OBJECT IDENTITY via the
 * WeakMap cache above. The map's tiles array must not be mutated after the
 * first lookup or the cached index goes stale.
 */
const getTileIndex = (
  map: Pick<NormalizedSectorMap, "tiles">,
): Map<string, NormalizedSectorTile> => {
  let index = tileIndexCache.get(map);
  if (!index) {
    index = new Map(map.tiles.map((tile) => [getSectorTileKey(tile.x, tile.y), tile]));
    tileIndexCache.set(map, index);
  }
  return index;
};

/**
 * O(1) tile lookup via the lazily built per-map index; undefined when the
 * coordinate has no tile entry
 */
export const getSectorTile = (
  map: Pick<NormalizedSectorMap, "tiles">,
  coordinate: SectorCoordinate,
) => {
  return getTileIndex(map).get(getSectorTileKey(coordinate.x, coordinate.y));
};

/**
 * The canonical walkability predicate shared by movement, BFS reachability and
 * validation: in bounds AND tile exists AND not blocked AND walkCost > 0
 */
export const isWalkableCoordinate = (
  map: Pick<NormalizedSectorMap, "width" | "height" | "tiles">,
  coordinate: SectorCoordinate,
) => {
  if (!isCoordinateInSectorMap(map, coordinate)) return false;
  const tile = getSectorTile(map, coordinate);
  return !!tile && !tile.blocked && tile.walkCost > 0;
};

/**
 * The six hex neighbours under the flat-top odd-q stagger convention (even
 * columns shift the diagonal pair up, odd columns down). May return
 * out-of-bounds coordinates; callers are expected to filter.
 */
export const getNeighborCoordinates = (
  coordinate: SectorCoordinate,
): SectorCoordinate[] => {
  const isEvenColumn = coordinate.x % 2 === 0;
  return [
    { x: coordinate.x, y: coordinate.y + 1 },
    { x: coordinate.x, y: coordinate.y - 1 },
    { x: coordinate.x - 1, y: coordinate.y + (isEvenColumn ? 0 : 1) },
    { x: coordinate.x + 1, y: coordinate.y + (isEvenColumn ? 0 : 1) },
    { x: coordinate.x - 1, y: coordinate.y + (isEvenColumn ? -1 : 0) },
    { x: coordinate.x + 1, y: coordinate.y + (isEvenColumn ? -1 : 0) },
  ];
};

/**
 * Whether a walkable path exists from `from` to `to`, via BFS over walkable
 * tiles only. Both endpoints must themselves be walkable or this returns false
 * immediately. Runs on the move hot-path.
 */
export const isReachableCoordinate = (
  map: Pick<NormalizedSectorMap, "width" | "height" | "tiles">,
  from: SectorCoordinate,
  to: SectorCoordinate,
) => {
  if (!isWalkableCoordinate(map, from) || !isWalkableCoordinate(map, to)) return false;
  if (from.x === to.x && from.y === to.y) return true;

  const visited = new Set<string>();
  const queue: SectorCoordinate[] = [from];
  // Advance a head pointer instead of Array.shift() (which is O(n)); on a large
  // map that would make the whole BFS O(n^2) on the move hot-path.
  let head = 0;
  visited.add(getSectorTileKey(from.x, from.y));

  while (head < queue.length) {
    const current = queue[head++];
    if (!current) continue;

    for (const neighbor of getNeighborCoordinates(current)) {
      const key = getSectorTileKey(neighbor.x, neighbor.y);
      if (visited.has(key) || !isWalkableCoordinate(map, neighbor)) continue;
      if (neighbor.x === to.x && neighbor.y === to.y) return true;
      visited.add(key);
      queue.push(neighbor);
    }
  }

  return false;
};

/** The map anchor with the given key (e.g. "spawn.default"), if any */
export const resolveSectorAnchor = (
  map: Pick<NormalizedSectorMap, "anchors">,
  key: string,
) => {
  return map.anchors.find((anchor) => anchor.key === key);
};

/**
 * Resolve a safe standing position, in order: the coordinate itself if
 * walkable, else the fallback anchor (default "spawn.default") if walkable,
 * else the nearest walkable tile by Chebyshev distance. Returns null only when
 * the map has no walkable tiles at all.
 */
export const findNearestWalkableCoordinate = (
  map: Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors">,
  coordinate: SectorCoordinate,
  fallbackAnchor = "spawn.default",
): SectorCoordinate | null => {
  if (isWalkableCoordinate(map, coordinate)) return coordinate;

  const fallback = resolveSectorAnchor(map, fallbackAnchor);
  if (fallback && isWalkableCoordinate(map, fallback)) {
    return { x: fallback.x, y: fallback.y };
  }

  const candidates = map.tiles
    .filter((tile) => !tile.blocked && tile.walkCost > 0)
    .sort((a, b) => {
      const distA = Math.max(
        Math.abs(a.x - coordinate.x),
        Math.abs(a.y - coordinate.y),
      );
      const distB = Math.max(
        Math.abs(b.x - coordinate.x),
        Math.abs(b.y - coordinate.y),
      );
      return distA - distB;
    });
  const candidate = candidates[0];
  return candidate ? { x: candidate.x, y: candidate.y } : null;
};

/**
 * Structural validation of a normalized map: format version, dimension caps,
 * exact tile count, duplicate tiles/anchors, terrain-registry membership,
 * combat biomes, the required spawn.default anchor, at least one walkable
 * tile, and exits referencing existing anchors. Non-fatal issues (e.g. an
 * anchor on a non-walkable tile) are warnings; success = zero errors.
 */
export const validateNormalizedSectorMap = (
  map: NormalizedSectorMap,
  terrainRegistry: Map<string, TerrainSpec>,
): SectorMapValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tileKeys = new Set<string>();

  if (map.formatVersion !== SECTOR_MAP_VERSION) {
    errors.push(`Unsupported sector map format version ${map.formatVersion}`);
  }
  if (map.width <= 0 || map.height <= 0) {
    errors.push("Sector map dimensions must be positive");
  }
  if (map.width > SECTOR_MAP_MAX_DIMENSION || map.height > SECTOR_MAP_MAX_DIMENSION) {
    errors.push(
      `Sector map dimensions cannot exceed ${SECTOR_MAP_MAX_DIMENSION}x${SECTOR_MAP_MAX_DIMENSION}`,
    );
  }
  if (map.tiles.length !== map.width * map.height) {
    errors.push(`Expected ${map.width * map.height} tiles, found ${map.tiles.length}`);
  }

  map.tiles.forEach((tile: NormalizedSectorTile) => {
    const key = getSectorTileKey(tile.x, tile.y);
    if (tileKeys.has(key)) errors.push(`Duplicate tile at ${key}`);
    tileKeys.add(key);
    if (!isCoordinateInSectorMap(map, tile)) {
      errors.push(`Tile ${key} is outside sector bounds`);
    }
    if (!terrainRegistry.has(tile.terrain)) {
      errors.push(`Tile ${key} has unsupported terrain ${tile.terrain}`);
    }
    if (!COMBAT_BIOMES.includes(tile.battleBiome)) {
      errors.push(`Tile ${key} has unsupported battle biome ${tile.battleBiome}`);
    }
    if (!Number.isFinite(tile.walkCost) || tile.walkCost < 0) {
      errors.push(`Tile ${key} has invalid walk cost`);
    }
  });

  const anchorsByKey = new Map<string, NormalizedSectorAnchor>();
  map.anchors.forEach((anchor) => {
    if (anchorsByKey.has(anchor.key)) {
      errors.push(`Duplicate anchor ${anchor.key}`);
    }
    anchorsByKey.set(anchor.key, anchor);
    if (!isCoordinateInSectorMap(map, anchor)) {
      errors.push(`Anchor ${anchor.key} is outside sector bounds`);
    } else if (!isWalkableCoordinate(map, anchor)) {
      warnings.push(`Anchor ${anchor.key} is not on a walkable tile`);
    }
  });

  if (!anchorsByKey.has("spawn.default")) {
    errors.push("Missing required anchor spawn.default");
  }
  if (!map.tiles.some((tile) => !tile.blocked && tile.walkCost > 0)) {
    errors.push("Sector map has no walkable tiles");
  }

  map.exits.forEach((exit) => {
    if (!anchorsByKey.has(exit.fromAnchor)) {
      errors.push(`Exit references missing anchor ${exit.fromAnchor}`);
    }
  });

  return { success: errors.length === 0, errors, warnings };
};
