/**
 * Tower Defense Game Utilities
 *
 * This file contains client-side utilities for rendering and seed generation.
 * All game logic (spawning, combat, movement) is handled by SpacetimeDB.
 */

import type { TDEnemyDirection } from "@/drizzle/constants";
import type { HexPosition, SpriteDirection } from "@/validators/towerDefense";

/**
 * Calculate axial distance between two hexes.
 */
export const calculateHexDistance = (a: HexPosition, b: HexPosition): number => {
  const aq = a.col;
  const ar = a.row - Math.floor((a.col - (a.col & 1)) / 2);
  const bq = b.col;
  const br = b.row - Math.floor((b.col - (b.col & 1)) / 2);

  const dq = Math.abs(aq - bq);
  const dr = Math.abs(ar - br);
  const ds = Math.abs(aq + ar - (bq + br));

  return Math.max(dq, Math.max(dr, ds));
};

// ============================================
// Direction Utilities (for rendering)
// ============================================

const DIRECTION_TO_SPRITE: Record<string, SpriteDirection> = {
  north: "north",
  n: "north",
  "north-east": "north-east",
  ne: "north-east",
  east: "east",
  e: "east",
  "south-east": "south-east",
  se: "south-east",
  south: "south",
  s: "south",
  "south-west": "south-west",
  sw: "south-west",
  west: "west",
  w: "west",
  "north-west": "north-west",
  nw: "north-west",
};

/**
 * Convert short direction (game logic) or full name to sprite direction (asset paths).
 *
 * NOTE: We use two direction systems:
 * 1. Short form (n, ne, e, se, s, sw, w, nw) - Used by SpacetimeDB for efficiency
 *    and defined in TD_ENEMY_DIRECTIONS (drizzle/constants.ts).
 * 2. Long form (north, north-east, etc.) - Used for asset folder names and
 *    defined in spriteDirections (validators/towerDefense.ts).
 */
export const directionToSpriteDirection = (dir: string): SpriteDirection => {
  return DIRECTION_TO_SPRITE[dir.toLowerCase()] ?? "south";
};

/**
 * Calculate the direction based on movement delta.
 * Uses grid coordinates where positive row = north (up in ThreeJS).
 */
export const calculateEnemyDirection = (
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): TDEnemyDirection => {
  const dx = toCol - fromCol;
  const dy = toRow - fromRow;

  // Cardinal directions
  if (dx === 0 && dy > 0) return "n";
  if (dx === 0 && dy < 0) return "s";
  if (dx > 0 && dy === 0) return "e";
  if (dx < 0 && dy === 0) return "w";

  // Diagonal directions
  if (dx > 0 && dy > 0) return "ne";
  if (dx > 0 && dy < 0) return "se";
  if (dx < 0 && dy > 0) return "nw";
  if (dx < 0 && dy < 0) return "sw";

  return "s"; // Default
};

// ============================================
// Seed Generation
// ============================================

/**
 * Generates a unique seed for a new run.
 * Uses crypto if available, falls back to timestamp + random.
 */
export const generateRunSeed = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Calculate the cost of an upgrade based on its current level
 * Uses exponential scaling: baseCost * costMultiplier^currentLevel
 */
export const calculateUpgradeCost = (
  baseCost: number,
  costMultiplier: number,
  currentLevel: number,
): number => {
  return Math.floor(baseCost * costMultiplier ** currentLevel);
};
