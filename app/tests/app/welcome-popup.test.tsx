import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as localstorage from "@/hooks/localstorage";
import * as streaks from "@/hooks/useActivityStreaks";
import * as splash from "@/hooks/useSplash";
import ActivityStreakPopup from "@/layout/ActivityStreakPopup";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";
import { activityPanel } from "../setup/activityStreakPanel";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { splashEntry } from "../setup/splash";

let pathname = "/profile";
let tutorialOn = false;
let claimable = true;
let announcement = true;
const dismiss = vi.fn();
beforeEach(() => {
  installBrowserGlobals();
  pathname = "/profile";
  tutorialOn = false;
  claimable = true;
  announcement = true;
  dismiss.mockClear();
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(
    () =>
      ({
        data: { tutorialOn, tutorialStep: tutorialOn ? 0 : 99 },
        timeDiff: 0,
      }) as never,
  );
  vi.spyOn(localstorage, "useLocalStorage").mockReturnValue([null, dismiss]);
  vi.spyOn(streaks, "useActivityStreaks").mockImplementation(
    () =>
      ({
        data: { streaks: [{ canClaimToday: claimable }] },
        isLoading: false,
      }) as never,
  );
  vi.spyOn(splash, "useSplash").mockImplementation(
    () =>
      ({
        data: { announcements: announcement ? [splashEntry()] : [] },
        isLoading: false,
      }) as never,
  );
  activityPanel.mockImplementation(() => (
    <button type="button">Claim daily reward</button>
  ));
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("puts announcements and daily rewards in one profile dialog and dismisses them together", async () => {
  const view = render(<ActivityStreakPopup />);
  const dialog = await view.findByRole("dialog", { name: "Village dispatch" });
  expect(view.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(view.getByText("Daily activity rewards"));
  expect(await view.findByRole("button", { name: "Claim daily reward" })).toBeTruthy();
  expect(dialog.textContent).toContain("Daily activity rewards");
  expect(dialog.textContent).toContain("Defend the village");
  fireEvent.click(view.getByRole("button", { name: "Dismiss for today" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(dismiss).toHaveBeenCalled();
});
it("opens the announcement edition even when rewards were already claimed", async () => {
  claimable = false;
  const view = render(<ActivityStreakPopup />);
  expect(await view.findByRole("dialog", { name: "Village dispatch" })).toBeTruthy();
});
it("keeps the daily claim when announcements are disabled", async () => {
  announcement = false;
  const view = render(<ActivityStreakPopup />);
  expect(
    await view.findByRole("dialog", { name: "Daily Activity Rewards" }),
  ).toBeTruthy();
  expect(await view.findByRole("button", { name: "Claim daily reward" })).toBeTruthy();
});
it.each(["tutorial", "auth", "merch", "editor"])(
  "suppresses the welcome flow for %s",
  (reason) => {
    if (reason === "tutorial") tutorialOn = true;
    if (reason === "auth") pathname = "/native-sign-in";
    if (reason === "merch") pathname = "/merch";
    if (reason === "editor") pathname = "/manual/splash";
    const view = render(<ActivityStreakPopup />);
    expect(view.queryByRole("dialog")).toBeNull();
  },
);
