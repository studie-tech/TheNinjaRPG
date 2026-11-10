/**
 * Tower Defense Game Utilities
 *
 * Hex geometry, projectile, direction and upgrade-cost helpers shared by the client and
 * the tower-defense router. All game logic (spawning, combat, movement) is handled by
 * SpacetimeDB.
 */

import {
  TD_CRIT_DAMAGE_MULTIPLIER,
  TD_PROJECTILE_SPEED,
  type TDEnemyDirection,
} from "@/drizzle/constants";
import { oddQHexDistance } from "@/libs/hexgrid";
import type {
  HexPosition,
  SpriteDirection,
  TowerDefenseAbility,
  TowerDefenseProjectile,
} from "@/validators/towerDefense";
import { spriteDirections } from "@/validators/towerDefense";

/**
 * Calculate axial distance between two hexes.
 */
export const calculateHexDistance = (a: HexPosition, b: HexPosition): number =>
  oddQHexDistance(a.col, a.row, b.col, b.row);

/**
 * Damage a landed projectile shows: its base damage plus the ability's per-tile bonus for the
 * distance flown, multiplied on a critical roll. SpacetimeDB applies the authoritative hit.
 */
export const calculateProjectileDamage = (
  projectile: Pick<TowerDefenseProjectile, "origin" | "target" | "damage" | "critRoll">,
  ability: Pick<TowerDefenseAbility, "critChance" | "damagePerTile"> | undefined,
) => {
  const distanceBonus = Math.floor(
    calculateHexDistance(projectile.origin, projectile.target) *
      (ability?.damagePerTile ?? 0),
  );
  const critical =
    projectile.critRoll !== undefined &&
    projectile.critRoll < (ability?.critChance ?? 0);
  return {
    value:
      (projectile.damage + distanceBonus) * (critical ? TD_CRIT_DAMAGE_MULTIPLIER : 1),
    critical,
  };
};

/**
 * Interpolate a projectile's flight, 0 to 1, from its local spawn time. The server only
 * reports spawns and hits, so clients derive progress from the shared projectile speed.
 */
export const getProjectileProgress = (
  origin: HexPosition,
  target: HexPosition,
  clientSpawnTime: number,
  now: number,
) => {
  const distance = calculateHexDistance(origin, target);
  if (distance <= 0) return 1;
  const elapsedSeconds = (now - clientSpawnTime) / 1000;
  return Math.max(0, Math.min(1, (elapsedSeconds * TD_PROJECTILE_SPEED) / distance));
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
  return parseSpriteDirection(dir) ?? "south";
};

/** The sprite direction a short or full direction name denotes, if any. */
const parseSpriteDirection = (dir: string): SpriteDirection | undefined => {
  const key = dir.toLowerCase();
  return Object.hasOwn(DIRECTION_TO_SPRITE, key) ? DIRECTION_TO_SPRITE[key] : undefined;
};

/**
 * Key an imported per-direction map by sprite direction. Every sprite direction must
 * appear exactly once, so an asset config built from it is complete.
 */
export const toSpriteDirectionRecord = <T>(
  byDirection: Record<string, T>,
): { record: Record<SpriteDirection, T> } | { error: string } => {
  const record: Partial<Record<SpriteDirection, T>> = {};
  for (const [dir, value] of Object.entries(byDirection)) {
    const direction = parseSpriteDirection(dir);
    if (!direction) return { error: `unknown direction "${dir}"` };
    if (direction in record)
      return { error: `direction "${direction}" is listed twice` };
    record[direction] = value;
  }
  const missing = spriteDirections.filter((direction) => !(direction in record));
  if (missing.length > 0) return { error: `missing directions ${missing.join(", ")}` };
  return { record: record as Record<SpriteDirection, T> };
};

/**
 * Calculate the direction based on movement delta.
 * Uses grid coordinates where positive row = north (upward in the rendered world).
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
// Upgrade Costs
// ============================================

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
