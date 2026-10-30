import type { GetRewardResult } from "@/libs/quest";
import type { getUserProgressionUpdate } from "@/server/api/routers/profile";
import { getRewardUserDelta, type updateRewards } from "@/server/api/routers/quests";

/**
 * Return confirmed integer payouts. Conditional pet-bank grants and relation
 * changes reconcile through the canonical profile query.
 */
export const getRewardUserUpdate = (input: {
  rewards: GetRewardResult;
  granted: Pick<
    Awaited<ReturnType<typeof updateRewards>>,
    "titles" | "badges" | "sageModes"
  >;
  requiresRelations?: boolean;
  progression?: ReturnType<typeof getUserProgressionUpdate>;
}) => {
  const { rewards, granted } = input;
  const delta = getRewardUserDelta(rewards);
  const needsReconciliation =
    input.requiresRelations ||
    delta === undefined ||
    rewards.reward_exp > 0 ||
    granted.titles.length > 0 ||
    granted.badges.length > 0 ||
    granted.sageModes.length > 0;
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
