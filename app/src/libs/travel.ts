import type { CombatBiome } from "@/drizzle/constants";
import {
  MAP_GLOBAL_TRAVEL_TIME_CAP_SECS,
  MAP_WAKE_ISLAND_SECTOR,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import type { GlobalMapData, GlobalTile, SectorPoint } from "@/libs/threejs/types";

/**
 * Check if a given position is at the edge of a sector
 */
export const isAtEdge = (position: SectorPoint | null) => {
  return (
    position &&
    (position.x === 0 ||
      position.x === SECTOR_WIDTH - 1 ||
      position.y === 0 ||
      position.y === SECTOR_HEIGHT - 1)
  );
};

/**
 * Gets the biome of a tile from a global tile
 * @param tile - The tile to get the biome from
 * @returns The biome of the tile
 */
export const getBiomeFromGlobalTile = (tile: GlobalTile): CombatBiome => {
  return tile.t === 0
    ? "ocean"
    : tile.t === 1
      ? "ground"
      : tile.t === 2
        ? "dessert"
        : "ice";
};

/**
 * Based on current position, find the nearest edge
 */
export const findNearestEdge = (position: SectorPoint) => {
  const x = position.x < SECTOR_WIDTH / 2 ? 0 : SECTOR_WIDTH - 1;
  const y = position.y < SECTOR_HEIGHT / 2 ? 0 : SECTOR_HEIGHT - 1;
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

// Calculate if we are in village or not.
// Not the nicest, but eventually we are merging towards
export const calcIsInVillage = (_position: SectorPoint) => {
  // if ([0, 19].includes(position.x)) return false;
  // if ([0, 14].includes(position.y)) return false;
  // if (position.y === 13) {
  //   if ([1, 2, 3, 17, 18].includes(position.x)) return false;
  // }
  // if (position.y === 1) {
  //   if ([1, 2, 3, 4, 16, 17, 18].includes(position.x)) return false;
  // }
  // if (position.y === 2) {
  //   if ([1, 2, 18].includes(position.x)) return false;
  // }
  // if (position.x === 1 && position.y === 12) return false;
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
