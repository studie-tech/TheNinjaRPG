import { spiral, ring, Hex } from "honeycomb-grid";
import { defaultHexSettings } from "honeycomb-grid";
import { createHexDimensions } from "honeycomb-grid";
import { createHexOrigin } from "honeycomb-grid";
import { aStar } from "abstract-astar";
import type { CombatAction } from "./combat/types";
import type { BoundingBox, Grid, Ellipse } from "honeycomb-grid";
import type { Orientation, Point } from "honeycomb-grid";
import type { HexOffset, HexOptions } from "honeycomb-grid";

/**
 * Custom hex used by honeycomb.js
 */
export class TerrainHex extends Hex {
  asset?: "ocean" | "ground" | "dessert" | "ice";
  name?: string;
  level!: number;
  cost!: number;
}

/**
 * Hexagonal face mesh for Three.js
 */
export interface HexagonalFaceMesh extends THREE.Mesh {
  currentHex: number;
  material: THREE.MeshBasicMaterial;
  userData: {
    id: number;
    hex: number;
    tile: TerrainHex;
    highlight: boolean;
    selected: boolean;
    canClick: boolean;
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
  let highlights: Grid<TerrainHex> | undefined = undefined;
  if (action && origin) {
    const radius = action.range;
    if (
      action.method === "SINGLE" ||
      action.method === "AOE_LINE_SHOOT" ||
      action.method === "AOE_WALL_SHOOT" ||
      action.method === "AOE_CIRCLE_SHOOT" ||
      action.method === "AOE_SPIRAL_SHOOT" ||
      action.method === "AOE_CIRCLE_SPAWN"
    ) {
      const f = spiral<TerrainHex>({ start: [origin.q, origin.r], radius: radius });
      highlights = grid.traverse(f);
    } else if (action.method === "ALL") {
      highlights = grid.forEach((hex) => hex);
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

  getShortestPath = (origin: TerrainHex, target: TerrainHex) => {
    const key = `${origin.col},${origin.row},${target.col},${target.row}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const shortestPath = aStar<TerrainHex>({
      start: origin,
      goal: target,
      estimateFromNodeToGoal: (tile) => this.grid.distance(tile, origin),
      neighborsAdjacentToNode: (center) =>
        this.grid.traverse(ring({ radius: 1, center })).toArray(),
      actualCostToMove: (_, from, to) => {
        return to.cost + from.cost;
      },
    });
    this.cache.set(key, shortestPath);
    return shortestPath;
  };
}
