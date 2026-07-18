import type { CombatBiome } from "@/drizzle/constants";
import {
  MAP_GLOBAL_TRAVEL_TIME_CAP_SECS,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { getSectorTile } from "@/libs/sector-map/validation";
import type { GlobalMapData, GlobalTile, SectorPoint } from "@/libs/threejs/types";

export interface SectorDimensions {
  width: number;
  height: number;
}

/**
 * Check if a given position is at the edge of a sector
 */
export const isAtEdge = (
  position: SectorPoint | null,
  dimensions: SectorDimensions,
) => {
  return (
    position &&
    (position.x === 0 ||
      position.x === dimensions.width - 1 ||
      position.y === 0 ||
      position.y === dimensions.height - 1)
  );
};

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
 * Based on current position, find the nearest edge
 */
export const findNearestEdge = (
  position: SectorPoint,
  dimensions: SectorDimensions,
) => {
  const x = position.x < dimensions.width / 2 ? 0 : dimensions.width - 1;
  const y = position.y < dimensions.height / 2 ? 0 : dimensions.height - 1;
  return { x: x, y: y };
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
