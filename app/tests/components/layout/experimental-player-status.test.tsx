import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { ExperimentalPlayerStatus } from "@/components/layout/ExperimentalPlayerStatus";
import { MISSIONS_PER_DAY } from "@/drizzle/constants";
import * as Avatar from "@/layout/Avatar";
import * as userContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let user: Record<string, unknown>;
const openPlayer = vi.fn();
beforeEach(() => {
  installBrowserGlobals();
  openPlayer.mockClear();
  user = {
    userId: "hud-player",
    username: "Shinobi",
    avatar: null,
    level: 10,
    rank: "GENIN",
    status: "AWAKE",
    village: { name: "Horizon" },
    experience: 0,
    earnedExperience: 0,
    regeneration: 0,
    regenAt: new Date(),
    raidBuffs: [],
    titles: [],
    curHealth: 80,
    maxHealth: 100,
    curChakra: 60,
    maxChakra: 100,
    curStamina: 40,
    maxStamina: 100,
    curEnergy: 20,
    maxEnergy: 100,
    money: 1200,
    reputationPoints: 7,
    dailyMissions: 1,
    dailyErrands: 2,
    dailyMedicalMissions: 0,
    dailyPvpMissions: 0,
    immunityUntil: new Date(0),
    bracketImmunityLiftedUntil: new Date(0),
    warParticipantUntil: new Date(0),
  };
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select(user as never), timeDiff: 0 }) as never,
  );
  vi.spyOn(Avatar, "default").mockImplementation(({ alt }) => (
    <span role="img" aria-label={alt} />
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: { getSidebarTimers: { useQuery: () => ({ data: undefined }) } },
    raids: { getUserRaidBuffs: { useQuery: () => ({ data: undefined }) } },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("shows five live meters and opens the detailed player menu from each", () => {
  const view = render(
    <ExperimentalPlayerStatus hasLocation onOpenPlayerMenu={openPlayer} />,
  );
  for (const name of ["HP: 80 / 100", "CP: 60 / 100", "SP: 40 / 100", "EP: 20 / 100"]) {
    fireEvent.click(view.getByRole("button", { name }));
  }
  fireEvent.click(view.getByRole("button", { name: /^XP:/ }));
  expect(openPlayer).toHaveBeenCalledTimes(5);
  expect(view.getAllByRole("button", { name: /^(HP|CP|SP|EP|XP):/ })).toHaveLength(5);
  user = { ...user, curHealth: 35, maxHealth: 90 };
  view.rerender(<ExperimentalPlayerStatus hasLocation onOpenPlayerMenu={openPlayer} />);
  expect(view.getByRole("button", { name: "HP: 35 / 90" })).toBeTruthy();
});

it("keeps profile, status, village, balances and daily destinations accessible", () => {
  const view = render(
    <ExperimentalPlayerStatus hasLocation onOpenPlayerMenu={openPlayer} />,
  );
  expect(
    view.getByRole("link", { name: "Shinobi's profile" }).getAttribute("href"),
  ).toBe("/profile");
  expect(view.getByRole("link", { name: "AWAKE" }).getAttribute("href")).toBe("/home");
  expect(view.getByRole("link", { name: "Horizon" }).getAttribute("href")).toBe(
    "/village",
  );
  expect(
    view.getByRole("link", { name: "Money on hand: 1,200" }).getAttribute("href"),
  ).toBe("/bank");
  expect(
    view
      .getByRole("link", {
        name: `Daily missions to complete: 1 / ${MISSIONS_PER_DAY}`,
      })
      .getAttribute("href"),
  ).toBe("/missionhall");
  expect(
    view.getByRole("link", { name: "Reputation points: 7" }).getAttribute("href"),
  ).toBe("/points");
  user = { ...user, status: "ASLEEP", dailyMissions: MISSIONS_PER_DAY };
  view.rerender(
    <ExperimentalPlayerStatus hasLocation={false} onOpenPlayerMenu={openPlayer} />,
  );
  expect(view.getByRole("link", { name: "ASLEEP" }).getAttribute("href")).toBe("/home");
  expect(
    view.getByRole("link", { name: "Money on hand: 1,200" }).getAttribute("href"),
  ).toBe("/profile");
  expect(view.queryByRole("link", { name: /^Daily missions/ })).toBeNull();
});

it("shortens HUD balances while retaining their exact accessible values", () => {
  user = { ...user, money: 1_234_567, reputationPoints: 100_000 };
  const view = render(
    <ExperimentalPlayerStatus hasLocation onOpenPlayerMenu={openPlayer} />,
  );
  expect(
    view.getByRole("link", { name: "Money on hand: 1,234,567" }).textContent,
  ).toContain("1.2M");
  expect(
    view.getByRole("link", { name: "Reputation points: 100000" }).textContent,
  ).toContain("100K");
});
