import { z } from "zod";
import { AttackMethods, AttackTargets, ItemRarities } from "@/drizzle/constants";
import { ItemSlotTypes, ItemTypes, JutsuTypes } from "@/drizzle/constants";
import {
  LetterRanks,
  UserRanks,
  WeaponTypes,
  BattleUsageTypes,
} from "@/drizzle/constants";
import { BloodlineDifficultyRatings } from "@/drizzle/constants";
import { ElementNames } from "@/drizzle/constants";
import { DateTimeRegExp } from "@/utils/regex";
import { StatTypes, GeneralTypes, PoolTypes } from "@/drizzle/constants";
import { SkillTreeTargets, SkillTreeEntryTypes } from "@/drizzle/constants";
import { AdjustableBasicActions } from "@/drizzle/constants";
import { getUserCaps } from "@/drizzle/constants";
import { rewardFields } from "@/validators/rewards";
import type { Item, UserData } from "@/drizzle/schema";

/**
 * Schema & types for performing battle actions
 */
export const performActionSchema = z.object({
  battleId: z.string(),
  userId: z.string().optional(),
  actionId: z.string().optional(),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  version: z.number(),
});
export type PerformActionType = z.infer<typeof performActionSchema>;

/**
 * Convenience method for a string with a default value
 */
const msg = (defaultString: string) => {
  return z.string().default(defaultString);
};

const type = (defaultString: string) => {
  return z.literal(defaultString).default(defaultString);
};

/**
 * Battle Descriptions use the following variables:
 * https://www.scribbr.com/nouns-and-pronouns/pronouns/
 *
 * %user - the name of the one who is affected by the effect
 * %target - the name of the one who is affected by the effect
 * %user_subject - he/she
 * %target_subject - he/she
 * %user_object - him/her
 * %target_object - him/her
 * %user_posessive - his/hers
 * %target_posessive - his/hers
 * %user_reflexive - himself/herself
 * %target_reflexive - himself/herself
 * %attacker - a character attacking the target
 * %rounds - the number of rounds the effect will last
 * %amount - the amount of the effect
 * %affected - the stats or pools that are affected by the effect
 * %changetype - the type of change (increased or decreased)
 * %location - the location of the action
 */

/******************** */
/**  BASE ATTRIBUTES  */
/******************** */
const BaseTagTargets = ["INHERIT", "SELF"] as const;
const BaseAttributes = {
  // Visual controls
  staticAssetPath: z.string().default(""),
  staticAnimation: z.string().default(""),
  appearAnimation: z.string().default(""),
  disappearAnimation: z.string().default(""),
  // SFX controls
  appearSfx: z.string().default(""),
  disappearSfx: z.string().default(""),
  // Timing controls
  rounds: z.coerce.number().int().min(0).max(100).optional(),
  timeTracker: z.record(z.string(), z.coerce.number()).optional(),
  // Power controls. Has different meanings depending on calculation
  power: z.coerce.number().min(-100).max(100).default(1),
  powerPerLevel: z.coerce.number().min(-1).max(1).default(0),
  // Used for indicating offensive / defensive effect
  direction: type("offence"),
  // Attack target, if different from the default
  target: z.enum(BaseTagTargets).optional().default("INHERIT"),
  // Enable / disables applying to friendlies. Default is to apply to all users
  friendlyFire: z.enum(["ALL", "FRIENDLY", "ENEMIES"]).optional(),
  // Default is for calculation to be static
  calculation: z.enum(["static"]).default("static"),
};

const PowerAttributes = {
  power: z.coerce.number().min(0).default(1),
  powerPerLevel: z.coerce.number().min(0).max(1).default(0),
};

const PoolAttributes = {
  poolsAffected: z.array(z.enum(PoolTypes)).default(["Health"]).optional(),
};

const IncludeStats = {
  // Power has the following meaning depending on calculation
  // static: directly equates to the amount returned
  // percentage: power is returned as a percentage
  // formula: power is used in stats-based formula to calculate return value
  statTypes: z.array(z.enum(StatTypes)).optional(),
  generalTypes: z.array(z.enum(GeneralTypes)).optional(),
  elements: z.array(z.enum(ElementNames)).optional(),
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

export const AbsorbTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("absorb").default("absorb"),
  calculation: z.enum(["percentage"]).default("percentage"),
  direction: type("defence"),
  description: msg("Absorb damage taken & convert to health, chakra or stamina"),
  poolsAffected: z.array(z.enum(PoolTypes)).default(["Health"]),
  target: z.enum(BaseTagTargets).optional().default("SELF"),
});

