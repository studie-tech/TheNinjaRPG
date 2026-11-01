import type { UserQueueState } from "@/deltas/profile";

import { getRewardUserDelta } from "@/deltas/quests";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import type { postProcessRewards } from "@/libs/quest";
import { hasEnergyQueue } from "@/libs/queue";

/** Debit the configured event-pass currencies; withhold the delta while energy work is queued. */
export const getPurchaseEventPassUserUpdate = ({
  user,
  configRyoCost,
  configRepsCost,
  configSeichiSilverCost,
}: {
  user: UserQueueState;
  configRyoCost: number;
  configRepsCost: number;
  configSeichiSilverCost: number;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : {
        ...(configRyoCost > 0 ? { money: -configRyoCost } : {}),
        ...(configRepsCost > 0 ? { reputationPoints: -configRepsCost } : {}),
        ...(configSeichiSilverCost > 0
          ? { seichiSilver: -configSeichiSilverCost }
          : {}),
      },
});

/**
 * Project supported streak rewards and subtract the reputation cost of a paid catch-up day.
 * Unsupported reward effects require profile reconciliation.
 */
export const getClaimStreakDayUserUpdate = ({
  processedRewards,
  paidCatchUp,
}: {
  processedRewards: NonNullable<Awaited<ReturnType<typeof postProcessRewards>>>;
  paidCatchUp: boolean;
}) => ({
  userDelta: getRewardUserDelta(
    processedRewards,
    paidCatchUp ? COST_STREAK_CATCHUP_DAY : 0,
  ),
});
