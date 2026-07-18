import { aStar } from "abstract-astar";
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
 */
export class PathCalculator {
  cache: Map<string, TerrainHex[] | undefined>;
  grid: Grid<TerrainHex>;

  constructor(grid: Grid<TerrainHex>) {
    this.cache = new Map<string, TerrainHex[] | undefined>();
    this.grid = grid;
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
    const shortestPath = aStar<TerrainHex>({
      start: origin,
      goal: target,
      estimateFromNodeToGoal: (tile) => this.grid.distance(tile, origin),
      neighborsAdjacentToNode: (center) =>
        this.grid
          .traverse(ring({ radius: 1, center }))
          .toArray()
          .filter((tile) => !tile.blocked),
      actualCostToMove: (_, from, to) => {
        return to.cost + from.cost;
      },
    });
    this.cache.set(key, shortestPath);
    return shortestPath;
  };
}
