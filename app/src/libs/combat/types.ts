import { z } from "zod";
import { AttackMethods, AttackTargets, ItemRarities } from "@/drizzle/constants";
import { ItemSlotTypes, ItemTypes, JutsuTypes } from "@/drizzle/constants";
import { LetterRanks, UserRanks, WeaponTypes } from "@/drizzle/constants";
import { ElementNames } from "@/drizzle/constants";
import { StatTypes, GeneralTypes, PoolTypes } from "@/drizzle/constants";
import { MAX_STATS_CAP, MAX_GENS_CAP, USER_CAPS } from "@/drizzle/constants";
import type { StatType, GeneralType, PoolType, ElementName } from "@/drizzle/constants";
import type { publicState } from "@/libs/combat/constants";
import type { StatNames, GenNames } from "@/libs/combat/constants";
import type { Jutsu, Item, VillageAlliance, Clan, War } from "@/drizzle/schema";
import type { UserJutsu, UserItem, UserData, AiProfile, RankedUserJutsu, RankedLoadout } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";
import type { BattleType } from "@/drizzle/constants";
import type { WarAlly } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";

export type BattleWar = War & {
  warAllies: WarAlly[];
  attackerVillage: { name: string } | null;
  defenderVillage: { name: string } | null;
};

/**
 * BattleUserState is the data stored in the battle entry about a given user
 */
export type BattleUserState = UserWithRelations & {
  jutsus: (UserJutsu & {
    jutsu: Jutsu;
    lastUsedRound: number;
  })[];
  rankedUserJutsus: (RankedUserJutsu & {
    jutsu: Jutsu;
    lastUsedRound: number;
    experience: number;
  })[];
  rankedLoadout?: RankedLoadout & {
    weapon?: Item;
    consumable1?: Item;
    consumable2?: Item;
  };
  basicActions: CombatAction[];
  items: (UserItem & {
    item: Item;
    lastUsedRound: number;
  })[];
  aiProfile: AiProfile;
  round: number;
  loadout?: { jutsuIds: string[] } | null;
  relations: VillageAlliance[];
  wars: BattleWar[];
  highestOffence: (typeof StatNames)[number];
  highestDefence: (typeof StatNames)[number];
  highestGenerals: (typeof GenNames)[number][];
  iAmHere: boolean;
  actionPoints: number;
  hidden?: boolean;
  isOriginal: boolean;
  isAggressor: boolean;
  controllerId: string;
  leftBattle: boolean;
  fledBattle: boolean;
  initiative: number;
  originalLongitude: number;
  originalLatitude: number;
  originalMoney: number;
  direction: "left" | "right";
  allyVillage: boolean;
  moneyStolen: number;
  usedGenerals: Record<(typeof GenNames)[number], number>;
  usedStats: Record<(typeof StatNames)[number], number>;
  usedActions: { id: string; type: "jutsu" | "item" | "basic" | "bloodline" }[];
  hex?: TerrainHex;
  clan?: Clan | null;
};

// Create type for battle, which contains information on user current state
export type CompleteBattle = {
  usersState: BattleUserState[];
  usersEffects: UserEffect[];
  groundEffects: GroundEffect[];
  id: string;
  activeUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  roundStartAt: Date;
  background: string;
  battleType: BattleType;
  version: number;
  round: number;
  rewardScaling: number;
};

/**
 * User state returned is masked to hide confidential information about other players
 */
export type ReturnedUserState = Pick<BattleUserState, (typeof publicState)[number]> &
  Partial<BattleUserState>;

/**
 * A returned battle used on frontend where private information is hidden
 */
export type ReturnedBattle = Omit<CompleteBattle, "usersState"> & {
  usersState: ReturnedUserState[];
};

/**
 * Result type for users when battle is ended
 */
export type CombatResult = {
  outcome: "Won" | "Lost" | "Draw" | "Fled";
  didWin: number;
  eloDiff: number;
  experience: number;
  pvpStreak: number;
  curHealth: number;
  curStamina: number;
  curChakra: number;
  strength: number;
  intelligence: number;
  willpower: number;
  speed: number;
  money: number;
  ninjutsuOffence: number;
  ninjutsuDefence: number;
  genjutsuOffence: number;
  genjutsuDefence: number;
  taijutsuOffence: number;
  taijutsuDefence: number;
  bukijutsuOffence: number;
  bukijutsuDefence: number;
  villagePrestige: number;
  friendsLeft: number;
  targetsLeft: number;
  villageTokens: number;
  townhallChangeHP: number;
  shrineChangeHp: number;
  townhallInfo: Record<string, number>;
  shrineInfo: Record<number, number>;
  clanPoints: number;
  notifications: string[];
};

