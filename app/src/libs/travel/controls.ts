import { type SectorPoint, type GlobalMapData } from "./types";
import { SECTOR_HEIGHT, SECTOR_WIDTH } from "./constants";
import { MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import { MAP_GLOBAL_TRAVEL_TIME_CAP_SECS } from "@/drizzle/constants";

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
export const calcIsInVillage = (position: SectorPoint) => {
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

// Placements of walls in villages
export const wallPlacements = [
  { x: 2, y: 3 },
  { x: 1, y: 3 },
  { x: 1, y: 4 },
  { x: 1, y: 5 },
  { x: 1, y: 6 },
  { x: 1, y: 7 },
  { x: 1, y: 8 },
  { x: 1, y: 9 },
  { x: 1, y: 10 },
  { x: 1, y: 11 },
  { x: 2, y: 12 },
  { x: 3, y: 12 },
  { x: 4, y: 13 },
  { x: 5, y: 13 },
  { x: 6, y: 13 },
  { x: 7, y: 13 },
  { x: 8, y: 13 },
  { x: 9, y: 13 },
  { x: 10, y: 13 },
  { x: 11, y: 13 },
  { x: 12, y: 13 },
  { x: 13, y: 13 },
  { x: 14, y: 13 },
  { x: 15, y: 13 },
  { x: 16, y: 13 },
  { x: 17, y: 12 },
  { x: 18, y: 12 },
  { x: 18, y: 11 },
  { x: 18, y: 10 },
  { x: 18, y: 9 },
  { x: 18, y: 8 },
  { x: 18, y: 7 },
  { x: 18, y: 6 },
  { x: 18, y: 5 },
  { x: 18, y: 4 },
  { x: 18, y: 3 },
  { x: 17, y: 2 },
  { x: 16, y: 2 },
  { x: 15, y: 1 },
  { x: 14, y: 1 },
  { x: 13, y: 1 },
  { x: 12, y: 1 },
  { x: 11, y: 1 },
  { x: 10, y: 1 },
  { x: 9, y: 1 },
  { x: 8, y: 1 },
  { x: 7, y: 1 },
  { x: 6, y: 1 },
  { x: 5, y: 1 },
] as const;
