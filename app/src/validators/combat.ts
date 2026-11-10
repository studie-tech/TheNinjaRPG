import { z } from "zod";
import {
  AdjustableBasicActions,
  type AttackMethod,
  AttackMethods,
  type AttackTarget,
  AttackTargets,
  type BasicElement,
  BattleUsageTypes,
  BloodlineDifficultyRatings,
  CACHE_MAX_GRANTED_ITEMS,
  type CombatStatName,
  DIFFUSE_DEFAULT_DELAY_ROUNDS,
  DIFFUSE_MAX_PERCENTAGE,
  ELEMENTAL_SEAL_AP_COST,
  ElementNames,
  GeneralTypes,
  getCombatStatCap,
  getUserCaps,
  ITEM_XP_TO_LEVEL,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
  JutsuTypes,
  LetterRanks,
  MAX_ACTIVITY_REDUCTION_PERCENT,
  MAX_COOKING_OUTPUT,
  MAX_EXTRA_JUTSU_SLOTS,
  MAX_GATHERING_BONUS_QUANTITY,
  MAX_HUNTING_BONUS_QUANTITY,
  MAX_ITEM_CRAFTING_REQUIREMENT_QUANTITY,
  MAX_ITEM_STACK_SIZE,
  MAX_MEAL_DURATION_SECONDS,
  MAX_PLAYER_LEVEL,
  MasteryTypes,
  MaxPoolTypes,
  NonActionItemTypes,
  PET_MAX_CONSUME_PETS,
  PoolTypes,
  SAGE_MASTERY_EXP_CAP,
  SAGE_MODE_MAX_LEVEL,
  SHIELD_MAX_HEALTH,
  SKILL_TREE_MAX_TIER,
  SkillTreeEntryTypes,
  SkillTreePathTypes,
  SkillTreeTargets,
  StatTypes,
  TEMPORAL_AP_DELTA,
  UserRanks,
  WeaponTypes,
} from "@/drizzle/constants";
import type { Item, UserData } from "@/drizzle/schema";
import {
  CACHE_RESTRICTED_REWARD_MESSAGE,
  isRestrictedCacheReward,
  isWeightedCacheEffect,
} from "@/libs/weightedCache";
import { DateTimeRegExp } from "@/utils/regex";
import { literalType } from "@/validators/base";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import {
  type CoordinateTargeting,
  coordinateTargetingSchema,
} from "@/validators/coordinateTargeting";
import { itemEconomySchema, refineItemEconomy } from "@/validators/itemEconomy";
import {
  FURNITURE_ITEM_DEFAULTS,
  furnitureItemSchema,
} from "@/validators/itemFurniture";
import { lpcItemFields } from "@/validators/lpc";
import {
  generalRequirementFields,
  masteryRequirementFields,
} from "@/validators/mastery";
import { type MethodSize, methodSizeSchema } from "@/validators/methodSize";
import { rewardFields } from "@/validators/rewards";
import {
  maximumCacheItems,
  weightedCacheDraftSchema,
  weightedCacheSchema,
} from "@/validators/weightedCache";

/**
 * Convenience method for a string with a default value
 */
const msg = (defaultString: string) => {
  return z.string().prefault(defaultString);
};

const type = (defaultString: string) => {
  return z.literal(defaultString).prefault(defaultString);
};

/** The discriminating `type` of a tag, keeping its literal for the tag union. */
const tagType = <T extends string>(tag: T) => z.literal(tag).prefault(tag);

/**
 * Battle Descriptions use the following variables:
 * https://www.scribbr.com/nouns-and-pronouns/pronouns/
 *
 * %user - the acting user's name
 * %target - the targets' names, comma-joined
 * %user_subject - he/she
 * %target_subject - he/she
 * %user_object - him/her
 * %target_object - him/her
 * %user_posessive - his/hers
 * %target_posessive - his/hers
 * %user_reflexive - himself/herself
 * %target_reflexive - himself/herself
 * %location - the location of the action, as [row, col]
 *
 * Target pronouns take the plural forms (they/them/theirs/themselves) when several
 * users are targeted; substitution happens in actions.ts.
 */

/******************** */
/**  BASE ATTRIBUTES  */
/******************** */
const BaseTagTargets = ["INHERIT", "SELF", "COORDINATES"] as const;
const BaseAttributes = {
  // Visual controls
  staticAssetPath: z.string().prefault(""),
  staticAnimation: z.string().prefault(""),
  appearAnimation: z.string().prefault(""),
  disappearAnimation: z.string().prefault(""),
  animationScale: z.coerce.number().min(1).max(3).prefault(1),
  // SFX controls
  appearSfx: z.string().prefault(""),
  disappearSfx: z.string().prefault(""),
  // Timing controls
  rounds: z.coerce.number().int().min(0).max(100).optional(),
  timeTracker: z.record(z.string(), z.coerce.number()).optional(),
  // Power controls. Power's meaning depends on calculation:
  // static: directly equates to the amount returned
  // percentage: power is returned as a percentage
  // formula: power is used in stats-based formula to calculate return value
  power: z.coerce.number().min(-100).max(100).prefault(1),
  powerPerLevel: z.coerce.number().min(-1).max(1).prefault(0),
  // Used for indicating offensive / defensive effect
  direction: type("offence"),
  // Attack target, if different from the default
  target: z.enum(BaseTagTargets).optional().prefault("INHERIT"),
  coordinateTargeting: coordinateTargetingSchema.nullish(),
  // Enable / disables applying to friendlies. Default is to apply to all users
  friendlyFire: z.enum(["ALL", "FRIENDLY", "ENEMIES"]).optional(),
  // Default is for calculation to be static
  calculation: z.enum(["static"]).prefault("static"),
};

const PowerAttributes = {
  power: z.coerce.number().min(0).prefault(1),
  powerPerLevel: z.coerce.number().min(0).max(1).prefault(0),
};

/** A tag with only the base and power controls. */
const simpleTag = <T extends string>(tag: T, description: string) =>
  z.object({
    ...BaseAttributes,
    ...PowerAttributes,
    type: tagType(tag),
    description: msg(description),
  });

/** Percentage-first adjustment; the editor offers static and percentage. */
const PercentageCalculation = {
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
};

/** Activity passives use self-only amounts, without combat duration or level scaling. */
const ActivityBonusAttributes = {
  ...BaseAttributes,
  power: z.coerce.number().min(0).max(MAX_ACTIVITY_REDUCTION_PERCENT).prefault(1),
  powerPerLevel: z.literal(0).prefault(0),
  calculation: z.literal("percentage").prefault("percentage"),
  target: z.literal("SELF").prefault("SELF"),
  friendlyFire: z.literal("FRIENDLY").optional(),
  rounds: BaseAttributes.rounds.refine(
    (value): boolean => value === undefined,
    "Activity bonuses have no combat duration",
  ),
  timeTracker: BaseAttributes.timeTracker.refine(
    (value): boolean => value === undefined,
    "Activity bonuses have no combat timer",
  ),
};

export const DecreaseGatheringTime = z.object({
  ...ActivityBonusAttributes,
  type: tagType("decreasegatheringtime"),
  description: msg(
    `Reduce each gathering quest collection duration by power percent, with a one-second minimum. Eligible bloodline, activated skill and usable worn gear bonuses stack up to ${MAX_ACTIVITY_REDUCTION_PERCENT}%; captured when collection begins.`,
  ),
});
export const DecreaseFarmingTime = z.object({
  ...ActivityBonusAttributes,
  type: tagType("decreasefarmingtime"),
  description: msg(
    `Reduce each planted crop duration by power percent, with a one-second minimum. Eligible bloodline, activated skill and usable worn gear bonuses stack up to ${MAX_ACTIVITY_REDUCTION_PERCENT}%; captured when planting.`,
  ),
});
export const DecreaseCraftingTime = z.object({
  ...ActivityBonusAttributes,
  type: tagType("decreasecraftingtime"),
  description: msg(
    `Reduce duration by power percent (minimum one second) once per non-meal crafting job, excluding imbuing. Eligible bloodline, activated skill and usable worn gear bonuses stack up to ${MAX_ACTIVITY_REDUCTION_PERCENT}%; captured when submitted.`,
  ),
});
export const DecreaseCookingTime = z.object({
  ...ActivityBonusAttributes,
  type: tagType("decreasecookingtime"),
  description: msg(
    `Reduce duration by power percent (minimum one second) once per complete meal cooking job. Eligible bloodline, activated skill and usable worn gear bonuses stack up to ${MAX_ACTIVITY_REDUCTION_PERCENT}%; captured when submitted.`,
  ),
});
export const IncreaseHuntingYield = z.object({
  ...ActivityBonusAttributes,
  calculation: z.literal("static").prefault("static"),
  power: z.coerce.number().int().min(0).max(MAX_HUNTING_BONUS_QUANTITY).prefault(1),
  type: tagType("increasehuntingyield"),
  description: msg(
    `Add units to each successfully dropped hunting material. Eligible bloodline, activated skill and usable worn gear bonuses stack up to +${MAX_HUNTING_BONUS_QUANTITY}; captured when battle begins. Drop chances are unchanged.`,
  ),
});

export const IncreaseGatheringYield = z.object({
  ...ActivityBonusAttributes,
  calculation: z.literal("static").prefault("static"),
  power: z.coerce.number().int().min(0).max(MAX_GATHERING_BONUS_QUANTITY).prefault(1),
  type: tagType("increasegatheringyield"),
  description: msg(
    `Add units to each successfully dropped gathering material. Eligible bloodline, activated skill and usable worn gear bonuses stack up to +${MAX_GATHERING_BONUS_QUANTITY}; captured when collection begins. Drop chances are unchanged.`,
  ),
});

