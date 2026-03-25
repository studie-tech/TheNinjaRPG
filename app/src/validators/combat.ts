import { z } from "zod";
import {
  AdjustableBasicActions,
  AttackMethods,
  AttackTargets,
  BattleUsageTypes,
  BloodlineDifficultyRatings,
  ElementNames,
  GeneralTypes,
  getUserCaps,
  ItemRarities,
  ItemSlotTypes,
  ItemTypes,
  JutsuTypes,
  LetterRanks,
  PoolTypes,
  SkillTreeEntryTypes,
  SkillTreeTargets,
  StatTypes,
  UserRanks,
  WeaponTypes,
} from "@/drizzle/constants";
import type { Item, UserData } from "@/drizzle/schema";
import { DateTimeRegExp } from "@/utils/regex";
import { rewardFields } from "@/validators/rewards";

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
  return z.string().prefault(defaultString);
};

const type = (defaultString: string) => {
  return z.literal(defaultString).prefault(defaultString);
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
  staticAssetPath: z.string().prefault(""),
  staticAnimation: z.string().prefault(""),
  appearAnimation: z.string().prefault(""),
  disappearAnimation: z.string().prefault(""),
  // SFX controls
  appearSfx: z.string().prefault(""),
  disappearSfx: z.string().prefault(""),
  // Timing controls
  rounds: z.coerce.number().int().min(0).max(100).optional(),
  timeTracker: z.record(z.string(), z.coerce.number()).optional(),
  // Power controls. Has different meanings depending on calculation
  power: z.coerce.number().min(-100).max(100).prefault(1),
  powerPerLevel: z.coerce.number().min(-1).max(1).prefault(0),
  // Used for indicating offensive / defensive effect
  direction: type("offence"),
  // Attack target, if different from the default
  target: z.enum(BaseTagTargets).optional().prefault("INHERIT"),
  // Enable / disables applying to friendlies. Default is to apply to all users
  friendlyFire: z.enum(["ALL", "FRIENDLY", "ENEMIES"]).optional(),
  // Default is for calculation to be static
  calculation: z.enum(["static"]).prefault("static"),
};

const PowerAttributes = {
  power: z.coerce.number().min(0).prefault(1),
  powerPerLevel: z.coerce.number().min(0).max(1).prefault(0),
};

const PoolAttributes = {
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health"]).optional(),
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
  type: z.literal("absorb").prefault("absorb"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  direction: type("defence"),
  description: msg("Absorb damage taken & convert to health, chakra or stamina"),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health"]),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
});

export const IncreaseDamageGivenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("increasedamagegiven").prefault("increasedamagegiven"),
  description: msg("Increase damage given by target"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const DecreaseDamageGivenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("decreasedamagegiven").prefault("decreasedamagegiven"),
  description: msg("Decrease damage given by target"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const IncreaseDamageTakenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("increasedamagetaken").prefault("increasedamagetaken"),
  description: msg("Increase damage taken of target"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const DecreaseDamageTakenTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("decreasedamagetaken").prefault("decreasedamagetaken"),
  description: msg("Decrease damage taken of target"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const IncreaseHealGivenTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("increaseheal").prefault("increaseheal"),
  description: msg("Increase how much target can heal others"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const DecreaseHealGivenTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("decreaseheal").prefault("decreaseheal"),
  description: msg("Decrease how much target can heal others"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const IncreasePoolCostTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("increasepoolcost").prefault("increasepoolcost"),
  description: msg("Increase cost of taking actions"),
  rounds: z.coerce.number().int().min(2).max(20).prefault(2),
  direction: type("defence"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const DecreasePoolCostTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("decreasepoolcost").prefault("decreasepoolcost"),
  description: msg("Decrease cost of taking actions"),
  rounds: z.coerce.number().int().min(2).max(20).prefault(2),
  direction: type("defence"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const IncreaseMaxPoolsTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("increasemaxpools").prefault("increasemaxpools"),
  description: msg("Increase maximum and current pool values"),
  calculation: z.enum(["static", "percentage"]).prefault("static"),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health"]),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
});

export const DecreaseMaxPoolsTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("decreasemaxpools").prefault("decreasemaxpools"),
  description: msg("Decrease maximum and current pool values"),
  calculation: z.enum(["static", "percentage"]).prefault("static"),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health"]),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
});

export const TimeCompressionTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("timecompression").prefault("timecompression"),
  description: msg("Increases AP cost of actions by 10"),
  rounds: z.coerce.number().int().min(1).max(20).prefault(1),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export type TimeCompressionTagType = z.infer<typeof TimeCompressionTag>;

export const TimeDilationTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("timedilation").prefault("timedilation"),
  description: msg("Decreases AP cost of actions by 10"),
  rounds: z.coerce.number().int().min(1).max(20).prefault(1),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export type TimeDilationTagType = z.infer<typeof TimeDilationTag>;

export const RedirectionTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("redirection").prefault("redirection"),
  description: msg(
    "Redirects the target towards or away from the user by power number of spaces",
  ),
  rounds: z.coerce.number().int().min(0).max(0).prefault(0),
  calculation: z.enum(["static"]).prefault("static"),
  direction: z.enum(["push", "pull"]).prefault("pull"),
});
export type RedirectionTagType = z.infer<typeof RedirectionTag>;

export const IncreaseRangeTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("increaserange").prefault("increaserange"),
  description: msg("Increase range of basic actions"),
  calculation: z.enum(["static"]).prefault("static"),
  actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
});

