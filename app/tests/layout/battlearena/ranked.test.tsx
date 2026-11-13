import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { RANKED_ENTRY_COST } from "@/drizzle/constants";
import * as queueCount from "@/hooks/useRankedQueueCount";
import { RankedMode } from "@/layout/battlearena/RankedMode";
import * as pvpRank from "@/layout/PvpRank";
import * as toast from "@/libs/toast";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
let user: Record<string, unknown>;
let inQueue = false;
let season: unknown;

beforeEach(() => {
  installBrowserGlobals();
  user = {
    userId: "me",
    status: "AWAKE",
    rankedLp: 180,
    villagePrestige: 50000,
    isBanned: false,
  };
  inQueue = false;
  season = { name: "Season 4", paused: false };
  for (const name of [
    "enterRankedSeason",
    "queueForRankedPvp",
    "leaveRankedPvpQueue",
    "checkRankedPvpMatches",
  ]) {
    mutations[name] = vi.fn();
  }
  const useMutation = (name: string) => () => ({
    mutate: mutations[name],
    isPending: false,
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    pvpRank: {
      getRankedPvpQueue: {
        useQuery: () => ({ data: { inQueue, queueCount: 4, createdAt: new Date() } }),
      },
      getCurrentTopPlayers: {
        useQuery: () => ({
          data: [1200, 1190, 1180, 1170, 1160, 1150, 1140, 1130, 1120, 1110],
        }),
      },
      getCurrentSeason: { useQuery: () => ({ data: season, isPending: false }) },
      getRankedLoadout: {
        useQuery: () => ({
          data: {
            loadout: {
              jutsuIds: Array(12).fill("j"),
              weaponIds: ["w", "w"],
              consumableIds: ["c"],
            },
          },
        }),
      },
      enterRankedSeason: { useMutation: useMutation("enterRankedSeason") },
      queueForRankedPvp: { useMutation: useMutation("queueForRankedPvp") },
      leaveRankedPvpQueue: { useMutation: useMutation("leaveRankedPvpQueue") },
      checkRankedPvpMatches: { useMutation: useMutation("checkRankedPvpMatches") },
    },
  });
  mockUserContextValue(
    () => ({ data: user, prepareUserUpdate: vi.fn(), updateUser: vi.fn() }) as never,
  );
  vi.spyOn(queueCount, "useRankedQueueCountCache").mockReturnValue({
    refreshRankedQueueCount: vi.fn(),
  } as never);
  vi.spyOn(pvpRank, "RankedLoadoutSelector").mockImplementation(() => (
    <p>Ranked loadout picker</p>
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("shows the division and LP to the next one", () => {
  render(<RankedMode />);
  expect(screen.getByRole("heading", { name: "Wood" })).toBeDefined();
  expect(screen.getByText("180 LP")).toBeDefined();
  expect(screen.getByText("120 LP to Adept")).toBeDefined();
  expect(
    screen.getByText("Jutsu 12 / 15 · Weapons 2 / 2 · Consumables 1 / 4"),
  ).toBeDefined();
});

it("shows Sannin for a player among the top Legend players", () => {
  user = { ...user, rankedLp: 1200 };
  render(<RankedMode />);
  expect(screen.getByRole("heading", { name: "Sannin" })).toBeDefined();
  expect(screen.queryByText(/LP to/)).toBeNull();
});

it("queues and leaves the queue", () => {
  render(<RankedMode />);
  fireEvent.click(screen.getByRole("button", { name: "Find ranked match" }));
  expect(mutations.queueForRankedPvp).toHaveBeenCalled();
  cleanup();
  inQueue = true;
  render(<RankedMode />);
  expect(screen.getByText(/Waiting for an opponent/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Leave queue" }));
  expect(mutations.leaveRankedPvpQueue).toHaveBeenCalled();
});

it("refuses to queue during a battle", () => {
  user = { ...user, status: "BATTLE" };
  render(<RankedMode />);
  fireEvent.click(screen.getByRole("button", { name: "Find ranked match" }));
  expect(mutations.queueForRankedPvp).not.toHaveBeenCalled();
  expect(toast.showMutationToast).toHaveBeenCalledWith({
    success: false,
    message:
      "You cannot queue while in battle. Please finish your current battle first.",
  });
});

it("offers to enter the season", () => {
  user = { ...user, rankedLp: 0 };
  render(<RankedMode />);
  const enter = screen.getByRole("button", { name: /Enter season/ });
  expect(enter.textContent).toContain(RANKED_ENTRY_COST.toLocaleString());
  fireEvent.click(enter);
  expect(mutations.enterRankedSeason).toHaveBeenCalled();
});

it("says when the season is paused", () => {
  season = { name: "Season 4", paused: true };
  render(<RankedMode />);
  expect(screen.getByText(/Season 4.*paused/)).toBeDefined();
  expect(screen.queryByRole("button", { name: "Find ranked match" })).toBeNull();
});

it("keeps ranked loadout editing available when no season is running", () => {
  season = null;
  render(<RankedMode />);
  expect(screen.getByText("No ranked season is running right now.")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Find ranked match" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit loadout" }));
  expect(screen.getByText("Ranked loadout picker")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByText("Ranked loadout picker")).toBeNull();
});

it("opens the ranked loadout editor", () => {
  render(<RankedMode />);
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Edit loadout" }));
  });
  expect(screen.getByText("Ranked loadout picker")).toBeDefined();
});

it("keeps the loadout editor at panel width on wide screens", () => {
  render(<RankedMode />);
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Edit loadout" }));
  });
  const dialog = screen.getByRole("dialog", { name: "Ranked loadout" });
  expect(dialog.className).toContain("max-w-3xl");
});