/** Out-of-combat passives supported by the shared activity-source aggregator. */
export const activityBonusTypes = [
  "decreasegatheringtime",
  "decreasefarmingtime",
  "decreasecraftingtime",
  "decreasecookingtime",
  "increasehuntingyield",
  "increasegatheringyield",
] as const;
/** Keep power units identical in the content editor and player-facing effect details. */
export const activityBonusPowerLabel = (tag: { type: string }) =>
  tag.type === "increasehuntingyield" || tag.type === "increasegatheringyield"
    ? "Additional quantity per dropped material"
    : "Reduction (%)";
/** Identify activity-only tags for authoring restrictions and removal from combat snapshots. */
export const isActivityBonus = (tag: { type: string }) =>
  (activityBonusTypes as readonly string[]).includes(tag.type);

/** Only bloodlines, activated skills, worn gear and its imbuements support these bonuses. */
export const rejectActivityBonuses = (
  effects: { type: string }[],
  ctx: z.RefinementCtx,
) => {
  effects.forEach((effect, index) => {
    if (isActivityBonus(effect))
      ctx.addIssue({
        code: "custom",
        path: [index, "type"],
        message:
          "Activity bonuses require a bloodline, activated skill, worn gear or imbuement.",
      });
  });
};

const PoolAttributes = {
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health"]).optional(),
};

const IncludeGeneralsAndElements = {
  generalTypes: z.array(z.enum(GeneralTypes)).optional(),
  elements: z.array(z.enum(ElementNames)).optional(),
};

/** Stat selection where "Highest" is stored as None and resolved at runtime. */
const statTypesField = z.array(
  z
    .enum([...StatTypes, "Highest"])
    .transform((value) => (value === "Highest" ? "None" : value)),
);

const IncludeStats = {
  statTypes: statTypesField.optional(),
  ...IncludeGeneralsAndElements,
};

/******************** */
/*******  TAGS  *******/
/******************** */

// Prevent-type effect tags that can be blocked by ImmunityTag (content-selectable)
export const PreventTagTypes = [
  "buffprevent",
  "clearprevent",
  "cleanseprevent",
  "debuffprevent",
  "disarm",
  "fleeprevent",
  "healprevent",
  "moveprevent",
  "onehitkillprevent",
  "robprevent",
  "sealprevent",
  "stunprevent",
  "summonprevent",
] as const;

export type PreventTagType = (typeof PreventTagTypes)[number];

export const PotencyTagTypes = [
  "damage",
  "increasedamagegiven",
  "decreasedamagegiven",
  "increasedamagetaken",
  "decreasedamagetaken",
  "afterburn",
  "lifesteal",
  "reflect",
  "parry",
  "curse",
  "increaseheal",
  "heal",
  "vamp",
  "absorb",
  "consume",
  "siphon",
  "shield",
  "pierce",
  "drain",
  "poison",
] as const;

const PotencyAttributes = {
  ...BaseAttributes,
  ...PowerAttributes,
  affectedTag: z.enum(["none", "all", ...PotencyTagTypes]).prefault("all"),
  affectedElements: z.array(z.enum(ElementNames)).prefault([]),
  calculation: z.enum(["static", "percentage"]).prefault("static"),
  rounds: z.coerce.number().int().min(1).max(100).prefault(3),
};

export const IncreasePotencyTag = z.object({
  ...PotencyAttributes,
  type: tagType("increasepotency"),
  target: z.enum(BaseTagTargets).prefault("SELF"),
  description: msg("Increase the power of selected tags on subsequent jutsu"),
});

export const DecreasePotencyTag = z.object({
  ...PotencyAttributes,
  type: tagType("decreasepotency"),
  description: msg(
    "Decrease the power of selected tags on the target's subsequent jutsu",
  ),
});

export type PotencyTag = z.infer<typeof IncreasePotencyTag | typeof DecreasePotencyTag>;

export const AbsorbTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("absorb"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  direction: type("defence"),
  description: msg("Absorb damage taken & convert to health, chakra or stamina"),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health"]),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
});

const DamageModifierAttributes = {
  ...BaseAttributes,
  ...PowerAttributes,
  ...PercentageCalculation,
  elements: z.array(z.enum(ElementNames)).optional(),
};

export const IncreaseDamageGivenTag = z.object({
  ...DamageModifierAttributes,
  type: tagType("increasedamagegiven"),
  description: msg("Increase damage given by target"),
});

export const DecreaseDamageGivenTag = z.object({
  ...DamageModifierAttributes,
  type: tagType("decreasedamagegiven"),
  description: msg("Decrease damage given by target"),
});

export const IncreaseDamageTakenTag = z.object({
  ...DamageModifierAttributes,
  type: tagType("increasedamagetaken"),
  description: msg("Increase damage taken of target"),
});

export const DecreaseDamageTakenTag = z.object({
  ...DamageModifierAttributes,
  type: tagType("decreasedamagetaken"),
  description: msg("Decrease damage taken of target"),
});

const AggroAttributes = {
  ...BaseAttributes,
  ...PowerAttributes,
  target: z.enum(BaseTagTargets).prefault("SELF"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
  aggroMode: z.enum(["ENMITY", "GENERATION"]).prefault("GENERATION"),
};

export const IncreaseAggroTag = z.object({
  ...AggroAttributes,
  type: tagType("increaseaggro"),
  description: msg(
    "Increase current enmity or damage-generated enmity. ENMITY applies once per round; GENERATION modifies each damage packet. Omit rounds for passive gear.",
  ),
});

export const DecreaseAggroTag = z.object({
  ...AggroAttributes,
  type: tagType("decreaseaggro"),
  description: msg(
    "Decrease current enmity or damage-generated enmity. ENMITY applies once per round; GENERATION modifies each damage packet. Omit rounds for passive gear.",
  ),
});

const HealModifierAttributes = {
  ...BaseAttributes,
  ...PowerAttributes,
  ...PercentageCalculation,
};

export const IncreaseHealGivenTag = z.object({
  ...HealModifierAttributes,
  type: tagType("increaseheal"),
  description: msg("Increase how much target can heal others"),
});

export const DecreaseHealGivenTag = z.object({
  ...HealModifierAttributes,
  type: tagType("decreaseheal"),
  description: msg("Decrease how much target can heal others"),
});

const PoolCostAttributes = {
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  ...PercentageCalculation,
  rounds: z.coerce.number().int().min(2).max(20).prefault(2),
  direction: type("defence"),
};

export const IncreasePoolCostTag = z.object({
  ...PoolCostAttributes,
  type: tagType("increasepoolcost"),
  description: msg("Increase cost of taking actions"),
});

export const DecreasePoolCostTag = z.object({
  ...PoolCostAttributes,
  type: tagType("decreasepoolcost"),
  description: msg("Decrease cost of taking actions"),
});

const MaxPoolsAttributes = {
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  calculation: z.enum(["static", "percentage"]).prefault("static"),
  poolsAffected: z.array(z.enum(MaxPoolTypes)).prefault(["Health"]),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
};

export const IncreaseMaxPoolsTag = z.object({
  ...MaxPoolsAttributes,
  type: tagType("increasemaxpools"),
  description: msg("Increase maximum and current pool values"),
});

export const DecreaseMaxPoolsTag = z.object({
  ...MaxPoolsAttributes,
  type: tagType("decreasemaxpools"),
  description: msg("Decrease maximum and current pool values"),
});

const TimeShiftAttributes = {
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  ...PercentageCalculation,
  rounds: z.coerce.number().int().min(1).max(20).prefault(1),
};

export const TimeCompressionTag = z.object({
  ...TimeShiftAttributes,
  type: tagType("timecompression"),
  description: msg(`Increases AP cost of actions by ${TEMPORAL_AP_DELTA}`),
});

export const TimeDilationTag = z.object({
  ...TimeShiftAttributes,
  type: tagType("timedilation"),
  description: msg(`Decreases AP cost of actions by ${TEMPORAL_AP_DELTA}`),
});

export const RedirectionTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: tagType("redirection"),
  description: msg(
    "Redirects the target towards or away from the user by power number of spaces",
  ),
  rounds: z.coerce.number().int().min(0).max(0).prefault(0),
  calculation: z.enum(["static"]).prefault("static"),
  direction: z.enum(["push", "pull"]).prefault("pull"),
});

/** Static adjustment of basic actions, listed after the description in the editor. */
const basicActionTag = <T extends string>(tag: T, description: string) =>
  z.object({
    ...BaseAttributes,
    ...PowerAttributes,
    type: tagType(tag),
    description: msg(description),
    calculation: z.enum(["static"]).prefault("static"),
    actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
  });

export const IncreaseRangeTag = basicActionTag(
  "increaserange",
  "Increase range of basic actions",
);

export const IncreaseCooldownTag = basicActionTag(
  "increasecooldown",
  "Increase cooldown of basic actions",
);

export const DecreaseCooldownTag = basicActionTag(
  "decreasecooldown",
  "Decrease cooldown of basic actions",
);