export const IncreaseCooldownTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("increasecooldown").prefault("increasecooldown"),
  description: msg("Increase cooldown of basic actions"),
  calculation: z.enum(["static"]).prefault("static"),
  actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
});

export const DecreaseCooldownTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("decreasecooldown").prefault("decreasecooldown"),
  description: msg("Decrease cooldown of basic actions"),
  calculation: z.enum(["static"]).prefault("static"),
  actionsAffected: z.array(z.enum(AdjustableBasicActions)).optional(),
});

export const IncreaseStatTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("increasestat").prefault("increasestat"),
  direction: z.enum(["offence", "defence", "both"]).prefault("both"),
  description: msg("Increase stats of target"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const DecreaseStatTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("decreasestat").prefault("decreasestat"),
  direction: z.enum(["offence", "defence", "both"]).prefault("both"),
  description: msg("Decrease stats of target"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const BarrierTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("barrier").prefault("barrier"),
  curHealth: z.coerce.number().int().min(1).max(100000).prefault(100),
  maxHealth: z.coerce.number().int().min(1).max(100000).prefault(100),
  absorbPercentage: z.coerce.number().int().min(1).max(100).prefault(50),
  direction: type("defence"),
  description: msg("Creates a barrier with level corresponding to power"),
});

export type BarrierTagType = z.infer<typeof BarrierTag>;

export const BuffPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("buffprevent").prefault("buffprevent"),
  description: msg("Prevents buffing"),
});

export const ClearTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("clear").prefault("clear"),
  description: msg("Clears all positive effects from the target"),
});

export const ClearPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("clearprevent").prefault("clearprevent"),
  description: msg("Prevents clearing"),
});

export const CleanseTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("cleanse").prefault("cleanse"),
  description: msg("Clears all negative effects from the target"),
});

export const CleansePreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("cleanseprevent").prefault("cleanseprevent"),
  description: msg("Prevents cleansing"),
});

export const CloneTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("clone").prefault("clone"),
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
  type: z.literal("damage").prefault("damage"),
  description: msg("Deals damage to target"),
  calculation: z.enum(["formula", "static", "percentage"]).prefault("formula"),
  residualModifier: z.coerce.number().min(0).max(2).prefault(1).optional(),
  dmgModifier: z.coerce.number().min(0).max(2).prefault(1).optional(),
  allowBloodlineDamageIncrease: z.coerce.boolean().prefault(true),
  allowBloodlineDamageDecrease: z.coerce.boolean().prefault(true),
});
export type DamageTagType = z.infer<typeof DamageTag>;

export const CopyTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("copy").prefault("copy"),
  description: msg("Copies some positive effects from the target to the user"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
});
export type CopyTagType = z.infer<typeof CopyTag>;

export const MirrorTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("mirror").prefault("mirror"),
  description: msg("Mirrors some negative effects from the user to the target"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
});
export type MirrorTagType = z.infer<typeof MirrorTag>;