export const IncreaseDamageGivenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("increasedamagegiven").default("increasedamagegiven"),
  description: msg("Increase damage given by target"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const DecreaseDamageGivenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("decreasedamagegiven").default("decreasedamagegiven"),
  description: msg("Decrease damage given by target"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const IncreaseDamageTakenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("increasedamagetaken").default("increasedamagetaken"),
  description: msg("Increase damage taken of target"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const DecreaseDamageTakenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("decreasedamagetaken").default("decreasedamagetaken"),
  description: msg("Decrease damage taken of target"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const IncreaseHealGivenTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("increaseheal").default("increaseheal"),
  description: msg("Increase how much target can heal others"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const DecreaseHealGivenTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("decreaseheal").default("decreaseheal"),
  description: msg("Decrease how much target can heal others"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const IncreasePoolCostTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("increasepoolcost").default("increasepoolcost"),
  description: msg("Increase cost of taking actions"),
  rounds: z.coerce.number().int().min(2).max(20).default(2),
  direction: type("defence"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const DecreasePoolCostTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("decreasepoolcost").default("decreasepoolcost"),
  description: msg("Decrease cost of taking actions"),
  rounds: z.coerce.number().int().min(2).max(20).default(2),
  direction: type("defence"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const TimeCompressionTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("timecompression").default("timecompression"),
  description: msg("Increases AP cost of actions by 10"),
  rounds: z.coerce.number().int().min(1).max(20).default(1),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export type TimeCompressionTagType = z.infer<typeof TimeCompressionTag>;

export const TimeDilationTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("timedilation").default("timedilation"),
  description: msg("Decreases AP cost of actions by 10"),
  rounds: z.coerce.number().int().min(1).max(20).default(1),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export type TimeDilationTagType = z.infer<typeof TimeDilationTag>;

export const RedirectionTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("redirection").default("redirection"),
  description: msg(
    "Redirects the target towards or away from the user by power number of spaces",
  ),
  rounds: z.coerce.number().int().min(0).max(0).default(0),
  calculation: z.enum(["static"]).default("static"),
  direction: z.enum(["push", "pull"]).default("pull"),
});
export type RedirectionTagType = z.infer<typeof RedirectionTag>;

export const IncreaseRangeTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("increaserange").default("increaserange"),
  description: msg("Increase range of basic actions"),
  calculation: z.enum(["static"]).default("static"),
  actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
});

export const IncreaseCooldownTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("increasecooldown").default("increasecooldown"),
  description: msg("Increase cooldown of basic actions"),
  calculation: z.enum(["static"]).default("static"),
  actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
});

export const DecreaseCooldownTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("decreasecooldown").default("decreasecooldown"),
  description: msg("Decrease cooldown of basic actions"),
  calculation: z.enum(["static"]).default("static"),
  actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
});

export const IncreaseStatTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("increasestat").default("increasestat"),
  direction: z.enum(["offence", "defence", "both"]).default("both"),
  description: msg("Increase stats of target"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const DecreaseStatTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("decreasestat").default("decreasestat"),
  direction: z.enum(["offence", "defence", "both"]).default("both"),
  description: msg("Decrease stats of target"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const BarrierTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("barrier").default("barrier"),
  curHealth: z.coerce.number().int().min(1).max(100000).default(100),
  maxHealth: z.coerce.number().int().min(1).max(100000).default(100),
  absorbPercentage: z.coerce.number().int().min(1).max(100).default(50),
  direction: type("defence"),
  description: msg("Creates a barrier with level corresponding to power"),
});

export type BarrierTagType = z.infer<typeof BarrierTag>;

export const BuffPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("buffprevent").default("buffprevent"),
  description: msg("Prevents buffing"),
});

export const ClearTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("clear").default("clear"),
  description: msg("Clears all positive effects from the target"),
});

export const ClearPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("clearprevent").default("clearprevent"),
  description: msg("Prevents clearing"),
});

export const CleanseTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("cleanse").default("cleanse"),
  description: msg("Clears all negative effects from the target"),
});

export const CleansePreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("cleanseprevent").default("cleanseprevent"),
  description: msg("Prevents cleansing"),
});

export const CloneTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("clone").default("clone"),
  description: msg(
    "Create a temporary clone to fight alongside you for a given number of rounds.",
  ),
  rounds: z.coerce.number().int().min(2).max(100).default(2),
  calculation: z.enum(["percentage"]).default("percentage"),
});

