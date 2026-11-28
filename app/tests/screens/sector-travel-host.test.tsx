import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as dynamic from "next/dynamic";
import { createRef, useEffect, useState } from "react";
import * as playerStatus from "@/components/layout/SectorPlayerStatus";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import { layoutVariantClasses } from "@/components/layout/shared/layoutVariants";
import * as compass from "@/components/layout/shared/TravelCompass";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as navigation from "@/hooks/navigation";
import * as media from "@/hooks/useMediaQuery";
import * as help from "@/layout/LowerRightHelpBtn";
import * as queueNotice from "@/layout/QueueNotice";
import { PUBLIC_PAGE_ROUTES } from "@/libs/browserRouteTelemetry";
import { getGameLayout } from "@/libs/gameLayouts";
import { DEFAULT_MOBILE_NAV_CONFIG } from "@/libs/mobileNavConfig";
import { useScreenNavigation } from "@/screens/ScreenNavigationContext";
import * as routing from "@/utils/routing";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

let starts = 0;
let stops = 0;
function MapSession({ isInteractive }: { isInteractive: boolean }) {
  useEffect(() => {
    starts++;
    return () => {
      stops++;
    };
  }, []);
  return (
    <>
      <p>Map {isInteractive ? "active" : "paused"}</p>
      <div className="sector-nav-map-controls">
        <button type="button">Sector</button>
      </div>
    </>
  );
}
const dynamicSpy = vi.spyOn(dynamic, "default").mockReturnValue(MapSession as never);
const travelHost = await import("@/components/layout/SectorTravelHost");
const { SectorTravelHost } = travelHost;
dynamicSpy.mockRestore();
const { SectorGameLayout } = await import("@/components/layout/SectorGameLayout");
let pathname = "/travel";
const replace = vi.fn();

function Building() {
  const { onBack } = useScreenNavigation("/village");
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button type="button" onClick={onBack}>
        Leave building
      </button>
      <input aria-label="Amount" defaultValue="" />
      <button type="button" onClick={() => setConfirm(true)}>
        Transfer
      </button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Confirm transfer</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

beforeEach(() => {
  starts = 0;
  stops = 0;
  pathname = "/travel";
  replace.mockClear();
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ replace } as never);
});
afterEach(async () => {
  await act(async () => {
    cleanup();
    await flushRadixFocus();
  });
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("keeps one session across travel, direct building entries, back and forward", async () => {
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <p>Unused route</p>
    </SectorTravelHost>,
  );
  expect(view.queryByText("Unused route")).toBeNull();
  for (const path of [
    "/bank",
    "/auctionhouse",
    "/forum/board/thread",
    "/combat",
    "/profile",
    "/travel",
    "/itemshop",
    "/bank",
    "/travel",
  ]) {
    pathname = path;
    await act(async () => {
      view.rerender(
        <SectorTravelHost isGuidedTutorial={false}>
          <Building />
        </SectorTravelHost>,
      );
      await flushRadixFocus();
    });
    expect(
      view.getByText(path === "/travel" ? "Map active" : "Map paused"),
    ).toBeTruthy();
    expect(view.queryAllByRole("dialog")).toHaveLength(path === "/travel" ? 0 : 1);
    expect(starts).toBe(1);
    expect(stops).toBe(0);
  }
});

it("hosts every non-travel route in a dialog without replacing the map session", async () => {
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <p>Route screen</p>
    </SectorTravelHost>,
  );
  for (const path of PUBLIC_PAGE_ROUTES) {
    pathname = path;
    await act(async () => {
      view.rerender(
        <SectorTravelHost isGuidedTutorial={false}>
          <p>Route screen</p>
        </SectorTravelHost>,
      );
    });
    expect(view.queryAllByRole("dialog")).toHaveLength(path === "/travel" ? 0 : 1);
    expect(view.queryByText("Route screen") !== null).toBe(path !== "/travel");
    expect(starts).toBe(1);
    expect(stops).toBe(0);
  }
});

it("resets dialog scroll for a new route while retaining the map", () => {
  pathname = "/auctionhouse";
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <p>Auctions</p>
    </SectorTravelHost>,
  );
  const dialog = view.getByRole("dialog");
  dialog.scrollTop = 400;
  pathname = "/forum";
  view.rerender(
    <SectorTravelHost isGuidedTutorial={false}>
      <p>Forum</p>
    </SectorTravelHost>,
  );
  expect(view.getByRole("dialog")).toBe(dialog);
  expect(dialog.scrollTop).toBe(0);
  expect(starts).toBe(1);
});

