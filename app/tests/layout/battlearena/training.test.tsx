import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as combatHooks from "@/hooks/combat";
import * as combatEntry from "@/hooks/combatEntry";
import * as navigation from "@/hooks/navigation";
import * as sleep from "@/hooks/sleep";
import * as loadoutNames from "@/hooks/useLoadoutNames";
import { TrainingMode } from "@/layout/battlearena/TrainingMode";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import { createStatSchema } from "@/validators/combat";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

const { maxValues } = createStatSchema(10, 10, undefined);
let mutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(combatEntry, "useCombatEntry").mockReturnValue({
    prepareCombatEntry: vi.fn(),
    loadBattle: vi.fn(),
  });
  installBrowserGlobals();
  mutate = vi.fn();
  Object.assign(vi.spyOn(client, "api" as never), {
    combat: { startArenaBattle: { useMutation: () => ({ mutate, isPending: false }) } },
  });
  mockUserContextValue({
    data: {
      userId: "me",
      status: "AWAKE",
      defence: 2500,
      strength: maxValues.strength + 5000,
      speed: 2100,
      intelligence: 1300,
      willpower: 1600,
    },
    updateUser: vi.fn(),
  } as never);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    push: vi.fn(),
  } as never);
  vi.spyOn(sleep, "useSleepToggle").mockReturnValue({
    toggleSleep: vi.fn(),
    isTogglingSleep: false,
  } as never);
  vi.spyOn(combatHooks, "useAutoCombatSetting").mockReturnValue([false, vi.fn()]);
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: null,
    item: null,
  });
  vi.spyOn(jutsuLoadout, "default").mockImplementation((() => (
    <p>Jutsu loadout</p>
  )) as never);
  vi.spyOn(itemLoadout, "default").mockImplementation((() => (
    <p>Item loadout</p>
  )) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const value = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;
const pressed = () =>
  screen.getAllByRole("button", { pressed: true }).map((button) => button.textContent);

it("fills the dummy from the player's own stats", () => {
  render(<TrainingMode statDistribution={undefined} setStatDistribution={vi.fn()} />);
  expect(pressed()).toEqual(["Minimum"]);
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Like me" }));
  });
  expect(value("Defence")).toBe("2500");
  expect(value("Strength")).toBe(String(maxValues.strength));
  expect(value("Willpower")).toBe("1600");
  expect(pressed()).toEqual(["Like me"]);
});

it("marks Custom after editing a value", () => {
  render(<TrainingMode statDistribution={undefined} setStatDistribution={vi.fn()} />);
  act(() => {
    fireEvent.input(screen.getByLabelText("Speed"), { target: { value: "500" } });
  });
  expect(pressed()).toEqual(["Custom"]);
});

it("remembers the stats used for the fight", async () => {
  const setStatDistribution = vi.fn();
  render(
    <TrainingMode
      statDistribution={undefined}
      setStatDistribution={setStatDistribution}
    />,
  );
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Maximum" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Start training/ }));
  });
  const sent = mutate.mock.calls[0]?.[0];
  expect(sent.aiId).toBe("tra93opw09262024jut5ufa8f");
  expect(sent.autoCombat).toBe(false);
  expect(sent.stats.strength).toBe(maxValues.strength);
  expect(setStatDistribution).toHaveBeenCalledWith(sent.stats);
});
