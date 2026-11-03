import {
  MAP_RESERVED_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";

/**
 * Canonical settlement placement for the cylindrical world, shared by globe and
 * sector generation, the village seed and the tutorial.
 */
export const WORLD_LANDMARKS = [
  {
    name: "Freedom State",
    sector: 555,
    expectedTerrain: "ground",
  },
  {
    name: "Wake Island",
    sector: 222,
    expectedTerrain: "island",
  },
  {
    name: "Akikaze",
    sector: 724,
    expectedTerrain: "highland",
  },
  {
    name: "Horizon",
    sector: 301,
    expectedTerrain: "lush",
  },
  {
    name: "Tsukimori",
    sector: 1490,
    expectedTerrain: "lush",
  },
  {
    name: "Iron Shield",
    sector: 352,
    expectedTerrain: "ground",
  },
  {
    name: "Syndicate",
    sector: 1062,
    expectedTerrain: "dessert",
  },
  {
    name: "SafariFaction",
    sector: 1000,
    expectedTerrain: "ground",
  },
  {
    name: "Hyorin",
    sector: 177,
    expectedTerrain: "ice",
  },
  {
    name: "Shirohana",
    sector: 1538,
    expectedTerrain: "dessert",
  },
  {
    name: "Akasumi",
    sector: 1335,
    expectedTerrain: "coast",
  },
] as const;

/** Coastal/island landmarks intentionally keep their natural water footprint. */
export const WORLD_PROTECTED_LAND_SECTORS = WORLD_LANDMARKS.filter(
  (landmark) =>
    landmark.expectedTerrain !== "coast" && landmark.expectedTerrain !== "island",
).map((landmark) => landmark.sector);

/**
 * Sectors worldgen forces onto land, in the order stored as the globe's
 * `protectedLandSectors`. Changing any source list requires regenerating
 * `src/data/hexasphere.json` with `scripts/generate-globe.ts`.
 */
export const getWorldProtectedLandSectors = (extraSectors: readonly number[] = []) => [
  ...new Set([
    ...MAP_RESERVED_SECTORS,
    ...WORLD_PROTECTED_LAND_SECTORS,
    ...extraSectors,
    MAP_WAKE_ISLAND_SECTOR,
    MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  ]),
];