export const DamageTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("damage").default("damage"),
  description: msg("Deals damage to target"),
  calculation: z.enum(["formula", "static", "percentage"]).default("formula"),
  residualModifier: z.coerce.number().min(0).max(2).default(1).optional(),
  dmgModifier: z.coerce.number().min(0).max(2).default(1).optional(),
  allowBloodlineDamageIncrease: z.coerce.boolean().default(true),
  allowBloodlineDamageDecrease: z.coerce.boolean().default(true),
});
export type DamageTagType = z.infer<typeof DamageTag>;

export const CopyTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("copy").default("copy"),
  description: msg("Copies some positive effects from the target to the user"),
  calculation: z.enum(["percentage"]).default("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).default(3),
});
export type CopyTagType = z.infer<typeof CopyTag>;

export const MirrorTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("mirror").default("mirror"),
  description: msg("Mirrors some negative effects from the user to the target"),
  calculation: z.enum(["percentage"]).default("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).default(3),
});
export type MirrorTagType = z.infer<typeof MirrorTag>;

export const PierceTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("pierce").default("pierce"),
  description: msg("Deals piercing damage to target"),
  calculation: z.enum(["formula", "static", "percentage"]).default("formula"),
  residualModifier: z.coerce.number().min(0).max(2).default(1).optional(),
  dmgModifier: z.coerce.number().min(0).max(2).default(1).optional(),
  allowBloodlineDamageIncrease: z.coerce.boolean().default(true),
  allowBloodlineDamageDecrease: z.coerce.boolean().default(true),
});
export type PierceTagType = z.infer<typeof PierceTag>;

export const DebuffPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("debuffprevent").default("debuffprevent"),
  description: msg("Prevents debuffing"),
});

export const FleeTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("flee").default("flee"),
  description: msg("Flee the battle"),
});

export const FleePreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("fleeprevent").default("fleeprevent"),
  description: msg("Prevents fleeing"),
});

export const HealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("heal").default("heal"),
  rounds: z.coerce.number().int().min(0).max(100).default(0),
  description: msg("Heals themselves or others"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const HealPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("healprevent").default("healprevent"),
  description: msg("Prevents healing"),
});

export const LifeStealTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("lifesteal").default("lifesteal"),
  description: msg("Heal based on damage given"),
  calculation: z.enum(["percentage"]).default("percentage"),
});

export const DrainTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("drain").default("drain"),
  description: msg("Drain target's pools over time"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).default(3),
  poolsAffected: z.array(z.enum(PoolTypes)).default(["Chakra", "Stamina", "Health"]),
});
export type DrainTagType = z.infer<typeof DrainTag>;

export const PoisonTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("poison").default("poison"),
  description: msg("Deal damage based on Chakra and Stamina lost"),
  calculation: z.enum(["percentage"]).default("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).default(3),
  poolsAffected: z.array(z.enum(PoolTypes)).default(["Health", "Chakra", "Stamina"]),
});
export type PoisonTagType = z.infer<typeof PoisonTag>;

export const ShieldTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("shield").default("shield"),
  description: msg("Creates a temporary HP bar that lasts for a set amount of rounds"),
  rounds: z.coerce.number().int().min(1).max(100).default(3),
  health: z.coerce.number().int().min(1).max(100000).default(100),
});
export type ShieldTagType = z.infer<typeof ShieldTag>;

export const FinalStandTag = z.object({
  ...BaseAttributes,
  type: z.literal("finalstand").default("finalstand"),
  description: msg("User cannot be reduced below 1 HP"),
  power: z.coerce.number().min(0).max(100).default(100),
  powerPerLevel: z.coerce.number().min(0).max(1).default(0),
});
export type FinalStandTagType = z.infer<typeof FinalStandTag>;

export const MoveTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("move").default("move"),
  description: msg("Move on the battlefield"),
});

export type MoveTagType = z.infer<typeof MoveTag>;

export const MovePreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("moveprevent").default("moveprevent"),
  description: msg("Prevents movement of the target"),
});

export const OneHitKillTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("onehitkill").default("onehitkill"),
  description: msg("Instantly kills the target"),
});

export const OneHitKillPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("onehitkillprevent").default("onehitkillprevent"),
  description: msg("Prevents instant kill effects"),
});

export const ReflectTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("reflect").default("reflect"),
  description: msg("Reflect damage taken"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const WoundTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("wound").default("wound"),
  description: msg("Applies wound damage over multiple turns based on damage dealt"),
  calculation: z.enum(["percentage"]).default("percentage"),
  rounds: z.coerce.number().int().min(1).max(20).default(1),
});
export type WoundTagType = z.infer<typeof WoundTag>;

export const RemoveBloodline = z.object({
  ...BaseAttributes,
  type: z.literal("removebloodline").default("removebloodline"),
  description: msg("Remove bloodline"),
  power: z.coerce.number().int().min(0).max(100).default(1),
  calculation: z.enum(["percentage"]).default("percentage"),
});