export type CombatAction = {
  id: string;
  name: string;
  image: string;
  battleDescription: string;
  type: "basic" | "jutsu" | "item";
  target: (typeof AttackTargets)[number];
  method: (typeof AttackMethods)[number];
  range: number;
  healthCost: number;
  chakraCost: number;
  staminaCost: number;
  actionCostPerc: number;
  updatedAt: number;
  cooldown: number;
  effects: ZodAllTags[];
  lastUsedRound?: number;
  data?: Jutsu | Item;
  level?: number;
  quantity?: number;
  hidden?: boolean;
};

export interface BattleState {
  battle?: ReturnedBattle | null | undefined;
  result: CombatResult | null | undefined;
  isPending: boolean;
}

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
 * Battle Consequence, i.e. the permanent things that happen to a user as a result of an action
 */
export type Consequence = {
  userId: string;
  targetId: string;
  heal_hp?: number;
  heal_sp?: number;
  heal_cp?: number;
  damage?: number;
  residual?: number;
  reflect?: number;
  recoil?: number;
  lifesteal_hp?: number;
  absorb_hp?: number;
  absorb_sp?: number;
  absorb_cp?: number;
  drain_hp?: number;
  drain_cp?: number;
  drain_sp?: number;
  poison?: number;
  types?: (GeneralType | StatType | ElementName | PoolType | ZodAllTags["type"])[];
};

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
  power: z.coerce.number().min(1).max(100).default(1),
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
  description: msg("Copies all positive effects from the target to the user"),
  calculation: z.enum(["percentage"]).default("percentage"),
  rounds: z.coerce.number().int().min(1).max(10).default(3),
});
export type CopyTagType = z.infer<typeof CopyTag>;

export const MirrorTag = z.object({
  ...BaseAttributes,
  ...PowerAttributes,
  type: z.literal("mirror").default("mirror"),
  description: msg("Mirrors all negative effects from the user to the target"),
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
  calculation: z.enum(["percentage"]).default("percentage"),
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
  description: msg("%user cannot be reduced below 1 HP"),
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
  power: z.coerce.number().int().min(0).max(100).default(1),
  type: z.literal("rollbloodline").default("rollbloodline"),
  calculation: z.enum(["percentage"]).default("percentage"),
});

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
  description: msg("Stealth the target, only allowing basic move and heal actions"),
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

export const GroundTag = z.object({
  ...BaseAttributes,
  type: z.literal("ground").default("ground"),
  description: msg("ground dot"),
});

export const IncreaseMarriageSlots = z.object({
  ...BaseAttributes,
  rank: z.enum(LetterRanks).default("D"),
  description: msg("Increases a users marriage slots"),
  power: z.coerce.number().int().min(0).max(100).default(1),
  type: z.literal("marriageslotincrease").default("marriageslotincrease"),
});

/******************** */
/** UNIONS OF TAGS   **/
/******************** */
export const AllTags = z.union([
  AbsorbTag.default({}),
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
  GroundTag.default({}),
  HealPreventTag.default({}),
  HealTag.default({}),
  IncreaseDamageGivenTag.default({}),
  IncreaseDamageTakenTag.default({}),
  IncreaseHealGivenTag.default({}),
  IncreaseMarriageSlots.default({}),
  IncreasePoolCostTag.default({}),
  IncreaseStatTag.default({}),
  LifeStealTag.default({}),
  MirrorTag.default({}),
  MovePreventTag.default({}),
  MoveTag.default({}),
  OneHitKillPreventTag.default({}),
  OneHitKillTag.default({}),
  PierceTag.default({}),
  PoisonTag.default({}),
  RecoilTag.default({}),
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
  UnknownTag.default({}),
  VisualTag.default({}),
  WeaknessTag.default({}),
]);
export type ZodAllTags = z.infer<typeof AllTags>;
export const tagTypes = AllTags._def.options
  .map((o) => o._def.innerType.shape.type._def.innerType._def.value)
  .filter((t) => t !== "unknown");

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
      "stealth",
      "debuffprevent",
      "decreasedamagetaken",
      "decreasepoolcost",
      "heal",
      "lifesteal",
      "increasedamagegiven",
      "increaseheal",
      "increasestat",
      "move",
      "moveprevent",
      "onehitkillprevent",
      "reflect",
      "robprevent",
      "sealprevent",
      "stunprevent",
      "summon",
      "shield",
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
      // "cleanseprevent",
      "buffprevent",
      "decreasedamagegiven",
      "drain",
      "increasedamagetaken",
      "decreaseheal",
      "increasepoolcost",
      "decreasestat",
      "clear",
      "damage",
      "moveprevent",
      "pierce",
      "poison",
      "recoil",
      "flee",
      "fleeprevent",
      "onehitkill",
      "rob",
      "seal",
      "summonprevent",
      "weakness",
      "healprevent",
      "elementalseal",
    ].includes(tag.type)
  ) {
    return true;
  }
  return false;
};