export const PierceTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("pierce").prefault("pierce"),
  description: msg("Deals piercing damage to target"),
  calculation: z.enum(["formula", "static", "percentage"]).prefault("formula"),
  residualModifier: z.coerce.number().min(0).max(2).prefault(1).optional(),
  dmgModifier: z.coerce.number().min(0).max(2).prefault(1).optional(),
  allowBloodlineDamageIncrease: z.coerce.boolean().prefault(true),
  allowBloodlineDamageDecrease: z.coerce.boolean().prefault(true),
});
export type PierceTagType = z.infer<typeof PierceTag>;

export const DebuffPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("debuffprevent").prefault("debuffprevent"),
  description: msg("Prevents debuffing"),
});

export const FleeTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("flee").prefault("flee"),
  description: msg("Flee the battle"),
});

export const FleePreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("fleeprevent").prefault("fleeprevent"),
  description: msg("Prevents fleeing"),
});

export const HealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("heal").prefault("heal"),
  rounds: z.coerce.number().int().min(0).max(100).prefault(0),
  description: msg("Heals themselves or others"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const HealPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("healprevent").prefault("healprevent"),
  description: msg("Prevents healing"),
});

export const LifeStealTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("lifesteal").prefault("lifesteal"),
  description: msg("Heal based on damage given"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const VampTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("vamp").prefault("vamp"),
  description: msg(
    "Instantly heal yourself based on a percentage of the damage dealt by this jutsu",
  ),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});
export type VampTagType = z.infer<typeof VampTag>;

export const DrainTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("drain").prefault("drain"),
  description: msg("Drain target's pools over time"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Chakra", "Stamina", "Health"]),
});
export type DrainTagType = z.infer<typeof DrainTag>;

export const PoisonTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  ...PoolAttributes,
  type: z.literal("poison").prefault("poison"),
  description: msg("Deal damage based on Chakra and Stamina lost"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).prefault(3),
  poolsAffected: z.array(z.enum(PoolTypes)).prefault(["Health", "Chakra", "Stamina"]),
});
export type PoisonTagType = z.infer<typeof PoisonTag>;

export const ShieldTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("shield").prefault("shield"),
  description: msg("Creates a temporary HP bar that lasts for a set amount of rounds"),
  rounds: z.coerce.number().int().min(1).max(100).prefault(3),
  health: z.coerce.number().int().min(1).max(100000).prefault(100),
});
export type ShieldTagType = z.infer<typeof ShieldTag>;

export const FinalStandTag = z.object({
  ...BaseAttributes,
  type: z.literal("finalstand").prefault("finalstand"),
  description: msg("User cannot be reduced below 1 HP"),
  power: z.coerce.number().min(0).max(100).prefault(100),
  powerPerLevel: z.coerce.number().min(0).max(1).prefault(0),
});
export type FinalStandTagType = z.infer<typeof FinalStandTag>;

export const MoveTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("move").prefault("move"),
  description: msg("Move on the battlefield"),
});

export type MoveTagType = z.infer<typeof MoveTag>;

export const MovePreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("moveprevent").prefault("moveprevent"),
  description: msg("Prevents movement of the target"),
});

export const OneHitKillTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("onehitkill").prefault("onehitkill"),
  description: msg("Instantly kills the target"),
});

export const OneHitKillPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("onehitkillprevent").prefault("onehitkillprevent"),
  description: msg("Prevents instant kill effects"),
});

export const ReflectTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("reflect").prefault("reflect"),
  description: msg("Reflect damage taken"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const WoundTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("wound").prefault("wound"),
  description: msg("Applies wound damage over multiple turns based on damage dealt"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  rounds: z.coerce.number().int().min(1).max(20).prefault(1),
});
export type WoundTagType = z.infer<typeof WoundTag>;

export const RemoveBloodline = z.object({
  ...BaseAttributes,
  type: z.literal("removebloodline").prefault("removebloodline"),
  description: msg("Remove bloodline"),
  power: z.coerce.number().int().min(0).max(100).prefault(1),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const RecoilTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("recoil").prefault("recoil"),
  description: msg("Recoil damage given back to self"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const AfterburnTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("afterburn").prefault("afterburn"),
  description: msg("Take a percentage of incoming damage as afterburndamage"),
  calculation: z.enum(["static", "percentage"]).prefault("percentage"),
});

export const RobPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("robprevent").prefault("robprevent"),
  description: msg("Prevents robbing of the target"),
});