/** Recovery-rate bonus evaluated on the pool clock rather than as a per-round battle action. */
export const IncreaseRegenerationTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("increaseregeneration"),
  description: msg("Increase out-of-combat regeneration"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

const StatModifierAttributes = {
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  ...PercentageCalculation,
  direction: z.enum(["offence", "defence", "both"]).prefault("both"),
};

export const IncreaseStatTag = z.object({
  ...StatModifierAttributes,
  type: tagType("increasestat"),
  description: msg("Increase stats of target"),
});

export const DecreaseStatTag = z.object({
  ...StatModifierAttributes,
  type: tagType("decreasestat"),
  description: msg("Decrease stats of target"),
});

/** Mastery adjustment, listing its masteries ahead of the description in the editor. */
const masteryModifierTag = <T extends string>(tag: T, description: string) =>
  z.object({
    ...BaseAttributes,
    ...PowerAttributes,
    ...PercentageCalculation,
    type: tagType(tag),
    masteryTypes: z.array(z.enum(MasteryTypes)).prefault(["Ninjutsu"]),
    description: msg(description),
  });

export const IncreaseMasteryTag = masteryModifierTag(
  "increasemastery",
  "Increase mastery of target",
);

export const DecreaseMasteryTag = masteryModifierTag(
  "decreasemastery",
  "Decrease mastery of target",
);

export const BarrierTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("barrier"),
  curHealth: z.coerce.number().int().min(1).max(100000).prefault(100),
  maxHealth: z.coerce.number().int().min(1).max(100000).prefault(100),
  absorbPercentage: z.coerce.number().int().min(1).max(100).prefault(50),
  direction: type("defence"),
  description: msg("Creates a barrier with level corresponding to power"),
});

export type BarrierTagType = z.infer<typeof BarrierTag>;

export const BuffPreventTag = simpleTag("buffprevent", "Prevents buffing");

export const ClearTag = simpleTag(
  "clear",
  "Clears all positive effects from the target",
);

export const ClearPreventTag = simpleTag("clearprevent", "Prevents clearing");

export const CleanseTag = simpleTag(
  "cleanse",
  "Clears all negative effects from the target",
);

export const CleansePreventTag = simpleTag("cleanseprevent", "Prevents cleansing");

export const CloneTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("clone"),
  description: msg(
    "Create a temporary clone to fight alongside you for a given number of rounds.",
  ),
  rounds: z.coerce.number().int().min(2).max(100).prefault(2),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const DamageTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: tagType("damage"),
  description: msg("Deals damage to target"),
  calculation: z.enum(["formula", "static", "percentage"]).prefault("formula"),
  residualModifier: z.coerce.number().min(0).max(2).prefault(1).optional(),
  dmgModifier: z.coerce.number().min(0).max(2).prefault(1).optional(),
  allowBloodlineDamageIncrease: z.coerce.boolean().prefault(true),
  allowBloodlineDamageDecrease: z.coerce.boolean().prefault(true),
});

/** Reuse damage authoring controls; combat resolves the caster's element at runtime. */
export const ElementalDamageTag = DamageTag.omit({ elements: true }).extend({
  type: tagType("elementaldamage"),
  description: msg("Deals damage using the caster's preferred basic element"),
});

export const CopyTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("copy"),
  description: msg("Copies some positive effects from the target to the user"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
});

export const MirrorTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("mirror"),
  description: msg("Mirrors some negative effects from the user to the target"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
});

export const PierceTag = DamageTag.extend({
  type: tagType("pierce"),
  description: msg("Deals piercing damage to target"),
});

export const DebuffPreventTag = simpleTag("debuffprevent", "Prevents debuffing");

export const FleeTag = simpleTag("flee", "Flee the battle");

export const FleePreventTag = simpleTag("fleeprevent", "Prevents fleeing");

export const HealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: tagType("heal"),
  rounds: z.coerce.number().int().min(0).max(100).prefault(0),
  description: msg("Heals themselves or others"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const HealPreventTag = simpleTag("healprevent", "Prevents healing");

export const LifeStealTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("lifesteal"),
  description: msg("Heal based on damage given"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const VampTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("vamp"),
  description: msg(
    "Instantly heal yourself based on a percentage of the damage dealt by this jutsu",
  ),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const ConsumeTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("consume"),
  description: msg(
    "While active, convert a percentage of all damage you deal into stacking temporary shields on yourself. Shares conversion and shield HP caps with Siphon. Not affected by heal modifiers.",
  ),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(0).max(100).prefault(3),
  shieldRounds: z.coerce.number().int().min(1).max(100).prefault(3),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
});

export const SiphonTag = ConsumeTag.extend({
  type: tagType("siphon"),
  description: msg(
    "While active, convert a percentage of damage you take after existing shields absorb it into stacking temporary shields. New shields are granted after damage resolves. Excludes self-inflicted damage and recoil. Shares conversion and shield HP caps with Consume. Can be cleared. Not affected by heal modifiers.",
  ),
  rounds: z.coerce.number().int().min(1).max(100).prefault(3),
});

export const DisarmTag = simpleTag(
  "disarm",
  "Prevents using WEAPON items in battle and hides them",
);

export const DrainTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: tagType("drain"),
  description: msg("Drain target's pools over time"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Chakra", "Stamina", "Health"]),
});

export const PoisonTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: tagType("poison"),
  description: msg("Deal damage based on Chakra and Stamina lost"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health", "Chakra", "Stamina"]),
});

export const ShieldTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("shield"),
  description: msg("Creates a temporary HP bar that lasts for a set amount of rounds"),
  rounds: z.coerce.number().int().min(1).max(100).prefault(3),
  health: z.coerce.number().int().min(1).max(SHIELD_MAX_HEALTH).prefault(100),
});
export type ShieldTagType = z.infer<typeof ShieldTag>;

export const FinalStandTag = z.object({
  ...BaseAttributes,
  type: tagType("finalstand"),
  description: msg("User cannot be reduced below 1 HP"),
  power: z.coerce.number().min(0).max(100).prefault(100),
  powerPerLevel: z.coerce.number().min(0).max(1).prefault(0),
});

export const MoveTag = simpleTag("move", "Move on the battlefield");

export const MovePreventTag = simpleTag(
  "moveprevent",
  "Prevents movement of the target",
);

export const OneHitKillTag = simpleTag("onehitkill", "Instantly kills the target");

export const OneHitKillPreventTag = simpleTag(
  "onehitkillprevent",
  "Prevents instant kill effects",
);

export const CurseTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("curse"),
  description: msg(
    "Store half the percentage of enemy damage dealt and half of enemy damage received as healing. Increases the holder's damage by the configured Damage Bonus percentage while active. Heals once on natural expiration; removal discards stored healing. Uses actual HP damage and cannot revive. Healing increases and decreases apply at payout before the maximum-HP cap; stored healing is unchanged. While active, disables the holder's Lifesteal, Absorb, and Vamp conversions.",
  ),
  calculation: z.literal("percentage").prefault("percentage"),
  damageBonusPercent: z.coerce.number().min(0).max(1000).prefault(0),
  rounds: z.coerce.number().int().min(1).max(100).prefault(3),
});

export const ParryTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("parry"),
  description: msg(
    "Redirect a percentage of incoming direct damage to the attacker before shields and absorption. Pierce bypasses Parry. Stacks up to 100%. Returned damage cannot trigger Parry. Cannot be buff prevented. Can be cleared.",
  ),
  calculation: z.literal("percentage").prefault("percentage"),
});

export const ReflectTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("reflect"),
  description: msg("Reflect damage taken"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const WoundTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("wound"),
  description: msg("Applies wound damage over multiple turns based on damage dealt"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(20).prefault(1),
});

export const DiffuseTag = z.object({
  ...BaseAttributes,
  type: tagType("diffuse"),
  description: msg(
    "Defer a percentage of nonlethal incoming damage over subsequent turns. Damage reduction applies before deferral; shields and absorption apply to the immediate portion. Repayment survives expiry, bypasses defenses, and respects Final Stand. Cannot be cleansed, prevented, or copied.",
  ),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  power: z.coerce.number().gt(0).max(DIFFUSE_MAX_PERCENTAGE).prefault(25),
  powerPerLevel: z.coerce.number().min(0).max(1).prefault(0),
  rounds: z.coerce.number().int().min(1).max(100).prefault(3),
  delayRounds: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .prefault(DIFFUSE_DEFAULT_DELAY_ROUNDS),
});

