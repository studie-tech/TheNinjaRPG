import type {
  BoundingBox,
  Ellipse,
  Grid,
  HexOffset,
  HexOptions,
  Orientation,
  Point,
} from "honeycomb-grid";
import {
  createHexDimensions,
  createHexOrigin,
  defaultHexSettings,
  Hex,
  ring,
  spiral,
} from "honeycomb-grid";
import type * as THREE from "three";
import type { CombatBiome } from "@/drizzle/constants";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { NormalizedSectorTile, SectorMapZone } from "@/libs/sector-map/types";
import type { CombatAction } from "./combat/types";

/**
 * Custom hex used by honeycomb.js
 */
export class TerrainHex extends Hex {
  /** Terrain key of the tile (open registry key, e.g. "ground", "swamp") */
  asset?: string;
  /** Combat arena background for battles started on this tile */
  battleBiome?: CombatBiome;
  name?: string;
  hasStructure?: boolean;
  blocked?: boolean;
  zone?: SectorMapZone;
  level!: number;
  assetStrength!: number;
  cost!: number;
  /** Resolved terrain spec, stashed during the sector build's first grid pass
   *  so the geometry pass doesn't re-resolve it per tile */
  spec?: TerrainSpec;
  /** The authored map tile backing this hex (if any), stashed alongside `spec`
   *  so the geometry pass skips a second per-tile authoredTiles lookup */
  authored?: NormalizedSectorTile;
}

/**
 * Hexagonal face mesh for Three.js
 */
export interface HexagonalFaceMesh
  extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  currentHex: number;
  userData: {
    id: number;
    hex: number;
    tile: TerrainHex;
    highlight: boolean;
    selected: boolean;
    canClick: boolean;
    originalColor?: THREE.Color;
    isBattleTile?: boolean;
  };
}

/**
 * Hexagonal tile used by honeycomb.js
 */
export function defineHex(hexOptions?: Partial<HexOptions>): typeof TerrainHex {
  const { dimensions, orientation, origin, offset } = {
    ...defaultHexSettings,
    ...hexOptions,
  };

  return class extends TerrainHex {
    get dimensions(): Ellipse {
      return createHexDimensions(dimensions as BoundingBox, orientation);
    }

    get orientation(): Orientation {
      return orientation;
    }

    get origin(): Point {
      return createHexOrigin(origin as "topLeft", this);
    }

    get offset(): HexOffset {
      return offset;
    }
  };
}

/**
 * A point defined by X and Y
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * A point defined by longitude and latitude
 */
export interface UserLocation {
  longitude: number;
  latitude: number;
}

/** Find a given hex in a grid */
export const findHex = (
  grid: Grid<TerrainHex> | null,
  point: Point2D | UserLocation,
) => {
  if ("x" in point && "y" in point) {
    return grid?.getHex({
      col: point.x,
      row: point.y,
    });
  } else if ("longitude" in point && "latitude" in point) {
    return grid?.getHex({
      col: point.longitude,
      row: point.latitude,
    });
  }
};

export const getPossibleActionTiles = (
  action: CombatAction | undefined,
  origin: TerrainHex | undefined,
  grid: Grid<TerrainHex>,
) => {
  let highlights: Grid<TerrainHex> | undefined;
  if (action && origin) {
    const radius = action.range;
    if (
      action.method === "SINGLE" ||
      action.method === "AOE_LINE_SHOOT" ||
      action.method === "AOE_WALL_SHOOT" ||
      action.method === "AOE_LARGE_WALL_SHOOT" ||
      action.method === "AOE_CIRCLE_SHOOT" ||
      action.method === "AOE_SPIRAL_SHOOT" ||
      action.method === "AOE_CIRCLE_SPAWN"
    ) {
      const f = spiral<TerrainHex>({ start: [origin.q, origin.r], radius: radius });
      highlights = grid.traverse(f);
    } else if (action.method === "ALL") {
      highlights = grid;
    }
  }
  return highlights;
};

/**
 * Uses A* algorithm to calculate the shortest path between two hexes.
 *
 * Only the COST of the returned path is defined. A grid usually holds many equally cheap routes
 * between two tiles and which one comes back depends on the search order, so callers must not
 * treat the specific tiles as stable — `getBarriersBetween` reads them to decide which barriers
 * absorb an attack, and that answer moves whenever the search does.
 */
export class PathCalculator {
  cache: Map<string, TerrainHex[] | undefined>;
  grid: Grid<TerrainHex>;
  /**
   * Lower bound on what a single step can cost, so the heuristic below can be scaled by it and
   * still never overestimate. A step costs `to.cost + from.cost`, so it is at least twice the
   * cheapest passable tile on this grid — 2 where combat sets every tile to 1, 4 on sector and
   * window grids where a tile costs `walkCost + 1`. It has to be read off the grid rather than
   * hardcoded because this class serves both.
   *
   * Snapshotted, and it bites harder than the path cache does: a stale cache still answers a
   * miss correctly, whereas a bound taken before a tile got CHEAPER overestimates, and then even
   * a miss comes back with a path that is not the shortest. Lowering any tile's cost means
   * building a new calculator, not just clearing the cache. Every site does that today — each
   * one constructs after its mutations — which is why this is a note rather than a guard.
   */
  minStepCost: number;

