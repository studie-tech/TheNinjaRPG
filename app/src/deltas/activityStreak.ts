import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserQueueState } from "@/deltas/profile";
import { getRewardUserDelta } from "@/deltas/quests";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import type { UserStreakProgress } from "@/drizzle/schema";
import type { postProcessRewards } from "@/libs/quest";
import { hasEnergyQueue } from "@/libs/queue";
import type { findActivityStreakConfigForClaimStreakDay } from "@/queries/activityStreak";
import { DAY_S, periodStart } from "@/utils/time";

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

/** Describe the committed claim and its next display state without loading the streak lists again. */
export const getClaimedStreakUpdate = (
  config: NonNullable<
    Awaited<ReturnType<typeof findActivityStreakConfigForClaimStreakDay>>
  >,
  progress: Pick<
    UserStreakProgress,
    "id" | "currentDay" | "lastClaimDate" | "startedAt"
  >,
  newCurrentDay: number,
  now: Date,
  startsCycle: boolean,
) => {
  const completed = newCurrentDay >= config.totalDays;
  const currentDay = completed && config.streakType === "RECURRING" ? 0 : newCurrentDay;
  const startedAt =
    startsCycle || (completed && config.streakType === "RECURRING")
      ? now
      : progress.startedAt;
  const theoreticalMaxDay = Math.min(
    Math.floor((now.getTime() - startedAt.getTime()) / (DAY_S * 1000)) + 1,
    config.totalDays,
  );
  const needsCatchUp = currentDay > 0 && currentDay < theoreticalMaxDay;
  return {
    claimedAt: now,
    configId: config.id,
    progressId: progress.id,
    totalDays: config.totalDays,
    streakType: config.streakType,
    before: {
      currentDay: progress.currentDay,
      lastClaimDate: progress.lastClaimDate,
      startedAt: progress.startedAt,
    },
    after:
      completed && config.streakType === "EVENT_PASS"
        ? null
        : {
            currentDay,
            startedAt,
            lastClaimDate: now,
            theoreticalMaxDay,
            needsCatchUp,
            nextDayNumber: currentDay + 1,
            daysToGo: needsCatchUp ? theoreticalMaxDay - currentDay : 0,
            alreadyClaimedToday: true,
            canClaimToday: false,
            nextRewards:
              config.rewards.find((reward) => reward.dayNumber === currentDay + 1)
                ?.rewards ?? null,
          },
  };
};

/** Apply a confirmed day to its loaded progress baseline; new or changed progress retains a read. */
export const getClaimedStreaks = (
  current: RouterOutputs["activityStreak"]["getUserStreaks"],
  update: ReturnType<typeof getClaimedStreakUpdate>,
  now: Date,
): RouterOutputs["activityStreak"]["getUserStreaks"] | undefined => {
  if (
    periodStart("daily", now).getTime() !==
      periodStart("daily", update.claimedAt).getTime() ||
    (update.after &&
      Math.min(
        Math.floor(
          (now.getTime() - update.after.startedAt.getTime()) / (DAY_S * 1000),
        ) + 1,
        update.totalDays,
      ) !== update.after.theoreticalMaxDay)
  )
    return;
  const row = current.streaks.find(
    (row) => row.configId === update.configId && row.progressId === update.progressId,
  );
  if (
    !row ||
    row.totalDays !== update.totalDays ||
    row.streakType !== update.streakType ||
    row.currentDay !== update.before.currentDay ||
    row.lastClaimDate?.getTime() !== update.before.lastClaimDate?.getTime() ||
    row.startedAt.getTime() !== update.before.startedAt.getTime()
  )
    return;
  return {
    ...current,
    streaks: current.streaks.flatMap((row) =>
      row.progressId !== update.progressId
        ? [row]
        : update.after
          ? [{ ...row, ...update.after }]
          : [],
    ),
  };
};
