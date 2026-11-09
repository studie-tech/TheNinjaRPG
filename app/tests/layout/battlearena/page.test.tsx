import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as nextNavigation from "next/navigation";
import Arena from "@/app/[shell]/battlearena/page";
import { TUTORIAL_ARENA_DUMMY_ID } from "@/drizzle/constants";
import * as tutorial from "@/hooks/tutorial";
import * as arenaMode from "@/layout/battlearena/ArenaMode";
import * as modeShell from "@/layout/battlearena/ArenaModeShell";
import * as overview from "@/layout/battlearena/ArenaOverview";
import * as pyramidMode from "@/layout/battlearena/PyramidMode";
import * as rankedMode from "@/layout/battlearena/RankedMode";
import * as sparringMode from "@/layout/battlearena/SparringMode";
import * as trainingMode from "@/layout/battlearena/TrainingMode";
import * as contentBox from "@/layout/ContentBox";
import * as userContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { actualContentBox } from "../../setup/preload";

let tutorialStep: unknown;
let arenaProps: { aiId?: string } = {};

beforeEach(() => {
  installBrowserGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/battlearena");
  tutorialStep = undefined;
  arenaProps = {};
  // Bun retains module mocks from other suites; navigation requires the real title.
  vi.spyOn(contentBox, "default").mockImplementation(actualContentBox);
  vi.spyOn(userContext, "useRequireInVillage").mockReturnValue({
    userData: { userId: "me", isBanned: false },
    access: true,
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(
    () => ({ currentStep: tutorialStep }) as never,
  );
  vi.spyOn(nextNavigation, "useRouter").mockReturnValue({
    push: (href: string) => window.history.pushState({}, "", href),
    back: () => window.history.back(),
  } as never);
  vi.spyOn(overview, "ArenaOverview").mockImplementation(({ onOpen }) => (
    <div>
      <p>Overview</p>
      <button type="button" onClick={() => onOpen("Training")}>
        Open Training
      </button>
    </div>
  ));
  vi.spyOn(modeShell, "ArenaModeShell").mockImplementation(({ mode, children }) => (
    <section aria-label={`${mode} mode`}>{children}</section>
  ));
  vi.spyOn(arenaMode, "ArenaMode").mockImplementation((props) => {
    arenaProps = props;
    return <p>Arena body</p>;
  });
  vi.spyOn(sparringMode, "SparringMode").mockImplementation(() => <p>Sparring body</p>);
  vi.spyOn(trainingMode, "TrainingMode").mockImplementation(() => <p>Training body</p>);
  vi.spyOn(rankedMode, "RankedMode").mockImplementation(() => <p>Ranked body</p>);
  vi.spyOn(pyramidMode, "PyramidMode").mockImplementation(() => <p>Pyramid body</p>);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("opens the overview without a hash", () => {
  render(<Arena />);
  expect(screen.getByText("Overview")).toBeDefined();
});

it("opens the mode named in the hash", () => {
  window.history.replaceState({}, "", "/battlearena#Battle%20Pyramid");
  render(<Arena />);
  expect(screen.getByRole("region", { name: "Battle Pyramid mode" }).textContent).toBe(
    "Pyramid body",
  );
});

it("returns from a deep-linked mode to the overview through the page title", () => {
  window.history.replaceState({}, "", "/battlearena#Sparring");
  render(<Arena />);
  fireEvent.click(screen.getByRole("button", { name: "Battle Arena" }));
  expect(screen.getByText("Overview")).toBeDefined();
  expect(window.location.hash).toBe("");
});

it("leaves for the village after returning from a mode through the page title", async () => {
  window.history.replaceState({}, "", "/village");
  window.history.pushState({}, "", "/battlearena");
  render(<Arena />);
  fireEvent.click(screen.getByRole("button", { name: "Open Training" }));
  expect(screen.getByText("Training body")).toBeDefined();
  expect(window.location.hash).toBe("#Training");

  fireEvent.click(screen.getByRole("button", { name: "Battle Arena" }));
  expect(screen.getByText("Overview")).toBeDefined();
  expect(window.location.hash).toBe("");

  fireEvent.click(screen.getByRole("button", { name: "Battle Arena" }));
  await waitFor(() => expect(window.location.pathname).toBe("/village"));
});

it("leaves the forced tutorial mode for the village through the page title", async () => {
  window.history.replaceState({}, "", "/battlearena#Training");
  window.history.pushState({}, "", "/battlearena#Sparring");
  tutorialStep = { advanceOn: "arenaStart" };
  render(<Arena />);
  expect(screen.getByRole("region", { name: "Arena mode" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Battle Arena" }));
  await waitFor(() => expect(window.location.pathname).toBe("/village"));
});

it("opens Arena with the Academy Dummy during the tutorial arena step", () => {
  window.history.replaceState({}, "", "/battlearena#Sparring");
  window.localStorage.setItem("arenaAI4", JSON.stringify("some-other-ai"));
  tutorialStep = { advanceOn: "arenaStart" };
  act(() => {
    render(<Arena />);
  });
  expect(screen.getByRole("region", { name: "Arena mode" })).toBeDefined();
  expect(arenaProps.aiId).toBe(TUTORIAL_ARENA_DUMMY_ID);
});
