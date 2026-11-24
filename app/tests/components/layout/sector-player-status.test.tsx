import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { SectorPlayerStatus } from "@/components/layout/SectorPlayerStatus";
import {
  getCombatStatCap,
  getUserCaps,
  MAX_PVP_BRACKET,
  MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import * as Avatar from "@/layout/Avatar";
import * as userContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let user: Record<string, unknown>;
beforeEach(() => {
  installBrowserGlobals();
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
afterEach(async () => {
  await act(async () => {
    cleanup();
    await flushRadixFocus();
  });
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("keeps five live HUD meters while profile pools update", () => {
  const view = render(<SectorPlayerStatus hasLocation />);
  expect(view.getAllByRole("button", { name: /^(HP|CP|SP|EP|XP):/ })).toHaveLength(5);
  user = { ...user, curHealth: 35, maxHealth: 90 };
  view.rerender(<SectorPlayerStatus hasLocation />);
  expect(view.getByRole("button", { name: "HP: 35 / 90" })).toBeTruthy();
});

it("keeps combat readings rank-capped and mastery modifiers separate from earned values", () => {
  user = {
    ...user,
    offence: 1_000_000,
    speed: 123.456,
    ninjutsuMastery: 200,
    effectiveMasteries: { ninjutsuMastery: 225 },
    masteryRanks: { ninjutsuMastery: "D" },
  };
  const view = render(<SectorPlayerStatus hasLocation />);
  const combat = within(view.getByRole("region", { name: "Combat stats" }));
  expect(
    combat.getByText(
      getCombatStatCap(getUserCaps("GENIN"), "offence").toLocaleString(),
    ),
  ).toBeTruthy();
  expect(combat.getByText("123.46")).toBeTruthy();
  const mastery = view.container.querySelector(
    '[title="Ninjutsu (D): 200 (+25 from modifiers)"]',
  );
  expect(mastery?.textContent).toBe("Ninjutsu200 (+25)");
  expect(user.offence).toBe(1_000_000);

  user = { ...user, speed: 150, effectiveMasteries: { ninjutsuMastery: 190 } };
  view.rerender(<SectorPlayerStatus hasLocation />);
  expect(combat.getByText("150")).toBeTruthy();
  expect(
    view.container.querySelector('[title="Ninjutsu (D): 200 (-10 from modifiers)"]'),
  ).toBeTruthy();
});

it("opens full character readings from each meter and returns keyboard focus on close", async () => {
  const view = render(<SectorPlayerStatus hasLocation />);
  const meters = view.getAllByRole("button", { name: /^(HP|CP|SP|EP|XP):/ });
  for (const meter of meters) {
    await act(async () => {
      meter.focus();
      await flushRadixFocus();
    });
    fireEvent.click(meter);
    const details = view.getByRole("dialog", { name: "Character details" });
    expect(within(details).getByText("HP (80 / 100)")).toBeTruthy();
    expect(within(details).getByText("EP (20 / 100)")).toBeTruthy();
    await act(async () => flushRadixFocus());
    expect(document.activeElement).toBe(
      within(details).getByRole("heading", { name: "Character details" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => flushRadixFocus());
    await waitFor(() =>
      expect(view.queryByRole("dialog", { name: "Character details" })).toBeNull(),
    );
    expect(document.activeElement).toBe(meter);
  }
});

it.each([
  ["HP", "Health"],
  ["CP", "Chakra"],
  ["SP", "Stamina"],
])(
  "returns focus to the current %s meter after a live pool update",
  async (title, pool) => {
    const view = render(<SectorPlayerStatus hasLocation />);
    const meter = view.getByRole("button", { name: new RegExp(`^${title}:`) });
    await act(async () => {
      meter.focus();
      await flushRadixFocus();
    });
    fireEvent.click(meter);
    await act(async () => flushRadixFocus());

    user = { ...user, [`cur${pool}`]: 35, [`max${pool}`]: 90 };
    view.rerender(<SectorPlayerStatus hasLocation />);
    expect(meter.isConnected).toBe(false);
    expect(
      within(view.getByRole("dialog", { name: "Character details" })).getByText(
        `${title} (35 / 90)`,
      ),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => flushRadixFocus());
    await waitFor(() =>
      expect(view.queryByRole("dialog", { name: "Character details" })).toBeNull(),
    );
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: `${title}: 35 / 90` }),
    );
  },
);

it("keeps profile, status, village, balances and daily destinations accessible", () => {
  const view = render(<SectorPlayerStatus hasLocation />);
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
  view.rerender(<SectorPlayerStatus hasLocation={false} />);
  expect(view.getByRole("link", { name: "ASLEEP" }).getAttribute("href")).toBe("/home");
  expect(
    view.getByRole("link", { name: "Money on hand: 1,200" }).getAttribute("href"),
  ).toBe("/profile");
  expect(view.queryByRole("link", { name: /^Daily missions/ })).toBeNull();
});

it("shortens HUD balances while retaining their exact accessible values", () => {
  user = { ...user, money: 1_234_567, reputationPoints: 100_000 };
  const view = render(<SectorPlayerStatus hasLocation />);
  expect(
    view.getByRole("link", { name: "Money on hand: 1,234,567" }).textContent,
  ).toContain("1.2M");
  expect(
    view.getByRole("link", { name: "Reputation points: 100000" }).textContent,
  ).toContain("100K");
});

it("shows the bracket and game clock alongside the other character shortcuts", () => {
  const view = render(<SectorPlayerStatus hasLocation />);
  const shortcuts = within(view.getByRole("region", { name: "Character shortcuts" }));
  expect(
    shortcuts.getByRole("button", { name: `PvP bracket: 0/${MAX_PVP_BRACKET}` }),
  ).toBeTruthy();
  expect(shortcuts.getByRole("timer", { name: "Game time (UTC)" }).textContent).toMatch(
    /\d{2}:\d{2}:\d{2}/,
  );
});
