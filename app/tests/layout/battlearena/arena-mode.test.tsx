import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as combatHooks from "@/hooks/combat";
import * as loadoutNames from "@/hooks/useLoadoutNames";
import * as navigation from "@/hooks/navigation";
import * as sleep from "@/hooks/sleep";
import * as tutorial from "@/hooks/tutorial";
import { ArenaMode } from "@/layout/battlearena/ArenaMode";
import * as image from "@/layout/Image";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import * as userContext from "@/utils/UserContext";

let mutate: ReturnType<typeof vi.fn>;
let toggleSleep: ReturnType<typeof vi.fn>;
let status = "AWAKE";
let tutorialStep: unknown;

beforeEach(() => {
  mutate = vi.fn();
  toggleSleep = vi.fn();
  status = "AWAKE";
  tutorialStep = undefined;
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
      getAi: { useQuery: () => ({ data: undefined, isPending: true }) },
    },
    combat: { startArenaBattle: { useMutation: () => ({ mutate, isPending: false }) } },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: { userId: "me", level: 22, status, dailyArenaFights: 3 },
        updateUser: vi.fn(),
      }) as never,
  );
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(
    () => ({ currentStep: tutorialStep, completeTutorialAction: vi.fn() }) as never,
  );
  vi.spyOn(sleep, "useSleepToggle").mockImplementation(() => ({ toggleSleep, isTogglingSleep: false }) as never);
  vi.spyOn(combatHooks, "useAutoCombatSetting").mockReturnValue([true, vi.fn()]);
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({ jutsu: null, item: null });
  vi.spyOn(jutsuLoadout, "default").mockImplementation((() => <p>Jutsu loadout</p>) as never);
  vi.spyOn(itemLoadout, "default").mockImplementation((() => <p>Item loadout</p>) as never);
  // biome-ignore lint/performance/noImgElement: isolated avatar fixture
  vi.spyOn(image, "default").mockImplementation((({ alt }: { alt: string }) => <img alt={alt} />) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("names the selected opponent on the fight button", () => {
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const fight = screen.getByRole("button", { name: "Fight Yama" });
  expect(fight.id).toBe("tutorial-battlearena-challenge-ai-enter");
  expect(screen.getByText("Fights today: 3")).toBeDefined();
});

it("lists the closest level first and selects on click", () => {
  const setAiId = vi.fn();
  render(<ArenaMode aiId="ai-1" setAiId={setAiId} />);
  const tiles = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }));
  expect(tiles.some((tile) => tile.textContent?.includes("Drazir"))).toBe(true);
  expect(screen.getAllByRole("button", { name: /Level/ })[0]?.textContent).toContain("Yama");
  fireEvent.click(screen.getByRole("button", { name: /Drazir/ }));
  expect(setAiId).toHaveBeenCalledWith("ai-2");
});

it("switches to the best match when the saved opponent is not in the arena", () => {
  const setAiId = vi.fn();
  render(<ArenaMode aiId="retired-ai" setAiId={setAiId} />);
  expect(setAiId).toHaveBeenCalledWith("ai-1");
});

it("starts the fight once", () => {
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const fight = screen.getByRole("button", { name: "Fight Yama" });
  fireEvent.click(fight);
  fireEvent.click(fight);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith({ aiId: "ai-1", autoCombat: true });
});

it("fights by hand during the tutorial", () => {
  tutorialStep = { advanceOn: "arenaStart" };
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  expect(screen.queryByRole("switch", { name: "Toggle auto combat" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fight Yama" }));
  expect(mutate).toHaveBeenCalledWith({ aiId: "ai-1", autoCombat: false });
});

it("asks to wake up when asleep", () => {
  status = "ASLEEP";
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Fight Yama" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Wake up/ }));
  expect(toggleSleep).toHaveBeenCalled();
});

it("scrolls opponents in one row and gives the battle setup its own row below", () => {
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const picker = screen.getByRole("region", { name: "Choose your opponent" });
  const strip = within(picker).getByRole("list", { name: "Opponents" });
  expect(strip.className).toContain("overflow-x-auto");
  expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
  const setup = screen.getByRole("complementary", { name: "Battle setup" });
  expect(picker.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(setup.className).not.toContain("w-60");
  expect(within(setup).getByRole("button", { name: "Fight Yama" })).toBeDefined();
});
