import type { GetRewardResult } from "@/libs/quest";
import type { getUserProgressionUpdate } from "@/server/api/routers/profile";
import { getRewardUserDelta } from "@/server/api/routers/quests";

/**
 * Return confirmed integer payouts. Conditional pet-bank grants and relation
 * changes reconcile through the canonical profile query.
 */
export const getRewardUserUpdate = (input: {
  rewards: GetRewardResult;
  requiresRelations?: boolean;
  progression?: ReturnType<typeof getUserProgressionUpdate>;
}) => {
  const { rewards } = input;
  const delta = getRewardUserDelta(rewards);
  const needsReconciliation =
    input.requiresRelations || delta === undefined || rewards.reward_exp > 0;
  const fallback = {
    userPatch: undefined,
    userDelta: undefined,
    achievementProgress: undefined,
    announcements: undefined,
  };
  if (needsReconciliation) return fallback;
  const progression = input.progression;
  return {
    announcements: undefined,
    userDelta: delta,
    achievementProgress: progression?.achievementProgress,
    userPatch: progression?.userPatch ?? {},
  };
};
