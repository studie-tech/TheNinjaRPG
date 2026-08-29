import type { CombatBiome } from "@/drizzle/constants";
import {
  MAP_GLOBAL_TRAVEL_TIME_CAP_SECS,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { getSectorTile } from "@/libs/sector-map/validation";
import type { GlobalMapData, GlobalTile, SectorPoint } from "@/libs/threejs/types";

/**
 * Gets the biome for a globe tile terrain type (0=ocean, 1=land, 2=desert, 3=ice)
 */
export const getBiomeFromTileType = (tileType: number): CombatBiome => {
  return tileType === 0
    ? "ocean"
    : tileType === 1
      ? "ground"
      : tileType === 2
        ? "dessert"
        : "ice";
};

/**
 * Gets the biome of a tile from a global tile
 * @param tile - The tile to get the biome from
 * @returns The biome of the tile
 */
export const getBiomeFromGlobalTile = (tile: GlobalTile): CombatBiome => {
  return getBiomeFromTileType(tile.t);
};

/**
 * Resolve the visible biome at a named authored-map anchor. The local tile is
 * authoritative for structures standing on it; the globe's sector-center
 * biome is only a fallback for incomplete legacy maps.
 */
export const getBiomeAtSectorAnchor = (
  sectorMap: Pick<NormalizedSectorMap, "tiles" | "anchors">,
  anchorKey: string,
  globalTileType: number,
): CombatBiome => {
  const anchor = sectorMap.anchors.find((candidate) => candidate.key === anchorKey);
  const tile = anchor ? getSectorTile(sectorMap, anchor) : undefined;
  const visibleBiome =
    tile?.terrain === "ocean" ||
    tile?.terrain === "ground" ||
    tile?.terrain === "dessert" ||
    tile?.terrain === "ice" ||
    tile?.terrain === "snow"
      ? tile.terrain
      : undefined;
  return visibleBiome ?? tile?.battleBiome ?? getBiomeFromTileType(globalTileType);
};

/**
 * Walkable landing point a short walk from a point of interest, or null when the
 * sector offers none in range. Deliberately not the tile itself: arriving on top
 * of a quest target would skip the approach the objective asks for. The default
 * range is bounded by what a zoomed-in sector camera actually shows -- about
 * three tiles above and below the player -- so the target lands on screen.
 */
export const findLandingNear = (
  sectorMap: Pick<NormalizedSectorMap, "tiles">,
  target: { x: number; y: number },
  randomIndex: (upperBound: number) => number,
  minDistance = 2,
  maxDistance = 3,
) => {
  const candidates = sectorMap.tiles.filter((tile) => {
    if (tile.blocked || tile.walkCost <= 0) return false;
    const distance = Math.max(Math.abs(tile.x - target.x), Math.abs(tile.y - target.y));
    return distance >= minDistance && distance <= maxDistance;
  });
  if (candidates.length === 0) return null;
  const tile = candidates[randomIndex(candidates.length)];
  return tile ? { x: tile.x, y: tile.y } : null;
};

/** Uniformly random walkable landing point for global travel. */
export const findGlobalTravelDestination = (
  sectorMap: Pick<NormalizedSectorMap, "tiles">,
  randomIndex: (upperBound: number) => number,
) => {
  const walkableTiles = sectorMap.tiles.filter(
    (tile) => !tile.blocked && tile.walkCost > 0,
  );
  if (walkableTiles.length === 0) return null;

  const index = randomIndex(walkableTiles.length);
  const tile = walkableTiles[index];
  if (!tile) return null;
  return { x: tile.x, y: tile.y };
};

// Calculate distance between two points on the hexasphere
export const calcGlobalTravelTime = (
  sectorA: number,
  sectorB: number,
  map: GlobalMapData,
) => {
  if (sectorB === MAP_WAKE_ISLAND_SECTOR) return 0;
  const a = map?.tiles[sectorA]?.c;
  const b = map?.tiles[sectorB]?.c;
  const r = map?.radius;
  if (a && b && r) {
    const distance = r * Math.acos((a.x * b.x + a.y * b.y + a.z * b.z) / r ** 2);
    const secs = Math.floor(distance / 2) || 5;
    return Math.min(secs, MAP_GLOBAL_TRAVEL_TIME_CAP_SECS);
  }
  return MAP_GLOBAL_TRAVEL_TIME_CAP_SECS;
};

/**
 * Whether a position sits in a village zone. When a sector map is provided
 * the tile zone decides; callers without map access treat the whole sector
 * as village (endpoints like train/home that predate zone-based checks).
 */
export const calcIsInVillage = (
  position: SectorPoint,
  sectorMap?: Pick<NormalizedSectorMap, "tiles">,
) => {
  if (sectorMap) {
    return getSectorTile(sectorMap, position)?.zone === "village";
  }
  return true;
};

// Maximum distance between two set of longitudes / latitudes
export const maxDistance = (
  userData: { longitude: number; latitude: number },
  b: SectorPoint,
) => {
  return Math.max(
    Math.abs(userData.longitude - b.x),
    Math.abs(userData.latitude - b.y),
  );
};