const BloodlineTags = z.union([
  AbsorbTag.default({}),
  CleansePreventTag.default({}),
  ClearPreventTag.default({}),
  DamageTag.default({}),
  DecreaseDamageGivenTag.default({}),
  DecreaseDamageTakenTag.default({}),
  DecreaseHealGivenTag.default({}),
  DecreasePoolCostTag.default({}),
  DecreaseStatTag.default({}),
  HealTag.default({}),
  IncreaseDamageGivenTag.default({}),
  IncreaseDamageTakenTag.default({}),
  IncreaseHealGivenTag.default({}),
  IncreasePoolCostTag.default({}),
  IncreaseStatTag.default({}),
  LifeStealTag.default({}),
  PierceTag.default({}),
  RecoilTag.default({}),
  ReflectTag.default({}),
  RobPreventTag.default({}),
  SealPreventTag.default({}),
  StunPreventTag.default({}),
]);
export type ZodBloodlineTags = z.infer<typeof BloodlineTags>;
export const bloodlineTypes = BloodlineTags._def.options.map(
  (o) => o._def.innerType.shape.type._def.innerType._def.value,
);

/** Based on type name, get the zod schema for validation of that tag */
export const getTagSchema = (type: ZodAllTags["type"]) => {
  const schema = AllTags._def.options.find(
    (o) => o._def.innerType.shape.type._def.innerType._def.value === type,
  );
  if (!schema) return UnknownTag;
  return schema._def.innerType;
};

/**
 * Realized tag, i.e. these are the tags that are actually inserted in battle, with
 * reference information added to the tag (i.e. how powerful was the effect)
 */
export type BattleEffect = ZodAllTags & {
  id: string;
  creatorId: string;
  level: number;
  isNew: boolean;
  castThisRound: boolean;
  createdRound: number;
  villageId?: string | null;
  targetType?: "user" | "barrier";
  power?: number;
  highestOffence?: (typeof StatNames)[number];
  highestDefence?: (typeof StatNames)[number];
  highestGenerals?: (typeof GenNames)[number][];
  targetHighestOffence?: (typeof StatNames)[number];
  targetHighestDefence?: (typeof StatNames)[number];
  targetHighestGenerals?: (typeof GenNames)[number][];
  longitude: number;
  latitude: number;
  barrierAbsorb: number;
  actionId: string;
};

export type GroundEffect = BattleEffect;

export type UserEffect = BattleEffect & {
  targetId: string;
  fromEffectId?: string;
  fromGround?: boolean;
  fromType?: "jutsu" | "armor" | "item" | "basic" | "bloodline";
  elements?: ElementName[]; // TODO: Remove this, should already be in the tag
  cpSpent?: number;
  spSpent?: number;
};

