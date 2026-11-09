import { MasteryTypes } from "@/drizzle/constants";
import {
  hasMasteryPromotion,
  MASTERY_EXPERIENCE_FIELDS,
  type ObjectiveRewardType,
} from "@/validators/rewards";

/**
 * Display positive discipline XP grants and the final quest's mastery promotion.
 * Sage discipline XP is separate from reward_sage_mastery_experience (sage-mode XP),
 * which the sage-mode reward presentation renders.
 */
export const masteryRewardLabels = (
  reward: Partial<
    Pick<
      ObjectiveRewardType,
      | (typeof MASTERY_EXPERIENCE_FIELDS)[number]
      | "reward_mastery_stat"
      | "reward_mastery_rank"
    >
  >,
): string[] => [
  ...MASTERY_EXPERIENCE_FIELDS.flatMap((field, index) =>
    (reward[field] ?? 0) > 0
      ? [`${reward[field]?.toLocaleString()} ${MasteryTypes[index]} Mastery XP`]
      : [],
  ),
  ...(hasMasteryPromotion(reward)
    ? [
        `${reward.reward_mastery_stat.replace("Mastery", "")} mastery rank: ${reward.reward_mastery_rank}`,
      ]
    : []),
];