export const RecoilTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("recoil").default("recoil"),
  description: msg("Recoil damage given back to self"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const AfterburnTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("afterburn").default("afterburn"),
  description: msg("Take a percentage of incoming damage as afterburndamage"),
  calculation: z.enum(["static", "percentage"]).default("percentage"),
});

export const RobPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("robprevent").default("robprevent"),
  description: msg("Prevents robbing of the target"),
});

export const RobTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("rob").default("rob"),
  description: msg("Robs money from the target"),
  robPercentage: z.coerce.number().int().min(0).max(100).default(1),
});

export const RollRandomBloodline = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).default("D"),
  description: msg("Receive a random bloodline"),
  power: z.coerce.number().min(0).max(100).default(1),
  type: z.literal("rollbloodline").default("rollbloodline"),
  calculation: z.enum(["percentage"]).default("percentage"),
});

export const NonCombatConsumeRewardTag = z.object({
  ...BaseAttributes,
  ...rewardFields,
  type: z.literal("noncombatconsumereward").default("noncombatconsumereward"),
  description: msg("Gain various rewards from consumption outside of combat"),
});
export type NonCombatConsumeRewardTagType = z.infer<typeof NonCombatConsumeRewardTag>;

export const RepairTag = z.object({
  ...BaseAttributes,
  type: z.literal("repair").default("repair"),
  description: msg("Repair an item's durability by the power amount"),
});
export type RepairTagType = z.infer<typeof RepairTag>;

export const SealPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("sealprevent").default("sealprevent"),
  description: msg("Prevents bloodline from being sealed"),
});

export const SealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("seal").default("seal"),
  description: msg("Seals the target's bloodline effects"),
});

export const StealthTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("stealth").default("stealth"),
  description: msg("Stealth the target, only allowing non-damaging jutsu and actions"),
});

export type StealthTagType = z.infer<typeof StealthTag>;

export const ElementalSealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("elementalseal").default("elementalseal"),
  description: msg("Seals the target's ability to use jutsu of specified elements"),
  elements: z.array(z.enum(ElementNames)).min(1).default(["Fire"]),
});

export type ElementalSealTagType = z.infer<typeof ElementalSealTag>;

export const StunPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("stunprevent").default("stunprevent"),
  calculation: z.enum(["percentage"]).default("percentage"),
  description: msg("Prevents being stunned"),
});

export const ImmunityTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("immunity").default("immunity"),
  description: msg("Grants immunity against the specified prevent-type effect"),
  target: z.enum(BaseTagTargets).optional().default("SELF"),
  blocks: z.enum(PreventTagTypes).default("buffprevent"),
  rounds: z.coerce.number().int().min(1).max(20).default(2),
  calculation: z.enum(["static"]).default("static"),
});
export type ImmunityTagType = z.infer<typeof ImmunityTag>;

export const StunTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("stun").default("stun"),
  description: msg("Stuns the target"),
  apReduction: z.coerce.number().int().min(0).max(100).default(10),
});

export const SummonPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("summonprevent").default("summonprevent"),
  description: msg("Prevents summoning"),
});

export const SummonTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("summon").default("summon"),
  description: msg(
    "Summon an ally for a certain number of rounds. Its stats are scaled to same total as the summoner, modified by the power of the jutsu as a percentage.",
  ),
  rounds: z.coerce.number().int().min(2).max(100).default(2),
  aiId: z.string().default(""),
  aiHp: z.coerce.number().min(100).max(100000).default(100),
  calculation: z.enum(["percentage"]).default("percentage"),
});

export const VisualTag = z.object({
  ...BaseAttributes,
  type: z.literal("visual").default("visual"),
  description: msg("A battlefield visual effect"),
});

export const WeaknessTag = z.object({
  ...BaseAttributes,
  type: z.literal("weakness").default("weakness"),
  items: z.array(z.string()).default([]),
  jutsus: z.array(z.string()).default([]),
  elements: z.array(z.enum(ElementNames)).default([]),
  statTypes: z.array(z.enum(StatTypes)).default([]),
  generalTypes: z.array(z.enum(GeneralTypes)).default([]),
  description: msg("Extra raw damage from specific things"),
  dmgModifier: z.coerce.number().min(1).max(50).default(1).optional(),
});
export type WeaknessTagType = z.infer<typeof WeaknessTag>;

export const UnknownTag = z.object({
  ...BaseAttributes,
  type: z.literal("unknown").default("unknown"),
  description: msg("An unknown tag - please report & change!"),
});

