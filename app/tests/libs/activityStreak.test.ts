import { describe, expect, it } from "bun:test";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import {
  type ActivityStreakPopupState,
  formatEventPassCost,
  getStreakClaimState,
  isActivityStreakPopupBlocking,
  isEventPassCompletion,
  isStreakContinuous,
  nextStreakRefreshAt,
  normalizeRecurringStreakProgress,
  resolveActivityStreakDateLatches,
  resolveActivityStreakPopupOpen,
  resolveStreakClaim,
  shouldFetchActivityStreaksForPopup,
} from "@/libs/activityStreak";

describe("event pass completion history", () => {
  it("recognizes event-pass completion audit entries", () => {
    expect(isEventPassCompletion(["Completed Summer Pass (EVENT_PASS)"])).toBe(true);
  });

  it("does not treat recurring or malformed audit data as an event-pass completion", () => {
    expect(isEventPassCompletion(["Completed Daily Streak (RECURRING)"])).toBe(false);
    expect(isEventPassCompletion(null)).toBe(false);
    expect(isEventPassCompletion({ changes: ["(EVENT_PASS)"] })).toBe(false);
  });
});

/** Builds popup state that defaults to closed, loaded, ineligible and outside the tutorial. */
const state = (
  patch: Partial<ActivityStreakPopupState> = {},
): ActivityStreakPopupState => ({
  isOpen: false,
  isLoading: false,
  shouldShowPopup: false,
  dismissedToday: false,
  userClosed: false,
  tutorialActive: false,
  ...patch,
});

describe("activity streak popup state", () => {
  it("opens when rewards become available", () => {
    expect(resolveActivityStreakPopupOpen(state({ shouldShowPopup: true }))).toBe(true);
  });

  it("stays latched open after a claim refetch clears the final reward", () => {
    expect(resolveActivityStreakPopupOpen(state({ isOpen: true }))).toBe(true);
  });

  it("does not reopen after an explicit close or daily dismissal", () => {
    expect(
      resolveActivityStreakPopupOpen(
        state({ shouldShowPopup: true, userClosed: true }),
      ),
    ).toBe(false);
    expect(
      resolveActivityStreakPopupOpen(
        state({ shouldShowPopup: true, dismissedToday: true }),
      ),
    ).toBe(false);
  });

  it("clears close and dismissal latches when the date rolls over", () => {
    expect(
      resolveActivityStreakDateLatches("2026-08-15", "2026-08-15", "2026-08-15"),
    ).toEqual({ dismissedToday: true, userClosed: true });
    expect(
      resolveActivityStreakDateLatches("2026-08-16", "2026-08-15", "2026-08-15"),
    ).toEqual({ dismissedToday: false, userClosed: false });
  });

  it("blocks competing popups during loading and until an explicit close", () => {
    expect(isActivityStreakPopupBlocking(true, state({ isLoading: true }))).toBe(true);
    expect(isActivityStreakPopupBlocking(true, state({ isOpen: true }))).toBe(true);
    expect(
      isActivityStreakPopupBlocking(true, state({ isOpen: true, userClosed: true })),
    ).toBe(false);
  });

  it("never opens while the tutorial is running", () => {
    // A brand-new account has no streak progress, so the enrolment prompt is
    // eligible on exactly the accounts that are also mid-tutorial.
    expect(
      resolveActivityStreakPopupOpen(
        state({ shouldShowPopup: true, tutorialActive: true }),
      ),
    ).toBe(false);
    expect(
      resolveActivityStreakPopupOpen(state({ isLoading: true, tutorialActive: true })),
    ).toBe(false);
  });

  it("closes an already-open popup if the tutorial restarts underneath it", () => {
    expect(
      resolveActivityStreakPopupOpen(state({ isOpen: true, tutorialActive: true })),
    ).toBe(false);
  });

  it("does not hold back other popups while suppressed for the tutorial", () => {
    expect(
      isActivityStreakPopupBlocking(
        true,
        state({ isLoading: true, tutorialActive: true }),
      ),
    ).toBe(false);
    expect(
      isActivityStreakPopupBlocking(
        true,
        state({ shouldShowPopup: true, tutorialActive: true }),
      ),
    ).toBe(false);
  });
});

