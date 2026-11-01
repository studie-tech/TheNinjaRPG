import { ensureDom } from "../setup/dom.mjs";
import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as iframeMute from "@/hooks/useIframeMute";
import * as client from "@/app/_trpc/client";
import { ClassicGameLayout } from "@/components/layout/ClassicGameLayout";
import { PanelGameLayout } from "@/components/layout/PanelGameLayout";
import { PixelGameLayout } from "@/components/layout/PixelGameLayout";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import { layoutVariantClasses } from "@/components/layout/shared/layoutVariants";
import * as LayoutSidebars from "@/components/layout/shared/LayoutSidebars";
import * as Footer from "@/layout/Footer";
import { GameSettingsPanel, GlobalAudioProvider } from "@/layout/GameSettings";
import * as HelpButton from "@/layout/LowerRightHelpBtn";
import * as Image from "@/layout/Image";
import { DEFAULT_MOBILE_NAV_CONFIG } from "@/libs/mobileNavConfig";
import {
  SWAP_SIDEBARS_ATTRIBUTE,
  SWAP_SIDEBARS_STORAGE_KEY,
} from "@/libs/layoutPreference";
import { VISUAL_EFFECT_KEYS } from "@/libs/visualEffects";
import { LayoutContextProvider } from "@/utils/LayoutContext";

ensureDom();

const browserGlobals = ["Event", "CustomEvent"] as const;
const browserDescriptors = browserGlobals.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);
const LAYOUT_STYLESHEETS = ["layout-themes.css", "layout-directions.css"];
let stylesheet: HTMLStyleElement | undefined;

