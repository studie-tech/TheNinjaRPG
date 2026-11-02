import {
  MAP_RESERVED_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";

/**
 * Canonical settlement placement for the cylindrical world.
 *
 * This list is shared by globe generation and relocation regression tests so
 * the committed terrain protection cannot drift away from the database
 * migration that places the actual Village rows.
 */
export const WORLD_LANDMARKS = [
  {
    name: "Freedom State",
    legacySectors: [51],
    sector: 555,
    expectedTerrain: "ground",
  },
  {
    name: "Wake Island",
    legacySectors: [222],
    sector: 222,
    expectedTerrain: "island",
  },
  {
    name: "Akikaze",
    legacySectors: [271],
    sector: 724,
    expectedTerrain: "highland",
  },
  {
    name: "Horizon",
    legacySectors: [296, 913],
    sector: 301,
    expectedTerrain: "lush",
  },
  {
    name: "Tsukimori",
    legacySectors: [305],
    sector: 1490,
    expectedTerrain: "lush",
  },
  {
    name: "Iron Shield",
    legacySectors: [352],
    sector: 352,
    expectedTerrain: "ground",
  },
  {
    name: "Syndicate",
    legacySectors: [484],
    sector: 1062,
    expectedTerrain: "dessert",
  },
  {
    name: "SafariFaction",
    legacySectors: [485],
    sector: 1000,
    expectedTerrain: "ground",
  },
  {
    name: "Hyorin",
    legacySectors: [203, 688],
    sector: 177,
    expectedTerrain: "ice",
  },
  {
    name: "Shirohana",
    legacySectors: [83, 1631],
    sector: 1538,
    expectedTerrain: "dessert",
  },
  {
    name: "Akasumi",
    legacySectors: [254, 1784],
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

export const WAKE_ISLAND_STRUCTURE_POSITIONS = [
  { name: "Administration Building", x: 13, y: 8 },
  { name: "Auction House", x: 10, y: 10 },
  { name: "Mini Games", x: 16, y: 10 },
  { name: "Colosseum", x: 9, y: 13 },
  { name: "History Building", x: 17, y: 13 },
  { name: "Global ANBU HQ", x: 10, y: 16 },
  { name: "Souvenir Shop", x: 16, y: 16 },
  { name: "Science Building", x: 13, y: 14 },
] as const;