describe("shouldFetchActivityStreaksForPopup", () => {
  it("fetches for a signed-in user who can still see the popup", () => {
    expect(
      shouldFetchActivityStreaksForPopup({
        hasUser: true,
        tutorialActive: false,
        dismissedToday: false,
        userClosed: false,
      }),
    ).toBe(true);
  });

  it("skips the query when the popup cannot open", () => {
    expect(
      shouldFetchActivityStreaksForPopup({
        hasUser: false,
        tutorialActive: false,
        dismissedToday: false,
        userClosed: false,
      }),
    ).toBe(false);
    expect(
      shouldFetchActivityStreaksForPopup({
        hasUser: true,
        tutorialActive: true,
        dismissedToday: false,
        userClosed: false,
      }),
    ).toBe(false);
    expect(
      shouldFetchActivityStreaksForPopup({
        hasUser: true,
        tutorialActive: false,
        dismissedToday: true,
        userClosed: false,
      }),
    ).toBe(false);
    expect(
      shouldFetchActivityStreaksForPopup({
        hasUser: true,
        tutorialActive: false,
        dismissedToday: false,
        userClosed: true,
      }),
    ).toBe(false);
  });

  it("does not hold competing popups when the streaks query is gated off", () => {
    expect(
      isActivityStreakPopupBlocking(
        true,
        state({ isLoading: false, tutorialActive: true }),
      ),
    ).toBe(false);
    expect(
      isActivityStreakPopupBlocking(
        true,
        state({ isLoading: false, dismissedToday: true }),
      ),
    ).toBe(false);
    expect(
      isActivityStreakPopupBlocking(
        true,
        state({ isLoading: false, userClosed: true }),
      ),
    ).toBe(false);
  });
});

describe("recurring progress after configuration changes", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const progress = {
    currentDay: 14,
    startedAt: new Date("2026-09-01"),
    lastClaimDate: new Date("2026-09-19T12:00:00Z"),
  };
  it("starts a new recurring cycle while preserving the claim concurrency token", () => {
    expect(
      normalizeRecurringStreakProgress(
        progress,
        { streakType: "RECURRING", totalDays: 14 },
        now,
      ),
    ).toEqual({ ...progress, currentDay: 0, startedAt: now });
  });
  it("preserves completed event passes and unfinished recurring progress", () => {
    expect(
      normalizeRecurringStreakProgress(
        progress,
        { streakType: "EVENT_PASS", totalDays: 14 },
        now,
      ),
    ).toBe(progress);
    expect(
      normalizeRecurringStreakProgress(
        progress,
        { streakType: "RECURRING", totalDays: 28 },
        now,
      ),
    ).toBe(progress);
  });
  it("resets an expanded converted pass only until its new recurring cycle starts", () => {
    const completedAt = new Date("2026-09-19T12:00:00Z");
    const converted = { currentDay: 2, startedAt: new Date("2026-09-01") };
    const config = { streakType: "RECURRING", totalDays: 3 };
    const normalized = normalizeRecurringStreakProgress(
      converted,
      config,
      now,
      completedAt,
    );
    expect(normalized.currentDay).toBe(0);
    const nextDay = { ...normalized, currentDay: 1 };
    expect(
      normalizeRecurringStreakProgress(
        nextDay,
        config,
        new Date("2026-09-21"),
        completedAt,
      ),
    ).toBe(nextDay);
  });
});

describe("streak refresh schedule", () => {
  it("refreshes streaks at elapsed pass days and the exact continuity deadline", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const lastClaimDate = new Date("2026-09-30T00:00:00Z");
    expect(isStreakContinuous(lastClaimDate, new Date(now.getTime() - 1))).toBe(true);
    expect(isStreakContinuous(lastClaimDate, now)).toBe(false);
    expect(
      nextStreakRefreshAt(
        [{ lastClaimDate: now, startedAt: new Date("2026-09-30T14:00:00Z") }],
        now,
      ),
    ).toEqual(new Date("2026-10-01T14:00:00Z"));
    expect(nextStreakRefreshAt([], now)).toEqual(new Date("2026-10-02T00:00:00Z"));
  });
});

describe("streak claim state", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);
  const recurring = { streakType: "RECURRING", totalDays: 7 };

  it("caps the reachable day at the streak length", () => {
    const progress = { currentDay: 2, startedAt: hoursAgo(49), lastClaimDate: null };
    expect(getStreakClaimState(progress, recurring, now).theoreticalMaxDay).toBe(3);
    expect(
      getStreakClaimState(progress, { ...recurring, totalDays: 2 }, now)
        .theoreticalMaxDay,
    ).toBe(2);
  });

  it("does not treat a fresh start as behind", () => {
    const fresh = { currentDay: 0, startedAt: hoursAgo(72), lastClaimDate: null };
    expect(getStreakClaimState(fresh, recurring, now).isBehind).toBe(false);
    expect(
      getStreakClaimState({ ...fresh, currentDay: 1 }, recurring, now).isBehind,
    ).toBe(true);
  });

  it("reads claim timing from the given clock", () => {
    const progress = {
      currentDay: 1,
      startedAt: hoursAgo(2),
      lastClaimDate: hoursAgo(2),
    };
    const state = getStreakClaimState(progress, recurring, now);
    expect(state.alreadyClaimedToday).toBe(true);
    expect(state.continuous).toBe(true);
    const later = getStreakClaimState(
      progress,
      recurring,
      new Date("2026-10-14T00:00:00Z"),
    );
    expect(later.alreadyClaimedToday).toBe(false);
    expect(later.continuous).toBe(false);
  });

  it("completes an event pass by day count or a logged completion", () => {
    const pass = { streakType: "EVENT_PASS", totalDays: 2 };
    const base = { startedAt: hoursAgo(1), lastClaimDate: null };
    expect(
      getStreakClaimState({ ...base, currentDay: 1 }, pass, now).isPassCompleted,
    ).toBe(false);
    expect(
      getStreakClaimState({ ...base, currentDay: 2 }, pass, now).isPassCompleted,
    ).toBe(true);
    expect(
      getStreakClaimState({ ...base, currentDay: 1 }, pass, now, now).isPassCompleted,
    ).toBe(true);
    expect(
      getStreakClaimState({ ...base, currentDay: 7 }, recurring, now, now)
        .isPassCompleted,
    ).toBe(false);
  });
});

