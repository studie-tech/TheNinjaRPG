/**
 * Shared utilities for Tower Defense upgrade UI components
 */

import {
  ArrowLeftRight,
  ArrowUp,
  CircleDollarSign,
  Coins,
  Crosshair,
  Droplets,
  Ghost,
  Heart,
  HeartPulse,
  Shield,
  ShieldPlus,
  Sparkles,
  Sword,
  Target,
  TrendingUp,
  Wand2,
  Zap,
} from "lucide-react";
import { TowerDefenseUpgradeCategories } from "@/drizzle/constants";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";

// ============================================
// Upgrade Sort Order (simplicity-based)
// ============================================

/**
 * Sort upgrades by their simplicity within category
 */
export const sortUpgradesBySimplicity = (
  upgrades: TowerDefenseUpgrade[],
): TowerDefenseUpgrade[] => {
  const allOrder = Object.values(TowerDefenseUpgradeCategories).flat();
  return [...upgrades].sort((a, b) => {
    const orderA = allOrder.indexOf(a.upgradeType);
    const orderB = allOrder.indexOf(b.upgradeType);
    return orderA - orderB;
  });
};

/**
 * Get upgrades filtered by category and sorted by simplicity
 */
export const getUpgradesByCategory = (
  upgradeDefinitions: TowerDefenseUpgrade[],
  category: keyof typeof TowerDefenseUpgradeCategories,
): TowerDefenseUpgrade[] => {
  const categoryTypes = TowerDefenseUpgradeCategories[category];
  const filtered = upgradeDefinitions.filter((u) =>
    (categoryTypes as readonly string[]).includes(u.upgradeType),
  );
  return sortUpgradesBySimplicity(filtered);
};

// ============================================
// Icons
// ============================================

export const getUpgradeIcon = (type: string, className = "h-5 w-5") => {
  switch (type) {
    // Attack
    case "DAMAGE":
      return <Sword className={className} />;
    case "ATTACK_SPEED":
      return <Zap className={className} />;
    case "RANGE":
      return <Target className={className} />;
    case "CRIT_CHANCE":
      return <Sparkles className={className} />;
    case "DAMAGE_PER_TILE":
      return <Crosshair className={className} />;
    // Defense
    case "HEALTH":
      return <Heart className={className} />;
    case "HEALTH_REGEN":
      return <HeartPulse className={className} />;
    case "DEFENSE_PERCENT":
      return <Shield className={className} />;
    case "DEFENSE_FLAT":
      return <ShieldPlus className={className} />;
    case "LIFESTEAL":
      return <Droplets className={className} />;
    case "KNOCKBACK_CHANCE":
    case "KNOCKBACK_FORCE":
      return <ArrowLeftRight className={className} />;
    // Utility
    case "TOKENS_PER_WAVE":
      return <CircleDollarSign className={className} />;
    case "TOKENS_PER_KILL":
      return <Coins className={className} />;
    case "INTEREST_PER_WAVE":
      return <TrendingUp className={className} />;
    case "SKIP_ENEMY_CHANCE":
      return <Ghost className={className} />;
    // Abilities
    case "ABILITY_UNLOCK":
      return <Wand2 className={className} />;
    default:
      return <ArrowUp className={className} />;
  }
};

export const getCategoryIcon = (category: string, className = "h-4 w-4") => {
  switch (category) {
    case "ATTACK":
      return <Sword className={className} />;
    case "DEFENSE":
      return <Shield className={className} />;
    case "UTILITY":
      return <Coins className={className} />;
    case "ABILITIES":
      return <Wand2 className={className} />;
    default:
      return <ArrowUp className={className} />;
  }
};

// ============================================
// Colors
// ============================================

export const getUpgradeColor = (type: string): string => {
  switch (type) {
    // Attack - red/orange tones
    case "DAMAGE":
      return "text-red-500";
    case "ATTACK_SPEED":
      return "text-yellow-500";
    case "RANGE":
      return "text-blue-500";
    case "CRIT_CHANCE":
      return "text-purple-500";
    case "DAMAGE_PER_TILE":
      return "text-cyan-500";
    // Defense - green/teal tones
    case "HEALTH":
      return "text-green-500";
    case "HEALTH_REGEN":
      return "text-emerald-400";
    case "DEFENSE_PERCENT":
      return "text-teal-500";
    case "DEFENSE_FLAT":
      return "text-teal-400";
    case "LIFESTEAL":
      return "text-rose-400";
    case "KNOCKBACK_CHANCE":
    case "KNOCKBACK_FORCE":
      return "text-sky-400";
    // Utility - amber/gold tones
    case "TOKENS_PER_WAVE":
      return "text-amber-500";
    case "TOKENS_PER_KILL":
      return "text-amber-400";
    case "INTEREST_PER_WAVE":
      return "text-lime-500";
    case "SKIP_ENEMY_CHANCE":
      return "text-violet-400";
    // Abilities - pink tones
    case "ABILITY_UNLOCK":
      return "text-pink-500";
    default:
      return "text-gray-500";
  }
};