export const RemoveBloodline = z.object({
  ...BaseAttributes,
  type: tagType("removebloodline"),
  description: msg("Remove bloodline"),
  power: z.coerce.number().int().min(0).max(100).prefault(1),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const RecoilTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("recoil"),
  description: msg("Recoil damage given back to self"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const AfterburnTag = z.object({
  ...BaseAttributes,
  ...IncludeGeneralsAndElements,
  ...PowerAttributes,
  type: tagType("afterburn"),
  description: msg("Take a percentage of incoming damage as afterburndamage"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const RobPreventTag = simpleTag("robprevent", "Prevents robbing of the target");

export const RobTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: tagType("rob"),
  description: msg("Robs money from the target"),
  robPercentage: z.coerce.number().int().min(0).max(100).prefault(1),
});

export const RollRandomBloodline = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).prefault("D"),
  description: msg("Receive a random bloodline"),
  power: z.coerce.number().min(0).max(100).prefault(1),
  type: tagType("rollbloodline"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

/** Item-only consumable: probabilistic roll of a level-1 catalog mode. */
export const RollRandomSageMode = z.object({
  ...BaseAttributes,
  description: msg("Receive a random sage mode"),
  power: z.coerce.number().min(0).max(100).prefault(1),
  type: tagType("rollsagemode"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

/** Applies `SageMode` activation costs and `effects` from battle `extraState` for the actor. */
export const ActivateSageModeTag = z.object({
  ...BaseAttributes,
  type: tagType("activatesagemode"),
  description: msg("Enter sage mode using your equipped sage mode definition"),
});

export const NonCombatConsumeRewardTag = z
  .object({
    ...BaseAttributes,
    ...rewardFields,
    reward_pets: z
      .array(z.string().min(1).max(191))
      .max(PET_MAX_CONSUME_PETS)
      .prefault([]),
    type: tagType("noncombatconsumereward"),
    description: msg("Gain various rewards from consumption outside of combat"),
    rewardMode: z.enum(["standard", "weightedCache"]).optional(),
    weightedCache: weightedCacheDraftSchema.optional(),
  })
  .superRefine((effect, ctx) => {
    if (effect.rewardMode === "weightedCache" && effect.reward_pets.length > 0)
      ctx.addIssue({
        code: "custom",
        path: ["reward_pets"],
        message: "Pet grants require standard rewards.",
      });
    if (effect.rewardMode !== "weightedCache") return;
    const result = weightedCacheSchema.safeParse(effect.weightedCache);
    if (!result.success) {
      for (const issue of result.error.issues)
        ctx.addIssue({ ...issue, path: ["weightedCache", ...issue.path] });
    }
  });

export const RepairTag = z.object({
  ...BaseAttributes,
  type: tagType("repair"),
  description: msg("Repair an item's durability by the power amount"),
});

export const SealPreventTag = simpleTag(
  "sealprevent",
  "Prevents bloodline from being sealed",
);

export const SealTag = simpleTag("seal", "Seals the target's bloodline effects");

export const StealthTag = simpleTag(
  "stealth",
  "Stealth the target, blocking all jutsu while allowing weapons and items",
);

export const ElementalSealTag = simpleTag(
  "elementalseal",
  `Seals the target's ability to use all elemental ${ELEMENTAL_SEAL_AP_COST} AP jutsu`,
);

export const StunPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("stunprevent"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  description: msg("Prevents being stunned"),
});

export const ImmunityTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("immunity"),
  description: msg("Grants immunity against the specified prevent-type effect"),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
  blocks: z.enum(PreventTagTypes).prefault("buffprevent"),
  rounds: z.coerce.number().int().min(1).max(20).prefault(2),
  calculation: z.enum(["static"]).prefault("static"),
});

export const StunTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("stun"),
  description: msg("Stuns the target"),
  apReduction: z.coerce.number().int().min(0).max(100).prefault(10),
});

export const SummonPreventTag = simpleTag("summonprevent", "Prevents summoning");

export const SummonTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: tagType("summon"),
  description: msg(
    "Summon an ally for a certain number of rounds. Its stats are scaled to same total as the summoner, modified by the power of the jutsu as a percentage.",
  ),
  rounds: z.coerce.number().int().min(2).max(100).prefault(2),
  aiId: z.string().prefault(""),
  aiHp: z.coerce.number().min(100).max(100000).prefault(100),
  // When true, a human summoner drives this creature themselves on its turn
  // (its jutsu, items, AP and targeting); default false keeps it AI-driven.
  // Plain boolean (not z.coerce.boolean): the editor Switch always writes a real
  // boolean, and coercion would turn a stray string "false" into true.
  playerControlled: z.boolean().prefault(false),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const VisualTag = z.object({
  ...BaseAttributes,
  type: tagType("visual"),
  description: msg("A battlefield visual effect"),
});

export const WeaknessTag = z.object({
  ...BaseAttributes,
  type: tagType("weakness"),
  items: z.array(z.string()).prefault([]),
  jutsus: z.array(z.string()).prefault([]),
  elements: z.array(z.enum(ElementNames)).prefault([]),
  statTypes: statTypesField.prefault([]),
  generalTypes: z.array(z.enum(GeneralTypes)).prefault([]),
  description: msg("Extra raw damage from specific things"),
  dmgModifier: z.coerce.number().min(1).max(50).prefault(1).optional(),
});
export type WeaknessTagType = z.infer<typeof WeaknessTag>;

export const UnknownTag = z.object({
  ...BaseAttributes,
  type: tagType("unknown"),
  description: msg("An unknown tag - please report & change!"),
});

export const IncreaseMarriageSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).prefault("D"),
  description: msg("Increases a users marriage slots"),
  power: z.coerce.number().int().min(0).max(100).prefault(1),
  type: tagType("marriageslotincrease"),
});

export const IncreaseReskinSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).prefault("D"),
  description: msg("Increases the number of allowed reskins"),
  power: z.coerce.number().int().min(0).max(100).prefault(1),
  type: tagType("noncombatincreasereskins"),
});

/** Permanent consumable grants share the purchase cap and never execute as combat effects. */
export const IncreaseJutsuSlots = z.object({
  ...BaseAttributes,
  type: tagType("increasejutsuslots"),
  description: msg(
    `Permanently add extra jutsu slots on consumption. Shares the ${MAX_EXTRA_JUTSU_SLOTS}-slot limit with purchased slots; the item is not consumed if the grant would exceed it.`,
  ),
  power: z.coerce.number().int().min(1).max(MAX_EXTRA_JUTSU_SLOTS).prefault(1),
  powerPerLevel: z.literal(0).prefault(0),
  calculation: z.literal("static").prefault("static"),
  target: z.literal("SELF").prefault("SELF"),
  friendlyFire: z.literal("FRIENDLY").optional(),
  rounds: BaseAttributes.rounds.refine(
    (value): boolean => value === undefined,
    "Jutsu slot grants have no combat duration",
  ),
});

/**
 * InjectJutsusTag: Grants access to selected jutsus flagged as injectableInBattle
 * - editors must restrict selection to jutsus where injectableInBattle=true
 */
export const InjectJutsusTag = z.object({
  ...BaseAttributes,
  type: tagType("injectjutsus"),
  description: msg("Temporarily adds selected jutsus to the user's action list"),
  jutsuIds: z.array(z.string()).prefault([]),
});

export const NonCombatGainSkill = z.object({
  ...BaseAttributes,
  type: tagType("noncombatgainskill"),
  description: msg("Grants access to a special skill tree entry"),
  skillId: z.string().prefault(""),
});

/**
 * Start a Special quest through item consumption. The empty ID supports new editor
 * drafts; ItemValidator rejects it before the item can be saved.
 */
export const NonCombatQuestTag = z.object({
  ...BaseAttributes,
  type: tagType("noncombatquest"),
  description: msg("Starts a Special quest when the item is consumed"),
  questId: z.string().trim().min(1, "Select a Special quest").default(""),
});

export const UnlockItemVariantTag = z.object({
  ...BaseAttributes,
  type: tagType("unlockitemvariant"),
  description: msg("Unlocks a token-locked item variant when used on an item"),
  variantId: z.string().trim().nullable().prefault(null),
});

/******************** */
/** UNIONS OF TAGS   **/
/******************** */
export const AllTags = z.union([
  IncreaseRegenerationTag.prefault({}),
  AbsorbTag.prefault({}),
  ActivateSageModeTag.prefault({}),
  AfterburnTag.prefault({}),
  BarrierTag.prefault({}),
  BuffPreventTag.prefault({}),
  CleansePreventTag.prefault({}),
  CleanseTag.prefault({}),
  ClearPreventTag.prefault({}),
  ClearTag.prefault({}),
  CloneTag.prefault({}),
  ConsumeTag.prefault({}),
  SiphonTag.prefault({}),
  CopyTag.prefault({}),
  DamageTag.prefault({}),
  DebuffPreventTag.prefault({}),
  DecreaseAggroTag.prefault({}),
  DecreaseCookingTime.prefault({}),
  DecreaseCooldownTag.prefault({}),
  DecreaseCraftingTime.prefault({}),
  DecreaseDamageGivenTag.prefault({}),
  DecreaseDamageTakenTag.prefault({}),
  DecreaseFarmingTime.prefault({}),
  DecreaseGatheringTime.prefault({}),
  DecreaseHealGivenTag.prefault({}),
  DecreasePotencyTag.prefault({}),
  DecreasePoolCostTag.prefault({}),
  DecreaseMaxPoolsTag.prefault({}),
  DecreaseMasteryTag.prefault({}),
  DecreaseStatTag.prefault({}),
  DiffuseTag.prefault({}),
  DisarmTag.prefault({}),
  DrainTag.prefault({}),
  ElementalDamageTag.prefault({}),
  ElementalSealTag.prefault({}),
  FinalStandTag.prefault({}),
  FleePreventTag.prefault({}),
  FleeTag.prefault({}),
  HealPreventTag.prefault({}),
  HealTag.prefault({}),
  IncreaseAggroTag.prefault({}),
  IncreaseCooldownTag.prefault({}),
  IncreaseDamageGivenTag.prefault({}),
  IncreaseDamageTakenTag.prefault({}),
  IncreaseGatheringYield.prefault({}),
  IncreaseHealGivenTag.prefault({}),
  IncreaseHuntingYield.prefault({}),
  IncreaseJutsuSlots.prefault({}),
  IncreasePotencyTag.prefault({}),
  IncreaseMarriageSlots.prefault({}),
  IncreaseReskinSlots.prefault({}),
  InjectJutsusTag.prefault({}),
  IncreasePoolCostTag.prefault({}),
  IncreaseMaxPoolsTag.prefault({}),
  IncreaseRangeTag.prefault({}),
  IncreaseMasteryTag.prefault({}),
  IncreaseStatTag.prefault({}),
  ImmunityTag.prefault({}),
  LifeStealTag.prefault({}),
  MirrorTag.prefault({}),
  MovePreventTag.prefault({}),
  MoveTag.prefault({}),
  NonCombatConsumeRewardTag.prefault({}),
  NonCombatGainSkill.prefault({}),
  NonCombatQuestTag.prefault({}),
  RepairTag.prefault({}),
  OneHitKillPreventTag.prefault({}),
  OneHitKillTag.prefault({}),
  PierceTag.prefault({}),
  PoisonTag.prefault({}),
  RecoilTag.prefault({}),
  RedirectionTag.prefault({}),
  ReflectTag.prefault({}),
  ParryTag.prefault({}),
  CurseTag.prefault({}),
  RemoveBloodline.prefault({}),
  RobPreventTag.prefault({}),
  RobTag.prefault({}),
  RollRandomBloodline.prefault({}),
  RollRandomSageMode.prefault({}),
  SealPreventTag.prefault({}),
  SealTag.prefault({}),
  ShieldTag.prefault({}),
  StealthTag.prefault({}),
  StunPreventTag.prefault({}),
  StunTag.prefault({}),
  SummonPreventTag.prefault({}),
  SummonTag.prefault({}),
  TimeCompressionTag.prefault({}),
  TimeDilationTag.prefault({}),
  UnlockItemVariantTag.prefault({}),
  UnknownTag.prefault({}),
  VampTag.prefault({}),
  VisualTag.prefault({}),
  WeaknessTag.prefault({}),
  WoundTag.prefault({}),
]);
export type ZodAllTags = z.infer<typeof AllTags>;
export const tagTypes = AllTags.options
  .map((o) => literalType(o.unwrap()))
  .filter((t) => t !== "unknown");
