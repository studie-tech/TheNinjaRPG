import { createHexGrid, PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";

export interface WindowNavEntry {
  sector: number;
  dx: number;
  dy: number;
  map: NormalizedSectorMap;
}

/**
 * A single logical hex grid spanning the whole 3x3 sector window, so paths,
 * hover highlights and continuous walks cross sector borders as if the world
 * were one map. Walkability/cost are composed from the 9 authored maps; the
 * center sector sits at unified offset (W, H). This grid is used for
 * PATHFINDING and adjacency only - rendering still uses the per-sector grids,
 * so the returned tiles are mapped back to (dx, dy, local col/row).
 */
export interface WindowNav {
  pathFinder: PathCalculator;
  toUnified: (
    dx: number,
    dy: number,
    col: number,
    row: number,
  ) => TerrainHex | undefined;
  fromUnified: (tile: TerrainHex) => {
    dx: number;
    dy: number;
    col: number;
    row: number;
  };
  /**
   * Offsets and sectors of the window this grid was built from. The window recenters as the
   * character crosses borders, so a path resolves its offsets here rather than in a newer window.
   */
  offsetOf: (sector: number) => { dx: number; dy: number } | undefined;
  sectorAt: (dx: number, dy: number) => number | undefined;
}

/**
 * Composes up to 9 authored sector maps into one unified 3W x 3H hex grid for
 * cross-border pathfinding (rendering stays per-sector); the center sector
 * occupies unified offset (W, H). Rotated cube-edge-seam neighbors and missing
 * (polar) neighbors are marked impassable (blocked, cost 9999) so paths stop
 * cleanly at those borders. All existing terrain is traversable; zero-cost
 * palette entries use the standard walking cost. Returns null without a map.
 */
export const buildWindowNav = (
  entries: WindowNavEntry[],
  hexsize: number,
): WindowNav | null => {
  const first = entries[0]?.map;
  if (!first) return null;
  const W = first.width;
  const H = first.height;
  // Per-window-offset tile lookups for O(1) walkability composition
  const tilesByOffset = new Map<string, Map<string, NormalizedSectorTile>>();
  for (const entry of entries) {
    const lookup = new Map<string, NormalizedSectorTile>();
    for (const tile of entry.map.tiles) {
      lookup.set(`${tile.x},${tile.y}`, tile);
    }
    tilesByOffset.set(`${entry.dx},${entry.dy}`, lookup);
  }
  const grid = createHexGrid(hexsize, 3 * W, 3 * H, {
    x: -hexsize * 0.5,
    y: -hexsize * 0.5,
  }).map((tile) => {
    const dx = Math.floor(tile.col / W) - 1;
    const dy = Math.floor(tile.row / H) - 1;
    const localCol = tile.col - (dx + 1) * W;
    const localRow = tile.row - (dy + 1) * H;
    const offsetKey = `${dx},${dy}`;
    const lookup = tilesByOffset.get(offsetKey);
    const mapTile = lookup?.get(`${localCol},${localRow}`);
    if (!mapTile) {
      // Sector missing from the window (polar edge) is an impassable wall
      tile.blocked = true;
      tile.cost = 9999;
      return tile;
    }
    tile.blocked = false;
    tile.cost = (mapTile.walkCost || 1) + 1;
    return tile;
  });
  // Offset-indexed tiles: honeycomb's getHex builds a throwaway hex per lookup, and
  // terrain building looks up every tile of the window several times.
  const columns = 3 * W,
    rows = 3 * H;
  const byCell = new Array<TerrainHex | undefined>(columns * rows);
  for (const tile of grid) byCell[tile.row * columns + tile.col] = tile;
  return {
    pathFinder: new PathCalculator(grid),
    toUnified: (dx, dy, col, row) => {
      const unifiedCol = (dx + 1) * W + col,
        unifiedRow = (dy + 1) * H + row;
      if (
        unifiedCol < 0 ||
        unifiedCol >= columns ||
        unifiedRow < 0 ||
        unifiedRow >= rows
      )
        return undefined;
      return byCell[unifiedRow * columns + unifiedCol];
    },
    fromUnified: (tile) => {
      const dx = Math.floor(tile.col / W) - 1;
      const dy = Math.floor(tile.row / H) - 1;
      return { dx, dy, col: tile.col - (dx + 1) * W, row: tile.row - (dy + 1) * H };
    },
    offsetOf: (sector) => {
      const entry = entries.find((candidate) => candidate.sector === sector);
      return entry ? { dx: entry.dx, dy: entry.dy } : undefined;
    },
    sectorAt: (dx, dy) =>
      entries.find((candidate) => candidate.dx === dx && candidate.dy === dy)?.sector,
  };
};