export const RobTag = z.object({
  ...BaseAttributes,
  ...IncludeStats,
  ...PowerAttributes,
  type: z.literal("rob").prefault("rob"),
  description: msg("Robs money from the target"),
  robPercentage: z.coerce.number().int().min(0).max(100).prefault(1),
});

export const RollRandomBloodline = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).prefault("D"),
  description: msg("Receive a random bloodline"),
  power: z.coerce.number().min(0).max(100).prefault(1),
  type: z.literal("rollbloodline").prefault("rollbloodline"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const NonCombatConsumeRewardTag = z.object({
  ...BaseAttributes,
  ...rewardFields,
  type: z.literal("noncombatconsumereward").prefault("noncombatconsumereward"),
  description: msg("Gain various rewards from consumption outside of combat"),
});
export type NonCombatConsumeRewardTagType = z.infer<typeof NonCombatConsumeRewardTag>;

export const RepairTag = z.object({
  ...BaseAttributes,
  type: z.literal("repair").prefault("repair"),
  description: msg("Repair an item's durability by the power amount"),
});
export type RepairTagType = z.infer<typeof RepairTag>;

export const SealPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("sealprevent").prefault("sealprevent"),
  description: msg("Prevents bloodline from being sealed"),
});

export const SealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("seal").prefault("seal"),
  description: msg("Seals the target's bloodline effects"),
});

export const StealthTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("stealth").prefault("stealth"),
  description: msg("Stealth the target, only allowing non-damaging jutsu and actions"),
});

export type StealthTagType = z.infer<typeof StealthTag>;

export const ElementalSealTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("elementalseal").prefault("elementalseal"),
  description: msg("Seals the target's ability to use jutsu of specified elements"),
  elements: z.array(z.enum(ElementNames)).min(1).prefault(["Fire"]),
});

export type ElementalSealTagType = z.infer<typeof ElementalSealTag>;

export const StunPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("stunprevent").prefault("stunprevent"),
  calculation: z.enum(["percentage"]).prefault("percentage"),
  description: msg("Prevents being stunned"),
});

export const ImmunityTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("immunity").prefault("immunity"),
  description: msg("Grants immunity against the specified prevent-type effect"),
  target: z.enum(BaseTagTargets).optional().prefault("SELF"),
  blocks: z.enum(PreventTagTypes).prefault("buffprevent"),
  rounds: z.coerce.number().int().min(1).max(20).prefault(2),
  calculation: z.enum(["static"]).prefault("static"),
});
export type ImmunityTagType = z.infer<typeof ImmunityTag>;

export const StunTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("stun").prefault("stun"),
  description: msg("Stuns the target"),
  apReduction: z.coerce.number().int().min(0).max(100).prefault(10),
});

export const SummonPreventTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("summonprevent").prefault("summonprevent"),
  description: msg("Prevents summoning"),
});

export const SummonTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("summon").prefault("summon"),
  description: msg(
    "Summon an ally for a certain number of rounds. Its stats are scaled to same total as the summoner, modified by the power of the jutsu as a percentage.",
  ),
  rounds: z.coerce.number().int().min(2).max(100).prefault(2),
  aiId: z.string().prefault(""),
  aiHp: z.coerce.number().min(100).max(100000).prefault(100),
  calculation: z.enum(["percentage"]).prefault("percentage"),
});

export const VisualTag = z.object({
  ...BaseAttributes,
  type: z.literal("visual").prefault("visual"),
  description: msg("A battlefield visual effect"),
});

export const WeaknessTag = z.object({
  ...BaseAttributes,
  type: z.literal("weakness").prefault("weakness"),
  items: z.array(z.string()).prefault([]),
  jutsus: z.array(z.string()).prefault([]),
  elements: z.array(z.enum(ElementNames)).prefault([]),
  statTypes: z.array(z.enum(StatTypes)).prefault([]),
  generalTypes: z.array(z.enum(GeneralTypes)).prefault([]),
  description: msg("Extra raw damage from specific things"),
  dmgModifier: z.coerce.number().min(1).max(50).prefault(1).optional(),
});
export type WeaknessTagType = z.infer<typeof WeaknessTag>;

