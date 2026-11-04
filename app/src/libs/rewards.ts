import { UserRanks } from "@/drizzle/constants";
import {
  hasMasteryPromotion,
  ObjectiveReward,
  type ObjectiveRewardType,
  REWARD_CHOICE_AMOUNT_FIELDS,
} from "@/validators/rewards";
/**
 * Combine reward payloads without mutating inputs or rolling item drops.
 * Scalars add, arrays concatenate and material flags combine. The highest rank wins;
 * village membership and mastery promotion use the last specified reward.
 * @returns A combined payload with fresh arrays, retaining item quantities and chances.
 */
export const collapseRewards = (
  rewards: ObjectiveRewardType[],
): ObjectiveRewardType => {
  const collapsed = ObjectiveReward.parse({});

  rewards.forEach((reward) => {
    // Truthy additions preserve absent optional mastery XP fields instead of creating zero keys.
    for (const field of REWARD_CHOICE_AMOUNT_FIELDS)
      if (reward[field])
        collapsed[field] = (collapsed[field] ?? 0) + (reward[field] ?? 0);
    if (hasMasteryPromotion(reward)) {
      collapsed.reward_mastery_stat = reward.reward_mastery_stat;
      collapsed.reward_mastery_rank = reward.reward_mastery_rank;
    }

    // Only set reward hunter items to true if any of the rewards have it
    if (reward.reward_hunter_items) {
      collapsed.reward_hunter_items = true;
    }

    // Only set reward gathering items to true if any of the rewards have it
    if (reward.reward_gathering_items) {
      collapsed.reward_gathering_items = true;
    }

    // Concatenate valid ids
    if (reward.reward_hunter_items_ids) {
      collapsed.reward_hunter_items_ids.push(...reward.reward_hunter_items_ids);
    }
    if (reward.reward_gathering_items_ids) {
      collapsed.reward_gathering_items_ids.push(...reward.reward_gathering_items_ids);
    }

    // Concatenate array rewards (nullish-guarded: legacy JSON rows from callers that
    // skip Zod normalization may predate a field, leaving it undefined)
    collapsed.reward_items.push(...(reward.reward_items ?? []));
    collapsed.reward_jutsus.push(...(reward.reward_jutsus ?? []));
    collapsed.reward_bloodlines.push(...(reward.reward_bloodlines ?? []));
    collapsed.reward_sage_modes.push(...(reward.reward_sage_modes ?? []));
    collapsed.reward_badges.push(...(reward.reward_badges ?? []));
    collapsed.reward_titles.push(...(reward.reward_titles ?? []));

    // Handle rank reward (take the highest rank)
    if (reward.reward_rank !== "NONE") {
      if (collapsed.reward_rank === "NONE") {
        collapsed.reward_rank = reward.reward_rank;
      } else {
        // Compare ranks and keep the higher one
        const rankOrder = UserRanks;
        const currentIndex = rankOrder.indexOf(collapsed.reward_rank);
        const newIndex = rankOrder.indexOf(reward.reward_rank);
        if (newIndex > currentIndex) {
          collapsed.reward_rank = reward.reward_rank;
        }
      }
    }

    // Handle village membership reward
    if (reward.reward_village_membership !== "NONE") {
      collapsed.reward_village_membership = reward.reward_village_membership;
    }
  });

  return collapsed;
};
