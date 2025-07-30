import { spiral, line, ring, fromCoordinates, Direction } from "honeycomb-grid";
import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "../hexgrid";
import type { CombatAction, GroundEffect, ReturnedUserState } from "./types";

export const isValidMove = (info: {
  action: CombatAction;
  target: TerrainHex;
  user: ReturnedUserState;
  users: ReturnedUserState[];
  barriers: GroundEffect[];
  clicked: TerrainHex;
}) => {
  const { action, user, users, target, clicked, barriers } = info;
  const { villageId, userId } = user;
  const barrier = barriers.find(
    (b) => b.longitude === target.col && b.latitude === target.row,
  );
  if (!barrier) {
    const opponent = users.find(
      (u) =>
        u.longitude === target.col &&
        u.latitude === target.row &&
        u.curHealth > 0 &&
        !u.fledBattle,
    );
    if (action.target === "CHARACTER") {
      if (opponent) return true;
    } else if (action.target === "OPPONENT") {
      if (opponent && opponent?.villageId !== villageId) return true;
    } else if (action.target === "OTHER_USER") {
      if (opponent && opponent?.userId !== userId) return true;
    } else if (action.target === "ALLY") {
      if (opponent && opponent?.villageId === villageId) return true;
    } else if (action.target === "SELF") {
      // Allow self-targeting abilities like basic heal even when stealthed
      if (opponent && opponent?.userId === userId) return true;
    } else if (action.target === "EMPTY_GROUND") {
      if (!opponent || target !== clicked) return true;
    } else if (action.target === "GROUND") {
      return true;
    }
  } else {
    // Check if the action has a move effect
    const hasMoveEffect = action.effects.find((e) => e.type === "move");
    
    // If there's a move effect, barriers are not targetable
    if (hasMoveEffect) {
      return false;
    }
    
    // Otherwise, only allow damage/pierce actions to target barriers
    if (action.effects.find((e) => ["damage", "pierce"].includes(e.type))) {
      return true;
    }
  }

  return false;
};

export const getAffectedTiles = (info: {
  a: TerrainHex;
  b: TerrainHex;
  action: CombatAction;
  grid: Grid<TerrainHex>;
  restrictGrid?: Grid<TerrainHex>;
  users: ReturnedUserState[];
  ground: GroundEffect[];
  userId: string;
}) => {
  // Destruct & variables
  const { action, b, a, grid, restrictGrid, users, userId } = info;
  const radius = action.range;
  const green = new Set<TerrainHex>();
  const red = new Set<TerrainHex>();
  const user = users.find((u) => u.userId === userId);
  let tiles: Grid<TerrainHex> | undefined = undefined;

  // Get all ground effects which are barriers
  const barriers = info.ground.filter((g) => g.type === "barrier");

  // Guard if no user
  if (!user) return { green, red };

  // Guard if action not on restricted grid
  if (restrictGrid) {
    if (!restrictGrid.getHex({ q: b.q, r: b.r })) {
      return { green, red };
    }
  }

  // Handle different methods separately
  if (action.method === "SINGLE") {
    tiles = grid.traverse(fromCoordinates<TerrainHex>([b.q, b.r]));
  } else if (action.method === "AOE_CIRCLE_SPAWN") {
    tiles = grid.traverse(spiral<TerrainHex>({ start: [b.q, b.r], radius: 1 }));
  } else if (action.method === "AOE_LINE_SHOOT") {
    tiles = grid.traverse(line<TerrainHex>({ start: [b.q, b.r], stop: [a.q, a.r] }));
  } else if (action.method === "AOE_WALL_SHOOT") {
    const deltaX = Math.abs(a.q - b.q);
    const deltaY = Math.abs(a.r - b.r);
    if (deltaX >= deltaY) {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.N }),
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.S }),
      ]);
    } else {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.W }),
        line<TerrainHex>({ start: [b.q, b.r], length: 2, direction: Direction.E }),
      ]);
    }
  } else if (action.method === "AOE_LARGE_WALL_SHOOT") {
    const deltaX = Math.abs(a.q - b.q);
    const deltaY = Math.abs(a.r - b.r);
    if (deltaX >= deltaY) {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.N }),
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.S }),
      ]);
    } else {
      tiles = grid.traverse([
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.W }),
        line<TerrainHex>({ start: [b.q, b.r], length: 3, direction: Direction.E }),
      ]);
    }
  } else if (action.method === "AOE_CIRCLE_SHOOT") {
    tiles = grid.traverse(ring<TerrainHex>({ center: [a.q, a.r], radius }));
  } else if (action.method === "AOE_SPIRAL_SHOOT") {
    tiles = grid.traverse(spiral<TerrainHex>({ start: [a.q, a.r], radius }));
    if (tiles) tiles = tiles.filter((t) => t !== a);
  } else if (action.method === "ALL") {
    grid.forEach((target) => {
      if (isValidMove({ action, target, user, users, barriers, clicked: b })) {
        green.add(target);
      }
    });
  }

  // Return green for valid moves and red for unvalid moves
  tiles?.forEach((target) => {
    if (isValidMove({ action, target, user, users, barriers, clicked: b })) {
      green.add(target);
    } else {
      red.add(target);
    }
  });

  return { green, red };
};
