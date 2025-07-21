export const COMBAT_WIDTH = 13;
export const COMBAT_HEIGHT = 5;
export const COMBAT_SECONDS = 60;
export const COMBAT_LOBBY_SECONDS = 10;

export const SPAR_EXPIRY_SECONDS = 120;

export const ATK_SCALING = 0.5;
export const DEF_SCALING = 0.5;
export const EXP_SCALING = 0.5;
export const DMG_SCALING = 0.12;
export const GEN_SCALING = 0.5;
export const STATS_SCALING = 1.2;
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
 * Which user state is public
 */
export const publicState = [
  "actionPoints",
  "avatar",
  "basicActions",
  "bloodline",
  "clan",
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
  "keystoneName",
  "keystoneItem",
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
  "round",
  "regeneration",
  "sector",
  "updatedAt",
  "userId",
  "username",
  "village",
  "villageId",
] as const;

/**
 * Which user state is private
 */
export const privateState = [
  "bloodline",
  "bukijutsuDefence",
  "bukijutsuOffence",
  "genjutsuDefence",
  "genjutsuOffence",
  "highestDefence",
  "highestGenerals",
  "highestOffence",
  "intelligence",
  "items",
  "jutsus",
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
