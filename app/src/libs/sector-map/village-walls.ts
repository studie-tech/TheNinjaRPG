import type {
  NormalizedSectorAnchor,
  NormalizedSectorTile,
  SectorCoordinate,
} from "@/libs/sector-map/types";
import {
  getNeighborCoordinates,
  getSectorTileKey,
  isCoordinateInSectorMap,
} from "@/libs/sector-map/validation";

export const VILLAGE_STRUCTURE_FOOTPRINT_RADIUS = 1;
export const VILLAGE_WALL_CLEARANCE = 1;
export const VILLAGE_STRUCTURE_BORDER_MARGIN =
  VILLAGE_STRUCTURE_FOOTPRINT_RADIUS + VILLAGE_WALL_CLEARANCE + 1;

export const usesVillageWalls = (villageType: string | null | undefined) =>
  villageType === "VILLAGE" || villageType === "TOWN";

export type VillageWallAxis = "horizontal" | "diagonalDown" | "diagonalUp";
export type VillageWallEdgeKind = "wall" | "gate";

export interface VillageWallStructure {
  longitude: number;
  latitude: number;
  hasPage?: number;
}

export interface VillageWallEdge {
  tile: SectorCoordinate;
  /** Index into getNeighborCoordinates(tile). */
  direction: number;
  axis: VillageWallAxis;
  kind: VillageWallEdgeKind;
  vertices: readonly [string, string];
}

export interface VillageWallVertex {
  id: string;
  edges: number[];
}

export interface VillageWallPlan {
  structures: SectorCoordinate[];
  interior: SectorCoordinate[];
  edges: VillageWallEdge[];
  vertices: VillageWallVertex[];
  /** Closed boundary loops as ordered vertex ids (first id is not repeated). */
  contours: string[][];
}

/**
 * Tiles whose scenery would intersect the wall silhouette. The boundary tile
 * clears the village side; two exterior rings keep mature tree canopies from
 * reaching back over the masonry even when their trunks are farther away.
 */
export const getVillageWallDecorationClearanceKeys = (
  plan: Pick<VillageWallPlan, "edges">,
) => {
  const keys = new Set<string>();
  for (const edge of plan.edges) {
    keys.add(getSectorTileKey(edge.tile.x, edge.tile.y));
    const outside = getNeighborCoordinates(edge.tile)[edge.direction];
    if (!outside) continue;
    keys.add(getSectorTileKey(outside.x, outside.y));
    for (const exteriorNeighbor of getNeighborCoordinates(outside)) {
      keys.add(getSectorTileKey(exteriorNeighbor.x, exteriorNeighbor.y));
    }
  }
  return keys;
};

/**
 * Interior boundary tiles whose terrain face sits directly beneath a wall.
 * Repainting only the village side creates a natural shore/foundation while
 * preserving the authored terrain immediately outside the enclosure.
 */
export const getVillageWallFoundationKeys = (plan: Pick<VillageWallPlan, "edges">) =>
  new Set(plan.edges.map((edge) => getSectorTileKey(edge.tile.x, edge.tile.y)));

interface VillageWallMap {
  width: number;
  height: number;
  tiles?: NormalizedSectorTile[];
  anchors?: NormalizedSectorAnchor[];
}

const coordinateSort = (a: SectorCoordinate, b: SectorCoordinate) =>
  a.x - b.x || a.y - b.y;

const parseCoordinateKey = (key: string): SectorCoordinate => {
  const [x = "0", y = "0"] = key.split(",");
  return { x: Number(x), y: Number(y) };
};

const inBounds = (
  map: Pick<VillageWallMap, "width" | "height">,
  point: SectorCoordinate,
) => isCoordinateInSectorMap(map, point);

const oddQToCube = (point: SectorCoordinate) => {
  const x = point.x;
  const z = point.y - (point.x - (point.x & 1)) / 2;
  return { x, y: -x - z, z };
};

/**
 * Structure art occupies its center and first ring. The wall sits beyond one
 * additional clear ring and keeps one exterior map ring available, so a
 * structure center must have three complete in-map rings.
 */
