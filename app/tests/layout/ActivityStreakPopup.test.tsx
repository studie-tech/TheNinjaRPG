import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setBlocking: vi.fn(),
  setDismissed: vi.fn(),
  query: {
    data: {
      streaks: [{ canClaimToday: true, needsCatchUp: false }],
      activeRecurringConfig: null as object | null,
    },
    isLoading: false,
  },
}));

vi.mock("jotai", () => ({ useSetAtom: () => mocks.setBlocking }));
vi.mock("@/app/_trpc/client", () => ({
  api: {
    activityStreak: {
      getUserStreaks: { useQuery: () => mocks.query },
    },
  },
}));
vi.mock("@/hooks/localstorage", () => ({
  useLocalStorage: () => [false, mocks.setDismissed],
}));
vi.mock("@/utils/UserContext", () => ({
  blockingPopupOpenAtom: {},
  useUserData: () => ({ data: { userId: "user-1" } }),
}));
vi.mock("@/layout/ActivityStreakPanel", () => ({
  default: () => <div>Streak panel</div>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

import ActivityStreakPopup from "@/layout/ActivityStreakPopup";

describe("ActivityStreakPopup compatibility", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.setBlocking.mockClear();
    mocks.setDismissed.mockClear();
    mocks.query.data = {
      streaks: [{ canClaimToday: true, needsCatchUp: false }],
      activeRecurringConfig: null,
    };
    mocks.query.isLoading = false;
  });

  it("stays open after a claim refetch clears the final claimable reward", async () => {
    const view = render(<ActivityStreakPopup />);
    await screen.findByText("Streak panel");

    mocks.query.data = {
      streaks: [{ canClaimToday: false, needsCatchUp: false }],
      activeRecurringConfig: null,
    };
    view.rerender(<ActivityStreakPopup />);

    expect(screen.getByText("Streak panel")).toBeTruthy();
    await waitFor(() => expect(mocks.setBlocking).toHaveBeenLastCalledWith(true));
  });

  it("unblocks overworld prompts only after the user explicitly closes it", async () => {
    render(<ActivityStreakPopup />);
    await screen.findByText("Streak panel");

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByText("Streak panel")).toBeNull();
    await waitFor(() => expect(mocks.setBlocking).toHaveBeenLastCalledWith(false));
  });
});
