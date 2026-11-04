/**
 * Pure geometry for crossing a sector border.
 *
 * The low-level primitives in this file use the baked globe's canonical edge
 * frame. Edges are indexed the same way as a tile's neighbour array `n` and
 * entry-edge array `ne`:
 *
 *   0 = North (y = 0)      2 = South (y = height - 1)
 *   1 = East  (x = W - 1)  3 = West  (x = 0)
 *
 * Authored/rendered sector maps use the opposite vertical axis (larger y is
 * visually north). `resolveSectorMapEdgeCrossing` is the adapter for all game
 * movement.
 *
 * The cylindrical world graph only uses aligned neighbors: crossing north lands
 * on the neighbor's south edge at the same column, and east/west behaves likewise.
 * The entry-edge primitives stay generic so the adapter handles map-axis
 * conversion and differently sized authored maps.
 */

export type EdgeIndex = 0 | 1 | 2 | 3;

export const EDGE_NORTH = 0;
export const EDGE_EAST = 1;
export const EDGE_SOUTH = 2;
export const EDGE_WEST = 3;

/**
 * Authored sector maps render with y increasing upward, while the baked globe
 * edge convention follows the JSON corner order with north at edge 0. Thus the
 * rendered north/south edges are vertically reflected relative to the globe;
 * east/west are unchanged. This mapping is deliberately explicit so window
 * placement, client routing, and server crossings share one convention.
 */
export const sectorMapEdgeForGlobeEdge = (edge: EdgeIndex): EdgeIndex =>
  edge === EDGE_NORTH ? EDGE_SOUTH : edge === EDGE_SOUTH ? EDGE_NORTH : edge;

/** Length (cell count) of an edge: N/S run along width, E/W along height */
export const edgeLength = (edge: EdgeIndex, width: number, height: number): number =>
  edge === EDGE_NORTH || edge === EDGE_SOUTH ? width : height;

/** Along-edge parameter (0..len-1) of a cell sitting on the given edge */
export const edgeParam = (edge: EdgeIndex, x: number, y: number): number =>
  edge === EDGE_NORTH || edge === EDGE_SOUTH ? x : y;

/** Interior-most cell (x, y) at along-edge parameter p on a width x height map */
export const edgeCell = (
  edge: EdgeIndex,
  p: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  switch (edge) {
    case EDGE_NORTH:
      return { x: p, y: 0 };
    case EDGE_EAST:
      return { x: width - 1, y: p };
    case EDGE_SOUTH:
      return { x: p, y: height - 1 };
    default:
      return { x: 0, y: p };
  }
};

/** Map an exit parameter (0..lenA-1) to the neighbour's entry parameter (0..lenB-1) */
export const mapParam = (pA: number, lenA: number, lenB: number): number => {
  const frac = lenA <= 1 ? 0 : pA / (lenA - 1);
  return Math.round(frac * Math.max(0, lenB - 1));
};

export interface CrossingResult {
  entryEdge: EdgeIndex;
  entryX: number;
  entryY: number;
}

/**
 * Resolve a baked globe-edge crossing into rendered sector-map coordinates.
 * Neighbours are aligned, so the along-edge parameter carries across the seam;
 * the vertical reflection reverses it on east/west map edges, so parameters are
 * converted to globe orientation and back on the destination.
 */
export const resolveSectorMapEdgeCrossing = (
  globeExitEdge: EdgeIndex,
  exitX: number,
  exitY: number,
  fromWidth: number,
  fromHeight: number,
  globeEntryEdge: EdgeIndex,
  toWidth: number,
  toHeight: number,
): CrossingResult => {
  const mapExitEdge = sectorMapEdgeForGlobeEdge(globeExitEdge);
  const mapEntryEdge = sectorMapEdgeForGlobeEdge(globeEntryEdge);
  const lenA = edgeLength(mapExitEdge, fromWidth, fromHeight);
  const lenB = edgeLength(mapEntryEdge, toWidth, toHeight);
  const mapExitParam = edgeParam(mapExitEdge, exitX, exitY);
  const globeExitParam =
    globeExitEdge === EDGE_EAST || globeExitEdge === EDGE_WEST
      ? lenA - 1 - mapExitParam
      : mapExitParam;
  const globeEntryParam = mapParam(globeExitParam, lenA, lenB);
  const mapEntryParam =
    globeEntryEdge === EDGE_EAST || globeEntryEdge === EDGE_WEST
      ? lenB - 1 - globeEntryParam
      : globeEntryParam;
  const cell = edgeCell(mapEntryEdge, mapEntryParam, toWidth, toHeight);
  return { entryEdge: mapEntryEdge, entryX: cell.x, entryY: cell.y };
};