export const isVillageStructurePlacementAllowed = (
  map: Pick<VillageWallMap, "width" | "height">,
  point: SectorCoordinate,
  margin = VILLAGE_STRUCTURE_BORDER_MARGIN,
) => {
  if (!inBounds(map, point)) return false;
  let frontier = [point];
  const visited = new Set([getSectorTileKey(point.x, point.y)]);
  for (let distance = 0; distance < margin; distance++) {
    const next: SectorCoordinate[] = [];
    for (const current of frontier) {
      for (const neighbor of getNeighborCoordinates(current)) {
        if (!inBounds(map, neighbor)) return false;
        const key = getSectorTileKey(neighbor.x, neighbor.y);
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return true;
};

/**
 * Return the smallest six-direction convex hex region containing every
 * structure footprint plus its clear ring. Intersecting the min/max bounds
 * on all three cube axes avoids the thin corridors and inward bays produced
 * by connecting per-building bubbles with shortest paths.
 */
const buildConvexInterior = (
  map: Pick<VillageWallMap, "width" | "height">,
  structures: SectorCoordinate[],
) => {
  const padding = VILLAGE_STRUCTURE_FOOTPRINT_RADIUS + VILLAGE_WALL_CLEARANCE;
  const cubes = structures.map(oddQToCube);
  const minX = Math.min(...cubes.map((point) => point.x)) - padding;
  const maxX = Math.max(...cubes.map((point) => point.x)) + padding;
  const minY = Math.min(...cubes.map((point) => point.y)) - padding;
  const maxY = Math.max(...cubes.map((point) => point.y)) + padding;
  const minZ = Math.min(...cubes.map((point) => point.z)) - padding;
  const maxZ = Math.max(...cubes.map((point) => point.z)) + padding;
  const interior = new Set<string>();
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) {
      const cube = oddQToCube({ x, y });
      if (
        cube.x >= minX &&
        cube.x <= maxX &&
        cube.y >= minY &&
        cube.y <= maxY &&
        cube.z >= minZ &&
        cube.z <= maxZ
      ) {
        interior.add(getSectorTileKey(x, y));
      }
    }
  }
  return interior;
};

/**
 * Asset axes are named in screen space. The Three.js camera renders increasing
 * world Y upward, so the two diagonal groups are the inverse of their odd-q
 * world-coordinate slopes.
 */
export const getVillageWallAxis = (direction: number): VillageWallAxis => {
  if (direction === 0 || direction === 1) return "horizontal";
  if (direction === 2 || direction === 5) return "diagonalUp";
  return "diagonalDown";
};

const CORNERS_BY_DIRECTION = [
  [
    [1, 1],
    [-1, 1],
  ],
  [
    [-1, -1],
    [1, -1],
  ],
  [
    [-1, 1],
    [-2, 0],
  ],
  [
    [2, 0],
    [1, 1],
  ],
  [
    [-2, 0],
    [-1, -1],
  ],
  [
    [1, -1],
    [2, 0],
  ],
] as const;

const edgeVertexIds = (tile: SectorCoordinate, direction: number) => {
  const centerX = tile.x * 3;
  const centerY = tile.y * 2 + (tile.x & 1);
  const corners = CORNERS_BY_DIRECTION[direction];
  if (!corners) throw new Error(`Unsupported wall direction ${direction}`);
  return corners.map(([dx, dy]) => `${centerX + dx},${centerY + dy}`) as [
    string,
    string,
  ];
};

export const getOddQHexDistance = (a: SectorCoordinate, b: SectorCoordinate) => {
  const ac = oddQToCube(a);
  const bc = oddQToCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
};

/**
 * Pick a small, well-spaced set of visually significant contour corners.
 * Looking several edges in each direction smooths over the alternating
 * diagonal steps of a screen-vertical hex boundary, so towers do not land on
 * arbitrary sawtooth vertices.
 */
export const selectVillageWallTowerVertices = (
  contour: string[],
  blocked: ReadonlySet<string>,
  maxTowers: number,
) => {
  const count = contour.length;
  if (count === 0 || maxTowers <= 0) return [];
  const target = Math.min(maxTowers, Math.max(2, Math.floor(count / 8)), count);
  const lookahead = Math.max(2, Math.floor(count / 12));
  const candidates = contour
    .map((vertex, index) => {
      const previous = parseCoordinateKey(
        contour[(index - lookahead + count) % count] ?? vertex,
      );
      const current = parseCoordinateKey(vertex);
      const next = parseCoordinateKey(contour[(index + lookahead) % count] ?? vertex);
      const incoming = { x: current.x - previous.x, y: current.y - previous.y };
      const outgoing = { x: next.x - current.x, y: next.y - current.y };
      const denominator =
        Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
      const cosine = denominator
        ? (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator
        : 1;
      return { vertex, index, score: 1 - cosine };
    })
    .filter(({ vertex }) => !blocked.has(vertex))
    .sort((a, b) => b.score - a.score || a.vertex.localeCompare(b.vertex));

  const minimumSpacing = Math.max(2, Math.floor(count / (target * 2)));
  const chosen: typeof candidates = [];
  for (const candidate of candidates) {
    const separated = chosen.every(({ index }) => {
      const distance = Math.abs(candidate.index - index);
      return Math.min(distance, count - distance) >= minimumSpacing;
    });
    if (!separated) continue;
    chosen.push(candidate);
    if (chosen.length === target) break;
  }
  return chosen.map(({ vertex }) => vertex);
};

const chooseGateEdges = (
  edges: VillageWallEdge[],
  map: VillageWallMap,
  tileByKey: Map<string, NormalizedSectorTile>,
) => {
  const candidates = edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => {
      const outside = getNeighborCoordinates(edge.tile)[edge.direction];
      if (!outside) return false;
      return (
        tileByKey.get(getSectorTileKey(edge.tile.x, edge.tile.y))?.zone === "road" &&
        tileByKey.get(getSectorTileKey(outside.x, outside.y))?.zone === "road"
      );
    });

  if (candidates.length > 0) {
    const remaining = new Set(candidates.map(({ index }) => index));
    while (remaining.size > 0) {
      const seed = [...remaining].sort((a, b) => a - b)[0];
      if (seed === undefined) break;
      const component = [seed];
      remaining.delete(seed);
      for (let head = 0; head < component.length; head++) {
        const currentIndex = component[head];
        const current = currentIndex === undefined ? undefined : edges[currentIndex];
        if (!current) continue;
        for (const otherIndex of [...remaining]) {
          const other = edges[otherIndex];
          if (!other) continue;
          if (current.vertices.some((vertex) => other.vertices.includes(vertex))) {
            remaining.delete(otherIndex);
            component.push(otherIndex);
          }
        }
      }
      const chosen = component.sort((a, b) => a - b)[Math.floor(component.length / 2)];
      if (chosen !== undefined && edges[chosen]) edges[chosen].kind = "gate";
    }
    return;
  }

  const spawn = map.anchors?.find((anchor) => anchor.key === "spawn.default");
  if (!spawn || edges.length === 0) return;
  const chosen = edges
    .map((edge, index) => ({
      index,
      distance: getOddQHexDistance(edge.tile, spawn),
      key: `${edge.tile.x},${edge.tile.y},${edge.direction}`,
    }))
    .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key))[0];
  const chosenEdge = chosen ? edges[chosen.index] : undefined;
  if (chosenEdge) chosenEdge.kind = "gate";
};

