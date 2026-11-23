import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import GameLayoutController from "@/components/layout/shared/GameLayoutController";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import * as gameMenu from "@/hooks/useGameMenu";
import * as pageActive from "@/hooks/usePageActive";
import * as rankedQueue from "@/hooks/useRankedQueueCount";
import * as territoryWar from "@/hooks/useTerritoryWarNotice";
import * as audio from "@/layout/GlobalAudioProvider";
import * as tutorial from "@/layout/TutorialAssistant";
import type { NavBarDropdownLink } from "@/libs/menus";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";

const notifications: NavBarDropdownLink[] = [
  { href: "/inbox", name: "New messages", color: "red" },
  { href: "/profile", name: "Level up", color: "green", alwaysShow: true },
  { href: "/toast", name: "Toast", color: "toast" },
];

let renderProps: GameLayoutRenderProps | undefined;
let pathname = "/items";
const Renderer = (props: GameLayoutRenderProps) => {
  renderProps = props;
  return null;
};

beforeEach(() => {
  renderProps = undefined;
  pathname = "/items";
  vi.spyOn(UserContext, "useUserDataSelector").mockReturnValue({
    data: undefined,
    notifications,
    isClerkLoaded: true,
    isSignedIn: true,
    status: "success",
    userId: "user",
    pusher: undefined,
    timeDiff: 0,
    updateUser: vi.fn(),
  } as never);
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
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
});

const navigate = (view: ReturnType<typeof render>, to: string) => {
  pathname = to;
  view.rerender(
    <GameLayoutController variant="default" renderer={Renderer}>
      <div>{to}</div>
    </GameLayoutController>,
  );
  return renderProps!;
};

it("keeps the shown notifications between pages no notification links to", () => {
  const view = render(
    <GameLayoutController variant="default" renderer={Renderer}>
      <div />
    </GameLayoutController>,
  );
  const initial = renderProps!.shownNotifications;
  expect(initial.map((n) => n.href)).toEqual(["/inbox", "/profile"]);
  expect(navigate(view, "/jutsus").shownNotifications).toBe(initial);
  // The always-shown notification stays on its own page without changing the list.
  expect(navigate(view, "/profile").shownNotifications).toBe(initial);
});

it("hides a notification on its own page and restores it after leaving", () => {
  const view = render(
    <GameLayoutController variant="default" renderer={Renderer}>
      <div />
    </GameLayoutController>,
  );
  expect(navigate(view, "/inbox").shownNotifications.map((n) => n.href)).toEqual([
    "/profile",
  ]);
  expect(navigate(view, "/items").shownNotifications.map((n) => n.href)).toEqual([
    "/inbox",
    "/profile",
  ]);
});

it("marks only the battle page as the combat page", () => {
  const view = render(
    <GameLayoutController variant="default" renderer={Renderer}>
      <div />
    </GameLayoutController>,
  );
  expect(renderProps!.isCombatPage).toBe(false);
  expect(navigate(view, "/combat").isCombatPage).toBe(true);
  expect(navigate(view, "/combat-log").isCombatPage).toBe(false);
});

it.each(["default", "experimental"] as const)(
  "keeps navigation dismissal specific to the %s layout",
  async (variant) => {
    const view = render(
      <GameLayoutController variant={variant} renderer={Renderer}>
        <div />
      </GameLayoutController>,
    );
    const reopen = async () =>
      act(async () => {
        renderProps!.onLeftSideBarOpenChange(true);
        renderProps!.onRightSideBarOpenChange(true);
      });
    await reopen();
    const menu = renderProps!.leftSideBarMainMenu as ReactElement<{
      onNavigate: () => void;
    }>;
    await act(async () => menu.props.onNavigate());
    expect(renderProps!.leftSideBarOpen).toBe(variant === "experimental");
    await reopen();
    const icons = renderProps!.signedInIcons as ReactElement<{
      onEventClick: () => void;
    }>;
    await act(async () => icons.props.onEventClick());
    expect(renderProps!.leftSideBarOpen).toBe(variant === "experimental");
    await reopen();
    pathname = "/bank";
    view.rerender(
      <GameLayoutController variant={variant} renderer={Renderer}>
        <div />
      </GameLayoutController>,
    );
    expect(renderProps!.leftSideBarOpen).toBe(variant === "experimental");
    expect(renderProps!.rightSideBarOpen).toBe(variant === "experimental");
    await act(async () => {
      renderProps!.onLeftSideBarOpenChange(false);
      renderProps!.onRightSideBarOpenChange(false);
    });
    expect(renderProps!.leftSideBarOpen).toBe(false);
    expect(renderProps!.rightSideBarOpen).toBe(false);
  },
);
