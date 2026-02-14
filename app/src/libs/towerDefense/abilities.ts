/**
 * Tower Defense Abilities
 *
 * This file contains ONLY the functions needed to calculate initial stats
 * from permanent upgrades before creating a SpacetimeDB session.
 * All runtime game logic is handled by SpacetimeDB.
 */

import {
  TD_ABILITY_IDS,
  TD_BASE_CRIT_CHANCE,
  TD_BASE_DAMAGE_PER_TILE,
  TD_PLAYER_BASE_HEALTH,
  TD_SCORE_PER_KILL,
  TD_SHURIKEN_BASE_COOLDOWN,
  TD_SHURIKEN_BASE_DAMAGE,
  TD_SHURIKEN_BASE_RANGE,
} from "@/drizzle/constants";
import type { TowerDefenseUpgrade, UserTowerDefenseUpgrade } from "@/drizzle/schema";
import type { PlayerBonuses, TowerDefenseAbility } from "@/validators/towerDefense";

/**
 * Get the base shuriken ability definition.
 */
export const getShurikenAbility = (): TowerDefenseAbility => ({
  id: TD_ABILITY_IDS.SHURIKEN,
  name: "Shuriken Throw",
  damage: TD_SHURIKEN_BASE_DAMAGE,
  range: TD_SHURIKEN_BASE_RANGE,
  cooldownMs: TD_SHURIKEN_BASE_COOLDOWN,
  critChance: TD_BASE_CRIT_CHANCE,
  damagePerTile: TD_BASE_DAMAGE_PER_TILE,
  lastUsedAt: undefined,
});

/**
 * Calculate modified ability stats based on permanent upgrades.
 * Used to send initial stats to SpacetimeDB when creating a session.
 */
export const applyUpgradesToAbility = (
  ability: TowerDefenseAbility,
  userUpgrades: readonly UserTowerDefenseUpgrade[],
  upgradeDefinitions: readonly TowerDefenseUpgrade[],
): TowerDefenseAbility => {
  let modifiedDamage = ability.damage;
  let modifiedRange = ability.range;
  let modifiedCooldown = ability.cooldownMs;
  let modifiedCritChance = ability.critChance;
  let modifiedDamagePerTile = ability.damagePerTile;

  for (const userUpgrade of userUpgrades) {
    const definition = upgradeDefinitions.find((d) => d.id === userUpgrade.upgradeId);
    if (!definition) continue;

    const totalEffect = definition.effectValue * userUpgrade.level;

    switch (definition.upgradeType) {
      case "DAMAGE":
        modifiedDamage = Math.floor(modifiedDamage * (1 + totalEffect));
        break;
      case "ATTACK_SPEED":
        modifiedCooldown = Math.floor(modifiedCooldown * (1 - totalEffect * 0.5));
        break;
      case "RANGE":
        modifiedRange = Math.floor(modifiedRange + totalEffect);
        break;
      case "CRIT_CHANCE":
        modifiedCritChance = Math.min(1, modifiedCritChance + totalEffect);
        break;
      case "DAMAGE_PER_TILE":
        modifiedDamagePerTile = modifiedDamagePerTile + totalEffect;
        break;
    }
  }

  return {
    ...ability,
    damage: modifiedDamage,
    range: Math.max(1, modifiedRange),
    cooldownMs: Math.max(100, modifiedCooldown),
    critChance: modifiedCritChance,
    damagePerTile: modifiedDamagePerTile,
  };
};

/**
 * Apply HEALTH upgrades to get the modified player max health.
 * Used to send initial health to SpacetimeDB when creating a session.
 */
export const getModifiedPlayerHealth = (
  userUpgrades: readonly UserTowerDefenseUpgrade[],
  upgradeDefinitions: readonly TowerDefenseUpgrade[],
): number => {
  let modifiedHealth = TD_PLAYER_BASE_HEALTH;

  for (const userUpgrade of userUpgrades) {
    const definition = upgradeDefinitions.find((d) => d.id === userUpgrade.upgradeId);
    if (!definition || definition.upgradeType !== "HEALTH") continue;

    const totalEffect = definition.effectValue * userUpgrade.level;
    modifiedHealth = Math.floor(modifiedHealth * (1 + totalEffect));
  }

  return modifiedHealth;
};

/**
 * Get default player bonuses (no upgrades).
 */
export const getDefaultPlayerBonuses = (): PlayerBonuses => ({
  healthRegen: 0,
  defensePercent: 0,
  defenseFlat: 0,
  lifestealPercent: 0,
  knockbackChance: 0,
  knockbackForce: 0,
  tokensPerWave: 0,
  tokensPerKill: TD_SCORE_PER_KILL,
  interestPerWave: 0,
  skipEnemyChance: 0,
});

/**
 * Calculate player bonuses based on permanent upgrades.
 * Used to send initial bonuses to SpacetimeDB when creating a session.
 */
export const calculatePlayerBonuses = (
  userUpgrades: readonly UserTowerDefenseUpgrade[],
  upgradeDefinitions: readonly TowerDefenseUpgrade[],
): PlayerBonuses => {
  const bonuses = getDefaultPlayerBonuses();

  for (const userUpgrade of userUpgrades) {
    const definition = upgradeDefinitions.find((d) => d.id === userUpgrade.upgradeId);
    if (!definition) continue;

    const totalEffect = definition.effectValue * userUpgrade.level;

    switch (definition.upgradeType) {
      case "HEALTH_REGEN":
        bonuses.healthRegen += totalEffect;
        break;
      case "DEFENSE_PERCENT":
        bonuses.defensePercent = Math.min(0.9, bonuses.defensePercent + totalEffect);
        break;
      case "DEFENSE_FLAT":
        bonuses.defenseFlat += totalEffect;
        break;
      case "LIFESTEAL":
        bonuses.lifestealPercent += totalEffect;
        break;
      case "KNOCKBACK_CHANCE":
        bonuses.knockbackChance = Math.min(1, bonuses.knockbackChance + totalEffect);
        break;
      case "KNOCKBACK_FORCE":
        bonuses.knockbackForce += totalEffect;
        break;
      case "TOKENS_PER_WAVE":
        bonuses.tokensPerWave += totalEffect;
        break;
      case "TOKENS_PER_KILL":
        bonuses.tokensPerKill += totalEffect;
        break;
      case "INTEREST_PER_WAVE":
        bonuses.interestPerWave += totalEffect;
        break;
      case "SKIP_ENEMY_CHANCE":
        bonuses.skipEnemyChance = Math.min(0.5, bonuses.skipEnemyChance + totalEffect);
        break;
    }
  }

  return bonuses;
};