export type ActionEffect = {
  txt: string;
  color: "red" | "green" | "blue" | "yellow" | "purple" | "orange" | "pink" | "gray";
  types?: (GeneralType | StatType | ElementName | PoolType | ZodAllTags["type"])[];
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

interface JutsuValidatorType
  extends Omit<Jutsu, "id" | "createdAt" | "updatedAt" | "hidden"> {
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
  if (data.cost === 0 && data.repsCost === 0) {
    addIssue(ctx, "Must have either a ryo or reputation points cost");
  }
  if (data.cost > 0 && data.repsCost > 0) {
    addIssue(ctx, "Cannot have both ryo and reputation points cost");
  }
  if (data.itemType === "CONSUMABLE" && data.destroyOnUse === 0) {
    addIssue(ctx, "Consumable items must be destroyed on use");
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
const SuperRefineJutsu = (data: JutsuValidatorType, ctx: z.RefinementCtx) => {
  const hasBloodlineRoll = data.effects.find((e) => e.type === "rollbloodline");
  const hasRemoveBloodline = data.effects.find((e) => e.type === "removebloodline");
  if (hasBloodlineRoll || hasRemoveBloodline) {
    addIssue(ctx, "Cannot have bloodline add/remove effects on jutsu");
  }
};

/**
 * Validator specific to effects
 */
export const SuperRefineEffects = (
  effects: ZodAllTags[] | ZodBloodlineTags[],
  ctx: z.RefinementCtx,
) => {
  effects.forEach((e) => {
    if (e.type === "barrier" && e.staticAssetPath === "") {
      addIssue(ctx, "BarrierTag needs a staticAssetPath");
    } else if (e.type === "rollbloodline" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for rollbloodline effect");
    } else if (e.type === "removebloodline" && e.powerPerLevel > 0) {
      addIssue(ctx, "powerPerLevel must be 0 for removebloodline effect");
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
export const JutsuValidator = z
  .object({
    name: z.string(),
    image: z.string(),
    description: z.string(),
    battleDescription: z.string(),
    extraBaseCost: z.coerce.number().min(0).max(65535),
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
  })
  .superRefine(SuperRefineBase)
  .superRefine(SuperRefineJutsu);
export type ZodJutsuType = z.infer<typeof JutsuValidator>;

/**
 * Bloodline Type. Used for validating a bloodline object is set up properly
 */
export const BloodlineValidator = z.object({
  name: z.string(),
  image: z.string(),
  description: z.string(),
  rank: z.enum(LetterRanks),
  regenIncrease: z.coerce.number().int().min(0).max(100),
  statClassification: z.enum(StatTypes),
  villageId: z.string().nullable(),
  hidden: z.coerce.boolean().optional(),
  effects: z.array(BloodlineTags).superRefine(SuperRefineEffects),
});
export type ZodBloodlineType = z.infer<typeof BloodlineValidator>;

/**
 * Item Type. Used for validating a item object is set up properly
 */
export const ItemValidator = z
  .object({
    name: z.string(),
    image: z.string(),
    description: z.string(),
    battleDescription: z.string(),
    stackSize: z.coerce.number().int().min(1).max(100),
    destroyOnUse: z.coerce.number().min(0).max(1),
    chakraCost: z.coerce.number().int().min(0).max(10000),
    healthCost: z.coerce.number().int().min(0).max(10000),
    staminaCost: z.coerce.number().int().min(0).max(10000),
    healthCostReducePerLvl: z.coerce.number().min(0).max(10000),
    chakraCostReducePerLvl: z.coerce.number().min(0).max(10000),
    staminaCostReducePerLvl: z.coerce.number().min(0).max(10000),
    actionCostPerc: z.coerce.number().int().min(1).max(100),
    canStack: z.coerce.boolean(),
    inShop: z.coerce.boolean(),
    isEventItem: z.coerce.boolean(),
    preventBattleUsage: z.coerce.boolean(),
    hidden: z.coerce.boolean(),
    cooldown: z.coerce.number().int().min(0).max(300),
    cost: z.coerce.number().int().min(0),
    repsCost: z.coerce.number().int().min(0),
    range: z.coerce.number().int().min(0).max(10),
    maxEquips: z.coerce.number().int().min(0).max(10),
    method: z.enum(AttackMethods),
    target: z.enum(AttackTargets),
    itemType: z.enum(ItemTypes),
    weaponType: z.enum(WeaponTypes),
    rarity: z.enum(ItemRarities),
    slot: z.enum(ItemSlotTypes),
    effects: z.array(AllTags).superRefine(SuperRefineEffects),
  })
  .superRefine(SuperRefineBase)
  .superRefine(SuperRefineItem);
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
  const gens_cap = user ? USER_CAPS[user.rank].GENS_CAP : MAX_GENS_CAP;
  const stats_cap = user ? USER_CAPS[user.rank].STATS_CAP : MAX_STATS_CAP;
  return z.object({
    ninjutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.ninjutsuOffence || 0))
      .transform(roundStat)
      .default(start),
    taijutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.taijutsuOffence || 0))
      .transform(roundStat)
      .default(start),
    genjutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.genjutsuOffence || 0))
      .transform(roundStat)
      .default(start),
    bukijutsuOffence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.bukijutsuOffence || 0))
      .transform(roundStat)
      .default(start),
    ninjutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.ninjutsuDefence || 0))
      .transform(roundStat)
      .default(start),
    taijutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.taijutsuDefence || 0))
      .transform(roundStat)
      .default(start),
    genjutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.genjutsuDefence || 0))
      .transform(roundStat)
      .default(start),
    bukijutsuDefence: z.coerce
      .number()
      .min(min)
      .max(stats_cap - (user?.bukijutsuDefence || 0))
      .transform(roundStat)
      .default(start),
    strength: z.coerce
      .number()
      .min(min)
      .max(gens_cap - (user?.strength || 0))
      .transform(roundStat)
      .default(start),
    speed: z.coerce
      .number()
      .min(min)
      .max(gens_cap - (user?.speed || 0))
      .transform(roundStat)
      .default(start),
    intelligence: z.coerce
      .number()
      .min(min)
      .max(gens_cap - (user?.intelligence || 0))
      .transform(roundStat)
      .default(start),
    willpower: z.coerce
      .number()
      .min(min)
      .max(gens_cap - (user?.willpower || 0))
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
