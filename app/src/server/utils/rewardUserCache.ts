import type { GetRewardResult } from "@/libs/quest";
import { findRewardUserSnapshot } from "@/queries/quests";
import type { getUserProgressionUpdate } from "@/server/api/routers/profile";
import { getRewardUserDelta, type updateRewards } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";

/**
 * Confirm scalar payouts with a bounded read. Relation-changing rewards and
 * derived progression reconcile through the canonical profile query.
 */
export const getRewardUserUpdate = async (input: {
  client: DrizzleClient;
  userId: string;
  rewards: GetRewardResult;
  granted: Pick<
    Awaited<ReturnType<typeof updateRewards>>,
    "titles" | "badges" | "sageModes"
  >;
  requiresRelations?: boolean;
  progression?: ReturnType<typeof getUserProgressionUpdate>;
}) => {
  const { client, userId, rewards, granted } = input;
  const needsReconciliation =
    input.requiresRelations ||
    getRewardUserDelta(rewards) === undefined ||
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
  // Confirmation is optional cache data after the payout has committed.
  const counters = await findRewardUserSnapshot(client, userId).catch(() => undefined);
  if (!counters) return fallback;
  const progression = input.progression;
  return {
    announcements: undefined,
    userDelta: {},
    achievementProgress: progression?.achievementProgress,
    userPatch: {
      ...progression?.userPatch,
      ...counters,
      village: counters.village ?? undefined,
    },
  };
};
