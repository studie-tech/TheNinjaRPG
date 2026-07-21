/**
 * Pure geometry for crossing a sector border on the cube-sphere world.
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
 * movement and must be used instead of the raw globe-space primitive there.
 *
 * Within a cube face, neighbours are aligned: crossing north lands on the
 * neighbour's south edge at the SAME column (the parameter is preserved). Across
 * the 12 cube-edge seams the neighbour is rotated 90/270 degrees, so the entry
 * edge (from the tile's `ne` data) differs from the aligned expectation and the
 * along-edge parameter may run the opposite way. These helpers resolve both from
 * the baked `ne` value, with no runtime 3D geometry.
 *
 * The edge geometry is bound to the tile's 3D corners b = [NW, NE, SE, SW] via
 * the grid corners (x0,y0)=NW, (xW,y0)=NE, (xW,yH)=SE, (x0,yH)=SW - the binding
 * that reproduces the existing aligned crossing behaviour. EDGE_DIR records, per
 * edge, whether the along-edge parameter runs in the same direction as the tile's
 * clockwise corner order (N: b0->b1 and E: b1->b2 do; S: b3->b2 and W: b0->b3 are
 * reversed). Consistent manifold orientation means a shared edge is traversed in
 * opposite corner order by the two tiles, which is what `paramFlips` encodes.
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

/** +1 if the along-edge parameter follows clockwise corner order, else -1 */
const EDGE_DIR: readonly number[] = [1, 1, -1, -1];

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

/**
 * Whether the along-edge parameter reverses when crossing from `exitEdge` of one
 * tile to `entryEdge` of the neighbour. Derived purely from the two edge indices
 * using the clockwise corner correspondence of a consistently oriented manifold:
 * A.corner[eA] == B.corner[(eB+1)%4] and A.corner[(eA+1)%4] == B.corner[eB].
 */
export const paramFlips = (exitEdge: EdgeIndex, entryEdge: EdgeIndex): boolean => {
  // Clockwise corner index where the exit parameter starts (p = 0)
  const exitStartCorner = EDGE_DIR[exitEdge]! > 0 ? exitEdge : (exitEdge + 1) % 4;
  // The same 3D corner expressed as a clockwise corner index on the neighbour
  const entryEquivCorner =
    exitStartCorner === exitEdge ? (entryEdge + 1) % 4 : entryEdge;
  // Clockwise corner index where the entry parameter starts (p = 0)
  const entryStartCorner = EDGE_DIR[entryEdge]! > 0 ? entryEdge : (entryEdge + 1) % 4;
  return entryEquivCorner !== entryStartCorner;
};

/** Map an exit parameter (0..lenA-1) to the neighbour's entry parameter (0..lenB-1) */
export const mapParam = (
  pA: number,
  lenA: number,
  lenB: number,
  flip: boolean,
): number => {
  const frac = lenA <= 1 ? 0 : pA / (lenA - 1);
  const eff = flip ? 1 - frac : frac;
  return Math.round(eff * Math.max(0, lenB - 1));
};

/**
 * Number of clockwise 90-degree turns the neighbour across `exitEdge` is rotated
 * relative to an aligned neighbour. 0 for within-face and rot-0 seams; 1 or 3 for
 * the rotated cube-edge seams. Used to orient the neighbour's rendered map.
 */
export const seamRotation = (exitEdge: EdgeIndex, entryEdge: EdgeIndex): number =>
  (((entryEdge - ((exitEdge + 2) % 4)) % 4) + 4) % 4;

export interface CrossingResult {
  entryEdge: EdgeIndex;
  entryX: number;
  entryY: number;
}

/**
 * Resolve where a crossing lands in the neighbour. Given the exit edge, the cell
 * on that edge, this tile's map size and the neighbour's entry edge + map size,
 * returns the entry edge and interior-most entry cell in the neighbour.
 */
export const resolveEdgeCrossing = (
  exitEdge: EdgeIndex,
  exitX: number,
  exitY: number,
  fromWidth: number,
  fromHeight: number,
  entryEdge: EdgeIndex,
  toWidth: number,
  toHeight: number,
): CrossingResult => {
  const pA = edgeParam(exitEdge, exitX, exitY);
  const lenA = edgeLength(exitEdge, fromWidth, fromHeight);
  const lenB = edgeLength(entryEdge, toWidth, toHeight);
  const flip = paramFlips(exitEdge, entryEdge);
  const pB = mapParam(pA, lenA, lenB, flip);
  const cell = edgeCell(entryEdge, pB, toWidth, toHeight);
  return { entryEdge, entryX: cell.x, entryY: cell.y };
};

/**
 * Resolve a baked globe-edge crossing into rendered sector-map coordinates.
 * The vertical reflection reverses the along-edge parameter on east/west map
 * edges, so parameters are converted to globe orientation before applying the
 * seam handedness and converted back on the destination.
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
  const globeEntryParam = mapParam(
    globeExitParam,
    lenA,
    lenB,
    paramFlips(globeExitEdge, globeEntryEdge),
  );
  const mapEntryParam =
    globeEntryEdge === EDGE_EAST || globeEntryEdge === EDGE_WEST
      ? lenB - 1 - globeEntryParam
      : globeEntryParam;
  const cell = edgeCell(mapEntryEdge, mapEntryParam, toWidth, toHeight);
  return { entryEdge: mapEntryEdge, entryX: cell.x, entryY: cell.y };
};
