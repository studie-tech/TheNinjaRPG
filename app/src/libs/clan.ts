import { MAP_RESERVED_SECTORS } from "@/drizzle/constants";
import { fetchMap } from "@/libs/threejs/globe";

export const checkIfSectorIsAvailable = async (sector: number) => {
  const map = await fetchMap();
  const tile = map.tiles[sector];
  if (!tile) return false;
  // Check that it's not reserved
  if (MAP_RESERVED_SECTORS.includes(sector)) return false;
  // Passed all checks
  return true;
};