export const IncreaseMarriageSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).default("D"),
  description: msg("Increases a users marriage slots"),
  power: z.coerce.number().int().min(0).max(100).default(1),
  type: z.literal("marriageslotincrease").default("marriageslotincrease"),
});

export const IncreaseReskinSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).default("D"),
  description: msg("Increases the number of allowed reskins"),
  power: z.coerce.number().int().min(0).max(100).default(1),
  type: z.literal("noncombatincreasereskins").default("noncombatincreasereskins"),
});

/**
 * InjectJutsusTag: Grants access to selected jutsus flagged as injectableInBattle
 * - editors must restrict selection to jutsus where injectableInBattle=true
 */
export const InjectJutsusTag = z.object({
  ...BaseAttributes,
  type: z.literal("injectjutsus").default("injectjutsus"),
  description: msg("Temporarily adds selected jutsus to the user's action list"),
  jutsuIds: z.array(z.string()).default([]),
});

export const NonCombatGainSkill = z.object({
  ...BaseAttributes,
  type: z.literal("noncombatgainskill").default("noncombatgainskill"),
  description: msg("Grants access to a special skill tree entry"),
  skillId: z.string().default(""),
});

/******************** */
/** UNIONS OF TAGS   **/
/******************** */
export const AllTags = z.union([
  AbsorbTag.default({}),
  AfterburnTag.default({}),
  BarrierTag.default({}),
  BuffPreventTag.default({}),
  CleansePreventTag.default({}),
  CleanseTag.default({}),
  ClearPreventTag.default({}),
  ClearTag.default({}),
  CloneTag.default({}),
  CopyTag.default({}),
  DamageTag.default({}),
  DebuffPreventTag.default({}),
  DecreaseCooldownTag.default({}),
  DecreaseDamageGivenTag.default({}),
  DecreaseDamageTakenTag.default({}),
  DecreaseHealGivenTag.default({}),
  DecreasePoolCostTag.default({}),
  DecreaseStatTag.default({}),
  DrainTag.default({}),
  ElementalSealTag.default({}),
  FinalStandTag.default({}),
  FleePreventTag.default({}),
  FleeTag.default({}),
  HealPreventTag.default({}),
  HealTag.default({}),
  IncreaseCooldownTag.default({}),
  IncreaseDamageGivenTag.default({}),
  IncreaseDamageTakenTag.default({}),
  IncreaseHealGivenTag.default({}),
  IncreaseMarriageSlots.default({}),
  IncreaseReskinSlots.default({}),
  InjectJutsusTag.default({}),
  IncreasePoolCostTag.default({}),
  IncreaseRangeTag.default({}),
  IncreaseStatTag.default({}),
  ImmunityTag.default({}),
  LifeStealTag.default({}),
  MirrorTag.default({}),
  MovePreventTag.default({}),
  MoveTag.default({}),
  NonCombatConsumeRewardTag.default({}),
  NonCombatGainSkill.default({}),
  RepairTag.default({}),
  OneHitKillPreventTag.default({}),
  OneHitKillTag.default({}),
  PierceTag.default({}),
  PoisonTag.default({}),
  RecoilTag.default({}),
  RedirectionTag.default({}),
  ReflectTag.default({}),
  RemoveBloodline.default({}),
  RobPreventTag.default({}),
  RobTag.default({}),
  RollRandomBloodline.default({}),
  SealPreventTag.default({}),
  SealTag.default({}),
  ShieldTag.default({}),
  StealthTag.default({}),
  StunPreventTag.default({}),
  StunTag.default({}),
  SummonPreventTag.default({}),
  SummonTag.default({}),
  TimeCompressionTag.default({}),
  TimeDilationTag.default({}),
  UnknownTag.default({}),
  VisualTag.default({}),
  WeaknessTag.default({}),
  WoundTag.default({}),
]);
export type ZodAllTags = z.infer<typeof AllTags>;
export const tagTypes = AllTags._def.options
  .map((o) => o._def.innerType.shape.type._def.innerType._def.value)
  .filter((t) => t !== "unknown");
export const effectFilters = tagTypes;
export type EffectType = (typeof effectFilters)[number];

/**
 * Returns true if it is a positive user effect
 * @param tag
 * @returns
 */
