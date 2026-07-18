import { MAP_SECTOR_ID_MAX, MAP_SECTOR_ID_MIN } from "@/drizzle/constants";

/**
 * Integer in the inclusive [MAP_SECTOR_ID_MIN, MAP_SECTOR_ID_MAX] range;
 * sector ids correspond to hexasphere/globe tile ids
 */
export const isValidSectorId = (sector: number) => {
  return (
    Number.isInteger(sector) &&
    sector >= MAP_SECTOR_ID_MIN &&
    sector <= MAP_SECTOR_ID_MAX
  );
};
