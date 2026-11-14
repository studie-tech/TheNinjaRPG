import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import * as combatEntry from "@/hooks/combatEntry";
import * as ActivityStreakPanel from "@/layout/ActivityStreakPanel";
import ActivityStreakPopup from "@/layout/ActivityStreakPopup";
import { HuntingArrival } from "@/layout/HuntingArrival";
import * as HuntingBoard from "@/layout/HuntingBoard";
import * as Modal from "@/layout/Modal";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { huntingContract } from "../setup/hunting";

let store: ReturnType<typeof createStore>;
let isLoading: boolean;
let canClaimToday: boolean;
const streakQuery = vi.fn();
const cachedEncounter = {
  session: { id: "session", sector: 1, battleId: null },
  contract: huntingContract(),
};
let encounterData: typeof cachedEncounter | null | undefined;
let encounterError: Error | null;
const refetch = vi.fn();
const storageKey = "huntingArrival:popup-hunter";
const user = {
  userId: "popup-hunter",
  occupation: "HUNTER",
  status: "AWAKE",
  sector: 1,
  tutorialOn: false,
};

beforeEach(() => {
  vi.spyOn(combatEntry, "useCombatEntry").mockReturnValue({
    prepareCombatEntry: vi.fn(),
    loadBattle: vi.fn(),
  });
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation((select) => {
    const info = UserContext.useUserData();
    return { ...info, data: info.data ? select(info.data) : undefined } as never;
  });
});

beforeEach(() => {
  installBrowserGlobals();
  window.sessionStorage.removeItem(storageKey);
  window.localStorage.removeItem("streakPopupDismissedDateX");
  store = createStore();
  isLoading = false;
  canClaimToday = true;
  encounterData = cachedEncounter;
  encounterError = null;
  refetch.mockReset();
  streakQuery.mockReset();
  Object.assign(vi.spyOn(client, "api" as never), {
    hunting: {
      getSession: {
        useQuery: () => ({ data: encounterData, error: encounterError, refetch }),
      },
    },
    activityStreak: {
      getUserStreaks: {
        useQuery: (...args: unknown[]) => {
          streakQuery(...args);
          return {
            isLoading,
            data: isLoading
              ? undefined
              : { streaks: [{ canClaimToday, lastClaimDate: null }] },
          };
        },
      },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({ data: user } as never);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: user,
    timeDiff: 0,
  } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
  vi.spyOn(HuntingBoard, "HuntingBoard").mockImplementation(() => (
    <p>Hunting preparation</p>
  ));
  vi.spyOn(ActivityStreakPanel, "default").mockImplementation(() => (
    <p>Reward claims</p>
  ));
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  window.sessionStorage.removeItem(storageKey);
  window.localStorage.removeItem("streakPopupDismissedDateX");
  restoreBrowserGlobals();
});

// Match the shell: route children mount before the global daily-reward popup.
const shell = (blocked = false) => (
  <Provider store={store}>
    <HuntingArrival blocked={blocked} />
    <ActivityStreakPopup />
  </Provider>
);

it.each(["/native-sign-in", "/native-sign-in/"])(
  "clears an open reward blocker on %s without dismissing eligibility",
  async (pathname) => {
    const route = vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
    const popup = () => (
      <Provider store={store}>
        <ActivityStreakPopup />
        <button type="button">Continue to the app</button>
      </Provider>
    );
    const view = render(popup());
    await view.findByRole("dialog", { name: "Daily Activity Rewards" });
    expect(store.get(UserContext.blockingPopupOpenAtom)).toBe(true);
    const dismissedDate = window.localStorage.getItem("streakPopupDismissedDateX");

    route.mockReturnValue(pathname);
    view.rerender(popup());
    await waitFor(() =>
      expect(store.get(UserContext.blockingPopupOpenAtom)).toBe(false),
    );
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByRole("button", { name: "Continue to the app" })).toBeTruthy();
    expect(streakQuery.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: false });
    expect(window.localStorage.getItem("streakPopupDismissedDateX")).toBe(
      dismissedDate,
    );

    route.mockReturnValue("/travel");
    view.rerender(popup());
    await view.findByRole("dialog", { name: "Daily Activity Rewards" });
    expect(streakQuery.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: true });
  },
);

it.each([false, true])(
  "opens hunting after daily rewards close (initial loading: %s)",
  async (loading) => {
    isLoading = loading;
    const view = render(shell());
    if (loading) {
      await waitFor(() =>
        expect(store.get(UserContext.blockingPopupOpenAtom)).toBe(true),
      );
      expect(view.queryByRole("dialog")).toBeNull();
      expect(window.sessionStorage.getItem(storageKey)).toBeNull();
      isLoading = false;
      view.rerender(shell());
    }
    const daily = await view.findByRole("dialog", { name: "Daily Activity Rewards" });
    expect(view.queryByRole("dialog", { name: "Hunting encounter" })).toBeNull();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    fireEvent.click(within(daily).getAllByRole("button", { name: "Close" })[0]!);
    await view.findByRole("dialog", { name: "Hunting encounter" });
    expect(store.get(UserContext.blockingPopupOpenAtom)).toBe(false);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  },
);

