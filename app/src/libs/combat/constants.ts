import {
  DMG_ADVANTAGE_MAX,
  DMG_ADVANTAGE_MIN,
  DMG_AMPLITUDE,
  DMG_BASE_HITS,
  DMG_CURVE,
  DMG_EP_NORMALIZATION,
  DMG_GEN_WEIGHT,
  DMG_STATS_SCALING,
  ElementNames,
  RANKED_BLOODLINE_EFFECT_MULT,
} from "@/drizzle/constants";
import type { ActionEffect } from "@/libs/combat/types";
import { IncreaseDamageGivenTag } from "@/validators/combat";

/** Consequence fields that take health from their target, in application order. */
export const HP_DAMAGE_KEYS = [
  "damage",
  "residual",
  "wound",
  "afterburn",
  "drain_hp",
  "poison",
] as const;

/** Text color of each applied-effect color, for battle logs and the timeline. */
export const EFFECT_TEXT_COLORS: Record<ActionEffect["color"], string> = {
  red: "text-red-500",
  green: "text-green-500",
  blue: "text-blue-500",
  yellow: "text-yellow-500",
  purple: "text-purple-500",
  orange: "text-orange-500",
  pink: "text-pink-500",
  gray: "text-gray-500",
};

/**
 * Phrases in the item durability notices a battle result carries. The battle screen
 * titles its notification toasts by them, so the notices and the titles share these.
 */
export const ITEM_BROKEN_NOTICE = "has broken";
export const ITEM_DURABILITY_CRITICAL_NOTICE = "durability is critically low";
export const ITEM_DURABILITY_NOTICE = "durability is now";

/** Ranked bloodlines boost every damage element, including attacks outside Highest. */
export const RANKED_BLOODLINE_DAMAGE_TAG = IncreaseDamageGivenTag.parse({
  power: (RANKED_BLOODLINE_EFFECT_MULT - 1) * 100,
  target: "SELF",
  description: "Ranked bloodline simulation",
  elements: [...ElementNames],
});

export const COMBAT_BORDER_LEFT = 2;
export const COMBAT_BORDER_RIGHT = 2;
export const COMBAT_BORDER_TOP = 2;
export const COMBAT_BORDER_BOTTOM = 0;
export const COMBAT_SECONDS = 60;
/** Initiative multiplier gained per level above the opponents' average level. */
export const INITIATIVE_LEVEL_BONUS = 0.03;
/** Initiative multiplier gained in the user's own village sector, and lost outside it. */
export const INITIATIVE_TERRITORY_BONUS = 0.1;
/** Initiative bonus of each consecutive PvP streak step; later steps add the last entry. */
export const INITIATIVE_PVP_STREAK_BONUSES = [
  0.02, 0.015, 0.01, 0.005, 0.0025,
] as const;
export const COMBAT_LOBBY_SECONDS = 15;

export const SPAR_EXPIRY_SECONDS = 120;

/**
 * Max fraction of a hit's pre-shield damage that vamp + lifesteal can together
 * return to the attacker as HP. Shared budget: vamp fills first, lifesteal takes
 * the remainder.
 */
export const DAMAGE_LEECH_CAP_RATIO = 0.6;

/**
 * Max fraction of a hit's pre-Diffuse damage that reflect returns to the attacker;
 * the Diffuse split and the final reflect application share it.
 */
export const REFLECT_CAP_RATIO = 0.6;

/** Max fraction of a hit's pre-shield damage that absorb converts to health. */
export const ABSORB_CAP_RATIO = 0.6;

/** Max fraction of a hit's damage that stacked afterburn conversions can reach. */
export const AFTERBURN_CAP_RATIO = 0.6;

export const BARRIER_DAMAGE_TAG_TYPES = new Set<string>(["damage", "pierce"]);

/** These tags execute from battlefield cells rather than user-effect dispatch. */
export const GROUND_EFFECT_TAG_TYPES = new Set<string>([
  "move",
  "summon",
  "clone",
  "barrier",
  "visual",
]);

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
 * Battlefield state needed to render participants and their visible status.
 */
export const publicState = [
  // Only resolved artwork and cues are public; base traits and item-instance lookups stay private.
  "spriteAppearance",
  "spriteAction",
  "actionPoints",
  "avatar",
  "avatarFacing",
  "spriteAnimations",
  "spriteAnimationEvent",
  "transformation",
  "risesAgain",
  "bloodlineId",
  "keystoneName",
  "keystoneItemId",
  "updatedAt",
  "clanId",
  "sageModeActivated",
  "sageModeActivatedRound",
  "sageModeExpiresRound",
  "sageModeUsedThisBattle",
  "controllerId",
  "curChakra",
  "curHealth",
  "curStamina",
  "direction",
  "diffuseDamage",
  "enmity",
  "fledBattle",
  "gender",
  "iAmHere",
  "initiative",
  "isAi",
  "isMasked",
  "isPiloted",
  "isAutoCombat",
  "isSummon",
  "isOriginal",
  "latitude",
  "leftBattle",
  "level",
  "longitude",
  "maxChakra",
  "maxHealth",
  "maxStamina",
  "rank",
  "round",
  "userId",
  "username",
  "villageId",
] as const;

/**
 * Which user state is private
 */
export const privateState = [
  "activeSkillIds",
  "skillLockedJutsuIds",
  "anbuId",
  "basicActions",
  "sageModeId",
  "sageMasteryExperience",
  "dailySageActivations",
  "curEnergy",
  "maxEnergy",
  "items",
  "jutsus",
  "location",
  "medicalExperience",
  "relationIds",
  "regeneration",
  "sector",

  "masteryRanks",
  "usedMasteries",
  "bloodlineMastery",
  "bukijutsuMastery",
  "defence",
  "genjutsuMastery",
  "highestGenerals",
  "preferredDamageElement",
  "intelligence",
  "itemLoadout",
  "jutsuLoadout",
  "ninjutsuMastery",
  "offence",
  "sageMastery",
  "speed",
  "strength",
  "taijutsuMastery",
  "willpower",
] as const;

export const allState = [...publicState, ...privateState] as const;

export const StatNames = ["offence", "defence"] as const;

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

/** Damage-derived tags match generals and elements, without a jutsu stat filter. */
export const damageDerivedTagTypes: string[] = [
  "afterburn",
  "lifesteal",
  "recoil",
  "absorb",
  "reflect",
  "parry",
  "wound",
];

/**
 * Tags that sortEffects orders after pierce, because they read the damage
 * consequences pierce creates.
 */
export const POST_PIERCE_TAGS: string[] = [
  "lifesteal",
  "drain",
  "poison",
  "afterburn",
  "absorb",
  "recoil",
  "reflect",
  "parry",
  "wound",
  "decreaseheal",
  "increaseheal",
];
