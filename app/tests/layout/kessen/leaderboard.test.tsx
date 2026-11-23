import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as navigation from "next/navigation";
import KessenLeaderboardPage from "@/app/[shell]/kessen/leaderboard/page";
import * as kessenPvp from "@/hooks/kessen/useKessenPvpLobby";
import type { KessenLeaderboard, KessenLeaderboardEntry } from "@/validators/kessen";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const player: KessenLeaderboardEntry = {
  userId: "player",
  username: "Duelist",
  avatar: null,
  level: 50,
  rank: 1,
  rating: 1510,
  wins: 12,
  losses: 2,
  draws: 1,
};

let data: KessenLeaderboard | undefined;
let error: Error | null;
let refetch = vi.fn();
let push = vi.fn();

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  data = { entries: [player], you: player };
  error = null;
  refetch = vi.fn();
  push = vi.fn();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(kessenPvp, "useKessenLeaderboard").mockImplementation(
    () => ({ data, isError: !!error, error, refetch }) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("shows ranked players with profile links, levels and separate record columns", () => {
  render(<KessenLeaderboardPage />);
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Rank",
    "Player",
    "Rating",
    "Wins",
    "Losses",
    "Draws",
  ]);
  expect(screen.getByRole("link", { name: "Duelist" }).getAttribute("href")).toBe(
    "/username/Duelist",
  );
  expect(screen.getByText("Level 50")).toBeTruthy();
  expect(screen.getByText("1,510")).toBeTruthy();
  expect(screen.getByText("You")).toBeTruthy();
});

it("returns to Kessen from the page back control", () => {
  render(<KessenLeaderboardPage />);
  fireEvent.click(screen.getByRole("button", { name: "Kessen Leaderboard" }));
  expect(push).toHaveBeenCalledWith("/kessen");
});

it("explains an empty ladder without displaying an empty table", () => {
  data = { entries: [], you: null };
  render(<KessenLeaderboardPage />);
  expect(screen.getByText(/No ranked duels yet/)).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText("Ranked by Elo rating")).toBeTruthy();
});

it("keeps loading distinct from an empty leaderboard", () => {
  data = undefined;
  render(<KessenLeaderboardPage />);
  expect(screen.getByText("Loading leaderboard...")).toBeTruthy();
  expect(screen.queryByText(/No ranked duels yet/)).toBeNull();
});

it("offers a retry after an initial failure", () => {
  data = undefined;
  error = new Error("Connection lost");
  render(<KessenLeaderboardPage />);
  expect(screen.getByRole("alert").textContent).toContain("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Loading leaderboard...")).toBeNull();
});

it("keeps loaded standings visible when a background refresh fails", () => {
  error = new Error("Connection lost");
  render(<KessenLeaderboardPage />);
  expect(screen.getByRole("link", { name: "Duelist" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
