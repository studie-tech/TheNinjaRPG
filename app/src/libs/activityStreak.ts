import { COST_STREAK_CATCHUP_DAY, STREAK_CONTINUITY_HOURS } from "@/drizzle/constants";
import { DAY_S, HOUR_S, isSameDay, nextUtcDayAt, secondsFromDate } from "@/utils/time";

export type ActivityStreakPopupState = {
  isOpen: boolean;
  isLoading: boolean;
  shouldShowPopup: boolean;
  dismissedToday: boolean;
  userClosed: boolean;
  /**
   * The tutorial owns the screen while it runs: it dims the page and points at
   * specific elements, so an auto-opening dialog on top of it traps a brand-new
   * player behind a modal they were never taught to close. A fresh account has
   * no streak progress yet, which is exactly the state that makes the enrolment
   * prompt want to open, so the two collide on every new player unless this
   * blocks it — however the account was created.
   */
  tutorialActive: boolean;
};

/**
 * Resolve persisted and session-only popup latches for the current date.
 * Storing the date, rather than a boolean under a changing key, makes a
 * long-lived browser tab eligible again after the date rolls over.
 */
export const resolveActivityStreakDateLatches = (
  currentDateKey: string,
  dismissedDateKey: string | null,
  userClosedDateKey: string | null,
) => ({
  dismissedToday: dismissedDateKey === currentDateKey,
  userClosed: userClosedDateKey === currentDateKey,
});

/**
 * Resolve whether the activity-streak popup should be open. Once opened, it remains
 * latched through reward-query changes until an explicit close updates `userClosed`.
 */
export const resolveActivityStreakPopupOpen = ({
  isOpen,
  isLoading,
  shouldShowPopup,
  dismissedToday,
  userClosed,
  tutorialActive,
}: ActivityStreakPopupState): boolean =>
  // Checked ahead of the `isOpen` latch so a popup already on screen closes if
  // the tutorial (re)starts underneath it, rather than staying latched open.
  !tutorialActive &&
  (isOpen || (!isLoading && shouldShowPopup && !dismissedToday && !userClosed));

/**
 * Resolve whether the activity-streak flow must delay other auto-opening popups.
 * Loading is blocking to prevent an arrival prompt from winning the initial query race.
 */
export const isActivityStreakPopupBlocking = (
  hasUser: boolean,
  state: ActivityStreakPopupState,
): boolean =>
  hasUser &&
  // Suppressed for the tutorial means it will never open, so it must not hold
  // other prompts back either.
  !state.tutorialActive &&
  !state.dismissedToday &&
  !state.userClosed &&
  (state.isLoading || state.shouldShowPopup || state.isOpen);

/**
 * True when the root-layout popup is still allowed to open, so `getUserStreaks`
 * is worth sending. There is no claim-eligibility field on `userData`; the
 * suppressions below are the ones that already forbid the dialog, and skipping
 * the query for them cannot drop an unclaimed-reward popup.
 *
 * Do not defer this query behind first paint: `isActivityStreakPopupBlocking`
 * treats a not-yet-started fetch as non-blocking, which lets the overworld
 * arrival prompt win the login race.
 */
export const shouldFetchActivityStreaksForPopup = ({
  hasUser,
  tutorialActive,
  dismissedToday,
  userClosed,
}: {
  hasUser: boolean;
  tutorialActive: boolean;
  dismissedToday: boolean;
  userClosed: boolean;
}): boolean => hasUser && !tutorialActive && !dismissedToday && !userClosed;

/** Identifies the audit entry written when an event pass is completed. */
export const isEventPassCompletion = (changes: unknown): boolean =>
  Array.isArray(changes) &&
  changes.some(
    (change) => typeof change === "string" && change.endsWith("(EVENT_PASS)"),
  );

/** Latest event completion anchors ownership even if the configuration changes. */
export const getEventPassCompletionDate = (
  logs: { changes: unknown; createdAt: Date }[],
): Date | undefined =>
  logs
    .filter((log) => isEventPassCompletion(log.changes))
    .reduce<Date | undefined>(
      (latest, log) => (!latest || log.createdAt > latest ? log.createdAt : latest),
      undefined,
    );

/** Terminal progress can survive conversion from an event pass to a recurring streak. */
export const normalizeRecurringStreakProgress = <
  T extends { currentDay: number; startedAt: Date },
>(
  progress: T,
  config: { streakType: string; totalDays: number },
  now: Date,
  eventPassCompletedAt?: Date,
): T =>
  config.streakType === "RECURRING" &&
  (progress.currentDay >= config.totalDays ||
    // A successful restart advances startedAt beyond the event completion, so
    // the permanent ownership record cannot reset subsequent recurring claims.
    (eventPassCompletedAt !== undefined && eventPassCompletedAt >= progress.startedAt))
    ? { ...progress, currentDay: 0, startedAt: now }
    : progress;

const streakContinuityEndsAt = (lastClaimDate: Date | null) =>
  lastClaimDate
    ? secondsFromDate(STREAK_CONTINUITY_HOURS * HOUR_S, lastClaimDate)
    : null;

