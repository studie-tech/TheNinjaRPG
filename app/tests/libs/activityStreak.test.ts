import { describe, expect, it } from "vitest";
import {
  isActivityStreakPopupBlocking,
  resolveActivityStreakDateLatches,
  resolveActivityStreakPopupOpen,
  type ActivityStreakPopupState,
} from "@/libs/activityStreak";

/** Builds popup state with the legacy closed, loaded, and eligible defaults. */
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

describe("activity streak popup compatibility", () => {
  it("opens when rewards become available", () => {
    expect(
      resolveActivityStreakPopupOpen(state({ shouldShowPopup: true })),
    ).toBe(true);
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
      resolveActivityStreakDateLatches(
        "2026-08-15",
        "2026-08-15",
        "2026-08-15",
      ),
    ).toEqual({ dismissedToday: true, userClosed: true });
    expect(
      resolveActivityStreakDateLatches(
        "2026-08-16",
        "2026-08-15",
        "2026-08-15",
      ),
    ).toEqual({ dismissedToday: false, userClosed: false });
  });

  it("blocks competing popups during loading and until an explicit close", () => {
    expect(isActivityStreakPopupBlocking(true, state({ isLoading: true }))).toBe(
      true,
    );
    expect(isActivityStreakPopupBlocking(true, state({ isOpen: true }))).toBe(true);
    expect(
      isActivityStreakPopupBlocking(
        true,
        state({ isOpen: true, userClosed: true }),
      ),
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
      resolveActivityStreakPopupOpen(
        state({ isLoading: true, tutorialActive: true }),
      ),
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

  it("resumes normally once the tutorial is finished", () => {
    expect(
      resolveActivityStreakPopupOpen(
        state({ shouldShowPopup: true, tutorialActive: false }),
      ),
    ).toBe(true);
  });
});
