import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as combatHooks from "@/hooks/combat";
import * as loadoutNames from "@/hooks/useLoadoutNames";
import { ArenaOverview } from "@/layout/battlearena/ArenaOverview";
import * as setupPanel from "@/layout/battlearena/BattleSetupPanel";
import * as userContext from "@/utils/UserContext";

let towers: unknown[] = [];
let userQuests: unknown[] = [];

beforeEach(() => {
  towers = [{ id: "t-1" }, { id: "t-2" }];
  userQuests = [];
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      getAllAiNames: {
        useQuery: () => ({
          data: [
            { userId: "ai-2", username: "Drazir", level: 85, avatar: null },
            { userId: "ai-1", username: "Yama", level: 20, avatar: null },
          ],
        }),
      },
    },
    sparring: {
      getUserChallenges: {
        useQuery: () => ({
          data: [
            { id: "c1", senderId: "kaito", receiverId: "me", status: "PENDING" },
            { id: "c2", senderId: "hana", receiverId: "me", status: "PENDING" },
            { id: "c3", senderId: "me", receiverId: "rin", status: "PENDING" },
            { id: "c4", senderId: "sora", receiverId: "me", status: "REJECTED" },
          ],
        }),
      },
    },
    quests: { specificQuests: { useQuery: () => ({ data: towers }) } },
    pvpRank: {
      getCurrentTopPlayers: {
        useQuery: () => ({
          data: [1200, 1190, 1180, 1170, 1160, 1150, 1140, 1130, 1120, 1110],
        }),
      },
      getCurrentSeason: {
        useQuery: () => ({ data: { name: "Season 4", paused: false } }),
      },
      getRankedQueueCount: { useQuery: () => ({ data: 4 }) },
    },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: {
          userId: "me",
          level: 25,
          rankedLp: 180,
          dailyArenaFights: 3,
          userQuests,
          questData: [],
        },
      }) as never,
  );
  vi.spyOn(combatHooks, "useAutoCombatSetting").mockReturnValue([true, vi.fn()]);
  vi.spyOn(setupPanel, "BattleSetupControls").mockImplementation(() => (
    <p>Setup controls</p>
  ));
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: "PvE build",
    item: "Item loadout 1",
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("lists the five modes with their status", () => {
  render(<ArenaOverview onOpen={vi.fn()} />);
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toEqual(["Arena", "Sparring", "Battle Pyramid", "Ranked PvP", "Training dummy"]);
  expect(screen.getByText("Best match: Yama · Lv 20")).toBeDefined();
  expect(screen.getByText("Fights today: 3")).toBeDefined();
  expect(screen.getByText("2 challenges waiting")).toBeDefined();
  expect(screen.getByText("2 towers open to you")).toBeDefined();
  expect(screen.getByText("Wood · 180 LP · 4 in queue")).toBeDefined();
});

it("names the tower being climbed", () => {
  userQuests = [
    {
      endAt: null,
      quest: {
        id: "t-1",
        name: "Ritual of Sotek",
        questType: "battlepyramid",
        content: { objectives: [] },
      },
    },
  ];
  render(<ArenaOverview onOpen={vi.fn()} />);
  expect(screen.getByText("Climbing Ritual of Sotek")).toBeDefined();
});

it("opens a mode from its card", () => {
  const onOpen = vi.fn();
  render(<ArenaOverview onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose opponent" }));
  fireEvent.click(screen.getByRole("button", { name: "Find opponents" }));
  fireEvent.click(screen.getByRole("button", { name: "See towers" }));
  fireEvent.click(screen.getByRole("button", { name: "Open ranked" }));
  fireEvent.click(screen.getByRole("button", { name: "Set up dummy" }));
  expect(onOpen.mock.calls.map((call) => call[0])).toEqual([
    "Arena",
    "Sparring",
    "Battle Pyramid",
    "PVP Rank",
    "Training",
  ]);
});

it("summarises the selected loadouts and auto combat", () => {
  render(<ArenaOverview onOpen={vi.fn()} />);
  expect(
    screen.getByText("Jutsu: PvE build · Items: Item loadout 1 · Auto combat on"),
  ).toBeDefined();
});

it("leaves out loadouts a player cannot switch", () => {
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: null,
    item: null,
  });
  render(<ArenaOverview onOpen={vi.fn()} />);
  expect(screen.getByText("Auto combat on")).toBeDefined();
});