export const UnknownTag = z.object({
  ...BaseAttributes,
  type: z.literal("unknown").prefault("unknown"),
  description: msg("An unknown tag - please report & change!"),
});

export const IncreaseMarriageSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).prefault("D"),
  description: msg("Increases a users marriage slots"),
  power: z.coerce.number().int().min(0).max(100).prefault(1),
  type: z.literal("marriageslotincrease").prefault("marriageslotincrease"),
});

export const IncreaseReskinSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).prefault("D"),
  description: msg("Increases the number of allowed reskins"),
  power: z.coerce.number().int().min(0).max(100).prefault(1),
  type: z.literal("noncombatincreasereskins").prefault("noncombatincreasereskins"),
});

/**
 * InjectJutsusTag: Grants access to selected jutsus flagged as injectableInBattle
 * - editors must restrict selection to jutsus where injectableInBattle=true
 */
export const InjectJutsusTag = z.object({
  ...BaseAttributes,
  type: z.literal("injectjutsus").prefault("injectjutsus"),
  description: msg("Temporarily adds selected jutsus to the user's action list"),
  jutsuIds: z.array(z.string()).prefault([]),
});

export const NonCombatGainSkill = z.object({
  ...BaseAttributes,
  type: z.literal("noncombatgainskill").prefault("noncombatgainskill"),
  description: msg("Grants access to a special skill tree entry"),
  skillId: z.string().prefault(""),
});

/******************** */
/** UNIONS OF TAGS   **/
/******************** */
export const AllTags = z.union([
  AbsorbTag.prefault({}),
  AfterburnTag.prefault({}),
  BarrierTag.prefault({}),
  BuffPreventTag.prefault({}),
  CleansePreventTag.prefault({}),
  CleanseTag.prefault({}),
  ClearPreventTag.prefault({}),
  ClearTag.prefault({}),
  CloneTag.prefault({}),
  CopyTag.prefault({}),
  DamageTag.prefault({}),
  DebuffPreventTag.prefault({}),
  DecreaseCooldownTag.prefault({}),
  DecreaseDamageGivenTag.prefault({}),
  DecreaseDamageTakenTag.prefault({}),
  DecreaseHealGivenTag.prefault({}),
  DecreasePoolCostTag.prefault({}),
  DecreaseMaxPoolsTag.prefault({}),
  DecreaseStatTag.prefault({}),
  DrainTag.prefault({}),
  ElementalSealTag.prefault({}),
  FinalStandTag.prefault({}),
  FleePreventTag.prefault({}),
  FleeTag.prefault({}),
  HealPreventTag.prefault({}),
  HealTag.prefault({}),
  IncreaseCooldownTag.prefault({}),
  IncreaseDamageGivenTag.prefault({}),
  IncreaseDamageTakenTag.prefault({}),
  IncreaseHealGivenTag.prefault({}),
  IncreaseMarriageSlots.prefault({}),
  IncreaseReskinSlots.prefault({}),
  InjectJutsusTag.prefault({}),
  IncreasePoolCostTag.prefault({}),
  IncreaseMaxPoolsTag.prefault({}),
  IncreaseRangeTag.prefault({}),
  IncreaseStatTag.prefault({}),
  ImmunityTag.prefault({}),
  LifeStealTag.prefault({}),
  MirrorTag.prefault({}),
  MovePreventTag.prefault({}),
  MoveTag.prefault({}),
  NonCombatConsumeRewardTag.prefault({}),
  NonCombatGainSkill.prefault({}),
  RepairTag.prefault({}),
  OneHitKillPreventTag.prefault({}),
  OneHitKillTag.prefault({}),
  PierceTag.prefault({}),
  PoisonTag.prefault({}),
  RecoilTag.prefault({}),
  RedirectionTag.prefault({}),
  ReflectTag.prefault({}),
  RemoveBloodline.prefault({}),
  RobPreventTag.prefault({}),
  RobTag.prefault({}),
  RollRandomBloodline.prefault({}),
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
  UnknownTag.prefault({}),
  VampTag.prefault({}),
  VisualTag.prefault({}),
  WeaknessTag.prefault({}),
  WoundTag.prefault({}),
]);
export type ZodAllTags = z.infer<typeof AllTags>;
export const tagTypes = AllTags.options
  .map((o) => {
    const inner = o.unwrap(); // ZodObject
    const typeField = inner.shape.type;
    const literal = typeField.unwrap(); // ZodLiteral
    return literal.value as string;
  })
  .filter((t): t is string => t !== "unknown" && t !== undefined);
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
      "increasemaxpools",
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
      //"injectjutsus",
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
      "decreasemaxpools",
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
  const schema = AllTags.options.find((o) => {
    const inner = o.unwrap();
    const typeField = inner.shape.type;
    const literal = typeField.unwrap();
    return literal.value === type;
  });
  if (!schema) return UnknownTag;
  return schema.unwrap();
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
    code: "custom",
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
    } else if (e.type === "vamp") {
      const hasDamageOrPierce = effects.some(
        (x) => x.type === "damage" || x.type === "pierce",
      );
      if (!hasDamageOrPierce) {
        addIssue(
          ctx,
          "VampTag must be used together with a damage or pierce effect on the same action",
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
  injectableInBattle: z.coerce.boolean().prefault(false),
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
  battleUsageType: z.enum(BattleUsageTypes).prefault("BOTH"),
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
  statClassification: z.enum(StatTypes),
  villageId: z.string().nullable(),
  hidden: z.coerce.boolean().optional(),
  difficulty: z.enum(BloodlineDifficultyRatings).nullable().optional(),
  traits: z.string().max(256).nullable().optional(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
});
export type ZodBloodlineType = z.output<typeof BloodlineValidator>;
export type ZodBloodlineInput = z.input<typeof BloodlineValidator>;

/**
 * SkillTree Type. Used for validating a skill tree object is set up properly
 */
export const SkillTreeValidator = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  target: z.enum(SkillTreeTargets).prefault("SELF"),
  tier: z.coerce.number().int().min(1).max(10),
  requiredSkillIds: z.array(z.string()),
  costSkillPoints: z.coerce.number().int().min(1),
  hidden: z.coerce.boolean().optional(),
  skillType: z.enum(SkillTreeEntryTypes).prefault("DEFAULT"),
  folderId: z.string().nullish(),
  effects: z.array(AllTags).superRefine(SuperRefineEffects),
});
export type ZodSkillTreeType = z.output<typeof SkillTreeValidator>;
export type ZodSkillTreeInput = z.input<typeof SkillTreeValidator>;