/** Persistent player effects supported at the start of an authored battle. */
export const questBuffTypes = [
  "absorb",
  "debuffprevent",
  "decreasedamagetaken",
  "decreasepoolcost",
  "heal",
  "increasedamagegiven",
  "increaseheal",
  "increasepotency",
  "increasemaxpools",
  "increasestat",
  "increasemastery",
  "increaserange",
  "decreasecooldown",
  "lifesteal",
  "onehitkillprevent",
  "reflect",
  "parry",
  "curse",
  "robprevent",
  "sealprevent",
  "shield",
  "stealth",
  "stunprevent",
  "immunity",
] as const;
/** Player debuffs whose existing handlers support authored starting effects. */
export const questDebuffTypes = [
  "afterburn",
  "buffprevent",
  "decreasedamagegiven",
  "decreaseheal",
  "decreasepotency",
  "decreasestat",
  "decreasemastery",
  "decreasemaxpools",
  "disarm",
  "drain",
  "elementalseal",
  "fleeprevent",
  "healprevent",
  "increasedamagetaken",
  "increasepoolcost",
  "increasecooldown",
  "moveprevent",
  "poison",
  "recoil",
  "seal",
  "stun",
  "summonprevent",
  "weakness",
  "wound",
] as const;

/** Validate full combat tags against the permitted list and require an opening-round duration. */
export const questStartingEffectsSchema = (types: readonly string[]) =>
  z
    .array(AllTags)
    .superRefine((effects, ctx) => {
      effects.forEach((effect, i) => {
        if (!types.includes(effect.type))
          ctx.addIssue({
            code: "custom",
            path: [i, "type"],
            message: "Select a supported starting player effect",
          });
        if (effect.rounds === undefined || effect.rounds < 1)
          ctx.addIssue({
            code: "custom",
            path: [i, "rounds"],
            message:
              "Starting effects require a duration of at least one round, including the opening round",
          });
      });
    })
    .prefault([]);

export type EffectType = (typeof tagTypes)[number];

// clearprevent, cleanseprevent and injectjutsus are deliberately unclassified, so
// clear/cleanse cannot remove their own prevention effects.
// These sets decide what clear (positive), cleanse (negative), copy (positive) and
// mirror (negative) act on. Every questBuffTypes entry is positive and every
// questDebuffTypes entry negative; no type is both.
const POSITIVE_USER_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "absorb",
  "consume",
  "siphon",
  "debuffprevent",
  "increaseaggro",
  "decreaseaggro",
  "decreasedamagetaken",
  "decreasepoolcost",
  "heal",
  "increasedamagegiven",
  "increaseheal",
  "increasepotency",
  "increasemaxpools",
  "increasestat",
  "increasemastery",
  "increaserange",
  "decreasecooldown",
  "lifesteal",
  "move",
  "onehitkillprevent",
  "reflect",
  "parry",
  "curse",
  "robprevent",
  "sealprevent",
  "shield",
  "stealth",
  "stunprevent",
  "summon",
  "timedilation",
  "immunity",
]);

const NEGATIVE_USER_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "afterburn",
  "buffprevent",
  "clear",
  "damage",
  "elementaldamage",
  "decreasedamagegiven",
  "decreaseheal",
  "decreasepotency",
  "decreasestat",
  "decreasemastery",
  "decreasemaxpools",
  "disarm",
  "drain",
  "elementalseal",
  "flee",
  "fleeprevent",
  "healprevent",
  "increasedamagetaken",
  "increasepoolcost",
  "increasecooldown",
  "moveprevent",
  "onehitkill",
  "pierce",
  "poison",
  "recoil",
  "redirection",
  "rob",
  "seal",
  "stun",
  "summonprevent",
  "timecompression",
  "weakness",
  "wound",
]);

/** Returns true if it is a positive user effect */
export const isPositiveUserEffect = (tag: ZodAllTags) =>
  isActivityBonus(tag) || POSITIVE_USER_EFFECT_TYPES.has(tag.type);

/** Returns true if it is a negative user effect */
export const isNegativeUserEffect = (tag: ZodAllTags) =>
  NEGATIVE_USER_EFFECT_TYPES.has(tag.type);

/** Based on type name, get the zod schema for validation of that tag */
export const getTagSchema = (type: ZodAllTags["type"]) => {
  const schema = AllTags.options.find((o) => literalType(o.unwrap()) === type);
  if (!schema) return UnknownTag;
  return schema.unwrap();
};

/**
 * Fields shared by jutsu and item validators for cross-field targeting checks in
 * SuperRefineBase.
 */
interface ContentBaseValidatorType {
  target: AttackTarget;
  method: AttackMethod;
  range?: number;
  coordinateTargeting?: CoordinateTargeting | null;
  methodSize?: MethodSize | null;
  effects: ZodAllTags[];
}

interface ItemValidatorType
  extends Omit<
    Item,
    "id" | "createdAt" | "updatedAt" | "hidden" | "coordinateTargeting" | "methodSize"
  > {
  coordinateTargeting?: CoordinateTargeting | null;
  methodSize?: MethodSize | null;
  craftingRequirements?: { ids: string[]; number: number }[] | null;
  effects: ZodAllTags[];
}

/** Optional reference to another row: blank, null and omitted values all become null. */
const optionalIdField = (id = z.string()) => id.nullish().transform((v) => v || null);

/**
 * Convenience method for adding a custom zod validation error
 */
const addIssue = (ctx: z.RefinementCtx, message: string) => {
  ctx.addIssue({
    code: "custom",
    message,
  });
};

/**
 * Validator for using a specific item/jutsu action
 */
const SuperRefineBase = (data: ContentBaseValidatorType, ctx: z.RefinementCtx) => {
  if (data.method === "COORDINATES" && !data.coordinateTargeting) {
    ctx.addIssue({
      code: "custom",
      path: ["coordinateTargeting"],
      message: "Configure coordinates for the COORDINATES method.",
    });
  }
  const hasMove = data.effects.find((e) => e.type === "move");
  // Movement uses the clicked destination, so expansion must not imply extra landing tiles.
  if (hasMove && ((data.methodSize?.x ?? 0) > 0 || (data.methodSize?.y ?? 0) > 0)) {
    ctx.addIssue({
      code: "custom",
      path: ["methodSize"],
      message: "Move tags cannot use an expanded method size.",
    });
  }
  // Pick out various effect types
  const hasClone = data.effects.find((e) => e.type === "clone");
  const hasSummon = data.effects.find((e) => e.type === "summon");
  const hasBarrier = data.effects.find((e) => e.type === "barrier");
  const hasDamage = data.effects.find(
    (e) => e.type === "damage" || e.type === "elementaldamage",
  );
  const isAOE = data.method.includes("AOE");
  const isEmptyGround = data.target === "EMPTY_GROUND";
  // Curse stores healing on a persistent user effect until it expires.
  if (data.target === "GROUND" || isEmptyGround) {
    data.effects.forEach((effect, index) => {
      if (effect.type === "curse" && effect.target !== "SELF") {
        ctx.addIssue({
          code: "custom",
          path: ["effects", index, "target"],
          message: "Curse tags must target self when the action targets ground.",
        });
      }
    });
  }
  // Move uses the clicked destination rather than the affected pattern.
  if (
    hasMove &&
    (data.method === "COORDINATES" ||
      data.effects.some((tag) => tag.target === "COORDINATES"))
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["method"],
      message: "Move tags cannot be combined with coordinate targeting.",
    });
  }
  // Run checks
  if (data.target === "SELF" && data.range && data.range > 0) {
    addIssue(ctx, "If target is SELF, range should be 0");
  }
  if (!isEmptyGround) {
    if (hasBarrier) {
      addIssue(ctx, "For barrier tag 'target' needs to be empty ground");
    }
    if (hasClone || hasSummon) {
      addIssue(ctx, "For clone/summon tag 'target' needs to be empty ground");
    }
    if (hasMove) {
      addIssue(ctx, "For move tag 'target' needs to be empty ground");
    }
  }
  if (hasDamage && hasMove && !isAOE) {
    addIssue(ctx, "For Attack+Move tag combo 'method' must AOE-type");
  }
};

/**
 * Validator specific to items
 */