export const getUpgradeBorderColor = (type: string): string => {
  switch (type) {
    // Attack
    case "DAMAGE":
      return "border-red-500/30 hover:border-red-500/60";
    case "ATTACK_SPEED":
      return "border-yellow-500/30 hover:border-yellow-500/60";
    case "RANGE":
      return "border-blue-500/30 hover:border-blue-500/60";
    case "CRIT_CHANCE":
      return "border-purple-500/30 hover:border-purple-500/60";
    case "DAMAGE_PER_TILE":
      return "border-cyan-500/30 hover:border-cyan-500/60";
    // Defense
    case "HEALTH":
      return "border-green-500/30 hover:border-green-500/60";
    case "HEALTH_REGEN":
      return "border-emerald-400/30 hover:border-emerald-400/60";
    case "DEFENSE_PERCENT":
      return "border-teal-500/30 hover:border-teal-500/60";
    case "DEFENSE_FLAT":
      return "border-teal-400/30 hover:border-teal-400/60";
    case "LIFESTEAL":
      return "border-rose-400/30 hover:border-rose-400/60";
    case "KNOCKBACK_CHANCE":
    case "KNOCKBACK_FORCE":
      return "border-sky-400/30 hover:border-sky-400/60";
    // Utility
    case "TOKENS_PER_WAVE":
      return "border-amber-500/30 hover:border-amber-500/60";
    case "TOKENS_PER_KILL":
      return "border-amber-400/30 hover:border-amber-400/60";
    case "INTEREST_PER_WAVE":
      return "border-lime-500/30 hover:border-lime-500/60";
    case "SKIP_ENEMY_CHANCE":
      return "border-violet-400/30 hover:border-violet-400/60";
    default:
      return "border-gray-500/30 hover:border-gray-500/60";
  }
};

// ============================================
// Labels
// ============================================

export const getCategoryLabel = (category: string): string => {
  switch (category) {
    case "ATTACK":
      return "Attack";
    case "DEFENSE":
      return "Defense";
    case "UTILITY":
      return "Utility";
    case "ABILITIES":
      return "Abilities";
    default:
      return category;
  }
};

// ============================================
// Effect Display
// ============================================

/**
 * Check if upgrade type uses percentage display
 */
const isPercentageUpgrade = (upgradeType: string): boolean => {
  return [
    "DAMAGE",
    "ATTACK_SPEED",
    "HEALTH",
    "HEALTH_REGEN",
    "DEFENSE_PERCENT",
    "LIFESTEAL",
    "KNOCKBACK_CHANCE",
    "SKIP_ENEMY_CHANCE",
    "CRIT_CHANCE",
    "INTEREST_PER_WAVE",
  ].includes(upgradeType);
};

/**
 * Get effect display string based on upgrade type
 */
export const getEffectDisplay = (
  upgrade: TowerDefenseUpgrade,
  level: number,
): string => {
  const totalEffect = upgrade.effectValue * level;

  if (isPercentageUpgrade(upgrade.upgradeType)) {
    return `+${(totalEffect * 100).toFixed(0)}%`;
  }
  // Flat value upgrades - show decimal only if needed
  return totalEffect % 1 === 0 ? `+${totalEffect}` : `+${totalEffect.toFixed(1)}`;
};

/**
 * Get effect per level display string
 */
export const getEffectPerLevelDisplay = (upgrade: TowerDefenseUpgrade): string => {
  if (isPercentageUpgrade(upgrade.upgradeType)) {
    return `+${(upgrade.effectValue * 100).toFixed(0)}%`;
  }
  // Flat value upgrades
  return upgrade.effectValue % 1 === 0
    ? `+${upgrade.effectValue}`
    : `+${upgrade.effectValue.toFixed(1)}`;
};
