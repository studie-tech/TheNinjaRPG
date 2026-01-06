import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { towerDefenseCharacter } from "@/drizzle/schema";
import { TD_ENEMY_DIRECTIONS } from "@/drizzle/constants";

// ============================================
// Position & Coordinates
// ============================================
export const hexPositionSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
});
export type HexPosition = z.infer<typeof hexPositionSchema>;

// ============================================
// Game State (stored in MySQL for leaderboards)
// Active game state is managed by SpacetimeDB
// ============================================
export const towerDefenseStateSchema = z.object({
  playerHealth: z.number().int().min(0),
  playerPosition: hexPositionSchema,
  inRunCurrency: z.number().int().min(0),
  activeUpgrades: z.record(z.string(), z.number().int().min(0)),
  gridSize: z.number().int().min(5),
});
export type TowerDefenseState = z.infer<typeof towerDefenseStateSchema>;

// ============================================
// Enemy Types & Directions
// ============================================
export const enemyTypeSchema = z.string();
export type EnemyType = z.infer<typeof enemyTypeSchema>;

export const enemyDirectionSchema = z.enum(TD_ENEMY_DIRECTIONS);
export type EnemyDirection = z.infer<typeof enemyDirectionSchema>;

// ============================================
// Enemy (runtime only, not stored in DB)
// ============================================
export const towerDefenseEnemySchema = z.object({
  id: z.string(),
  aiUserId: z.string(),
  enemyType: enemyTypeSchema,
  position: hexPositionSchema,
  path: z.array(hexPositionSchema),
  pathIndex: z.number().int().min(0),
  health: z.number().int().min(0),
  maxHealth: z.number().int().min(1),
  speed: z.number().min(0),
  damage: z.number().int().min(0),
  attackCooldown: z.number().min(0).default(1),
  lastAttackTime: z.number().min(0).optional(),
  movementProgress: z.number().min(0).max(1),
  direction: enemyDirectionSchema,
});
export type TowerDefenseEnemy = z.infer<typeof towerDefenseEnemySchema>;

// ============================================
// Projectile (runtime only, not stored in DB)
// ============================================
export const towerDefenseProjectileSchema = z.object({
  id: z.string(),
  abilityType: z.string(),
  origin: hexPositionSchema,
  target: hexPositionSchema,
  progress: z.number().min(0).max(1),
  damage: z.number().int().min(0),
  impactAssetId: z.string().optional(),
  critRoll: z.number().min(0).max(1).optional(),
});
export type TowerDefenseProjectile = z.infer<typeof towerDefenseProjectileSchema>;

// ============================================
// Ability Definition
// ============================================
export const towerDefenseAbilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  damage: z.number().int().min(0),
  range: z.number().int().min(1),
  cooldownMs: z.number().int().min(0),
  critChance: z.number().min(0).max(1).default(0),
  damagePerTile: z.number().min(0).default(0),
  lastUsedAt: z.number().int().min(0).optional(),
});
export type TowerDefenseAbility = z.infer<typeof towerDefenseAbilitySchema>;

// ============================================
// Player Bonuses
// ============================================
export const playerBonusesSchema = z.object({
  healthRegen: z.number().min(0).default(0),
  defensePercent: z.number().min(0).max(0.9).default(0),
  defenseFlat: z.number().min(0).default(0),
  lifestealPercent: z.number().min(0).default(0),
  knockbackChance: z.number().min(0).max(1).default(0),
  knockbackForce: z.number().min(0).default(0),
  tokensPerWave: z.number().min(0).default(0),
  tokensPerKill: z.number().min(0).default(10),
  interestPerWave: z.number().min(0).default(0),
  skipEnemyChance: z.number().min(0).max(0.5).default(0),
});
export type PlayerBonuses = z.infer<typeof playerBonusesSchema>;

// ============================================
// UI & Game State
// ============================================
export const gameModes = [
  "lobby",
  "connecting",
  "playing",
  "wave-end",
  "game-over",
] as const;
export const gameModeSchema = z.enum(gameModes);
export type GameMode = z.infer<typeof gameModeSchema>;

export const hitEventSchema = z.object({
  id: z.string(),
  position: hexPositionSchema,
  timestamp: z.number(),
});
export type HitEvent = z.infer<typeof hitEventSchema>;

