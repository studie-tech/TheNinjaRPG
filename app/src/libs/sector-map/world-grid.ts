import {
  MAP_NAVIGABLE_LATITUDE_LIMIT,
  MAP_TOTAL_SECTORS,
  MAP_WORLD_COLUMNS,
  MAP_WORLD_ROWS,
} from "@/drizzle/constants";

export interface WorldGridPosition {
  column: number;
  row: number;
}

/** Convert a stable row-major sector id into its cylindrical grid position. */
export const sectorGridPosition = (sector: number): WorldGridPosition | null => {
  if (!Number.isInteger(sector) || sector < 0 || sector >= MAP_TOTAL_SECTORS) {
    return null;
  }
  return {
    column: sector % MAP_WORLD_COLUMNS,
    row: Math.floor(sector / MAP_WORLD_COLUMNS),
  };
};

/**
 * Convert a grid position into a sector id. Longitude wraps around the world;
 * latitude does not wrap because the space beyond the first/last row is a
 * non-navigable polar cap.
 */
export const sectorIdAt = (column: number, row: number): number => {
  if (!Number.isInteger(column) || !Number.isInteger(row)) return -1;
  if (row < 0 || row >= MAP_WORLD_ROWS) return -1;
  const wrappedColumn =
    ((column % MAP_WORLD_COLUMNS) + MAP_WORLD_COLUMNS) % MAP_WORLD_COLUMNS;
  return row * MAP_WORLD_COLUMNS + wrappedColumn;
};

/** Neighbor ids in canonical [north, east, south, west] order. */
export const sectorGridNeighbors = (
  sector: number,
): [number, number, number, number] => {
  const position = sectorGridPosition(sector);
  if (!position) return [-1, -1, -1, -1];
  const { column, row } = position;
  return [
    sectorIdAt(column, row - 1),
    sectorIdAt(column + 1, row),
    sectorIdAt(column, row + 1),
    sectorIdAt(column - 1, row),
  ];
};

/**
 * Entry edges paired with [north, east, south, west]. Missing polar neighbors
 * use -1; every real neighbor is aligned and enters through the opposite edge.
 */
export const sectorGridEntryEdges = (
  sector: number,
): [number, number, number, number] => {
  const neighbors = sectorGridNeighbors(sector);
  return [
    neighbors[0] < 0 ? -1 : 2,
    neighbors[1] < 0 ? -1 : 3,
    neighbors[2] < 0 ? -1 : 0,
    neighbors[3] < 0 ? -1 : 1,
  ];
};

/**
 * Sector covering a geographic position, or -1 for the non-navigable polar
 * caps. Exact inverse of the generator's uniform longitude/latitude layout, so
 * a point on the globe resolves to its sector arithmetically instead of by
 * raycasting the rendered terrain.
 */
export const sectorAtGeographic = (latitude: number, longitude: number): number => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return -1;
  if (Math.abs(latitude) > MAP_NAVIGABLE_LATITUDE_LIMIT) return -1;
  const latitudeStep = (MAP_NAVIGABLE_LATITUDE_LIMIT * 2) / MAP_WORLD_ROWS;
  const row = Math.min(
    MAP_WORLD_ROWS - 1,
    Math.max(0, Math.floor((MAP_NAVIGABLE_LATITUDE_LIMIT - latitude) / latitudeStep)),
  );
  const column = Math.floor((longitude + 180) / (360 / MAP_WORLD_COLUMNS));
  return sectorIdAt(column, row);
};
