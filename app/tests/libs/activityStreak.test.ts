import { describe, expect, it } from "vitest";
import {
  isActivityStreakPopupBlocking,
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
});
