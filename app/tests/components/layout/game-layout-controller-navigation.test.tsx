import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import GameLayoutController from "@/components/layout/shared/GameLayoutController";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import * as gameMenu from "@/hooks/useGameMenu";
import * as media from "@/hooks/useMediaQuery";
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
let isDesktop = false;
let currentNotifications = notifications;
let menuSystems: NavBarDropdownLink[] = [];
const Renderer = (props: GameLayoutRenderProps) => {
  renderProps = props;
  return null;
};

beforeEach(() => {
  renderProps = undefined;
  pathname = "/items";
  isDesktop = false;
  currentNotifications = notifications;
  menuSystems = [];
  vi.spyOn(media, "useMediaQuery").mockImplementation(() => isDesktop);
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    () =>
      ({
        data: undefined,
        notifications: currentNotifications,
        isClerkLoaded: true,
        isSignedIn: true,
        status: "success",
        userId: "user",
        pusher: undefined,
        timeDiff: 0,
        updateUser: vi.fn(),
      }) as never,
  );
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(pageActive, "usePageActive").mockReturnValue(true);
  vi.spyOn(gameMenu, "useGameMenu").mockImplementation(
    () =>
      ({
        systems: menuSystems,
        location: undefined,
      }) as never,
  );
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

it("counts game alerts and unread items once, excluding player-menu news and toasts", () => {
  currentNotifications = [
    { href: "/jutsus", name: "No jutsu", color: "red" },
    { href: "/occupation", name: "Services", color: "green", notificationCount: 4 },
    {
      href: "/profile?tab=dashboard",
      name: "Rewards",
      color: "green",
      notificationCount: 2,
    },
    {
      href: "/questteams",
      name: "Quest Teams",
      color: "default",
      notificationCount: 0,
    },
    { href: "/profile/recruit", name: "Vote", color: "hidden", notificationCount: 1 },
    { href: "/inbox", name: "Messages", color: "hidden", notificationCount: 3 },
    { href: "/reports", name: "Reports", color: "hidden", notificationCount: 0 },
    { href: "/news", name: "News", color: "hidden", notificationCount: 8 },
    { href: "/profile", name: "Saved", color: "toast" },
  ];
  menuSystems = [
    { href: "/profile", name: "Profile", notificationCount: 2 },
    { href: "/inbox", name: "Inbox", notificationCount: 3 },
    { href: "/tavern", name: "Tavern", notificationCount: 5 },
  ];
  const view = render(
    <GameLayoutController variant="experimental" renderer={Renderer}>
      <div />
    </GameLayoutController>,
  );
  expect(renderProps!.gameMenuNotificationCount).toBe(17);
  expect(navigate(view, "/jutsus").gameMenuNotificationCount).toBe(16);
  currentNotifications = [];
  menuSystems = [];
  expect(navigate(view, "/items").gameMenuNotificationCount).toBe(0);
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

it.each([
  ["default", false],
  ["default", true],
  ["experimental", false],
  ["experimental", true],
] as const)(
  "keeps navigation dismissal specific to %s (desktop=%s)",
  async (variant, desktop) => {
    isDesktop = desktop;
    const keepOpen = variant === "experimental" && desktop;
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
    expect(renderProps!.leftSideBarOpen).toBe(keepOpen);
    await reopen();
    const icons = renderProps!.signedInIcons as ReactElement<{
      onEventClick: () => void;
    }>;
    await act(async () => icons.props.onEventClick());
    expect(renderProps!.leftSideBarOpen).toBe(keepOpen);
    await reopen();
    const link = document.createElement("a");
    link.href = "/items";
    await act(async () =>
      renderProps!.handleRightSidebarClick({ target: link } as never),
    );
    expect(renderProps!.rightSideBarOpen).toBe(keepOpen);
    await reopen();
    pathname = "/bank";
    view.rerender(
      <GameLayoutController variant={variant} renderer={Renderer}>
        <div />
      </GameLayoutController>,
    );
    expect(renderProps!.leftSideBarOpen).toBe(keepOpen);
    expect(renderProps!.rightSideBarOpen).toBe(keepOpen);
    await act(async () => {
      renderProps!.onLeftSideBarOpenChange(false);
      renderProps!.onRightSideBarOpenChange(false);
    });
    expect(renderProps!.leftSideBarOpen).toBe(false);
    expect(renderProps!.rightSideBarOpen).toBe(false);
  },
);