it("keeps page and nested dialogs inside the sector while navigation remains reachable", async () => {
  pathname = "/auctionhouse";
  const navigate = vi.fn();
  const view = render(
    <>
      <button type="button" onClick={navigate}>
        Main navigation
      </button>
      <SectorTravelHost isGuidedTutorial={false}>
        <Building />
      </SectorTravelHost>
      <button type="button">Bottom navigation</button>
    </>,
  );
  await act(async () => flushRadixFocus());
  const layer = view.container.querySelector("[data-sector-screen-layer]");
  const page = view.getByRole("dialog", { name: "Game screen" });
  expect(page.closest("[data-sector-screen-layer]")).toBe(layer);
  expect(page.closest("[data-sector-screen-viewport]")).toBeTruthy();
  const mainNavigation = view.getByRole("button", { name: "Main navigation" });
  expect(view.getByRole("button", { name: "Bottom navigation" })).toBeTruthy();
  fireEvent.pointerDown(mainNavigation);
  fireEvent.click(mainNavigation);
  fireEvent.focusIn(mainNavigation);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Transfer" }));
  await act(async () => flushRadixFocus());
  expect(
    view
      .getByRole("dialog", { name: "Confirm transfer" })
      .closest("[data-sector-screen-layer]"),
  ).toBe(layer);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await act(async () => flushRadixFocus());
  expect(replace).not.toHaveBeenCalled();
  expect(view.getByRole("dialog", { name: "Game screen" })).toBe(page);
});

it("dismisses a page from the sector backdrop", async () => {
  pathname = "/auctionhouse";
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <Building />
    </SectorTravelHost>,
  );
  await act(async () => flushRadixFocus());
  const backdrop = view.container.querySelector("[data-sector-screen-backdrop]");
  expect(backdrop?.closest("[data-sector-screen-layer]")).toBeTruthy();
  fireEvent.pointerDown(backdrop!, { pointerType: "mouse", button: 0 });
  fireEvent.click(backdrop!);
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith("/travel", { scroll: false }),
  );
});

