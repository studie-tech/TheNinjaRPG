import { z } from "zod";
import {
  hasReward,
  hasUnpairedMasteryPromotion,
  MASTERY_PROMOTION_PAIR_MESSAGE,
  milestoneRewardFields,
  ObjectiveReward,
  type ObjectiveRewardType,
  rewardFields,
} from "@/validators/rewards";

/** Existing reward keys available to custom editor groups; nodes cannot invent payout fields. */
export const RewardField = z.enum(
  Object.keys(rewardFields) as [
    keyof typeof rewardFields,
    ...(keyof typeof rewardFields)[],
  ],
);
/** A named editor group with at least one distinct, supported reward field. */
export const RewardNodeValidator = z.object({
  name: z.string().trim().min(1).max(191),
  fields: z
    .array(RewardField)
    .min(1)
    .refine(
      (fields) => new Set(fields).size === fields.length,
      "Each field may appear once",
    ),
});
/** A nonempty reusable reward payload; mastery promotions require both stat and rank. */
export const RewardPackageValidator = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().max(5000).prefault(""),
  rewards: ObjectiveReward.refine(hasReward, "Add at least one reward").refine(
    (reward) => !hasUnpairedMasteryPromotion(reward),
    MASTERY_PROMOTION_PAIR_MESSAGE,
  ),
});
/** An editable attachment whose copied payload survives catalog changes or deletion. */
export const RewardPackageSnapshot = RewardPackageValidator.extend({
  /** Unique attachment identity, regenerated when its objective is copied. */
  id: z.string().min(1).max(191),
  /** Catalog attribution; independent reward nodes have no catalog source. */
  packageId: z.string().min(1).max(191).optional(),
});
/** Most reward packages one quest or objective reward can attach. */
export const MAX_REWARD_PACKAGES = 50;
/** Quest and objective rewards share direct fields plus optional independent or catalog snapshots. */
export const questRewardFields = {
  ...rewardFields,
  ...milestoneRewardFields,
  reward_packages: z.array(RewardPackageSnapshot).max(MAX_REWARD_PACKAGES).optional(),
};
/** A reward, or its parsed `head`, followed by its package payloads, ready to collapse. */
export const rewardPayloads = <
  T extends { reward_packages?: { rewards: ObjectiveRewardType }[] },
  H = T,
>(
  reward: T,
  head?: H,
) => [
  (head ?? reward) as H,
  ...(reward.reward_packages ?? []).map((pack) => pack.rewards),
];

/** Normalize quest rewards while retaining their package snapshots. */
export const QuestReward = z.object(questRewardFields);
export type QuestRewardType = z.infer<typeof QuestReward>;
export type RewardPackageSnapshotType = z.infer<typeof RewardPackageSnapshot>;