export const isPositiveUserEffect = (tag: ZodAllTags) => {
  if (
    [
      "absorb",
      // "clearprevent",
      "debuffprevent",
      "decreasedamagetaken",
      "decreasepoolcost",
      "heal",
      "increasedamagegiven",
      "increaseheal",
      "increasestat",
      "increaserange",
      "decreasecooldown",
      "lifesteal",
      "move",
      "moveprevent",
      "onehitkillprevent",
      "reflect",
      "robprevent",
      "sealprevent",
      "shield",
      "stealth",
      "stunprevent",
      "summon",
      "timedilation",
      "injectjutsus",
      "immunity",
    ].includes(tag.type)
  ) {
    return true;
  }
  // Default to return true
  return false;
};

/**
 * Returns true if it is a negative user effect
 * @param tag
 * @returns
 */
export const isNegativeUserEffect = (tag: ZodAllTags) => {
  if (
    [
      "afterburn",
      "buffprevent",
      // "cleanseprevent",
      "clear",
      "damage",
      "decreasedamagegiven",
      "decreaseheal",
      "decreasestat",
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
      "summonprevent",
      "timecompression",
      "weakness",
      "wound",
    ].includes(tag.type)
  ) {
    return true;
  }
  return false;
};

/** Based on type name, get the zod schema for validation of that tag */
export const getTagSchema = (type: ZodAllTags["type"]) => {
  const schema = AllTags._def.options.find(
    (o) => o._def.innerType.shape.type._def.innerType._def.value === type,
  );
  if (!schema) return UnknownTag;
  return schema._def.innerType;
};

/**
 * Refiner object, which is used to refine the data in the battle object
 */
interface ContentBaseValidatorType {
  target: (typeof AttackTargets)[number];
  method: (typeof AttackMethods)[number];
  range?: number;
  effects: ZodAllTags[];
}

interface ItemValidatorType
  extends Omit<Item, "id" | "createdAt" | "updatedAt" | "hidden"> {
  effects: ZodAllTags[];
}

/**
 * Convenience method for adding a custom zod validation error
 */
const addIssue = (ctx: z.RefinementCtx, message: string) => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
  });
};

/**
 * Validator for using a specific item/jutsu action
 */
