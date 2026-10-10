import { MasteryTypes } from "@/drizzle/constants";
import {
  MASTERY_EXPERIENCE_FIELDS,
  type ObjectiveRewardType,
} from "@/validators/rewards";
export const masteryRewardLabels = (reward: Partial<ObjectiveRewardType>) => [
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