/**
 * Item Type. Used for validating a item object is set up properly
 */
export const ItemValidatorRawSchema = z.object({
  name: z.string().trim(),
  image: z.string(),
  description: z.string(),
  battleDescription: z.string(),
  stackSize: z.coerce.number().int().min(1).max(999),
  destroyOnUse: z.coerce.boolean().prefault(false),
  chakraCost: z.coerce.number().int().min(0).max(10000),
  healthCost: z.coerce.number().int().min(0).max(10000),
  staminaCost: z.coerce.number().int().min(0).max(10000),
  healthCostReducePerLvl: z.coerce.number().min(0).max(10000),
  chakraCostReducePerLvl: z.coerce.number().min(0).max(10000),
  staminaCostReducePerLvl: z.coerce.number().min(0).max(10000),
  actionCostPerc: z.coerce.number().int().min(1).max(100),
  canStack: z.coerce.boolean().prefault(false),
  maxImbueNumber: z.coerce.number().int().min(1).max(3),
  maxDurability: z.coerce.number().int().min(1).max(100),
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
  target: z.enum(AttackTargets),
  itemType: z.enum(ItemTypes),
  weaponType: z.enum(WeaponTypes),
  rarity: z.enum(ItemRarities),
  slot: z.enum(ItemSlotTypes),
  requiredLevel: z.coerce.number().int().min(1).max(100).prefault(1),
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
  craftingExperience: z.coerce.number().int().min(0).prefault(0),
  crystalTargetTypes: z.enum(ItemTypes).nullable(),
  bloodlineId: z.string().nullable(),
  battleUsageType: z.enum(BattleUsageTypes).prefault("BOTH"),
  craftingRequirements: z
    .array(
      z.object({
        ids: z.array(z.string()),
        number: z.coerce.number().int().min(1).max(100),
      }),
    )
    .prefault([])
    .optional()
    .nullish(),
});
export const ItemValidator =
  ItemValidatorRawSchema.superRefine(SuperRefineBase).superRefine(SuperRefineItem);
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
export const createStatSchema = (min = 10, start = 10, user?: UserData) => {
  const { gens_cap, stats_cap } = getUserCaps(user?.rank);

  // Calculate max values for each stat
  const maxValues = {
    ninjutsuOffence: stats_cap - Math.min(user?.ninjutsuOffence || 0, stats_cap),
    taijutsuOffence: stats_cap - Math.min(user?.taijutsuOffence || 0, stats_cap),
    genjutsuOffence: stats_cap - Math.min(user?.genjutsuOffence || 0, stats_cap),
    bukijutsuOffence: stats_cap - Math.min(user?.bukijutsuOffence || 0, stats_cap),
    ninjutsuDefence: stats_cap - Math.min(user?.ninjutsuDefence || 0, stats_cap),
    taijutsuDefence: stats_cap - Math.min(user?.taijutsuDefence || 0, stats_cap),
    genjutsuDefence: stats_cap - Math.min(user?.genjutsuDefence || 0, stats_cap),
    bukijutsuDefence: stats_cap - Math.min(user?.bukijutsuDefence || 0, stats_cap),
    strength: gens_cap - Math.min(user?.strength || 0, gens_cap),
    speed: gens_cap - Math.min(user?.speed || 0, gens_cap),
    intelligence: gens_cap - Math.min(user?.intelligence || 0, gens_cap),
    willpower: gens_cap - Math.min(user?.willpower || 0, gens_cap),
  };

  const schema = z.object({
    ninjutsuOffence: z.coerce
      .number()
      .min(min)
      .max(maxValues.ninjutsuOffence)
      .transform(roundStat)
      .prefault(start),
    taijutsuOffence: z.coerce
      .number()
      .min(min)
      .max(maxValues.taijutsuOffence)
      .transform(roundStat)
      .prefault(start),
    genjutsuOffence: z.coerce
      .number()
      .min(min)
      .max(maxValues.genjutsuOffence)
      .transform(roundStat)
      .prefault(start),
    bukijutsuOffence: z.coerce
      .number()
      .min(min)
      .max(maxValues.bukijutsuOffence)
      .transform(roundStat)
      .prefault(start),
    ninjutsuDefence: z.coerce
      .number()
      .min(min)
      .max(maxValues.ninjutsuDefence)
      .transform(roundStat)
      .prefault(start),
    taijutsuDefence: z.coerce
      .number()
      .min(min)
      .max(maxValues.taijutsuDefence)
      .transform(roundStat)
      .prefault(start),
    genjutsuDefence: z.coerce
      .number()
      .min(min)
      .max(maxValues.genjutsuDefence)
      .transform(roundStat)
      .prefault(start),
    bukijutsuDefence: z.coerce
      .number()
      .min(min)
      .max(maxValues.bukijutsuDefence)
      .transform(roundStat)
      .prefault(start),
    strength: z.coerce
      .number()
      .min(min)
      .max(maxValues.strength)
      .transform(roundStat)
      .prefault(start),
    speed: z.coerce
      .number()
      .min(min)
      .max(maxValues.speed)
      .transform(roundStat)
      .prefault(start),
    intelligence: z.coerce
      .number()
      .min(min)
      .max(maxValues.intelligence)
      .transform(roundStat)
      .prefault(start),
    willpower: z.coerce
      .number()
      .min(min)
      .max(maxValues.willpower)
      .transform(roundStat)
      .prefault(start),
  });

  return { schema, maxValues };
};

export const { schema: statSchema, maxValues: defaultStatMaxValues } =
  createStatSchema();
export type StatSchemaType = z.infer<typeof statSchema>;

export const actSchema = z.object({
  power: z.coerce.number().min(1).max(100).prefault(1),
  statTypes: z.array(z.enum(StatTypes)).prefault(["Ninjutsu"]),
  generalTypes: z.array(z.enum(GeneralTypes)).prefault(["Strength"]),
});

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