const SuperRefineItem = (data: ItemValidatorType, ctx: z.RefinementCtx) => {
  if (data.itemType === "MEAL") {
    for (const [field, expected] of Object.entries(MEAL_ITEM_DEFAULTS)) {
      if (
        data[field as keyof ItemValidatorType] !== expected &&
        !(expected === null && !data[field as keyof ItemValidatorType])
      ) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            "Meals must be consumable, self-targeted and unavailable as equipment or combat actions",
        });
      }
    }
    if (data.effects.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["effects"],
        message: "Select one meal effect",
      });
    }
    const requirements = data.craftingRequirements ?? [];
    const ids = requirements.flatMap((entry) => entry.ids);
    if (
      data.canBeCrafted &&
      (ids.length === 0 || requirements.some((entry) => entry.ids.length === 0))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["craftingRequirements"],
        message: "Cooking recipes require ingredients",
      });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["craftingRequirements"],
        message: "Each ingredient must appear only once",
      });
    }
  }
  if (data.itemType === "FURNITURE") {
    if (!data.furnitureData) {
      ctx.addIssue({
        code: "custom",
        path: ["furnitureData"],
        message: "Furniture requires scene configuration",
      });
    }
    for (const [field, expected] of Object.entries(FURNITURE_ITEM_DEFAULTS)) {
      const actual = data[field as keyof ItemValidatorType];
      if (
        (field === "effects" && data.effects.length > 0) ||
        (field !== "effects" &&
          actual !== expected &&
          !(expected === null && (actual == null || actual === "")))
      ) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            "Furniture must remain cosmetic and cannot be used as equipment or a battle action",
        });
      }
    }
  } else {
    if (data.furnitureData) {
      ctx.addIssue({
        code: "custom",
        path: ["furnitureData"],
        message: "Scene configuration is only available for furniture",
      });
    }
    for (const field of ["maxImbueNumber", "maxDurability"] as const) {
      if (data[field] < 1) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Non-furniture items require a value of at least one",
        });
      }
    }
  }
  const hasBloodlineRoll = data.effects.find((e) => e.type === "rollbloodline");
  const hasSageModeRoll = data.effects.find((e) => e.type === "rollsagemode");
  const hasRemoveBloodline = data.effects.find((e) => e.type === "removebloodline");
  const hasNonCombatConsumeReward = data.effects.find(
    (e) => e.type === "noncombatconsumereward",
  );
  const petRewardCount = data.effects.reduce(
    (total, effect) =>
      total +
      (effect.type === "noncombatconsumereward"
        ? (effect.reward_pets?.length ?? 0)
        : 0),
    0,
  );
  if (petRewardCount > PET_MAX_CONSUME_PETS)
    addIssue(ctx, `An item may grant at most ${PET_MAX_CONSUME_PETS} companion.`);
  if (petRewardCount > 0 && !data.preventBattleUsage)
    addIssue(ctx, "Companion rewards must prevent battle usage.");
  const hasUnlockItemVariant = data.effects.find((e) => e.type === "unlockitemvariant");
  const jutsuSlotGrants = data.effects.filter((e) => e.type === "increasejutsuslots");
  if (jutsuSlotGrants.length > 0) {
    if (
      data.itemType !== "CONSUMABLE" ||
      !data.destroyOnUse ||
      !data.preventBattleUsage ||
      data.target !== "SELF" ||
      data.method !== "SINGLE"
    )
      addIssue(
        ctx,
        "Jutsu slot grants require a consumable destroyed on use, targeting self with single method and battle usage prevented.",
      );
    if (
      jutsuSlotGrants.reduce((total, effect) => total + effect.power, 0) >
      MAX_EXTRA_JUTSU_SLOTS
    )
      addIssue(
        ctx,
        `An item may grant at most ${MAX_EXTRA_JUTSU_SLOTS} extra jutsu slots.`,
      );
  }
  // One consumption receipt owns one quest start, restricted to noncombat use on self.
  const questGrants = data.effects.filter((effect) => effect.type === "noncombatquest");
  if (questGrants.some((effect) => !effect.questId.trim()))
    addIssue(ctx, "Select a Special quest for the item to grant.");
  if (questGrants.length > 1)
    addIssue(ctx, "An item may start only one Special quest.");
  if (
    questGrants.length > 0 &&
    (data.itemType !== "CONSUMABLE" ||
      !data.preventBattleUsage ||
      data.target !== "SELF" ||
      data.method !== "SINGLE")
  )
    addIssue(
      ctx,
      "Quest items must be consumable, target self, use single method and prevent battle usage.",
    );
  const hasSageModeActivation = data.effects.find((e) => e.type === "activatesagemode");

  if (NonActionItemTypes.includes(data.itemType)) {
    SuperRefinePassiveEffects(data.effects, ctx);
    if (data.method === "COORDINATES")
      addIssue(ctx, "Coordinate methods require a combat action item.");
  }
  if (!["ARMOR", "ACCESSORY", "KEYSTONE", "CRYSTAL"].includes(data.itemType)) {
    rejectActivityBonuses(data.effects, ctx);
  }

  // Cost validation - exactly one cost type must be set
  const costTypes = [
    { name: "ryo", value: data.cost },
    { name: "reputation", value: data.repsCost },
    { name: "seichi silver", value: data.seichiSilverCost },
  ].filter((cost) => cost.value > 0);

  if (costTypes.length === 0 && (data.itemType !== "FURNITURE" || data.inShop)) {
    ctx.addIssue({
      code: "custom",
      path: ["cost"],
      message: "Must have either a ryo, reputation points, or seichi silver cost",
    });
  }

  if (data.isFarmSeed && data.farmGrowTimeSeconds <= 0) {
    ctx.addIssue({
      code: "custom",
      message: "Farm seeds must have a grow time of at least 1 second",
      path: ["farmGrowTimeSeconds"],
    });
  }

  if (data.itemType === "CONSUMABLE" && !data.destroyOnUse) {
    addIssue(ctx, "Consumable items must be destroyed on use");
  }
  const caches = data.effects.flatMap((effect) =>
    isWeightedCacheEffect(effect) && effect.weightedCache ? [effect.weightedCache] : [],
  );
  if (caches.length > 0 && !data.preventBattleUsage)
    addIssue(ctx, "Weighted caches must prevent battle usage");
  if (caches.length > 0 && isRestrictedCacheReward({ effects: data.effects }))
    addIssue(ctx, CACHE_RESTRICTED_REWARD_MESSAGE);
  if (
    caches.reduce((sum, cache) => sum + maximumCacheItems(cache), 0) >
    CACHE_MAX_GRANTED_ITEMS
  )
    addIssue(
      ctx,
      `All cache effects together may grant at most ${CACHE_MAX_GRANTED_ITEMS} items per opening`,
    );
  const requireSelfConsumable = (label: string) => {
    if (data.itemType !== "CONSUMABLE") addIssue(ctx, `${label} must be consumable.`);
    if (data.target !== "SELF") addIssue(ctx, `${label} must target self`);
    if (data.method !== "SINGLE") addIssue(ctx, `${label} must have single method`);
  };
  if (hasNonCombatConsumeReward) requireSelfConsumable("Non-combat consume reward");
  if (hasBloodlineRoll || hasRemoveBloodline || hasSageModeRoll) {
    requireSelfConsumable("Items with bloodline/sage roll");
  }
  if (hasSageModeActivation) {
    addIssue(
      ctx,
      "Cannot have sage mode activation effect on items; it is injected automatically in battle",
    );
  }
  if (hasUnlockItemVariant) {
    requireSelfConsumable("Items with unlockitemvariant");
    if (!data.destroyOnUse) {
      addIssue(ctx, "Items with unlockitemvariant must be destroyed on use");
    }
    if (!data.preventBattleUsage) {
      addIssue(
        ctx,
        "Items with unlockitemvariant must have preventBattleUsage enabled",
      );
    }
  }
};

/**
 * Validator specific to jutsus
 */
const SuperRefineJutsu = (
  data: z.infer<typeof JutsuValidatorRawSchema>,
  ctx: z.RefinementCtx,
) => {
  rejectActivityBonuses(data.effects, ctx);
  if (data.effects.some((e) => e.type === "increasejutsuslots"))
    addIssue(ctx, "Jutsu slot grants are only supported on non-combat consumables.");
  const hasBloodlineRoll = data.effects.find((e) => e.type === "rollbloodline");
  const hasSageModeRoll = data.effects.find((e) => e.type === "rollsagemode");
  const hasRemoveBloodline = data.effects.find((e) => e.type === "removebloodline");
  const hasSageModeActivation = data.effects.find((e) => e.type === "activatesagemode");
  const hasNonCombatConsumeReward = data.effects.find(
    (e) => e.type === "noncombatconsumereward",
  );
  if (hasBloodlineRoll || hasSageModeRoll || hasRemoveBloodline) {
    addIssue(ctx, "Cannot have bloodline/sage add/remove effects on jutsu");
  }
  if (hasSageModeActivation) {
    addIssue(
      ctx,
      "Cannot have sage mode activation effect on jutsu; it is injected automatically in battle",
    );
  }
  if (hasNonCombatConsumeReward) {
    addIssue(ctx, "Cannot have non-combat consume reward on jutsu");
  }
};

/**
 * Validator specific to effects
 */
