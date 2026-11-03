import type { CharacterAssetConfig } from "@/validators/towerDefense";

/** Scale used until a character's database config, and its own scale, is registered. */
const DEFAULT_SCALE_FACTOR = 2.8;

type CharacterAssets = { config?: CharacterAssetConfig; scaleFactor: number };

const enemyAssetConfigCache = new Map<
  string,
  { config: CharacterAssetConfig; scaleFactor: number }
>();

/**
 * Cache for the current player's asset configuration and scale.
 * Set when a game session starts with a selected player character.
 */
let playerAssetConfigCache: {
  config: CharacterAssetConfig;
  scaleFactor: number;
} | null = null;

/**
 * Register an enemy asset config from the database.
 * Called when enemy definitions are loaded.
 */
export const registerEnemyAssetConfig = (
  enemyType: string,
  config: CharacterAssetConfig,
  scaleFactor: number,
): void => {
  enemyAssetConfigCache.set(enemyType, { config, scaleFactor });
};

/**
 * Clear all cached enemy asset configs.
 */
export const clearEnemyAssetConfigCache = (): void => {
  enemyAssetConfigCache.clear();
};

/**
 * Register the player's asset configuration.
 * Called when a game session starts with a selected player character.
 */
export const registerPlayerAssetConfig = (
  config: CharacterAssetConfig,
  scaleFactor: number,
): void => {
  playerAssetConfigCache = { config, scaleFactor };
};

/**
 * Clear the player asset config cache.
 */
export const clearPlayerAssetConfigCache = (): void => {
  playerAssetConfigCache = null;
};

/** The current player's asset config; absent until one is registered. */
export const getPlayerAssetConfig = (): CharacterAssets =>
  playerAssetConfigCache ?? { scaleFactor: DEFAULT_SCALE_FACTOR };

/** The asset config for an enemy type; absent until its database config is registered. */
export const getEnemyAssetConfig = (enemyType: string): CharacterAssets =>
  enemyAssetConfigCache.get(enemyType) ?? { scaleFactor: DEFAULT_SCALE_FACTOR };
