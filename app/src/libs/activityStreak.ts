export type ActivityStreakPopupState = {
  isOpen: boolean;
  isLoading: boolean;
  shouldShowPopup: boolean;
  dismissedToday: boolean;
  userClosed: boolean;
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
}: ActivityStreakPopupState): boolean =>
  isOpen || (!isLoading && shouldShowPopup && !dismissedToday && !userClosed);

/**
 * Resolve whether the activity-streak flow must delay other auto-opening popups.
 * Loading is blocking to prevent an arrival prompt from winning the initial query race.
 */
export const isActivityStreakPopupBlocking = (
  hasUser: boolean,
  state: ActivityStreakPopupState,
): boolean =>
  hasUser &&
  !state.dismissedToday &&
  !state.userClosed &&
  (state.isLoading || state.shouldShowPopup || state.isOpen);