export const SuperRefineEffects = (effects: ZodAllTags[], ctx: z.RefinementCtx) => {
  effects.forEach((e, index) => {
    if (e.target === "COORDINATES" && !e.coordinateTargeting) {
      ctx.addIssue({
        code: "custom",
        path: [index, "coordinateTargeting"],
        message: "Configure coordinates for this tag.",
      });
    }
    if (e.target === "COORDINATES" && e.type === "move") {
      ctx.addIssue({
        code: "custom",
        path: [index, "target"],
        message: "Move tags must inherit the clicked destination or target self.",
      });
    }
    if (e.target === "COORDINATES" && e.type === "curse") {
      ctx.addIssue({
        code: "custom",
        path: [index, "target"],
        message: "Curse tags must target users rather than coordinates.",
      });
    }
    if (e.type === "barrier" && e.staticAssetPath === "") {
      addIssue(ctx, "BarrierTag needs a staticAssetPath");
    } else if (e.type === "wound") {
      const hasDamageOrPierce = effects.some(
        (x) =>
          x.type === "damage" || x.type === "elementaldamage" || x.type === "pierce",
      );
      if (!hasDamageOrPierce) {
        addIssue(
          ctx,
          "WoundTag must be used together with a damage or pierce effect on the same action",
        );
      }
    } else if (e.type === "vamp" || (e.type === "consume" && e.rounds === 0)) {
      const hasDamageOrPierce = effects.some(
        (x) =>
          x.type === "damage" || x.type === "elementaldamage" || x.type === "pierce",
      );
      if (!hasDamageOrPierce) {
        addIssue(
          ctx,
          `${e.type === "vamp" ? "VampTag" : "ConsumeTag"} must be used together with a damage or pierce effect on the same action`,
        );
      }
    } else if (e.type === "rollbloodline" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for rollbloodline effect");
    } else if (e.type === "rollsagemode" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for rollsagemode effect");
    } else if (e.type === "activatesagemode") {
      addIssue(
        ctx,
        "Cannot have sage mode activation effect; it is injected automatically in battle",
      );
    } else if (e.type === "removebloodline" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for removebloodline effect");
    } else if (e.type === "noncombatconsumereward" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for noncombatconsumereward effect");
    } else if (e.type === "clone" && e.rounds === 0) {
      addIssue(
        ctx,
        "CloneTag can only be set to 0 rounds, indicating a single clone creation",
      );
    }
  });
};

/** Passive sources have no selected tile or cast pattern. */
export const SuperRefinePassiveEffects = (
  effects: ZodAllTags[],
  ctx: z.RefinementCtx,
) => {
  effects.forEach((effect, index) => {
    if (effect.type === "increasejutsuslots") {
      ctx.addIssue({
        code: "custom",
        path: [index, "type"],
        message: "Jutsu slot grants are only supported on non-combat consumables.",
      });
    }
    if (effect.target === "COORDINATES") {
      ctx.addIssue({
        code: "custom",
        path: [index, "target"],
        message: "Coordinate tags require a jutsu or combat action item.",
      });
    }
  });
};

/** Jutsu catalog validation, including integer mastery and general-stat prerequisites. */
export const JutsuValidatorRawSchema = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  battleDescription: z.string(),
  extraBaseCost: z.coerce.number().min(0).max(65_535),
  jutsuWeapon: z.enum(WeaponTypes),
  jutsuType: z.enum(JutsuTypes),
  // Empty form resets and omitted values both clear the species restriction.
  requiredPetSpeciesId: optionalIdField(z.string().max(191)),
  jutsuRank: z.enum(LetterRanks),
  requiredRank: z.enum(UserRanks),
  requiredLevel: z.coerce.number().min(1).max(MAX_PLAYER_LEVEL),
  method: z.enum(AttackMethods),
  coordinateTargeting: coordinateTargetingSchema.nullish(),
  methodSize: methodSizeSchema.nullish(),
  target: z.enum(AttackTargets),
  range: z.coerce.number().int().min(0).max(5),
  // The column is nullable, so rows stored before this field existed - and any
  // write that leaves it out - arrive as null. Fall back to the catch-all
  // classification rather than blocking the save.
  statClassification: z
    .enum(StatTypes)
    .nullish()
    .transform((v) => v ?? "None"),
  elementClassification: z
    .enum(ElementNames)
    .nullish()
    .transform((v) => v ?? "None"),
  hidden: z.coerce.boolean().optional(),
  injectableInBattle: z.coerce.boolean().prefault(false),
  healthCost: z.coerce.number().min(0).max(10000),
  chakraCost: z.coerce.number().min(0).max(10000),
  staminaCost: z.coerce.number().min(0).max(10000),
  healthCostReducePerLvl: z.coerce.number().min(0).max(10000),
  chakraCostReducePerLvl: z.coerce.number().min(0).max(10000),
  staminaCostReducePerLvl: z.coerce.number().min(0).max(10000),
  actionCostPerc: z.coerce.number().int().min(10).max(100),
  cooldown: z.coerce.number().int().min(0).max(300),
  requiredSkillId: optionalIdField(z.string().max(191)),
  bloodlineId: z.string().nullable(),
  requiredBloodlineItemId: z
    .string()
    .nullable()
    .transform((val) => (val === "" ? null : val)),
  villageId: z.string().nullable(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
  battleUsageType: z.enum(BattleUsageTypes).prefault("BOTH"),
  reskinParentJutsuId: optionalIdField(),
  bloodlineReskinId: optionalIdField(),
  parentJutsuId: optionalIdField(),
  ...masteryRequirementFields,
  ...generalRequirementFields,
});

// Final validator with additional cross-field checks
export const JutsuValidator =
  JutsuValidatorRawSchema.superRefine(SuperRefineBase).superRefine(SuperRefineJutsu);
export type ZodJutsuType = z.output<typeof JutsuValidator>;
export type ZodJutsuInput = z.input<typeof JutsuValidator>;

/**
 * Bloodline Type. Used for validating a bloodline object is set up properly
 */
export const BloodlineValidator = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  rank: z.enum(LetterRanks),
  regenIncrease: z.coerce.number().int().min(0).max(100),
  // Nullable in the schema for the same reason as on jutsu - see JutsuValidatorRawSchema.
  statClassification: z
    .enum(StatTypes)
    .nullish()
    .transform((v) => v ?? "None"),
  villageId: z.string().nullable(),
  hidden: z.coerce.boolean().optional(),
  difficulty: z.enum(BloodlineDifficultyRatings).nullable().optional(),
  traits: z.string().max(256).nullable().optional(),
  effects: z
    .array(AllTags)
    .superRefine(SuperRefineEffects)
    .superRefine(SuperRefinePassiveEffects),
});
export type ZodBloodlineType = z.output<typeof BloodlineValidator>;
export type ZodBloodlineInput = z.input<typeof BloodlineValidator>;

/**
 * Staff-editor shape of a `SageMode` catalog row. `level` is the roll-pool gate;
 * `requiredSageMastery` unlocks `level2Effects` (must be > 0 if that array is non-empty).
 * Tag `rounds` are stripped on persist except `0` (instant).
 */
export const SageModeValidator = z
  .object({
    name: z.string().trim(),
    image: z.string(),
    description: z.string(),
    battleDescription: z.string().nullish(),
    level: z.coerce.number().int().min(1).max(SAGE_MODE_MAX_LEVEL),
    requiredSageMastery: z.coerce.number().int().min(0).max(SAGE_MASTERY_EXP_CAP),
    activationRounds: z.coerce.number().int().min(1).max(20),
    afterEffectRounds: z.coerce.number().int().min(0).max(20),
    chakraCostPerc: z.coerce.number().int().min(0).max(100),
    staminaCostPerc: z.coerce.number().int().min(0).max(100),
    actionCostPerc: z.coerce.number().int().min(10).max(100),
    villageId: z.string().nullable(),
    hidden: z.coerce.boolean().optional(),
    effects: z
      .array(AllTags)
      .superRefine(SuperRefineEffects)
      .superRefine(SuperRefinePassiveEffects),
    /** Applied when active sage buffs end; uses the full combat effect pipeline (instant damage/heal/drain resolve immediately). */
    afterEffects: z
      .array(AllTags)
      .superRefine(SuperRefineEffects)
      .superRefine(SuperRefinePassiveEffects),
    level2Effects: z
      .array(AllTags)
      .superRefine(SuperRefineEffects)
      .superRefine(SuperRefinePassiveEffects),
  })
  .superRefine((data, ctx) => {
    rejectActivityBonuses(data.effects, ctx);
    rejectActivityBonuses(data.afterEffects, ctx);
    rejectActivityBonuses(data.level2Effects, ctx);
    if (data.level2Effects.length > 0 && data.requiredSageMastery <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Level 2 effects require a Tier 2 mastery threshold above 0",
        path: ["level2Effects"],
      });
    }
  });
export type ZodSageModeType = z.infer<typeof SageModeValidator>;

/**
 * SkillTree Type. Used for validating a skill tree object is set up properly
 */
export const SkillTreeValidator = z
  .object({
    name: z.string().trim(),
    image: z.string(),
    description: z.string(),
    target: z.enum(SkillTreeTargets).prefault("SELF"),
    tier: z.coerce.number().int().min(1).max(SKILL_TREE_MAX_TIER),
    requiredSkillIds: z.array(z.string()),
    costSkillPoints: z.coerce.number().int().min(1),
    pathType: z.enum(SkillTreePathTypes).prefault("SKILL"),
    bloodlineId: z.string().nullish(),
    seichiSilverCost: z.coerce.number().int().min(0).max(2147483647).prefault(0),
    hidden: z.coerce.boolean().optional(),
    skillType: z.enum(SkillTreeEntryTypes).prefault("DEFAULT"),
    folderId: z.string().nullish(),
    effects: z
      .array(AllTags)
      .superRefine(SuperRefineEffects)
      .superRefine(SuperRefinePassiveEffects),
  })
  .superRefine((tier, ctx) => {
    // Purchased Bloodright effects enter userSkills only during combat, after activity snapshots.
    if (tier.pathType === "BLOODRIGHT") rejectActivityBonuses(tier.effects, ctx);
    if (tier.pathType === "BLOODRIGHT" && !tier.bloodlineId)
      ctx.addIssue({
        code: "custom",
        path: ["bloodlineId"],
        message: "Bloodright requires a bloodline",
      });
    if (tier.pathType === "SKILL" && tier.bloodlineId)
      ctx.addIssue({
        code: "custom",
        path: ["bloodlineId"],
        message: "Only Bloodright can have a bloodline",
      });
  });