export const towerDefenseGameStateSchema = z.object({
  mode: gameModeSchema,
  runId: z.string().nullable(),
  seed: z.string().nullable(),
  currentWave: z.number().int().min(0),
  score: z.number().int().min(0),
  state: towerDefenseStateSchema.nullable(),
  enemies: z.array(towerDefenseEnemySchema),
  projectiles: z.array(towerDefenseProjectileSchema),
  abilities: z.array(towerDefenseAbilitySchema),
  waveStartTime: z.number().min(0),
  waveInProgress: z.boolean(),
  isSubmitting: z.boolean(),
  error: z.string().nullable(),
  playerHitEvents: z.array(hitEventSchema),
  enemyHitEvents: z.array(hitEventSchema),
  finalPointsEarned: z.number().int().nullable(),
  playerBonuses: playerBonusesSchema,
  maxHealth: z.number().int().min(1),
  existingSession: z
    .object({
      id: z.string(),
      seed: z.string(),
      gridSize: z.number().int().min(5),
      wave: z.number().int().min(0),
      score: z.number().int().min(0),
      health: z.number().int().min(0),
      maxHealth: z.number().int().min(1),
    })
    .nullable(),
  enemyCount: z.number().int().min(0),
});
export type TowerDefenseGameState = z.infer<typeof towerDefenseGameStateSchema>;

// ============================================
// Shared Performance Interfaces (Refs)
// ============================================

/**
 * Entity store that lives OUTSIDE React state to avoid re-renders.
 */
export interface EntityStore {
  enemies: Map<string, TowerDefenseEnemy>;
  projectiles: Map<string, TowerDefenseProjectile>;
  enemiesArray: TowerDefenseEnemy[];
  projectilesArray: TowerDefenseProjectile[];
  enemiesVersion: number;
  projectilesVersion: number;
}

/**
 * Runtime state that lives OUTSIDE React state for smooth gameplay.
 */
export interface RuntimeState {
  score: number;
  currentWave: number;
  waveInProgress: boolean;
  waveStartTime: number;
  maxHealth: number;
  state: TowerDefenseState | null;
  abilities: TowerDefenseAbility[];
  playerBonuses: PlayerBonuses;
  enemyCount: number;
}

// ============================================
// API Input Schemas
// ============================================
export const purchaseUpgradeInputSchema = z.object({
  upgradeId: z.string(),
});
export type PurchaseUpgradeInput = z.infer<typeof purchaseUpgradeInputSchema>;

// ============================================
// Signed Definitions
// ============================================
export const signedUpgradeDefinitionSchema = z.object({
  id: z.string(),
  maxLevel: z.number().int().min(1),
  baseCost: z.number().int().min(0),
  costMultiplier: z.number().min(1),
  effectValue: z.number(),
  upgradeType: z.string(),
});
export type SignedUpgradeDefinition = z.infer<typeof signedUpgradeDefinitionSchema>;

export const signedEnemyDefinitionSchema = z.object({
  id: z.string(),
  enemyType: z.string(),
  baseHealth: z.number().int().min(1),
  baseSpeed: z.number().min(0),
  baseDamage: z.number().int().min(0),
  attackCooldown: z.number().min(0),
  healthScaling: z.number().min(0),
  speedScaling: z.number().min(0),
  damageScaling: z.number().min(0),
  firstAppearWave: z.number().int().min(1),
  baseCount: z.number().int().min(1),
  countScaling: z.number().min(0),
});
export type SignedEnemyDefinition = z.infer<typeof signedEnemyDefinitionSchema>;

// ============================================
// Character Asset Config
// ============================================
export const spriteDirections = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
export const spriteDirectionSchema = z.enum(spriteDirections);
export type SpriteDirection = z.infer<typeof spriteDirectionSchema>;

export const characterAnimationStates = ["idle", "moving", "throw", "punch"] as const;
export const characterAnimationStateSchema = z.enum(characterAnimationStates);
export type CharacterAnimationState = z.infer<typeof characterAnimationStateSchema>;

export const characterAnimationSchema = z.object({
  name: z.string(),
  state: characterAnimationStateSchema,
  frames: z.record(spriteDirectionSchema, z.array(z.string())),
  frameDurationMs: z.number().int().min(1).default(100),
  loop: z.boolean().default(true),
});
export type CharacterAnimation = z.infer<typeof characterAnimationSchema>;

export const characterAssetConfigSchema = z.object({
  rotations: z.record(spriteDirectionSchema, z.string()),
  animations: z.array(characterAnimationSchema),
});
export type CharacterAssetConfig = z.infer<typeof characterAssetConfigSchema>;

// ============================================
// Character Definition
// ============================================
export const insertTowerDefenseCharacterSchema = createInsertSchema(
  towerDefenseCharacter,
  {
    name: z.string().min(1).max(191),
    isPlayer: z.boolean(),
    baseHealth: z.number().int().min(1),
    baseSpeed: z.number().min(0.01),
    baseDamage: z.number().int().min(0),
    attackCooldown: z.number().min(0.1),
    healthScaling: z.number().min(0),
    speedScaling: z.number().min(0),
    damageScaling: z.number().min(0),
    firstAppearWave: z.number().int().min(1),
    baseCount: z.number().int().min(1),
    countScaling: z.number().min(0),
    scaleFactor: z.number().min(0.1),
    assetConfig: characterAssetConfigSchema.nullable(),
  },
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTowerDefenseCharacter = z.infer<
  typeof insertTowerDefenseCharacterSchema
>;
