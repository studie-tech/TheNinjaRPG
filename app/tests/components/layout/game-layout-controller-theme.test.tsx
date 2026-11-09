import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import GameLayoutController from "@/components/layout/shared/GameLayoutController";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import * as gameMenu from "@/hooks/useGameMenu";
import * as pageActive from "@/hooks/usePageActive";
import * as rankedQueue from "@/hooks/useRankedQueueCount";
import * as territoryWar from "@/hooks/useTerritoryWarNotice";
import * as audio from "@/layout/GlobalAudioProvider";
import * as tutorial from "@/layout/TutorialAssistant";
import type { GameLayoutId } from "@/libs/gameLayouts";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";

let renderProps: GameLayoutRenderProps | undefined;
const Renderer = (props: GameLayoutRenderProps) => {
  renderProps = props;
  return null;
};

beforeEach(() => {
  renderProps = undefined;
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.spyOn(UserContext, "useUserDataSelector").mockReturnValue({
    data: undefined,
    notifications: [],
    isClerkLoaded: true,
    isSignedIn: false,
    status: "success",
    userId: undefined,
    pusher: undefined,
    timeDiff: 0,
    updateUser: vi.fn(),
  } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/");
  vi.spyOn(pageActive, "usePageActive").mockReturnValue(true);
  vi.spyOn(gameMenu, "useGameMenu").mockReturnValue({
    systems: [],
    location: undefined,
  } as never);
  vi.spyOn(rankedQueue, "useRankedQueueCount").mockReturnValue({ data: 0 } as never);
  vi.spyOn(territoryWar, "useTerritoryWarNotice").mockReturnValue(undefined as never);
  vi.spyOn(audio, "GlobalAudioProvider").mockImplementation(
    ({ children }: { children: ReactNode }) => children as ReactElement,
  );
  vi.spyOn(tutorial, "default").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

/** Mount as the app does: the head script has already applied the stored theme. */
const mount = (
  variant: GameLayoutId,
  stored: "dark" | "light" | null,
  dark: boolean,
) => {
  if (stored) window.localStorage.setItem("theme", stored);
  document.documentElement.classList.toggle("dark", dark);
  render(
    <GameLayoutController variant={variant} renderer={Renderer}>
      <div />
    </GameLayoutController>,
  );
  const icons = renderProps?.signedInIcons as ReactElement<{
    onThemeToggle: () => void;
  }>;
  return () => act(() => icons.props.onThemeToggle());
};
const isDark = () => document.documentElement.classList.contains("dark");

it.each([
  ["dark", true],
  ["light", false],
  [null, false],
] as const)(
  "keeps the stored %s theme and toggles it in storage and on the document",
  (stored, dark) => {
    const toggle = mount("default", stored, dark);
    expect(isDark()).toBe(dark);
    toggle();
    expect(window.localStorage.getItem("theme")).toBe(dark ? "light" : "dark");
    expect(isDark()).toBe(!dark);
    const toggleAgain = renderProps?.signedInIcons as ReactElement<{
      onThemeToggle: () => void;
    }>;
    act(() => toggleAgain.props.onThemeToggle());
    expect(window.localStorage.getItem("theme")).toBe(dark ? "dark" : "light");
    expect(isDark()).toBe(dark);
  },
);

it("leaves a fixed-tone layout's document theme alone", () => {
  mount("pixel", "light", true);
  expect(isDark()).toBe(true);
  expect(window.localStorage.getItem("theme")).toBe("light");
});