export type ZodSkillTreeType = z.output<typeof SkillTreeValidator>;
export type ZodSkillTreeInput = z.input<typeof SkillTreeValidator>;

/**
 * Item Type. Used for validating a item object is set up properly
 */
export const ItemValidatorRawSchema = z.object({
  ...lpcItemFields.shape,
  ...itemEconomySchema.shape,
  ...furnitureItemSchema.shape,
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  battleDescription: z.string(),
  stackSize: z.coerce.number().int().min(1).max(MAX_ITEM_STACK_SIZE),
  destroyOnUse: z.coerce.boolean().prefault(false),
  chakraCost: z.coerce.number().int().min(0).max(10000),
  healthCost: z.coerce.number().int().min(0).max(10000),
  staminaCost: z.coerce.number().int().min(0).max(10000),
  healthCostReducePerLvl: z.coerce.number().min(0).max(10000),
  chakraCostReducePerLvl: z.coerce.number().min(0).max(10000),
  staminaCostReducePerLvl: z.coerce.number().min(0).max(10000),
  actionCostPerc: z.coerce.number().int().min(1).max(100),
  canStack: z.coerce.boolean().prefault(false),
  maxImbueNumber: z.coerce.number().int().min(0).max(3),
  maxDurability: z.coerce.number().int().min(0).max(100),
  inShop: z.coerce.boolean().prefault(false),
  isEventItem: z.coerce.boolean().prefault(false),
  preventBattleUsage: z.coerce.boolean().prefault(false),
  hidden: z.coerce.boolean(),
  cooldown: z.coerce.number().int().min(0).max(300),
  cost: z.coerce.number().int().min(0),
  repsCost: z.coerce.number().int().min(0),
  seichiSilverCost: z.coerce.number().int().min(0),
  range: z.coerce.number().int().min(0).max(10),
  maxEquips: z.coerce.number().int().min(0).max(10),
  method: z.enum(AttackMethods),
  coordinateTargeting: coordinateTargetingSchema.nullish(),
  methodSize: methodSizeSchema.nullish(),
  target: z.enum(AttackTargets),
  itemType: z.enum(ItemTypes),
  weaponType: z.enum(WeaponTypes),
  rarity: z.enum(ItemRarities),
  slot: z.enum(ItemSlotTypes),
  requiredLevel: z.coerce.number().int().min(1).max(MAX_PLAYER_LEVEL).prefault(1),
  xpToLevel: z.coerce.number().int().min(1).max(100000).prefault(ITEM_XP_TO_LEVEL),
  parentItemId: optionalIdField(),
  ...masteryRequirementFields,
  ...generalRequirementFields,
  expireFromStoreAt: z
    .string()
    .regex(DateTimeRegExp, "Must be of format YYYY-MM-DD")
    .nullable(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
  canBeImbued: z.coerce.boolean().prefault(false),
  canBeCrafted: z.coerce.boolean().prefault(false),
  canBeHunted: z.coerce.boolean().prefault(false),
  canBeGathered: z.coerce.boolean().prefault(false),
  canBeTraded: z.coerce.boolean().prefault(false),
  isFarmSeed: z.coerce.boolean().prefault(false),
  farmGrowTimeSeconds: z.coerce.number().int().min(0).prefault(0),
  farmYieldItemId: z.string().nullable(),
  farmMinLevel: z.coerce.number().int().min(1).max(100).prefault(1),
  farmPlantExperience: z.coerce.number().int().min(0).prefault(0),
  farmHarvestExperience: z.coerce.number().int().min(0).prefault(0),
  farmSellValue: z.coerce.number().int().min(0).prefault(0),
  farmExtractSeedItemId: z.string().nullable(),
  farmExtractSeedCount: z.coerce.number().int().min(0).prefault(0),
  isFarmFertilizer: z.coerce.boolean().prefault(false),
  farmTimeReductionSeconds: z.coerce.number().int().min(0).prefault(0),
  farmFertilizerExperience: z.coerce.number().int().min(0).prefault(0),
  cookingMinLevel: z.coerce.number().int().min(1).max(100).prefault(1),
  cookingTimeSeconds: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_MEAL_DURATION_SECONDS)
    .prefault(60),
  cookingOutputQuantity: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_COOKING_OUTPUT)
    .prefault(1),
  cookingExperience: z.coerce.number().int().min(0).max(1000000).prefault(0),
  mealDurationSeconds: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_MEAL_DURATION_SECONDS)
    .prefault(60),
  craftingExperience: z.coerce.number().int().min(0).prefault(0),
  crystalTargetTypes: z.enum(ItemTypes).nullable(),
  requiredSkillId: optionalIdField(z.string().max(191)),
  bloodlineId: z.string().nullable(),
  battleUsageType: z.enum(BattleUsageTypes).prefault("BOTH"),
  craftingRequirements: z
    .array(
      z.object({
        ids: z.array(z.string()),
        number: z.coerce
          .number()
          .int()
          .min(1)
          .max(MAX_ITEM_CRAFTING_REQUIREMENT_QUANTITY),
      }),
    )
    .prefault([])
    .nullish(),
});
export const ItemValidator = ItemValidatorRawSchema.superRefine(SuperRefineBase)
  .superRefine(SuperRefineItem)
  .superRefine(refineItemEconomy);
export type ZodItemType = z.output<typeof ItemValidator>;
export type ZodItemInput = z.input<typeof ItemValidator>;

/****************************** */
/*******  DMG SIMULATION  *******/
/****************************** */
const roundStat = (stat: number) => {
  return Math.round(stat * 100) / 100;
};

/**
 * Create a stats schema. Used for validating user stats, either starting stats,
 * stat changes, or stat differences
 * @returns - zod schema and max values for each stat
 */
export const createStatSchema = (
  min = 10,
  start = 10,
  user?: Pick<UserData, "rank"> &
    Partial<
      Pick<
        UserData,
        "offence" | "defence" | "strength" | "speed" | "intelligence" | "willpower"
      >
    >,
) => {
  const caps = getUserCaps(user?.rank);
  const roomFor = (stat: CombatStatName) => {
    const cap = getCombatStatCap(caps, stat);
    return cap - Math.min(user?.[stat] || 0, cap);
  };

  // Calculate max values for each stat
  const maxValues = {
    offence: roomFor("offence"),
    defence: roomFor("defence"),
    strength: roomFor("strength"),
    speed: roomFor("speed"),
    intelligence: roomFor("intelligence"),
    willpower: roomFor("willpower"),
  };

  const statField = (max: number) =>
    z.coerce.number().min(min).max(max).transform(roundStat).prefault(start);
  const schema = z.object({
    offence: statField(maxValues.offence),
    defence: statField(maxValues.defence),
    strength: statField(maxValues.strength),
    speed: statField(maxValues.speed),
    intelligence: statField(maxValues.intelligence),
    willpower: statField(maxValues.willpower),
  });

  return { schema, maxValues };
};

export const { schema: statSchema, maxValues: defaultStatMaxValues } =
  createStatSchema();
export type StatSchemaType = z.infer<typeof statSchema>;
export type AssignableUserStats = StatSchemaType &
  Partial<Record<BasicElement, number>> &
  Partial<{
    ninjutsuMastery: number;
    genjutsuMastery: number;
    taijutsuMastery: number;
    bukijutsuMastery: number;
    bloodlineMastery: number;
    sageMastery: number;
  }>;

export const actSchema = z.object({
  power: z.coerce.number().min(1).max(100).prefault(1),
  statTypes: statTypesField.prefault(["Ninjutsu"]),
  generalTypes: z.array(z.enum(GeneralTypes)).prefault(["Strength"]),
});

/** A player's real level and experience, which can exceed what their stats sum to */
export const loadedProgressSchema = z.object({
  level: z.number().int().min(1),
  experience: z.number().min(0),
});
export type LoadedProgress = z.infer<typeof loadedProgressSchema>;

/** Saved damage simulator state; progress is present when a player loaded their own stats */
export const damageSimulationStateSchema = z.object({
  attacker: statSchema,
  defender: statSchema,
  action: actSchema,
  attackerProgress: loadedProgressSchema.optional(),
  defenderProgress: loadedProgressSchema.optional(),
});
export type DamageSimulationState = z.infer<typeof damageSimulationStateSchema>;

export const confSchema = z
  .object({
    stats_scaling: z.coerce.number().min(0),
    base_hits: z.coerce.number().gt(0),
    curve: z.coerce.number().gt(0),
    amplitude: z.coerce.number().min(0),
    ep_normalization: z.coerce.number().gt(0),
    gen_weight: z.coerce.number().min(0),
    advantage_min: z.coerce.number().min(0),
    advantage_max: z.coerce.number().gt(0),
  })
  .refine((data) => data.advantage_min <= data.advantage_max, {
    message: "advantage_min must be less than or equal to advantage_max",
    path: ["advantage_min"],
  });