beforeAll(() => {
  // The sides are placed by the layout stylesheets, so the real rules are under test.
  stylesheet = document.createElement("style");
  stylesheet.textContent = LAYOUT_STYLESHEETS.map((file) =>
    readFileSync(new URL(`../../src/styles/${file}`, import.meta.url), "utf8"),
  ).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => {
  stylesheet?.remove();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute(SWAP_SIDEBARS_ATTRIBUTE);
  localStorage.removeItem(SWAP_SIDEBARS_STORAGE_KEY);
  for (const key of Object.values(VISUAL_EFFECT_KEYS)) localStorage.removeItem(key);
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const mockFrameChrome = () => {
  // Bun retains other suites' image stubs; preserve the layout markers and CSS classes.
  vi.spyOn(Image, "default").mockImplementation(({ alt, src, ...props }) => (
    // biome-ignore lint/performance/noImgElement: isolated sidebar image fixture
    <img {...props} alt={alt} src={typeof src === "string" ? src : undefined} />
  ));
  vi.spyOn(Footer, "default").mockImplementation(() => <div>Footer</div>);
  vi.spyOn(HelpButton, "default").mockImplementation(({ children }) => <>{children}</>);
  vi.spyOn(LayoutSidebars, "StrongestUsersBanner").mockImplementation(() => (
    <div>Strongest users</div>
  ));
};

const renderProps = (
  variant: GameLayoutRenderProps["variant"],
): GameLayoutRenderProps => ({
  children: <p>Page content</p>,
  variant,
  userData: undefined,
  isClerkLoaded: true,
  isSignedInLayout: true,
  isAnonymousLayout: false,
  pathname: "/profile",
  navbarMenuItems: [],
  navbarMenuItemsLeft: [],
  navbarMenuItemsRight: [],
  shownNotifications: [],
  systems: [],
  location: undefined,
  leftSideBarOpen: false,
  onLeftSideBarOpenChange: () => {},
  rightSideBarOpen: false,
  onRightSideBarOpenChange: () => {},
  rightSideBarRef: { current: null },
  mobileNavConfig: DEFAULT_MOBILE_NAV_CONFIG,
  signedInIcons: null,
  leftSideBar: <p>Player sidebar</p>,
  rightSideBar: <p>World sidebar</p>,
  leftSideBarMainMenu: null,
  handleRightSidebarClick: () => {},
  lightLayout: false,
  toggleLightLayout: () => {},
  imageset: { navbar: "/navbar.webp", handsign: "/handsign.webp", wallpaper: "/wall.webp" },
  variantClasses: layoutVariantClasses[variant],
  showMobileNotifications: false,
  mobileNotificationCount: 0,
});

const setSwapped = (swapped: boolean) =>
  document.documentElement.toggleAttribute(SWAP_SIDEBARS_ATTRIBUTE, swapped);

describe("sidebar sides in panel layouts", () => {
  it.each(["17-obsidian-council", "20-eclipse-observatory", "3-sakura-courtyard"] as const)(
    "keeps the %s grid areas by default and exchanges them when swapped",
    (variant) => {
      mockFrameChrome();
      const view = render(<PanelGameLayout {...renderProps(variant)} />);
      // Side panels only show from the layout's sidebar breakpoint, which jsdom does not
      // apply, so they are found by their landmark labels rather than by accessible role.
      const player = view.container.querySelector<HTMLElement>('aside[aria-label="Player status"]');
      const world = view.container.querySelector<HTMLElement>(
        'aside[aria-label="World and activity"]',
      );
      if (!player || !world) throw new Error("Panel sidebars are missing");
      expect(player.textContent).toBe("Player sidebar");
      expect(world.textContent).toBe("World sidebar");

      expect(getComputedStyle(player).gridArea).toBe("player");
      expect(getComputedStyle(world).gridArea).toBe("world");

      setSwapped(true);
      expect(getComputedStyle(player).gridArea).toBe("world");
      expect(getComputedStyle(world).gridArea).toBe("player");
    },
  );
});

describe("sidebar sides in flex layouts", () => {
  it("keeps the Classic columns and banners by default and mirrors them when swapped", () => {
    mockFrameChrome();
    const view = render(<ClassicGameLayout {...renderProps("default")} />);
    const row = view.container.querySelector<HTMLElement>("[data-sidebar-row]");
    const start = view.container.querySelector<HTMLElement>('[data-sidebar-content="start"]');
    const end = view.container.querySelector<HTMLElement>('[data-sidebar-content="end"]');
    const art = [...view.container.querySelectorAll<HTMLElement>("[data-sidebar-art]")];
    if (!row || !start || !end) throw new Error("Classic sidebar columns are missing");
    expect(start.textContent).toBe("Player sidebar");
    expect(end.textContent).toBe("World sidebar");
    expect(art).toHaveLength(4);

    expect(getComputedStyle(row).flexDirection).not.toBe("row-reverse");
    expect(art.map((image) => getComputedStyle(image).transform)).toEqual(
      art.map(() => "none"),
    );
    expect(getComputedStyle(start).paddingRight).not.toBe("80px");

    setSwapped(true);
    expect(getComputedStyle(row).flexDirection).toBe("row-reverse");
    expect(art.map((image) => getComputedStyle(image).transform)).toEqual(
      art.map(() => "scaleX(-1)"),
    );
    expect(getComputedStyle(start).paddingRight).toBe("80px");
    expect(getComputedStyle(end).paddingLeft).toBe("80px");
  });

  it("reverses the Pixel column row only when swapped", () => {
    mockFrameChrome();
    const view = render(<PixelGameLayout {...renderProps("pixel")} />);
    const row = view.container.querySelector<HTMLElement>("[data-sidebar-row]");
    if (!row) throw new Error("Pixel sidebar row is missing");
    const columns = [...row.children].map((column) => column.textContent);
    expect(columns[0]).toBe("Player sidebar");
    expect(columns.at(-1)).toBe("World sidebar");

    expect(getComputedStyle(row).flexDirection).not.toBe("row-reverse");
    setSwapped(true);
    expect(getComputedStyle(row).flexDirection).toBe("row-reverse");
  });
});

describe("game settings categories", () => {
  const renderSettings = () => {
    // useLocalStorage syncs same-page readers with the DOM's own CustomEvent.
    for (const key of browserGlobals) {
      Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
    }
    vi.spyOn(clerk, "useUser").mockReturnValue({ isSignedIn: false } as never);
    vi.spyOn(navigation, "useRouter").mockReturnValue({ refresh: vi.fn() } as never);
    Object.assign(vi.spyOn(client, "api" as never), {
      profile: { updatePreferences: { useMutation: () => ({ mutate: vi.fn() }) } },
    });
    vi.spyOn(iframeMute, "useIframeMute").mockReturnValue({ isIframesMuted: false, setIframesMuted: vi.fn(), toggleIframesMute: vi.fn() });
    return render(
      <LayoutContextProvider value="17-obsidian-council" isPixelLanding={false}>
        <GlobalAudioProvider>
          <GameSettingsPanel />
        </GlobalAudioProvider>
      </LayoutContextProvider>,
    );
  };
  it("stores the sidebar choice in the game layout category", () => {
    const view = renderSettings();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Game layout" }), { button: 0, ctrlKey: false });
    const toggle = view.getByRole("switch", { name: "Swap sidebars" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(view.getByText("Layout default")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(SWAP_SIDEBARS_STORAGE_KEY)).toBe("true");
  });

  it("keeps graphics in their own category and retains the shadow preference while lighting is off", () => {
    const view = renderSettings();
    expect(view.queryByRole("switch", { name: "Lighting" })).toBeNull();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Visual effects" }), { button: 0, ctrlKey: false });
    const lighting = view.getByRole("switch", { name: "Lighting" });
    const shadows = view.getByRole("switch", { name: "Shadows" });
    const animations = view.getByRole("switch", { name: "Animations" });
    fireEvent.click(shadows);
    fireEvent.click(animations);
    fireEvent.click(lighting);
    expect(shadows.hasAttribute("disabled")).toBe(true);
    expect(shadows.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(lighting);
    expect(shadows.hasAttribute("disabled")).toBe(false);
    expect(shadows.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(VISUAL_EFFECT_KEYS.shadows)).toBe("false");
    expect(localStorage.getItem(VISUAL_EFFECT_KEYS.animations)).toBe("false");
    expect(view.queryByRole("switch", { name: "Swap sidebars" })).toBeNull();
  });
});