const SuperRefineBase = (data: ContentBaseValidatorType, ctx: z.RefinementCtx) => {
  // Pick out various effect types
  const hasMove = data.effects.find((e) => e.type === "move");
  const hasClone = data.effects.find((e) => e.type === "clone");
  const hasSummon = data.effects.find((e) => e.type === "summon");
  const hasBarrier = data.effects.find((e) => e.type === "barrier");
  const hasDamage = data.effects.find((e) => e.type === "damage");
  const isAOE = data.method.includes("AOE");
  const isEmptyGround = data.target === "EMPTY_GROUND";
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
  const hasBloodlineRoll = data.effects.find((e) => e.type === "rollbloodline");
  const hasRemoveBloodline = data.effects.find((e) => e.type === "removebloodline");
  const hasNonCombatConsumeReward = data.effects.find(
    (e) => e.type === "noncombatconsumereward",
  );

  // Cost validation - exactly one cost type must be set
  const costTypes = [
    { name: "ryo", value: data.cost },
    { name: "reputation", value: data.repsCost },
    { name: "seichi silver", value: data.seichiSilverCost },
  ].filter((cost) => cost.value > 0);

  if (costTypes.length === 0) {
    addIssue(ctx, "Must have either a ryo, reputation points, or seichi silver cost");
  }

  if (data.itemType === "CONSUMABLE" && !data.destroyOnUse) {
    addIssue(ctx, "Consumable items must be destroyed on use");
  }
  if (hasNonCombatConsumeReward) {
    if (data.itemType !== "CONSUMABLE") {
      addIssue(ctx, "Non-combat consume reward must be consumable.");
    }
    if (data.target !== "SELF") {
      addIssue(ctx, "Non-combat consume reward must target self");
    }
    if (data.method !== "SINGLE") {
      addIssue(ctx, "Non-combat consume reward must have single method");
    }
  }
  if (hasBloodlineRoll || hasRemoveBloodline) {
    if (data.itemType !== "CONSUMABLE") {
      addIssue(ctx, "Items with bloodline roll must be consumable.");
    }
    if (data.target !== "SELF") {
      addIssue(ctx, "Items with bloodline roll must target self");
    }
    if (data.method !== "SINGLE") {
      addIssue(ctx, "Items with bloodline roll must have single method");
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
  const hasBloodlineRoll = data.effects.find((e) => e.type === "rollbloodline");
  const hasRemoveBloodline = data.effects.find((e) => e.type === "removebloodline");
  const hasNonCombatConsumeReward = data.effects.find(
    (e) => e.type === "noncombatconsumereward",
  );
  if (hasBloodlineRoll || hasRemoveBloodline) {
    addIssue(ctx, "Cannot have bloodline add/remove effects on jutsu");
  }
  if (hasNonCombatConsumeReward) {
    addIssue(ctx, "Cannot have non-combat consume reward on jutsu");
  }
};

/**
 * Validator specific to effects
 */
export const SuperRefineEffects = (effects: ZodAllTags[], ctx: z.RefinementCtx) => {
  effects.forEach((e) => {
    if (e.type === "barrier" && e.staticAssetPath === "") {
      addIssue(ctx, "BarrierTag needs a staticAssetPath");
    } else if (e.type === "wound") {
      const hasDamageOrPierce = effects.some(
        (x) => x.type === "damage" || x.type === "pierce",
      );
      if (!hasDamageOrPierce) {
        addIssue(
          ctx,
          "WoundTag must be used together with a damage or pierce effect on the same action",
        );
      }
    } else if (e.type === "rollbloodline" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for rollbloodline effect");
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

/**
 * Jutsu Type. Used for validating a jutsu object is set up properly
 */
export const JutsuValidatorRawSchema = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  battleDescription: z.string(),
  extraBaseCost: z.coerce.number().min(0).max(65_535),
  jutsuWeapon: z.enum(WeaponTypes),
  jutsuType: z.enum(JutsuTypes),
  jutsuRank: z.enum(LetterRanks),
  requiredRank: z.enum(UserRanks),
  requiredLevel: z.coerce.number().min(1).max(100),
  method: z.enum(AttackMethods),
  target: z.enum(AttackTargets),
  range: z.coerce.number().int().min(0).max(5),
  statClassification: z.enum(StatTypes),
  hidden: z.coerce.boolean().optional(),
  injectableInBattle: z.coerce.boolean().default(false),
  healthCost: z.coerce.number().min(0).max(10000),
  chakraCost: z.coerce.number().min(0).max(10000),
  staminaCost: z.coerce.number().min(0).max(10000),
  healthCostReducePerLvl: z.coerce.number().min(0).max(10000),
  chakraCostReducePerLvl: z.coerce.number().min(0).max(10000),
  staminaCostReducePerLvl: z.coerce.number().min(0).max(10000),
  actionCostPerc: z.coerce.number().int().min(10).max(100),
  cooldown: z.coerce.number().int().min(0).max(300),
  bloodlineId: z.string().nullable(),
  villageId: z.string().nullable(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
  battleUsageType: z.enum(BattleUsageTypes).default("BOTH"),
});

// Final validator with additional cross-field checks
export const JutsuValidator =
  JutsuValidatorRawSchema.superRefine(SuperRefineBase).superRefine(SuperRefineJutsu);
export type ZodJutsuType = z.infer<typeof JutsuValidator>;

/**
 * Bloodline Type. Used for validating a bloodline object is set up properly
 */
export const BloodlineValidator = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  rank: z.enum(LetterRanks),
  regenIncrease: z.coerce.number().int().min(0).max(100),
  statClassification: z.enum(StatTypes),
  villageId: z.string().nullable(),
  hidden: z.coerce.boolean().optional(),
  difficulty: z.enum(BloodlineDifficultyRatings).nullable().optional(),
  traits: z.string().max(256).nullable().optional(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
});
export type ZodBloodlineType = z.infer<typeof BloodlineValidator>;

/**
 * SkillTree Type. Used for validating a skill tree object is set up properly
 */
export const SkillTreeValidator = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  target: z.enum(SkillTreeTargets).default("SELF"),
  tier: z.coerce.number().int().min(1).max(10),
  requiredSkillIds: z.array(z.string()),
  costSkillPoints: z.coerce.number().int().min(1),
  hidden: z.coerce.boolean().optional(),
  skillType: z.enum(SkillTreeEntryTypes).default("DEFAULT"),
  folderId: z.string().nullish(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
});
export type ZodSkillTreeType = z.infer<typeof SkillTreeValidator>;

/**
 * Item Type. Used for validating a item object is set up properly
 */
export const ItemValidatorRawSchema = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  battleDescription: z.string(),
  stackSize: z.coerce.number().int().min(1).max(999),
  destroyOnUse: z.coerce.boolean().default(false),
  chakraCost: z.coerce.number().int().min(0).max(10000),
  healthCost: z.coerce.number().int().min(0).max(10000),
  staminaCost: z.coerce.number().int().min(0).max(10000),
  healthCostReducePerLvl: z.coerce.number().min(0).max(10000),
  chakraCostReducePerLvl: z.coerce.number().min(0).max(10000),
  staminaCostReducePerLvl: z.coerce.number().min(0).max(10000),
  actionCostPerc: z.coerce.number().int().min(1).max(100),
  canStack: z.coerce.boolean().default(false),
  maxImbueNumber: z.coerce.number().int().min(1).max(3),
  maxDurability: z.coerce.number().int().min(1).max(100),
  inShop: z.coerce.boolean().default(false),
  isEventItem: z.coerce.boolean().default(false),
  preventBattleUsage: z.coerce.boolean().default(false),
  hidden: z.coerce.boolean(),
  cooldown: z.coerce.number().int().min(0).max(300),
  cost: z.coerce.number().int().min(0),
  repsCost: z.coerce.number().int().min(0),
  seichiSilverCost: z.coerce.number().int().min(0),
  range: z.coerce.number().int().min(0).max(10),
  maxEquips: z.coerce.number().int().min(0).max(10),
  method: z.enum(AttackMethods),
  target: z.enum(AttackTargets),
  itemType: z.enum(ItemTypes),
  weaponType: z.enum(WeaponTypes),
  rarity: z.enum(ItemRarities),
  slot: z.enum(ItemSlotTypes),
  requiredLevel: z.coerce.number().int().min(1).max(100).default(1),
  expireFromStoreAt: z
    .string()
    .regex(DateTimeRegExp, "Must be of format YYYY-MM-DD")
    .nullable(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
  canBeImbued: z.coerce.boolean().default(false),
  canBeCrafted: z.coerce.boolean().default(false),
  canBeHunted: z.coerce.boolean().default(false),
  canBeGathered: z.coerce.boolean().default(false),
  canBeTraded: z.coerce.boolean().default(false),
  craftingExperience: z.coerce.number().int().min(0).default(0),
  crystalTargetTypes: z.enum(ItemTypes).nullable(),
  bloodlineId: z.string().nullable(),
  battleUsageType: z.enum(BattleUsageTypes).default("BOTH"),
  craftingRequirements: z
    .array(
      z.object({
        ids: z.array(z.string()),
        number: z.coerce.number().int().min(1).max(100),
      }),
    )
    .default([])
    .optional()
    .nullish(),
});
export const ItemValidator =
  ItemValidatorRawSchema.superRefine(SuperRefineBase).superRefine(SuperRefineItem);
export type ZodItemType = z.infer<typeof ItemValidator>;

/****************************** */
/*******  DMG SIMULATION  *******/
/****************************** */
const roundStat = (stat: number) => {
  return Math.round(stat * 100) / 100;
};

/**
 * Create a stats schema. Used for validating user stats, either starting stats,
 * stat changes, or stat differences
 * @returns - zod schema
 */
export const createStatSchema = (min = 10, start = 10, user?: UserData) => {
  const { gens_cap, stats_cap } = getUserCaps(user?.rank);
  return z.object({
    ninjutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.ninjutsuOffence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    taijutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.taijutsuOffence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    genjutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.genjutsuOffence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    bukijutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.bukijutsuOffence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    ninjutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.ninjutsuDefence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    taijutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.taijutsuDefence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    genjutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.genjutsuDefence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    bukijutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - Math.min(user?.bukijutsuDefence || 0, stats_cap))
      .transform(roundStat)
      .default(start),
    strength: z.coerce
      .number()
      .min(min)
      .max(gens_cap - Math.min(user?.strength || 0, gens_cap))
      .transform(roundStat)
      .default(start),
    speed: z.coerce
      .number()
      .min(min)
      .max(gens_cap - Math.min(user?.speed || 0, gens_cap))
      .transform(roundStat)
      .default(start),
    intelligence: z.coerce
      .number()
      .min(min)
      .max(gens_cap - Math.min(user?.intelligence || 0, gens_cap))
      .transform(roundStat)
      .default(start),
    willpower: z.coerce
      .number()
      .min(min)
      .max(gens_cap - Math.min(user?.willpower || 0, gens_cap))
      .transform(roundStat)
      .default(start),
  });
};

export const statSchema = createStatSchema();
export type StatSchemaType = z.infer<typeof statSchema>;

export const actSchema = z.object({
  power: z.coerce.number().min(1).max(100).default(1),
  statTypes: z.array(z.enum(StatTypes)).default(["Ninjutsu"]),
  generalTypes: z.array(z.enum(GeneralTypes)).default(["Strength"]),
});

export const confSchema = z.object({
  atk_scaling: z.coerce.number(),
  def_scaling: z.coerce.number(),
  exp_scaling: z.coerce.number(),
  dmg_scaling: z.coerce.number(),
  gen_scaling: z.coerce.number(),
  stats_scaling: z.coerce.number(),
  power_scaling: z.coerce.number(),
  dmg_base: z.coerce.number(),
});