describe("streak claim resolution", () => {
  const onTrack = { alreadyClaimedToday: false, continuous: true, isBehind: false };
  const request = { reset: false, payCatchUp: false, reputationPoints: 0 };
  const advance = (newCurrentDay: number) => ({
    newCurrentDay,
    streakReset: false,
    paidCatchUp: false,
  });
  const restart = { newCurrentDay: 1, streakReset: true, paidCatchUp: false };

  it("advances a continuous streak or a first claim once per day", () => {
    expect(resolveStreakClaim(3, onTrack, request)).toEqual(advance(4));
    expect(resolveStreakClaim(0, { ...onTrack, continuous: false }, request)).toEqual(
      advance(1),
    );
    expect(
      resolveStreakClaim(3, { ...onTrack, alreadyClaimedToday: true }, request),
    ).toEqual({ error: "You have already claimed this streak today" });
  });

  it("restarts a broken streak unless the player pays", () => {
    const broken = { ...onTrack, continuous: false, isBehind: true };
    expect(resolveStreakClaim(3, broken, request)).toEqual(restart);
    expect(
      resolveStreakClaim(3, broken, {
        ...request,
        payCatchUp: true,
        reputationPoints: COST_STREAK_CATCHUP_DAY,
      }),
    ).toEqual({ newCurrentDay: 4, streakReset: false, paidCatchUp: true });
  });

  it("refuses a catch-up without arrears or reputation", () => {
    const payCatchUp = { ...request, payCatchUp: true };
    expect(resolveStreakClaim(3, onTrack, payCatchUp)).toEqual({
      error: "You can only pay to catch up when you are behind. Come back tomorrow!",
    });
    expect(
      resolveStreakClaim(
        3,
        { ...onTrack, isBehind: true },
        {
          ...payCatchUp,
          reputationPoints: COST_STREAK_CATCHUP_DAY - 0.5,
        },
      ),
    ).toEqual({
      error: `Not enough reputation points. Required: ${COST_STREAK_CATCHUP_DAY}, Available: ${COST_STREAK_CATCHUP_DAY - 1}`,
    });
  });

  it("only resets a started streak that is behind and unclaimed today", () => {
    const reset = { ...request, reset: true };
    expect(resolveStreakClaim(0, onTrack, reset)).toEqual({
      error: "Nothing to reset - you haven't started yet",
    });
    expect(
      resolveStreakClaim(3, { ...onTrack, alreadyClaimedToday: true }, reset),
    ).toEqual({ error: "You have already claimed this streak today" });
    expect(resolveStreakClaim(3, onTrack, reset)).toEqual({
      error: "Cannot reset - your streak is on track! Just claim the next day.",
    });
    expect(resolveStreakClaim(3, { ...onTrack, isBehind: true }, reset)).toEqual(
      restart,
    );
  });
});

describe("formatEventPassCost", () => {
  const cost = { ryoCost: 100, repsCost: 5, seichiSilverCost: 2 };

  it("lists charged currencies in order with the surface's wording", () => {
    expect(formatEventPassCost(cost, { separator: " + " })).toBe(
      "100 ryo + 5 reputation + 2 silver",
    );
    expect(formatEventPassCost(cost, { separator: " / ", repsLabel: "reps" })).toBe(
      "100 ryo / 5 reps / 2 silver",
    );
    expect(
      formatEventPassCost(
        { ...cost, ryoCost: 0 },
        { separator: ", ", silverLabel: "seichi silver" },
      ),
    ).toBe("5 reputation, 2 seichi silver");
  });

  it("names a pass without a price", () => {
    const free = { ryoCost: 0, repsCost: 0, seichiSilverCost: 0 };
    expect(formatEventPassCost(free, { separator: " " })).toBe("Free");
    expect(formatEventPassCost(free, { separator: ", ", free: "free" })).toBe("free");
  });
});
