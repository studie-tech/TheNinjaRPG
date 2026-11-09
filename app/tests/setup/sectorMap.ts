import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";

/** Walkable wilderness tile. */
export const sectorTile = (
  x: number,
  y: number,
  overrides: Partial<NormalizedSectorTile> = {},
): NormalizedSectorTile => ({
  x,
  y,
  terrain: "ground",
  walkCost: 1,
  blocked: false,
  zone: "wilderness",
  battleBiome: "ground",
  ...overrides,
});

/** Published map whose row-major grid takes each cell's differences from `tile`. */
export const sectorMap = (
  width: number,
  height: number,
  tile: (x: number, y: number) => Partial<NormalizedSectorTile> = () => ({}),
  overrides: Partial<NormalizedSectorMap> = {},
): NormalizedSectorMap => ({
  formatVersion: SECTOR_MAP_VERSION,
  sector: 1,
  name: "Test Sector",
  width,
  height,
  tiles: Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return sectorTile(x, y, tile(x, y));
  }),
  objects: [],
  anchors: [{ key: "spawn.default", x: 0, y: 0 }],
  exits: [],
  metadata: { importedAt: "2026-01-01T00:00:00.000Z", source: "tiled" },
  ...overrides,
});