it("returns direct building visits to travel through their header and Escape", async () => {
  pathname = "/bank";
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <Building />
    </SectorTravelHost>,
  );
  expect(view.getByRole("dialog", { name: "Game screen" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Leave building" }));
  expect(replace).toHaveBeenCalledWith("/travel", { scroll: false });
  replace.mockClear();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(replace).toHaveBeenCalledWith("/travel", { scroll: false });
});

it("dismisses nested confirmations without closing the building or clearing its form", async () => {
  pathname = "/bank";
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <Building />
    </SectorTravelHost>,
  );
  fireEvent.change(view.getByRole("textbox", { name: "Amount" }), {
    target: { value: "25" },
  });
  fireEvent.click(view.getByRole("button", { name: "Transfer" }));
  await act(async () => {
    await flushRadixFocus();
  });
  expect(view.getByRole("dialog", { name: "Confirm transfer" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await act(async () => {
    await flushRadixFocus();
  });
  expect(replace).not.toHaveBeenCalled();
  expect(
    (view.getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value,
  ).toBe("25");
});

it("keeps tutorial controls outside a building reachable while the map is inert", () => {
  pathname = "/itemshop";
  const view = render(
    <>
      <button type="button">Tutorial next</button>
      <SectorTravelHost isGuidedTutorial>
        <Building />
      </SectorTravelHost>
    </>,
  );
  expect(view.getByRole("button", { name: "Tutorial next" })).toBeTruthy();
  expect(view.getByText("Map paused").parentElement?.hasAttribute("inert")).toBe(true);
});

it("returns a direct desktop building visit to the persistent map navigation", async () => {
  pathname = "/bank";
  const view = render(
    <SectorTravelHost isGuidedTutorial={false}>
      <Building />
    </SectorTravelHost>,
  );
  await act(async () => {
    await flushRadixFocus();
  });
  pathname = "/travel";
  await act(async () => {
    view.rerender(
      <SectorTravelHost isGuidedTutorial={false}>
        <Building />
      </SectorTravelHost>,
    );
    await flushRadixFocus();
  });
  await waitFor(() =>
    expect(
      document.activeElement === view.getByRole("button", { name: "Sector" }),
    ).toBe(true),
  );
});

describe("responsive sector menus", () => {
  let isDesktop = false;
  const props = (): GameLayoutRenderProps => ({
    children: <p>Route content</p>,
    variant: "sector",
    userData: { userId: "actor", tutorialOn: true, tutorialStep: 0 } as never,
    isSignedInLayout: true,
    isCombatPage: false,
    navbarMenuItems: [],
    shownNotifications: [],
    gameMenuNotificationCount: 0,
    location: { name: "Horizon", href: "/village" },
    leftSideBarOpen: false,
    onLeftSideBarOpenChange: vi.fn(),
    rightSideBarOpen: false,
    onRightSideBarOpenChange: vi.fn(),
    rightSideBarRef: createRef<HTMLDivElement>(),
    mobileNavConfig: DEFAULT_MOBILE_NAV_CONFIG,
    signedInIcons: <button type="button">Account</button>,
    leftSideBar: <p>Player statistics</p>,
    rightSideBar: (
      <a id="tutorial-village" href="/village">
        Horizon Village
      </a>
    ),
    leftSideBarMainMenu: <button type="button">Account controls</button>,
    handleRightSidebarClick: vi.fn(),
    lightLayout: false,
    toggleLightLayout: vi.fn(),
    imageset: {} as never,
    variantClasses: layoutVariantClasses.sector,
  });
  beforeEach(() => {
    vi.spyOn(playerStatus, "SectorPlayerStatus").mockReturnValue(
      <div aria-label="Character status" />,
    );
    vi.spyOn(compass, "TravelCompass").mockReturnValue(
      <button type="button">Destination compass</button>,
    );
    isDesktop = false;
    mockUserContextValue({});
    vi.spyOn(media, "useMediaQuery").mockImplementation(() => isDesktop);
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
    vi.spyOn(queueNotice, "QueueNotice").mockReturnValue(null);
    vi.spyOn(help, "default").mockImplementation(({ children }) => (
      <button type="button" aria-label="Chat">
        {children}
      </button>
    ));
    vi.spyOn(travelHost, "SectorTravelHost").mockReturnValue(
      <div aria-label="Map host" />,
    );
  });

  it.each(["/auctionhouse", "/combat", "/forum/board/thread", "/manual/item"])(
    "retains the map frame for %s",
    (path) => {
      vi.spyOn(routing, "usePublicPathname").mockReturnValue(path);
      const view = render(<SectorGameLayout {...props()} />);
      expect(view.getByLabelText("Map host")).toBeTruthy();
      expect(view.container.querySelector("main.sector-map-main")).toBeTruthy();
      expect(view.queryByRole("link", { name: "Show global map" })).toBeNull();
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "exposes each open sidebar to the desktop dialog columns (left=%s, right=%s)",
    (left, right) => {
      isDesktop = true;
      const input = { ...props(), leftSideBarOpen: left, rightSideBarOpen: right };
      const view = render(<SectorGameLayout {...input} />);
      const frame = view.container.querySelector(".sector-game");
      expect(frame?.getAttribute("data-player-menu-open")).toBe(left ? "true" : null);
      expect(frame?.getAttribute("data-game-menu-open")).toBe(right ? "true" : null);
      view.rerender(
        <SectorGameLayout
          {...input}
          leftSideBarOpen={false}
          rightSideBarOpen={false}
        />,
      );
      expect(frame?.hasAttribute("data-player-menu-open")).toBe(false);
      expect(frame?.hasAttribute("data-game-menu-open")).toBe(false);
    },
  );

  it("uses top-bar sidebar toggles and bottom Activity navigation on desktop", () => {
    isDesktop = true;
    const input = props();
    const view = render(<SectorGameLayout {...input} />);
    fireEvent.click(view.getByRole("button", { name: "Open player menu" }));
    expect(input.onLeftSideBarOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(view.getByRole("button", { name: "Open game menu" }));
    expect(input.onRightSideBarOpenChange).toHaveBeenCalledWith(true);
    expect(view.getByRole("button", { name: "Activity" })).toBeTruthy();
    expect(view.queryByText("Player statistics")).toBeNull();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByRole("complementary", { name: "Game menu" })).toBeNull();
    expect(view.container.querySelector('[data-header-item="activity"]')).toBeNull();
    expect(view.getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(
      view.queryByRole("button", { name: /Open notifications|Settings/ }),
    ).toBeNull();
    expect(getGameLayout("sector").sidebarBreakpoint).toBeNull();
  });
  it.each([false, true])(
    "shows only the closed sidebar's top-bar toggle (desktop=%s)",
    async (desktop) => {
      isDesktop = desktop;
      const input = props();
      const view = render(<SectorGameLayout {...input} />);
      const player = view.getByRole("button", { name: "Open player menu" });
      const game = view.getByRole("button", { name: "Open game menu" });
      expect(player.closest("header")).toBeTruthy();
      expect(game.closest("header")).toBeTruthy();
      expect(player.querySelector(".sector-menu-label")?.textContent).toBe("Player");
      expect(game.querySelector(".sector-menu-label")?.textContent).toBe("Game");
      view.rerender(<SectorGameLayout {...input} leftSideBarOpen />);
      await act(async () => flushRadixFocus());
      expect(player.hidden).toBe(true);
      expect(player.parentElement?.hidden).toBe(true);
      expect(game.hidden).toBe(false);
      expect(game.parentElement?.hidden).toBe(false);
      view.rerender(<SectorGameLayout {...input} rightSideBarOpen />);
      await act(async () => flushRadixFocus());
      expect(player.hidden).toBe(false);
      expect(player.parentElement?.hidden).toBe(false);
      expect(game.hidden).toBe(true);
      expect(game.parentElement?.hidden).toBe(true);
      view.rerender(<SectorGameLayout {...input} />);
      await act(async () => flushRadixFocus());
      expect(player.hidden).toBe(false);
      expect(game.hidden).toBe(false);
      expect(game.id).toBe("tutorial-gameBtn");
    },
  );

  it.each([0, 1, 120])("shows the game-menu notification count (%s)", (count) => {
    const input = { ...props(), gameMenuNotificationCount: count };
    const view = render(<SectorGameLayout {...input} />);
    const label =
      count > 0
        ? `Open game menu (${count} ${count === 1 ? "notification" : "notifications"})`
        : "Open game menu";
    const button = view.getByRole("button", { name: label });
    expect(button.querySelector('span[aria-hidden="true"]')?.textContent ?? null).toBe(
      count > 0 ? (count > 99 ? "99+" : String(count)) : null,
    );
    expect(button.id).toBe("tutorial-gameBtn");
    view.rerender(<SectorGameLayout {...input} gameMenuNotificationCount={0} />);
    expect(view.getByRole("button", { name: "Open game menu" })).toBe(button);
    expect(button.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it("uses mobile top-bar menus and the shared configured bottom navigation", () => {
    const input = props();
    input.mobileNavConfig = { left: ["bank"], right: ["itemshop", "items", "tavern"] };
    const view = render(<SectorGameLayout {...input} />);
    expect(view.getByRole("button", { name: "Open player menu" })).toBeTruthy();
    const game = view.getByRole("button", { name: "Open game menu" });
    expect(game.id).toBe("tutorial-gameBtn");
    fireEvent.click(game);
    expect(input.onRightSideBarOpenChange).toHaveBeenCalledWith(true);
    expect(view.getByRole("link", { name: "Bank" }).getAttribute("href")).toBe("/bank");
    expect(view.getByRole("link", { name: "Item Shop" }).getAttribute("href")).toBe(
      "/itemshop",
    );
    expect(view.getByRole("link", { name: "Village" }).getAttribute("href")).toBe(
      "/village",
    );
    expect(view.queryByRole("button", { name: "Destination compass" })).toBeNull();
    expect(view.getByRole("button", { name: "Activity" })).toBeTruthy();
    expect(view.queryByRole("complementary", { name: "Game menu" })).toBeNull();
    expect(view.queryByText("Player statistics")).toBeNull();
  });
  it("shows the compass outside a village while keeping Activity reachable", () => {
    const input = props();
    input.location = undefined;
    const view = render(<SectorGameLayout {...input} />);
    expect(view.getByRole("button", { name: "Destination compass" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Activity" })).toBeTruthy();
    expect(view.queryByRole("link", { name: "Village" })).toBeNull();
  });
  it("keeps an open sidebar and its tutorial target through desktop/mobile resizing", async () => {
    const input = { ...props(), rightSideBarOpen: true };
    const view = render(<SectorGameLayout {...input} />);
    expect(view.getByRole("dialog", { name: "Game menu" })).toBeTruthy();
    expect(
      input.rightSideBarRef.current?.querySelector("#tutorial-village"),
    ).toBeTruthy();
    isDesktop = true;
    view.rerender(<SectorGameLayout {...input} />);
    await act(async () => {
      await flushRadixFocus();
    });
    expect(view.getByRole("dialog", { name: "Game menu" })).toBeTruthy();
    expect(document.querySelectorAll("#tutorial-village")).toHaveLength(1);
    expect(
      input.rightSideBarRef.current?.querySelector("#tutorial-village"),
    ).toBeTruthy();
  });
  it("lets desktop map interactions keep the open nonmodal sidebar", async () => {
    isDesktop = true;
    const input = props();
    input.rightSideBarOpen = true;
    input.userData = { ...input.userData, tutorialOn: false } as never;
    const view = render(
      <>
        <button type="button">Map surface</button>
        <SectorGameLayout {...input} />
      </>,
    );
    await act(async () => flushRadixFocus());
    expect(view.getByRole("dialog", { name: "Game menu" })).toBeTruthy();
    const surface = view.getByRole("button", { name: "Map surface" });
    fireEvent.pointerDown(surface);
    fireEvent.click(surface);
    expect(input.onRightSideBarOpenChange).not.toHaveBeenCalled();
    expect(
      input.rightSideBarRef.current?.querySelector("#tutorial-village"),
    ).toBeTruthy();
  });
});
