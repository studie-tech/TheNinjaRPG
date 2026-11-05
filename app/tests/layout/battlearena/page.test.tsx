import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
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
import type { ContentBoxProps } from "@/layout/ContentBox";
import * as contentBox from "@/layout/ContentBox";
import * as userContext from "@/utils/UserContext";

// Local storage sync dispatches DOM events through the global constructors.
const browserGlobals = ["Event", "CustomEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
let tutorialStep: unknown;
let arenaProps: { aiId?: string } = {};

beforeEach(() => {
  for (const key of browserGlobals) {
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  }
  window.localStorage.clear();
  window.history.replaceState({}, "", "/battlearena");
  tutorialStep = undefined;
  arenaProps = {};
  vi.spyOn(userContext, "useRequireInVillage").mockReturnValue({
    userData: { userId: "me", isBanned: false },
    access: true,
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(() => ({ currentStep: tutorialStep }) as never);
  vi.spyOn(contentBox, "default").mockImplementation((({ children, onBack }: ContentBoxProps) => (
    <div><button type="button" onClick={onBack}>Battle Arena</button>{children}</div>
  )) as never);
  vi.spyOn(overview, "ArenaOverview").mockImplementation(() => <p>Overview</p>);
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
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

it("opens the overview without a hash", () => {
  render(<Arena />);
  expect(screen.getByText("Overview")).toBeDefined();
});

it("opens the mode named in the hash", () => {
  window.history.replaceState({}, "", "/battlearena#Battle%20Pyramid");
  render(<Arena />);
  expect(screen.getByRole("region", { name: "Battle Pyramid mode" }).textContent).toBe("Pyramid body");
});

it("returns from a deep-linked mode to the overview through the page title", () => {
  window.history.replaceState({}, "", "/battlearena#Sparring");
  render(<Arena />);
  fireEvent.click(screen.getByRole("button", { name: "Battle Arena" }));
  expect(screen.getByText("Overview")).toBeDefined();
  expect(window.location.hash).toBe("");
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
