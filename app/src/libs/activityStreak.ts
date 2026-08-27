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
