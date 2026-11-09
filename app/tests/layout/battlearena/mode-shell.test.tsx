import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as combatHooks from "@/hooks/combat";
import * as loadoutNames from "@/hooks/useLoadoutNames";
import { ArenaModeShell } from "@/layout/battlearena/ArenaModeShell";
import { BattleSetupPanel } from "@/layout/battlearena/BattleSetupPanel";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import * as userContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const setAutoCombat = vi.fn();

beforeEach(() => {
  installBrowserGlobals();
  Object.assign(vi.spyOn(client, "api" as never), {
    sparring: {
      getUserChallenges: {
        useQuery: () => ({
          data: [{ id: "c1", senderId: "kaito", receiverId: "me", status: "PENDING" }],
        }),
      },
    },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: {
      userId: "me",
      userQuests: [
        {
          endAt: null,
          quest: {
            id: "q-exam",
            name: "Genin Exam",
            content: { objectives: [{ id: "o-1", task: "spars_won", value: 3 }] },
          },
        },
      ],
      questData: [{ id: "q-exam", goals: [{ id: "o-1", value: 1, done: false }] }],
    },
  } as never);
  vi.spyOn(combatHooks, "useAutoCombatSetting").mockReturnValue([false, setAutoCombat]);
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: "PvE build",
    item: "Item loadout 1",
  });
  vi.spyOn(jutsuLoadout, "default").mockImplementation((({
    label,
  }: {
    label?: string;
  }) => <p>{label}</p>) as never);
  vi.spyOn(itemLoadout, "default").mockImplementation((({
    label,
  }: {
    label?: string;
  }) => <p>{label}</p>) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  setAutoCombat.mockReset();
  restoreBrowserGlobals();
});

const renderShell = (mode: "Arena" | "Sparring" = "Arena") => {
  const handlers = { onSelect: vi.fn() };
  render(
    <ArenaModeShell mode={mode} {...handlers}>
      <p>Mode body</p>
    </ArenaModeShell>,
  );
  return handlers;
};

it("marks the open tab and switches", () => {
  const { onSelect } = renderShell();
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    "Arena",
    "Sparring1",
    "Training",
    "Ranked",
    "Pyramid",
  ]);
  expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Ranked/ }));
  expect(onSelect).toHaveBeenCalledWith("PVP Rank");
  expect(screen.getByRole("tabpanel", { name: "Arena" }).textContent).toBe("Mode body");
});

it("shows the exam strip outside sparring", () => {
  const { onSelect } = renderShell("Arena");
  expect(screen.getByRole("button", { name: /Genin Exam/ }).textContent).toContain(
    "1 / 3",
  );
  fireEvent.click(screen.getByRole("button", { name: /Find opponents/ }));
  expect(onSelect).toHaveBeenCalledWith("Sparring");
  cleanup();
  renderShell("Sparring");
  expect(screen.queryByRole("button", { name: /Find opponents/ })).toBeNull();
});

it("leaves back navigation to the page title", () => {
  renderShell();
  expect(screen.queryByRole("button", { name: "← Overview" })).toBeNull();
});

it("holds loadouts, auto combat, extra options and the action", () => {
  render(
    <BattleSetupPanel autoCombat action={<button type="button">Fight Yama</button>}>
      <label>
        <input type="checkbox" /> Allow spectators
      </label>
    </BattleSetupPanel>,
  );
  expect(screen.getAllByText("Jutsu loadout").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Item loadout").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Allow spectators").length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("switch", { name: "Toggle auto combat" })[0]!);
  expect(setAutoCombat).toHaveBeenCalledWith(true);
  expect(screen.getByRole("button", { name: "Fight Yama" })).toBeDefined();
});

it("summarises the setup on the phone row", () => {
  render(<BattleSetupPanel autoCombat action={null} />);
  expect(screen.getByText("PvE build · Item loadout 1 · Auto off")).toBeDefined();
});

it("names the options when there is no loadout to show", () => {
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: null,
    item: null,
  });
  render(<BattleSetupPanel action={null} />);
  expect(screen.getByText("Battle options")).toBeDefined();
});
