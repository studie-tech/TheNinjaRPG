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
import { IncreaseDamageGivenTag } from "@/validators/combat";

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
export const COMBAT_LOBBY_SECONDS = 15;

export const SPAR_EXPIRY_SECONDS = 120;

/**
 * Max fraction of a hit's pre-shield damage that vamp + lifesteal can together
 * return to the attacker as HP. Shared budget: vamp fills first, lifesteal takes
 * the remainder.
 */
export const DAMAGE_LEECH_CAP_RATIO = 0.6;

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
  "wound",
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
