/**
 * Tower Defense Cryptographic Utilities
 *
 * This module provides HMAC-based signing for Tower Defense session data.
 * This prevents cheating by ensuring that game parameters, upgrade definitions,
 * and enemy definitions are calculated server-side and cannot be tampered with.
 *
 * Flow:
 * 1. Client calls tRPC `initiateSecureSession`
 * 2. Server fetches upgrades, enemies, and definitions from MySQL
 * 3. Server creates HMAC signature of (userId, nonce, stats, upgradeDefinitions, enemyDefinitions)
 * 4. Client passes signed params to SpacetimeDB
 * 5. SpacetimeDB stores signature and uses definitions for upgrades and enemy spawning
 * 6. When run ends, client calls tRPC `claimCompletedRun` with all session data
 * 7. Server re-calculates signature and verifies before awarding points
 */

import { createHmac, randomBytes } from "crypto";
import { env } from "@/env/server.mjs";
import type {
  SignedUpgradeDefinition,
  SignedEnemyDefinition,
} from "@/validators/towerDefense";

// Secret key for HMAC - uses a dedicated env var or falls back to a derived key
const getSecretKey = (): string => {
  // Use dedicated tower defense secret if available
  if (env.TOWER_DEFENSE_HMAC_SECRET) {
    return env.TOWER_DEFENSE_HMAC_SECRET;
  }

  // In production, TOWER_DEFENSE_HMAC_SECRET is REQUIRED
  if (env.NODE_ENV === "production") {
    const errorMsg =
      "TOWER_DEFENSE_HMAC_SECRET is missing in production environment. " +
      "A dedicated TOWER_DEFENSE_HMAC_SECRET must be configured in production for secure session signing.";
    console.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Fall back to deriving from CAPTCHA_SALT or a constant (non-production only)
  const baseSecret = env.CAPTCHA_SALT ?? "tower-defense-default-secret";
  return createHmac("sha256", baseSecret)
    .update("tower-defense-hmac-key-v1")
    .digest("hex");
};

/**
 * Session parameters that need to be signed
 */
export interface SessionParams {
  userId: string;
  nonce: string;
  abilityDamage: number;
  abilityRange: number;
  abilityCooldownMs: number;
  abilityCritChance: number;
  abilityDamagePerTile: number;
  playerMaxHealth: number;
  healthRegen: number;
  defensePercent: number;
  defenseFlat: number;
  lifestealPercent: number;
  knockbackChance: number;
  knockbackForce: number;
  tokensPerWave: number;
  tokensPerKill: number;
  interestPerWave: number;
  skipEnemyChance: number;
  scorePerKill: number;
  scoreToPointsRatio: number;
  initialGridSize: number;
  maxGridSize: number;
  gridExpandFreq: number;
  rangeVisualFactor: number;
  // Definitions from database - included to prevent tampering
  upgradeDefinitions: SignedUpgradeDefinition[];
  enemyDefinitions: SignedEnemyDefinition[];
}

/**
 * Create a canonical string for an upgrade definition.
 * Order is critical for consistent hashing.
 */
const canonicalizeUpgrade = (upgrade: SignedUpgradeDefinition): string => {
  return [
    upgrade.id,
    upgrade.maxLevel.toString(),
    upgrade.baseCost.toString(),
    upgrade.costMultiplier.toFixed(6),
    upgrade.effectValue.toFixed(6),
    upgrade.upgradeType,
  ].join(":");
};

/**
 * Create a canonical string for an enemy definition.
 * Order is critical for consistent hashing.
 */
const canonicalizeEnemy = (enemy: SignedEnemyDefinition): string => {
  return [
    enemy.id,
    enemy.enemyType,
    enemy.baseHealth.toString(),
    enemy.baseSpeed.toFixed(6),
    enemy.baseDamage.toString(),
    enemy.attackCooldown.toFixed(6),
    enemy.healthScaling.toFixed(6),
    enemy.speedScaling.toFixed(6),
    enemy.damageScaling.toFixed(6),
    enemy.firstAppearWave.toString(),
    enemy.baseCount.toString(),
    enemy.countScaling.toFixed(6),
  ].join(":");
};

/**
 * Create a canonical string representation of session params for signing.
 * Order is critical - must match exactly on verification.
 * Includes upgrade and enemy definitions sorted by ID for consistent hashing.
 */
const canonicalizeSessionParams = (params: SessionParams): string => {
  // Sort upgrades and enemies by ID for consistent ordering
  const sortedUpgrades = [...params.upgradeDefinitions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const upgradesHash = sortedUpgrades.map(canonicalizeUpgrade).join(";");

  const sortedEnemies = [...params.enemyDefinitions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const enemiesHash = sortedEnemies.map(canonicalizeEnemy).join(";");

  // Use fixed precision for floating point values to avoid floating point issues
  return [
    params.userId,
    params.nonce,
    params.abilityDamage.toString(),
    params.abilityRange.toString(),
    params.abilityCooldownMs.toString(),
    params.abilityCritChance.toFixed(6),
    params.abilityDamagePerTile.toFixed(6),
    params.playerMaxHealth.toString(),
    params.healthRegen.toFixed(6),
    params.defensePercent.toFixed(6),
    params.defenseFlat.toFixed(6),
    params.lifestealPercent.toFixed(6),
    params.knockbackChance.toFixed(6),
    params.knockbackForce.toFixed(6),
    params.tokensPerWave.toFixed(6),
    params.tokensPerKill.toFixed(6),
    params.interestPerWave.toFixed(6),
    params.skipEnemyChance.toFixed(6),
    params.scorePerKill.toString(),
    params.scoreToPointsRatio.toString(),
    params.initialGridSize.toString(),
    params.maxGridSize.toString(),
    params.gridExpandFreq.toString(),
    params.rangeVisualFactor.toFixed(6),
    upgradesHash, // Include upgrade definitions in the signature
    enemiesHash, // Include enemy definitions in the signature
  ].join("|");
};

/**
 * Generate HMAC signature for session parameters.
 * Call this server-side when initiating a new session.
 */
export const signSessionParams = (params: SessionParams): string => {
  const canonical = canonicalizeSessionParams(params);
  return createHmac("sha256", getSecretKey()).update(canonical).digest("hex");
};

/**
 * Generate a unique nonce for a session.
 * Includes timestamp and a cryptographically secure random component for uniqueness.
 */
export const generateSessionNonce = (): string => {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `${timestamp}-${random}`;
};