export const isStreakContinuous = (lastClaimDate: Date | null, now = new Date()) =>
  (streakContinuityEndsAt(lastClaimDate)?.getTime() ?? 0) > now.getTime();

/** Highest day the calendar has reached since the streak started, capped at its length. */
export const getStreakTheoreticalMaxDay = (
  startedAt: Date,
  totalDays: number,
  now: Date,
) =>
  Math.min(
    Math.floor((now.getTime() - startedAt.getTime()) / (DAY_S * 1000)) + 1,
    totalDays,
  );

/** Time-derived claim state; the streak list and the claim mutation must agree on it. */
export const getStreakClaimState = (
  progress: { currentDay: number; startedAt: Date; lastClaimDate: Date | null },
  config: { streakType: string; totalDays: number },
  now: Date,
  eventPassCompletedAt?: Date,
) => {
  const { currentDay, startedAt, lastClaimDate } = progress;
  const theoreticalMaxDay = getStreakTheoreticalMaxDay(
    startedAt,
    config.totalDays,
    now,
  );
  return {
    isPassCompleted:
      config.streakType === "EVENT_PASS" &&
      (currentDay >= config.totalDays || eventPassCompletedAt !== undefined),
    theoreticalMaxDay,
    alreadyClaimedToday: lastClaimDate !== null && isSameDay(lastClaimDate, now),
    continuous: isStreakContinuous(lastClaimDate, now),
    // Day 0 is a fresh start (never claimed or just reset), not a missed day.
    isBehind: currentDay > 0 && currentDay < theoreticalMaxDay,
  };
};

/** Decide which day a claim lands on and how it got there, or why it is refused. */
export const resolveStreakClaim = (
  currentDay: number,
  state: Pick<
    ReturnType<typeof getStreakClaimState>,
    "alreadyClaimedToday" | "continuous" | "isBehind"
  >,
  request: { reset?: boolean; payCatchUp?: boolean; reputationPoints: number },
):
  | { newCurrentDay: number; streakReset: boolean; paidCatchUp: boolean }
  | { error: string } => {
  const { alreadyClaimedToday, continuous, isBehind } = state;
  if (request.reset) {
    if (currentDay === 0) {
      return { error: "Nothing to reset - you haven't started yet" };
    }
    if (alreadyClaimedToday) {
      return { error: "You have already claimed this streak today" };
    }
    if (!isBehind) {
      return {
        error: "Cannot reset - your streak is on track! Just claim the next day.",
      };
    }
    return { newCurrentDay: 1, streakReset: true, paidCatchUp: false };
  }
  if (request.payCatchUp) {
    if (!isBehind) {
      return {
        error: "You can only pay to catch up when you are behind. Come back tomorrow!",
      };
    }
    if (request.reputationPoints < COST_STREAK_CATCHUP_DAY) {
      return {
        error: `Not enough reputation points. Required: ${COST_STREAK_CATCHUP_DAY}, Available: ${Math.floor(request.reputationPoints)}`,
      };
    }
    return { newCurrentDay: currentDay + 1, streakReset: false, paidCatchUp: true };
  }
  if (continuous || currentDay === 0) {
    if (alreadyClaimedToday) {
      return { error: "You have already claimed this streak today" };
    }
    return { newCurrentDay: currentDay + 1, streakReset: false, paidCatchUp: false };
  }
  // A broken streak that neither pays nor resets explicitly restarts from day 1.
  return { newCurrentDay: 1, streakReset: true, paidCatchUp: false };
};

/** Recheck at UTC rollover, the continuity deadline, or the next elapsed pass day. */
export const nextStreakRefreshAt = (
  streaks: { lastClaimDate: Date | null; startedAt?: Date }[],
  now = new Date(),
) => {
  const deadlines = streaks
    .flatMap((streak) => {
      const continuity = streakContinuityEndsAt(streak.lastClaimDate)?.getTime() ?? 0;
      const start = streak.startedAt?.getTime();
      const nextPassDay =
        start === undefined
          ? 0
          : start +
            (Math.max(0, Math.floor((now.getTime() - start) / (DAY_S * 1000))) + 1) *
              DAY_S *
              1000;
      return [continuity, nextPassDay];
    })
    .filter((timestamp) => timestamp > now.getTime());
  return new Date(Math.min(nextUtcDayAt(now).getTime(), ...deadlines));
};

/**
 * Event pass price as text, listing only the currencies it charges. Each surface picks
 * its own wording; a pass without a price reads as `free`.
 */
export const formatEventPassCost = (
  cost: { ryoCost: number; repsCost: number; seichiSilverCost: number },
  {
    separator,
    repsLabel = "reputation",
    silverLabel = "silver",
    free = "Free",
  }: { separator: string; repsLabel?: string; silverLabel?: string; free?: string },
) => {
  const parts: string[] = [];
  if (cost.ryoCost > 0) parts.push(`${cost.ryoCost} ryo`);
  if (cost.repsCost > 0) parts.push(`${cost.repsCost} ${repsLabel}`);
  if (cost.seichiSilverCost > 0) parts.push(`${cost.seichiSilverCost} ${silverLabel}`);
  return parts.length > 0 ? parts.join(separator) : free;
};
