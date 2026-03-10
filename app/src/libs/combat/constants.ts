import {
  DMG_ADVANTAGE_MAX,
  DMG_ADVANTAGE_MIN,
  DMG_AMPLITUDE,
  DMG_BASE_HITS,
  DMG_CURVE,
  DMG_EP_NORMALIZATION,
  DMG_GEN_WEIGHT,
  DMG_STATS_SCALING,
} from "@/drizzle/constants";

export const COMBAT_BORDER_LEFT = 2;
export const COMBAT_BORDER_RIGHT = 2;
export const COMBAT_BORDER_TOP = 2;
export const COMBAT_BORDER_BOTTOM = 0;
export const COMBAT_SECONDS = 60;
export const COMBAT_LOBBY_SECONDS = 15;

export const SPAR_EXPIRY_SECONDS = 120;

/**
 * Default damage configuration
 */
export const dmgConfig = {
  stats_scaling: DMG_STATS_SCALING,
  base_hits: DMG_BASE_HITS,
  curve: DMG_CURVE,
  amplitude: DMG_AMPLITUDE,
  ep_normalization: DMG_EP_NORMALIZATION,
  gen_weight: DMG_GEN_WEIGHT,
  advantage_min: DMG_ADVANTAGE_MIN,
  advantage_max: DMG_ADVANTAGE_MAX,
};
export type DmgConfig = typeof dmgConfig;

/**
 * Which user state is public (using ID references - full data is in extraState)
 */
export const publicState = [
  "actionPoints",
  "anbuId",
  "avatar",
  "basicActions",
  "bloodlineId",
  "clanId",
  "controllerId",
  "curChakra",
  "curHealth",
  "curStamina",
  "direction",
  "fledBattle",
  "gender",
  "iAmHere",
  "initiative",
  "isAi",
  "isSummon",
  "isOriginal",
  "items",
  "jutsus",
  "keystoneName",
  "keystoneItemId",
  "latitude",
  "leftBattle",
  "level",
  "location",
  "longitude",
  "maxChakra",
  "maxHealth",
  "maxStamina",
  "medicalExperience",
  "rank",
  "relationIds",
  "round",
  "regeneration",
  "sector",
  "updatedAt",
  "userId",
  "username",
  "villageId",
  "warIds",
] as const;

/**
 * Which user state is private
 */
export const privateState = [
  "bukijutsuDefence",
  "bukijutsuOffence",
  "genjutsuDefence",
  "genjutsuOffence",
  "highestDefence",
  "highestGenerals",
  "highestOffence",
  "intelligence",
  "ninjutsuDefence",
  "ninjutsuOffence",
  "speed",
  "strength",
  "taijutsuDefence",
  "taijutsuOffence",
  "updatedAt",
  "willpower",
] as const;

export const allState = [...publicState, ...privateState] as const;

export const StatNames = [
  "bukijutsuDefence",
  "bukijutsuOffence",
  "genjutsuDefence",
  "genjutsuOffence",
  "ninjutsuDefence",
  "ninjutsuOffence",
  "taijutsuDefence",
  "taijutsuOffence",
] as const;

export const GenNames = ["strength", "intelligence", "willpower", "speed"] as const;
export type GenName = (typeof GenNames)[number];

/**
 * Damage boost effect types (increases)
 * These should be applied BEFORE damage reductions
 */
export const damageBoostTypes: string[] = [
  "increasedamagetaken",
  "increasedamagegiven",
];

/**
 * Damage reduction effect types (decreases)
 * These should be applied AFTER all damage boosts
 */
export const damageReductionTypes: string[] = [
  "decreasedamagetaken",
  "decreasedamagegiven",
];

/**
 * Damage modifier effect types that require staged processing
 */
export const damageModifierTypes: string[] = [
  ...damageReductionTypes,
  ...damageBoostTypes,
];

/**
 * Post-pierce tags that must run AFTER pierce effects (per sortEffects ordering).
 * These tags read damage consequences that pierce creates, so they must run after pierce.
 * This constant is shared between process.ts and util.ts (sortEffects) to ensure consistency.
 */
export const POST_PIERCE_TAGS: string[] = [
  "lifesteal",
  "drain",
  "poison",
  "afterburn",
  "absorb",
  "recoil",
  "reflect",
  "wound",
  "decreaseheal",
  "increaseheal",
];
