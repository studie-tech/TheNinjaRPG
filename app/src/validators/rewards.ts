import { z } from "zod";
import {
  MASTERY_RANKS,
  MAX_EXPERIENCE_LEVEL,
  MAX_PLAYER_LEVEL,
  MAX_STATS_CAP,
  MasteryNames,
  QUEST_REWARD_MODES,
  QUEST_REWARD_PICK_MAX,
  STARTER_VILLAGES,
  type StarterVillage,
  UserRanks,
} from "@/drizzle/constants";
import { idsWithNumberField } from "@/validators/base";

// Maps legacy STARTER_VILLAGES enum keys to their current renames so quest
// content JSON stored before the townhall rename still parses. Without this,
// ObjectiveReward.parse() throws at reward-collection time for any quest whose
// content has reward_village_membership set to an old name.
const LEGACY_STARTER_VILLAGE_KEYS = ["SHINE", "GLACIER", "SHROUD", "CURRENT"] as const;
const LEGACY_STARTER_VILLAGE_MAP: Record<
  (typeof LEGACY_STARTER_VILLAGE_KEYS)[number],
  StarterVillage
> = {
  SHINE: "SHIROHANA",
  GLACIER: "HYORIN",
  SHROUD: "AKASUMI",
  CURRENT: "AKIKAZE",
};

export const rewardFields = {
  /** Final-quest-only promotion pair; QuestValidator rejects objective-level rank rewards. */
  reward_mastery_stat: z.enum(["None", ...MasteryNames]).optional(),
  reward_mastery_rank: z.enum(MASTERY_RANKS).optional(),
  /** Earned discipline gains, capped when granted; these do not award combat-stat XP. */
  reward_ninjutsu_experience: z.coerce.number().min(0).optional(),
  reward_genjutsu_experience: z.coerce.number().min(0).optional(),
  reward_taijutsu_experience: z.coerce.number().min(0).optional(),
  reward_bukijutsu_experience: z.coerce.number().min(0).optional(),
  reward_bloodline_experience: z.coerce.number().min(0).optional(),
  /** Sage discipline gain, separate from reward_sage_mastery_experience (sage-mode XP). */
  reward_sage_stat_experience: z.coerce.number().min(0).optional(),
  reward_hunter_items: z.boolean().prefault(false),
  reward_hunter_items_ids: z.array(z.string()).prefault([]),
  reward_gathering_items: z.boolean().prefault(false),
  reward_gathering_items_ids: z.array(z.string()).prefault([]),
  reward_seichi_silver: z.coerce.number().prefault(0),
  reward_money: z.coerce.number().prefault(0),
  reward_clanpoints: z.coerce.number().prefault(0),
  reward_anbupoints: z.coerce.number().prefault(0),
  reward_exp: z.coerce.number().prefault(0),
  /**
   * Unassigned XP for the eligible active pet without player XP; optional in stored rewards.
   */
  reward_pet_experience: z.coerce.number().min(0).optional(),
  reward_tokens: z.coerce.number().prefault(0),
  reward_prestige: z.coerce.number().prefault(0),
  reward_reputation: z.coerce.number().prefault(0),
  reward_skillpoints: z.coerce.number().prefault(0),
  reward_rank: z.enum(UserRanks).prefault("NONE"),
  reward_village_membership: z
    .union([
      z.enum(STARTER_VILLAGES),
      z
        .enum(LEGACY_STARTER_VILLAGE_KEYS)
        .transform((legacy) => LEGACY_STARTER_VILLAGE_MAP[legacy]),
    ])
    .prefault("NONE"),
  reward_items: idsWithNumberField,
  reward_jutsus: z.array(z.string()).prefault([]),
  reward_bloodlines: z.array(z.string()).prefault([]),
  /** Catalog ids granted by quests; skipped at claim if the player already has a mode. */
  reward_sage_modes: z.array(z.string()).prefault([]),
  reward_badges: z.array(z.string()).prefault([]),
  /** Catalog IDs to grant once; acquisition stores immutable bonuses, independent of display selection. */
  reward_titles: z.array(z.string()).prefault([]),
  reward_medical_experience: z.coerce.number().prefault(0),
  reward_hunting_experience: z.coerce.number().prefault(0),
  reward_crafting_experience: z.coerce.number().prefault(0),
  reward_gathering_experience: z.coerce.number().prefault(0),
  /** Added to `userData.sageMasteryExperience`, capped at `SAGE_MASTERY_EXP_CAP`. */
  reward_sage_mastery_experience: z.coerce.number().prefault(0),
  reward_war_damage: z.coerce.number().prefault(0), // Damage to enemy war health
  reward_war_healing: z.coerce.number().prefault(0), // Heal own war health
};

