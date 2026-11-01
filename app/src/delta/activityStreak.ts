import type { UserQueueState } from "@/delta/profile";

import { getRewardUserDelta } from "@/delta/quests";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import type { postProcessRewards } from "@/libs/quest";
import { hasEnergyQueue } from "@/libs/queue";

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
