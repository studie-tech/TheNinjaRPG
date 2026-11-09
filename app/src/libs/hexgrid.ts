import type {
  BoundingBox,
  Ellipse,
  HexOffset,
  HexOptions,
  Point,
} from "honeycomb-grid";
import {
  createHexDimensions,
  createHexOrigin,
  defaultHexSettings,
  Grid,
  Hex,
  Orientation,
  rectangle,
  ring,
  spiral,
} from "honeycomb-grid";
import type { CombatBiome } from "@/drizzle/constants";
import { HEX_ASPECT_RATIO, HEX_STACKING_DISPLACEMENT } from "@/drizzle/constants";
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
  /** Stock water sealed by an icy coast; recorded by the terrain field for ice-aware actors */
  frozen?: boolean;
  /** Integer terrain step from the terrain field: land rises 0..3, stock seabeds sink -1..-5 */
  terrace?: number;
  // A hex never moves once created, so its derived geometry is computed once. Honeycomb
  // otherwise rebuilds these points on every access, which dominates sector builds.
  #corners?: Point[];
  #point?: Point;
  #center?: Point;

  override get corners(): Point[] {
    this.#corners ??= Object.freeze(
      super.corners.map((corner) => Object.freeze(corner)),
    ) as Point[];
    return this.#corners;
  }

  override get x(): number {
    this.#point ??= Object.freeze({ x: super.x, y: super.y });
    return this.#point.x;
  }

  override get y(): number {
    this.#point ??= Object.freeze({ x: super.x, y: super.y });
    return this.#point.y;
  }

  override get center(): Point {
    this.#center ??= Object.freeze(super.center);
    return this.#center;
  }
}

/**
 * Hexagonal tile used by honeycomb.js
 */
export function defineHex(hexOptions?: Partial<HexOptions>): typeof TerrainHex {
  const { dimensions, orientation, origin, offset } = {
    ...defaultHexSettings,
    ...hexOptions,
  };

  // Every hex of the class shares one size and origin, resolved on first use so an
  // invalid size still fails only where a hex is measured.
  let hexDimensions: Ellipse | undefined;
  let hexOrigin: Point | undefined;
  return class extends TerrainHex {
    get dimensions(): Ellipse {
      hexDimensions ??= createHexDimensions(dimensions as BoundingBox, orientation);
      return hexDimensions;
    }

    get orientation(): Orientation {
      return orientation;
    }

    get origin(): Point {
      hexOrigin ??= createHexOrigin(origin as "topLeft", this);
      return hexOrigin;
    }

    get offset(): HexOffset {
      return offset;
    }
  };
}

/**
 * Flat-top rectangular hex grid. A zero-width mount gives a zero hex size, which
 * honeycomb's dimensions refuse, so that case yields an empty grid.
 * @param origin - Passed through unchanged; omitting it keeps honeycomb's default
 */
export const createHexGrid = (
  hexsize: number,
  width: number,
  height: number,
  origin?: Point,
) => {
  const Tile = defineHex({
    dimensions: { width: hexsize, height: hexsize * HEX_ASPECT_RATIO },
    origin,
    orientation: Orientation.FLAT,
  });
  return hexsize > 0 ? new Grid(Tile, rectangle({ width, height })) : new Grid(Tile);
};

/** Letter-and-row tile name and unit movement cost used by arena-style grids. */
export const nameArenaTile = <T extends TerrainHex>(tile: T) => {
  tile.cost = 1;
  tile.name = `${String.fromCharCode(65 + tile.col)}${tile.row + 1}`;
  return tile;
};

/** Hex widths spanned by `columns` stacked flat-top columns. */
export const stackedHexWidths = (columns: number) =>
  columns - HEX_STACKING_DISPLACEMENT * (columns - 1);

/** Height to width ratio of a hex map, including its two border rows. */
export const hexGridHeightRatio = (columns: number, rows: number) =>
  ((rows + 2) * HEX_ASPECT_RATIO) / stackedHexWidths(columns);

