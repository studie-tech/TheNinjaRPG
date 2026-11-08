import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserQueueState } from "@/deltas/profile";
import { getRewardUserDelta } from "@/deltas/quests";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import type { UserStreakProgress } from "@/drizzle/schema";
import { getStreakTheoreticalMaxDay, isStreakContinuous } from "@/libs/activityStreak";
import type { postProcessRewards } from "@/libs/quest/rewards";
import { hasEnergyQueue } from "@/libs/queue";
import type { findActivityStreakConfigForClaimStreakDay } from "@/queries/activityStreak";
import { isSameDay } from "@/utils/time";

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
  const theoreticalMaxDay = getStreakTheoreticalMaxDay(
    startedAt,
    config.totalDays,
    now,
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

/** Apply a confirmed claim to its loaded baseline; reconcile when any streak's timed eligibility changed. */
export const getClaimedStreaks = (
  current: RouterOutputs["activityStreak"]["getUserStreaks"],
  update: ReturnType<typeof getClaimedStreakUpdate>,
  now: Date,
): RouterOutputs["activityStreak"]["getUserStreaks"] | undefined => {
  if (!isSameDay(now, update.claimedAt)) return;
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
  const streaks = current.streaks.flatMap((row) =>
    row.progressId !== update.progressId
      ? [row]
      : update.after
        ? [{ ...row, ...update.after }]
        : [],
  );
  // Other rows can expire during a claim; refresh before showing stale claim or catch-up controls.
  if (
    streaks.some((streak) => {
      const alreadyClaimedToday =
        streak.lastClaimDate !== null && isSameDay(streak.lastClaimDate, now);
      const canClaimToday =
        !alreadyClaimedToday &&
        (streak.currentDay === 0 || isStreakContinuous(streak.lastClaimDate, now));
      return (
        streak.alreadyClaimedToday !== alreadyClaimedToday ||
        streak.canClaimToday !== canClaimToday ||
        streak.theoreticalMaxDay !==
          getStreakTheoreticalMaxDay(streak.startedAt, streak.totalDays, now)
      );
    })
  )
    return;
  return { ...current, streaks };
};
