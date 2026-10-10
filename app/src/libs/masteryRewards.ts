import { MasteryTypes } from "@/drizzle/constants";
import {
  MASTERY_EXPERIENCE_FIELDS,
  type ObjectiveRewardType,
} from "@/validators/rewards";

/**
 * Display positive discipline XP grants and the final quest's mastery promotion.
 * Sage discipline XP is separate from reward_sage_mastery_experience (sage-mode XP),
 * which remains rendered by the existing sage-mode reward presentation.
 */
export const masteryRewardLabels = (reward: Partial<ObjectiveRewardType>): string[] => [
  ...MASTERY_EXPERIENCE_FIELDS.flatMap((field, index) =>
    (reward[field] ?? 0) > 0
      ? [`${reward[field]?.toLocaleString()} ${MasteryTypes[index]} Mastery XP`]
      : [],
  ),
  ...(reward.reward_mastery_stat &&
  reward.reward_mastery_stat !== "None" &&
  reward.reward_mastery_rank &&
  reward.reward_mastery_rank !== "NONE"
    ? [
        `${reward.reward_mastery_stat.replace("Mastery", "")} mastery rank: ${reward.reward_mastery_rank}`,
      ]
    : []),
];