  constructor(grid: Grid<TerrainHex>) {
    this.cache = new Map<string, TerrainHex[] | undefined>();
    this.grid = grid;
    let cheapest = Number.POSITIVE_INFINITY;
    grid.forEach((tile) => {
      if (!tile.blocked && Number.isFinite(tile.cost) && tile.cost < cheapest) {
        cheapest = tile.cost;
      }
    });
    // A grid with no passable tile, or one whose tiles are free, leaves the heuristic at zero,
    // which is a plain Dijkstra search: slower, but still correct
    this.minStepCost = cheapest > 0 && Number.isFinite(cheapest) ? 2 * cheapest : 0;
  }

  /**
   * A* shortest path between two hexes. Returns undefined (unreachable) if
   * origin or target is blocked; blocked tiles are also excluded from
   * neighbour expansion. Results are memoized per origin/target key, so the
   * cache assumes tile blocked/cost state does not change within this
   * calculator's lifetime.
   */
  getShortestPath = (origin: TerrainHex, target: TerrainHex) => {
    if (origin.blocked || target.blocked) return undefined;
    const key = `${origin.col},${origin.row},${target.col},${target.row}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const shortestPath = findShortestPath({
      start: origin,
      goal: target,
      estimate: (tile) => this.minStepCost * this.grid.distance(tile, target),
      neighbors: (center) =>
        this.grid
          .traverse(ring({ radius: 1, center }))
          .toArray()
          .filter((tile) => !tile.blocked),
      stepCost: (from, to) => to.cost + from.cost,
    });
    this.cache.set(key, shortestPath);
    return shortestPath;
  };
}

/**
 * A* with a lazy-deletion binary heap.
 *
 * Finding a cheaper route to a tile pushes a second entry rather than moving the existing one,
 * and whichever entry surfaces after the tile is settled is skipped. That is what replaced
 * `abstract-astar`: its MinHeap sifts DOWN when a key decreases (a decrease has to sift up) and
 * `removeMinimum` leaves the moved item's stale index behind in its index map, so once the
 * heuristic actually reorders the frontier the pop order is wrong and the path it returns is not
 * always the shortest — measured at 4 of 68 paths on a sector-sized grid with mixed terrain
 * costs. Never decreasing a key sidesteps both.
 *
 * `estimate` must not overestimate the remaining cost or the result is not the shortest path;
 * `PathCalculator.minStepCost` is what keeps the caller's estimate under that bound.
 */
const findShortestPath = ({
  start,
  goal,
  estimate,
  neighbors,
  stepCost,
}: {
  start: TerrainHex;
  goal: TerrainHex;
  estimate: (tile: TerrainHex) => number;
  neighbors: (tile: TerrainHex) => TerrainHex[];
  stepCost: (from: TerrainHex, to: TerrainHex) => number;
}) => {
  const cheapestTo = new Map<TerrainHex, number>([[start, 0]]);
  const cameFrom = new Map<TerrainHex, TerrainHex>();
  const settled = new Set<TerrainHex>();
  const frontier: { tile: TerrainHex; score: number }[] = [
    { tile: start, score: estimate(start) },
  ];
  const scoreAt = (index: number) => frontier[index]?.score ?? Number.POSITIVE_INFINITY;
  const swap = (a: number, b: number) => {
    const first = frontier[a];
    const second = frontier[b];
    if (first === undefined || second === undefined) return;
    frontier[a] = second;
    frontier[b] = first;
  };
  const siftUp = (index: number) => {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (scoreAt(parent) <= scoreAt(index)) return;
      swap(index, parent);
      index = parent;
    }
  };
  const siftDown = (index: number) => {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < frontier.length && scoreAt(left) < scoreAt(smallest)) smallest = left;
      if (right < frontier.length && scoreAt(right) < scoreAt(smallest))
        smallest = right;
      if (smallest === index) return;
      swap(index, smallest);
      index = smallest;
    }
  };
  while (frontier.length > 0) {
    const top = frontier[0];
    const last = frontier.pop();
    if (top === undefined || last === undefined) break;
    if (frontier.length > 0) {
      frontier[0] = last;
      siftDown(0);
    }
    const current = top.tile;
    if (current === goal) {
      const path = [current];
      let step = current;
      for (;;) {
        const previous = cameFrom.get(step);
        if (previous === undefined) return path.reverse();
        path.push(previous);
        step = previous;
      }
    }
    if (settled.has(current)) continue;
    settled.add(current);
    const costToCurrent = cheapestTo.get(current) ?? Number.POSITIVE_INFINITY;
    for (const next of neighbors(current)) {
      const candidate = costToCurrent + stepCost(current, next);
      if (candidate < (cheapestTo.get(next) ?? Number.POSITIVE_INFINITY)) {
        cheapestTo.set(next, candidate);
        cameFrom.set(next, current);
        frontier.push({ tile: next, score: candidate + estimate(next) });
        siftUp(frontier.length - 1);
      }
    }
  }
  return undefined;
};
