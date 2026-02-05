export const COMBAT_BORDER_LEFT = 2;
export const COMBAT_BORDER_RIGHT = 2;
export const COMBAT_BORDER_TOP = 2;
export const COMBAT_BORDER_BOTTOM = 0;
export const COMBAT_SECONDS = 60;
export const COMBAT_LOBBY_SECONDS = 15;

export const SPAR_EXPIRY_SECONDS = 120;

export const ATK_SCALING = 0.5;
export const DEF_SCALING = 0.5;
export const EXP_SCALING = 0.5;
export const DMG_SCALING = 0.12;
export const GEN_SCALING = 0.5;
export const STATS_SCALING = 2;
export const POWER_SCALING = 0.05;
export const DMG_BASE = 30;

/**
 * Default damage configuration
 */
export const dmgConfig = {
  atk_scaling: ATK_SCALING,
  def_scaling: DEF_SCALING,
  exp_scaling: EXP_SCALING,
  dmg_scaling: DMG_SCALING,
  gen_scaling: GEN_SCALING,
  stats_scaling: STATS_SCALING,
  power_scaling: POWER_SCALING,
  dmg_base: DMG_BASE,
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
 * Damage modifier effect types that require staged processing
 */
export const damageModifierTypes: string[] = [
  "decreasedamagetaken",
  "decreasedamagegiven",
  "increasedamagetaken",
  "increasedamagegiven",
];