/** Keys of the given tiles and their direct neighbors. */
export const tileKeysNear = (
  grid: Grid<TerrainHex>,
  positions: { col: number; row: number }[],
) => {
  const keys = new Set<string>();
  for (const position of positions) {
    const tile = grid.getHex(position);
    if (!tile) continue;
    keys.add(`${tile.col},${tile.row}`);
    for (const neighbor of grid.traverse(ring({ radius: 1, center: tile }))) {
      keys.add(`${neighbor.col},${neighbor.row}`);
    }
  }
  return keys;
};

/** Cube coordinates of a flat-top odd-q offset position, as honeycomb-grid lays them out. */
export const oddQToCube = (col: number, row: number) => {
  const z = row - Math.floor((col - (col & 1)) / 2);
  return { x: col, y: -col - z, z };
};

/** Hex steps between two flat-top odd-q offset positions. */
export const oddQHexDistance = (
  aCol: number,
  aRow: number,
  bCol: number,
  bRow: number,
) => {
  const a = oddQToCube(aCol, aRow);
  const b = oddQToCube(bCol, bRow);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
};

/**
 * Tile `steps` hexes along the straight line from `from` through `to`, in flat-top odd-q
 * offsets. Negative steps extend the line behind `from`, and it can leave the grid.
 */
export const oddQLineStep = (
  from: { col: number; row: number },
  to: { col: number; row: number },
  steps: number,
) => {
  const a = oddQToCube(from.col, from.row);
  const b = oddQToCube(to.col, to.row);
  const t = steps / Math.max(oddQHexDistance(from.col, from.row, to.col, to.row), 1);
  const exact = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
  let x = Math.round(exact.x);
  const y = Math.round(exact.y);
  let z = Math.round(exact.z);
  // Rounding can break x + y + z = 0; rebuild the axis that rounded furthest.
  const xError = Math.abs(x - exact.x);
  const yError = Math.abs(y - exact.y);
  const zError = Math.abs(z - exact.z);
  if (xError > yError && xError > zError) x = -y - z;
  else if (zError >= yError) z = -x - y;
  return { col: x, row: z + Math.floor((x - (x & 1)) / 2) };
};

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

/** Whether selecting an action's target tile is constrained by its range. */
export const isActionRangeLimited = (
  action: Partial<Pick<CombatAction, "effects" | "method" | "coordinateTargeting">>,
) =>
  !!action.effects?.some(
    (tag) =>
      tag.target === "COORDINATES" && tag.coordinateTargeting?.origin === "TARGET",
  ) ||
  (action.method === "COORDINATES" &&
    action.coordinateTargeting?.origin === "TARGET") ||
  action.method === "SINGLE" ||
  action.method === "AOE_LINE_SHOOT" ||
  action.method === "AOE_WALL_SHOOT" ||
  action.method === "AOE_LARGE_WALL_SHOOT" ||
  action.method === "AOE_CIRCLE_SHOOT" ||
  action.method === "AOE_SPIRAL_SHOOT" ||
  action.method === "AOE_CIRCLE_SPAWN";

export const getPossibleActionTiles = (
  action: CombatAction | undefined,
  origin: TerrainHex | undefined,
  grid: Grid<TerrainHex>,
) => {
  let highlights: Grid<TerrainHex> | undefined;
  if (action && origin) {
    const radius = action.range;
    if (isActionRangeLimited(action)) {
      const f = spiral<TerrainHex>({ start: [origin.q, origin.r], radius: radius });
      highlights = grid.traverse(f);
    } else if (action.method === "ALL" || action.method === "COORDINATES") {
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
   * building a new calculator, not just clearing the cache. Every caller constructs after its
   * mutations; nothing guards this.
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
 * and whichever entry surfaces after the tile is settled is skipped. Never decreasing a key
 * avoids decrease-key bookkeeping in the heap, a common source of wrong pop order (and so of
 * paths that are not the shortest) in heap-based A*.
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