export const ObjectiveReward = z.object(rewardFields);
export type ObjectiveRewardType = z.infer<typeof ObjectiveReward>;
export type ObjectiveRewardInputType = z.input<typeof ObjectiveReward>;

/** Final academy milestone rewards; these cannot be packaged or selected as loot. */
export const milestoneRewardFields = {
  /** Target character level; zero or absence disables the milestone reward. */
  reward_level: z.coerce
    .number()
    .int()
    .refine(
      (value) =>
        value === 0 || (value > MAX_EXPERIENCE_LEVEL && value <= MAX_PLAYER_LEVEL),
      `Milestone level must be ${MAX_EXPERIENCE_LEVEL + 1}–${MAX_PLAYER_LEVEL}, or 0 to disable`,
    )
    .optional(),
  /** Fixed gain to each combat stat, limited by its rank cap at the account claim. */
  reward_stats: z.coerce.number().int().min(0).max(MAX_STATS_CAP).optional(),
};

/**
 * Schema for post-processed rewards where item/jutsu/bloodline/badge IDs
 * have been resolved to names (simple string arrays).
 * Used as output schema for API responses that return processed rewards.
 *
 * This is the SINGLE SOURCE OF TRUTH for post-processed reward types.
 * The postProcessRewards function in libs/quest/rewards.ts uses this type as its return type
 * to ensure type safety if the function implementation changes.
 */
export const PostProcessedRewardSchema = z.object({
  ...rewardFields,
  ...milestoneRewardFields,
  // Override fields that get resolved to names after processing
  reward_items: z.array(z.string()).prefault([]),
  reward_jutsus: z.array(z.string()).prefault([]),
  reward_bloodlines: z.array(z.string()).prefault([]),
  reward_sage_modes: z.array(z.string()).prefault([]),
  reward_badges: z.array(z.string()).prefault([]),
  /** Display names substituted for catalog IDs after reward delivery. */
  reward_titles: z.array(z.string()).prefault([]),
});

/** Type for post-processed rewards - single source of truth */
export type PostProcessedRewards = z.infer<typeof PostProcessedRewardSchema>;

type MasteryPromotionFields = Partial<
  Pick<ObjectiveRewardType, "reward_mastery_stat" | "reward_mastery_rank">
>;

export const MASTERY_PROMOTION_PAIR_MESSAGE =
  "Select both the mastery and its rank reward";

/** True when a reward names a mastery rank to promote to. */
export const hasPromotionRank = (reward: MasteryPromotionFields) =>
  !!reward.reward_mastery_rank && reward.reward_mastery_rank !== "NONE";

/** Detect the mastery half of a rank-promotion reward. */
const hasPromotionStat = (reward: MasteryPromotionFields) =>
  !!reward.reward_mastery_stat && reward.reward_mastery_stat !== "None";

/** True when a reward carries a complete mastery promotion, narrowing both fields. */
export const hasMasteryPromotion = <T extends MasteryPromotionFields>(
  reward: T,
): reward is T & {
  reward_mastery_stat: Exclude<
    MasteryPromotionFields["reward_mastery_stat"],
    "None" | undefined
  >;
  reward_mastery_rank: Exclude<
    MasteryPromotionFields["reward_mastery_rank"],
    "NONE" | undefined
  >;
} => hasPromotionStat(reward) && hasPromotionRank(reward);

/** True when only one half of a mastery promotion is set. */
export const hasUnpairedMasteryPromotion = (reward: MasteryPromotionFields) =>
  hasPromotionStat(reward) !== hasPromotionRank(reward);

/** True when any reward field is non-empty, including sage modes and sage mastery XP. */
export const hasReward = (reward: ObjectiveRewardType) => {
  const parsedReward = ObjectiveReward.parse(reward);
  return (
    hasPromotionRank(parsedReward) ||
    REWARD_CHOICE_AMOUNT_FIELDS.some((field) => (parsedReward[field] ?? 0) > 0) ||
    parsedReward.reward_rank !== "NONE" ||
    parsedReward.reward_village_membership !== "NONE" ||
    parsedReward.reward_items.length > 0 ||
    parsedReward.reward_jutsus.length > 0 ||
    parsedReward.reward_bloodlines.length > 0 ||
    parsedReward.reward_sage_modes.length > 0 ||
    parsedReward.reward_badges.length > 0 ||
    parsedReward.reward_titles.length > 0 ||
    parsedReward.reward_hunter_items ||
    parsedReward.reward_gathering_items
  );
};