it("opens hunting when daily-reward loading finishes without an eligible popup", async () => {
  isLoading = true;
  canClaimToday = false;
  const view = render(shell());
  await waitFor(() => expect(store.get(UserContext.blockingPopupOpenAtom)).toBe(true));
  expect(view.queryByRole("dialog")).toBeNull();
  isLoading = false;
  view.rerender(shell());
  await view.findByRole("dialog", { name: "Hunting encounter" });
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
});

it("still waits for travel confirmation after the global popup closes", async () => {
  const view = render(shell(true));
  const daily = await view.findByRole("dialog", { name: "Daily Activity Rewards" });
  fireEvent.click(within(daily).getAllByRole("button", { name: "Close" })[0]!);
  await waitFor(() => expect(store.get(UserContext.blockingPopupOpenAtom)).toBe(false));
  expect(view.queryByRole("dialog")).toBeNull();
  view.rerender(shell());
  await view.findByRole("dialog", { name: "Hunting encounter" });
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
});

it("preserves hunting when another arrival dialog takes focus", async () => {
  const closeOther = vi.fn();
  const arrivals = (isOpen: boolean) => (
    <Provider store={store}>
      <HuntingArrival />
      <Modal.default title="NPC arrival" isOpen={isOpen} setIsOpen={closeOther}>
        Another encounter
      </Modal.default>
    </Provider>
  );
  const view = render(arrivals(false));
  await view.findByRole("dialog", { name: "Hunting encounter" });
  view.rerender(arrivals(true));
  const other = await view.findByRole("dialog", { name: "NPC arrival" });
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  fireEvent.click(within(other).getAllByRole("button", { name: "Close" })[0]!);
  expect(closeOther).toHaveBeenCalledWith(false);
  view.rerender(arrivals(false));
  const hunting = await view.findByRole("dialog", { name: "Hunting encounter" });
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  fireEvent.click(within(hunting).getAllByRole("button", { name: "Close" })[0]!);
  expect(window.sessionStorage.getItem(storageKey)).toBe("1:session");
  expect(view.queryByRole("dialog", { name: "Hunting encounter" })).toBeNull();
});

it("keeps the open encounter, focus and action feedback through a failed refresh and recovery", async () => {
  canClaimToday = false;
  vi.spyOn(HuntingBoard, "HuntingBoard").mockImplementation(
    function HuntingPreparation() {
      const [message, setMessage] = useState("");
      return (
        <>
          <button onClick={() => setMessage("Preparation rejected")}>Prepare</button>
          <p role="status">{message}</p>
        </>
      );
    },
  );
  const view = render(shell());
  const hunting = await view.findByRole("dialog", { name: "Hunting encounter" });
  const prepare = within(hunting).getByRole("button", { name: "Prepare" });
  prepare.focus();
  fireEvent.click(prepare);
  for (const error of [new Error("Transient poll failure"), null]) {
    encounterError = error;
    view.rerender(shell());
    expect(view.getByRole("dialog", { name: "Hunting encounter" })).toBe(hunting);
    expect(document.activeElement).toBe(prepare);
    expect(within(hunting).getByRole("status").textContent).toBe(
      "Preparation rejected",
    );
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
  }
});

it.each(["another sector", "no session"])(
  "keeps the arrival empty after a failed refresh with cached %s",
  (result) => {
    canClaimToday = false;
    encounterData =
      result === "no session"
        ? null
        : { ...cachedEncounter, session: { ...cachedEncounter.session, sector: 2 } };
    const view = render(shell());
    expect(view.container.textContent).toBe("");
    encounterError = new Error("Transient poll failure");
    view.rerender(shell());
    expect(view.container.textContent).toBe("");
  },
);

it("offers Retry after an initial load failure and opens the recovered encounter", async () => {
  canClaimToday = false;
  encounterData = undefined;
  encounterError = new Error("Initial load failure");
  const view = render(shell());
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(view.queryByRole("dialog")).toBeNull();
  encounterError = null;
  encounterData = cachedEncounter;
  view.rerender(shell());
  await view.findByRole("dialog", { name: "Hunting encounter" });
  expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
});

it.each([false, true])(
  "respects the sleeping hunter's automatic-wake preference (%s)",
  async (autoWakeUp) => {
    const sleepingHunter = { ...user, status: "ASLEEP", autoWakeUp };
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: sleepingHunter,
      timeDiff: 0,
    } as never);
    const view = render(
      <Provider store={store}>
        <HuntingArrival />
      </Provider>,
    );
    if (autoWakeUp) await view.findByRole("dialog", { name: "Hunting encounter" });
    else {
      expect(view.queryByRole("dialog")).toBeNull();
      expect(view.queryByRole("button", { name: "Open hunting contract" })).toBeNull();
    }
  },
);