const traceContours = (
  edges: VillageWallEdge[],
  vertices: VillageWallVertex[],
): string[][] => {
  const verticesById = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const remainingEdges = new Set(edges.map((_, index) => index));
  const contours: string[][] = [];
  while (remainingEdges.size > 0) {
    const startEdgeIndex = [...remainingEdges].sort((a, b) => a - b)[0];
    const startEdge = startEdgeIndex === undefined ? undefined : edges[startEdgeIndex];
    if (!startEdge || startEdgeIndex === undefined) break;
    const startVertex = [...startEdge.vertices].sort()[0];
    if (!startVertex) break;
    const contour = [startVertex];
    let currentVertex = startVertex;
    let currentEdgeIndex = startEdgeIndex;
    for (let guard = 0; guard <= edges.length; guard++) {
      remainingEdges.delete(currentEdgeIndex);
      const currentEdge = edges[currentEdgeIndex];
      if (!currentEdge) break;
      const nextVertex =
        currentEdge.vertices[0] === currentVertex
          ? currentEdge.vertices[1]
          : currentEdge.vertices[0];
      if (nextVertex === startVertex) break;
      contour.push(nextVertex);
      const nextEdgeIndex = verticesById
        .get(nextVertex)
        ?.edges.find((edgeIndex) => edgeIndex !== currentEdgeIndex);
      if (nextEdgeIndex === undefined) break;
      currentVertex = nextVertex;
      currentEdgeIndex = nextEdgeIndex;
    }
    contours.push(contour);
  }
  return contours.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
};

export const planVillageWalls = (
  map: VillageWallMap,
  structures: VillageWallStructure[],
): VillageWallPlan => {
  const structureKeys = new Set<string>();
  for (const structure of structures) {
    if (structure.hasPage === 0) continue;
    const point = { x: structure.longitude, y: structure.latitude };
    if (!inBounds(map, point)) continue;
    structureKeys.add(getSectorTileKey(point.x, point.y));
  }
  const structurePoints = [...structureKeys]
    .map(parseCoordinateKey)
    .sort(coordinateSort);
  if (structurePoints.length === 0) {
    return { structures: [], interior: [], edges: [], vertices: [], contours: [] };
  }

  const interior = buildConvexInterior(map, structurePoints);

  const edges: VillageWallEdge[] = [];
  const interiorPoints = [...interior].map(parseCoordinateKey).sort(coordinateSort);
  for (const tile of interiorPoints) {
    getNeighborCoordinates(tile).forEach((neighbor, direction) => {
      if (interior.has(getSectorTileKey(neighbor.x, neighbor.y))) return;
      edges.push({
        tile,
        direction,
        axis: getVillageWallAxis(direction),
        kind: "wall",
        vertices: edgeVertexIds(tile, direction),
      });
    });
  }
  edges.sort(
    (a, b) => a.tile.x - b.tile.x || a.tile.y - b.tile.y || a.direction - b.direction,
  );

  const tileByKey = new Map(
    map.tiles?.map((tile) => [getSectorTileKey(tile.x, tile.y), tile]) ?? [],
  );
  chooseGateEdges(edges, map, tileByKey);

  const verticesById = new Map<string, VillageWallVertex>();
  edges.forEach((edge, edgeIndex) => {
    edge.vertices.forEach((id) => {
      const vertex = verticesById.get(id) ?? { id, edges: [] };
      vertex.edges.push(edgeIndex);
      verticesById.set(id, vertex);
    });
  });
  const vertices = [...verticesById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const contours = traceContours(edges, vertices);
  return {
    structures: structurePoints,
    interior: interiorPoints,
    edges,
    vertices,
    contours,
  };
};