/** True when processed rewards hold any amount or content the reward toast lists. */
export const hasAnyRewardValue = (
  rewards: Partial<Record<RewardChoiceAmountField, number>> &
    Partial<Record<RewardChoiceContentField, readonly unknown[]>>,
) =>
  REWARD_CHOICE_AMOUNT_FIELDS.some((field) => (rewards[field] ?? 0) > 0) ||
  REWARD_CHOICE_CONTENT_FIELDS.some((field) => (rewards[field]?.length ?? 0) > 0);

/** Quest content fields that select between granting every reward and a player pick. */
export const questRewardModeFields = {
  rewardMode: z.enum(QUEST_REWARD_MODES).prefault("all"),
  rewardPickCount: z.coerce
    .number()
    .int()
    .min(1)
    .max(QUEST_REWARD_PICK_MAX)
    .prefault(1),
};

/** Discipline XP fields in MasteryNames order; sage-mode XP uses its separate field. */
export const MASTERY_EXPERIENCE_FIELDS = [
  "reward_ninjutsu_experience",
  "reward_genjutsu_experience",
  "reward_taijutsu_experience",
  "reward_bukijutsu_experience",
  "reward_bloodline_experience",
  "reward_sage_stat_experience",
] as const;

/** Scalar reward fields that each become one pickable card in a "choose" quest. */
export const REWARD_CHOICE_AMOUNT_FIELDS = [
  ...MASTERY_EXPERIENCE_FIELDS,
  "reward_money",
  "reward_seichi_silver",
  "reward_clanpoints",
  "reward_anbupoints",
  "reward_exp",
  "reward_pet_experience",
  "reward_tokens",
  "reward_prestige",
  "reward_reputation",
  "reward_skillpoints",
  "reward_medical_experience",
  "reward_hunting_experience",
  "reward_crafting_experience",
  "reward_gathering_experience",
  "reward_sage_mastery_experience",
  "reward_war_damage",
  "reward_war_healing",
] as const;
export type RewardChoiceAmountField = (typeof REWARD_CHOICE_AMOUNT_FIELDS)[number];

/** Content reward fields whose every entry becomes one pickable card in a "choose" quest. */
export const REWARD_CHOICE_CONTENT_FIELDS = [
  "reward_items",
  "reward_jutsus",
  "reward_bloodlines",
  "reward_sage_modes",
  "reward_badges",
  "reward_titles",
] as const;
type RewardChoiceContentField = (typeof REWARD_CHOICE_CONTENT_FIELDS)[number];

/**
 * One pickable reward. `amount` is the scaled scalar value, or the item quantity (1 for
 * jutsus, bloodlines, sage modes and badges); `contentId` names the granted content.
 * Package cards use amount 1 and carry their complete copied payload in `rewards`.
 */
export const RewardChoiceCardSchema = z.object({
  id: z.string().min(1),
  field: z.enum([
    ...REWARD_CHOICE_AMOUNT_FIELDS,
    ...REWARD_CHOICE_CONTENT_FIELDS,
    "reward_package",
  ]),
  packageName: z.string().optional(),
  rewards: ObjectiveReward.optional(),
  amount: z.number().int().min(1),
  contentId: z.string().optional(),
});
export type RewardChoiceCard = z.infer<typeof RewardChoiceCardSchema>;

/** Offer frozen on QuestHistory when a "choose" quest completes, until the player picks. */
export const PendingRewardChoiceSchema = z.object({
  id: z.string().min(1),
  pickCount: z.number().int().min(1).max(QUEST_REWARD_PICK_MAX),
  cards: z.array(RewardChoiceCardSchema).min(1),
});
export type PendingRewardChoice = z.infer<typeof PendingRewardChoiceSchema>;

/** An empty `cardIds` clears an offer on which the player can no longer receive anything. */
export const ClaimRewardChoiceSchema = z.object({
  questId: z.string().min(1),
  choiceId: z.string().min(1),
  cardIds: z.array(z.string().min(1)).max(QUEST_REWARD_PICK_MAX),
});

/** A pending offer as shown to the player, with each card's content resolved for display. */
export const RewardChoiceDisplaySchema = z.object({
  questId: z.string(),
  questName: z.string(),
  choiceId: z.string(),
  pickCount: z.number(),
  cards: z.array(
    RewardChoiceCardSchema.extend({
      name: z.string(),
      image: z.string().nullable(),
      rarity: z.string().nullable(),
      description: z.string().nullable(),
      /** Resolved bundle contents, including original item quantities and drop chances. */
      includedRewards: z.array(z.string()).optional(),
      /** Why this player cannot pick the card (e.g. already owned), or null if pickable. */
      unavailableReason: z.string().nullable(),
    }),
  ),
});
export type RewardChoiceDisplay = z.infer<typeof RewardChoiceDisplaySchema>;
