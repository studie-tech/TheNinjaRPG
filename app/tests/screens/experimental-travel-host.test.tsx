import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as dynamic from "next/dynamic";
import { createRef, useEffect, useState } from "react";
import * as playerStatus from "@/components/layout/ExperimentalPlayerStatus";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import { layoutVariantClasses } from "@/components/layout/shared/layoutVariants";
import * as compass from "@/components/layout/shared/TravelCompass";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as navigation from "@/hooks/navigation";
import * as media from "@/hooks/useMediaQuery";
import * as help from "@/layout/LowerRightHelpBtn";
import { getGameLayout } from "@/libs/gameLayouts";
import { DEFAULT_MOBILE_NAV_CONFIG } from "@/libs/mobileNavConfig";
import { useScreenNavigation } from "@/screens/ScreenNavigationContext";
import * as routing from "@/utils/routing";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

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
      <div className="experimental-nav-map-controls">
        <button type="button">Sector</button>
      </div>
    </>
  );
}
const dynamicSpy = vi.spyOn(dynamic, "default").mockReturnValue(MapSession as never);
const travelHost = await import("@/components/layout/ExperimentalTravelHost");
const { ExperimentalTravelHost } = travelHost;
dynamicSpy.mockRestore();
const { ExperimentalGameLayout } = await import(
  "@/components/layout/ExperimentalGameLayout"
);
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
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <p>Unused route</p>
    </ExperimentalTravelHost>,
  );
  expect(view.queryByText("Unused route")).toBeNull();
  for (const path of ["/bank", "/travel", "/itemshop", "/bank", "/travel"]) {
    pathname = path;
    await act(async () => {
      view.rerender(
        <ExperimentalTravelHost isGuidedTutorial={false}>
          <Building />
        </ExperimentalTravelHost>,
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

it("returns direct building visits to travel through their header and Escape", async () => {
  pathname = "/bank";
  const view = render(
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <Building />
    </ExperimentalTravelHost>,
  );
  expect(view.getByRole("dialog", { name: "Bank" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Leave building" }));
  expect(replace).toHaveBeenCalledWith("/travel", { scroll: false });
  replace.mockClear();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(replace).toHaveBeenCalledWith("/travel", { scroll: false });
});

it("dismisses nested confirmations without closing the building or clearing its form", async () => {
  pathname = "/bank";
  const view = render(
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <Building />
    </ExperimentalTravelHost>,
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
      <ExperimentalTravelHost isGuidedTutorial>
        <Building />
      </ExperimentalTravelHost>
    </>,
  );
  expect(view.getByRole("button", { name: "Tutorial next" })).toBeTruthy();
  expect(view.getByText("Map paused").parentElement?.hasAttribute("inert")).toBe(true);
});

it("returns a direct desktop building visit to the persistent map navigation", async () => {
  pathname = "/bank";
  const view = render(
    <ExperimentalTravelHost isGuidedTutorial={false}>
      <Building />
    </ExperimentalTravelHost>,
  );
  await act(async () => {
    await flushRadixFocus();
  });
  pathname = "/travel";
  await act(async () => {
    view.rerender(
      <ExperimentalTravelHost isGuidedTutorial={false}>
        <Building />
      </ExperimentalTravelHost>,
    );
    await flushRadixFocus();
  });
  await waitFor(() =>
    expect(
      document.activeElement === view.getByRole("button", { name: "Sector" }),
    ).toBe(true),
  );
});

describe("responsive experimental menus", () => {
  let isDesktop = false;
  const props = (): GameLayoutRenderProps => ({
    children: <p>Route content</p>,
    variant: "experimental",
    userData: { userId: "actor", tutorialOn: true, tutorialStep: 0 } as never,
    isSignedInLayout: true,
    isCombatPage: false,
    navbarMenuItems: [],
    shownNotifications: [],
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
    variantClasses: layoutVariantClasses.experimental,
  });
  beforeEach(() => {
    vi.spyOn(playerStatus, "ExperimentalPlayerStatus").mockReturnValue(
      <div aria-label="Character status" />,
    );
    vi.spyOn(compass, "TravelCompass").mockReturnValue(
      <button type="button">Destination compass</button>,
    );
    isDesktop = false;
    vi.spyOn(media, "useMediaQuery").mockImplementation(() => isDesktop);
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/travel");
    vi.spyOn(help, "default").mockImplementation(({ children }) => (
      <button type="button" aria-label="Chat">
        {children}
      </button>
    ));
    vi.spyOn(travelHost, "ExperimentalTravelHost").mockImplementation(
      ({ headerItems }) => (
        <div aria-label="Map host">
          {headerItems?.map((item) => (
            <div key={item.key} data-header-item={item.key}>
              {item.node}
            </div>
          ))}
        </div>
      ),
    );
  });

  it("uses corner sidebar toggles and bottom Activity navigation on desktop", () => {
    isDesktop = true;
    const input = props();
    const view = render(<ExperimentalGameLayout {...input} />);
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
    expect(getGameLayout("experimental").sidebarBreakpoint).toBeNull();
  });
  it("returns keyboard focus to the resource meter that opened player details", async () => {
    vi.spyOn(playerStatus, "ExperimentalPlayerStatus").mockImplementation(
      ({ onOpenPlayerMenu }) => (
        <div data-compact-meter>
          <button type="button" onClick={onOpenPlayerMenu}>
            HP details
          </button>
        </div>
      ),
    );
    const input = props();
    const view = render(<ExperimentalGameLayout {...input} />);
    const meter = view.getByRole("button", { name: "HP details" });
    meter.focus();
    fireEvent.click(meter);
    expect(input.onLeftSideBarOpenChange).toHaveBeenCalledWith(true);
    view.rerender(<ExperimentalGameLayout {...input} leftSideBarOpen />);
    await act(async () => flushRadixFocus());
    expect(view.getByRole("dialog", { name: "Player menu" })).toBeTruthy();
    view.rerender(<ExperimentalGameLayout {...input} leftSideBarOpen={false} />);
    await act(async () => flushRadixFocus());
    expect(document.activeElement).toBe(meter);
  });

  it("uses mobile corner menus and the shared configured bottom navigation", () => {
    const input = props();
    input.mobileNavConfig = { left: ["bank"], right: ["itemshop", "items", "tavern"] };
    const view = render(<ExperimentalGameLayout {...input} />);
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
    const view = render(<ExperimentalGameLayout {...input} />);
    expect(view.getByRole("button", { name: "Destination compass" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Activity" })).toBeTruthy();
    expect(view.queryByRole("link", { name: "Village" })).toBeNull();
  });
  it("keeps an open sidebar and its tutorial target through desktop/mobile resizing", async () => {
    const input = { ...props(), rightSideBarOpen: true };
    const view = render(<ExperimentalGameLayout {...input} />);
    expect(view.getByRole("dialog", { name: "Game menu" })).toBeTruthy();
    expect(
      input.rightSideBarRef.current?.querySelector("#tutorial-village"),
    ).toBeTruthy();
    isDesktop = true;
    view.rerender(<ExperimentalGameLayout {...input} />);
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
        <ExperimentalGameLayout {...input} />
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
