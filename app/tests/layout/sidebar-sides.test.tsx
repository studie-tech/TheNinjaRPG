import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "bun:test";
import { readFileSync } from "node:fs";
import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import { ClassicGameLayout } from "@/components/layout/ClassicGameLayout";
import { PanelGameLayout } from "@/components/layout/PanelGameLayout";
import { PixelGameLayout } from "@/components/layout/PixelGameLayout";
import * as LayoutSidebars from "@/components/layout/shared/LayoutSidebars";
import type { GameLayoutRenderProps } from "@/components/layout/shared/layoutTypes";
import { layoutVariantClasses } from "@/components/layout/shared/layoutVariants";
import { useCombatPreferences } from "@/hooks/combat";
import * as iframeMute from "@/hooks/useIframeMute";
import * as Footer from "@/layout/Footer";
import { GameSettingsPanel } from "@/layout/GameSettings";
import { GlobalAudioProvider } from "@/layout/GlobalAudioProvider";
import * as Image from "@/layout/Image";
import * as HelpButton from "@/layout/LowerRightHelpBtn";
import { UserCombatSettings } from "@/layout/UserCombatSettings";
import {
  SWAP_SIDEBARS_ATTRIBUTE,
  SWAP_SIDEBARS_STORAGE_KEY,
} from "@/libs/layoutPreference";
import { DEFAULT_MOBILE_NAV_CONFIG } from "@/libs/mobileNavConfig";
import { VISUAL_EFFECT_KEYS } from "@/libs/visualEffects";
import { LayoutContextProvider } from "@/utils/LayoutContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

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

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

/** Answer width media queries as a viewport of `width` CSS pixels would. */
const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => {
      const min = /min-width:\s*([\d.]+)px/.exec(media)?.[1];
      const max = /max-width:\s*([\d.]+)px/.exec(media)?.[1];
      return {
        media,
        matches:
          (min === undefined || width >= Number(min)) &&
          (max === undefined || width <= Number(max)),
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    },
  });
};

beforeEach(() => setViewportWidth(1440));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalMatchMedia)
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  document.documentElement.removeAttribute(SWAP_SIDEBARS_ATTRIBUTE);
  localStorage.removeItem(SWAP_SIDEBARS_STORAGE_KEY);
  localStorage.removeItem("gameSettingsTab");
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("combat") || key === "showGridNumbers")
      localStorage.removeItem(key);
  }
  for (const key of Object.values(VISUAL_EFFECT_KEYS)) localStorage.removeItem(key);
  restoreBrowserGlobals();
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
  isSignedInLayout: true,
  pathname: "/profile",
  navbarMenuItems: [],
  shownNotifications: [],
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
  imageset: {
    navbar: "/navbar.webp",
    handsign: "/handsign.webp",
    wallpaper: "/wall.webp",
  },
  variantClasses: layoutVariantClasses[variant],
  showMobileNotifications: false,
});

const setSwapped = (swapped: boolean) =>
  document.documentElement.toggleAttribute(SWAP_SIDEBARS_ATTRIBUTE, swapped);

describe("sidebar sides in panel layouts", () => {
  it.each([
    "17-obsidian-council",
    "20-eclipse-observatory",
    "3-sakura-courtyard",
  ] as const)(
    "keeps the %s grid areas by default and exchanges them when swapped",
    (variant) => {
      mockFrameChrome();
      const view = render(<PanelGameLayout {...renderProps(variant)} />);
      // Side panels only show from the layout's sidebar breakpoint, which jsdom does not
      // apply, so they are found by their landmark labels rather than by accessible role.
      const player = view.container.querySelector<HTMLElement>(
        'aside[aria-label="Player status"]',
      );
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
    const start = view.container.querySelector<HTMLElement>(
      '[data-sidebar-content="start"]',
    );
    const end = view.container.querySelector<HTMLElement>(
      '[data-sidebar-content="end"]',
    );
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

  it.each([
    ["Classic", ClassicGameLayout, "default"],
    ["Pixel", PixelGameLayout, "pixel"],
  ] as const)(
    "leaves the hidden %s columns empty on phones",
    (_name, Layout, variant) => {
      mockFrameChrome();
      setViewportWidth(390);
      const view = render(<Layout {...renderProps(variant)} />);
      expect(view.queryByText("Player sidebar")).toBeNull();
      expect(view.queryByText("World sidebar")).toBeNull();
      expect(view.queryByText("Strongest users")).toBeNull();
      expect(view.getByText("Page content")).toBeTruthy();
    },
  );

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

describe("Classic light layout", () => {
  it.each([false, true])(
    "keeps one set of account and settings buttons when the banner is hidden (%p)",
    (lightLayout) => {
      mockFrameChrome();
      const view = render(
        <ClassicGameLayout
          {...renderProps("default")}
          lightLayout={lightLayout}
          signedInIcons={<button type="button">Game settings</button>}
        />,
      );
      const settings = view.getAllByRole("button", { name: "Game settings" });
      expect(settings).toHaveLength(1);
      // Without the banner, the buttons stack down the page edge.
      expect(!!settings[0]?.closest("[data-stacked-icons]")).toBe(lightLayout);
      expect(
        view.getByRole("button", { name: lightLayout ? "Show Layout" : "Hide Layout" }),
      ).toBeDefined();
    },
  );
});

describe("game settings categories", () => {
  beforeEach(() => {
    installBrowserGlobals();
  });

  const CombatSettingsProbe = ({
    supportsBattleFocus,
  }: {
    supportsBattleFocus: boolean;
  }) => (
    <UserCombatSettings
      config={useCombatPreferences()}
      supportsBattleFocus={supportsBattleFocus}
    />
  );
  const renderSettings = (withCombat = false, supportsBattleFocus = true) => {
    vi.spyOn(clerk, "useUser").mockReturnValue({ isSignedIn: false } as never);
    vi.spyOn(navigation, "useRouter").mockReturnValue({ refresh: vi.fn() } as never);
    Object.assign(vi.spyOn(client, "api" as never), {
      profile: { updatePreferences: { useMutation: () => ({ mutate: vi.fn() }) } },
    });
    vi.spyOn(iframeMute, "useIframeMute").mockReturnValue({
      isIframesMuted: false,
      setIframesMuted: vi.fn(),
    });
    return render(
      <LayoutContextProvider value="17-obsidian-council" isPixelLanding={false}>
        <GlobalAudioProvider>
          <GameSettingsPanel />
          {withCombat && (
            <CombatSettingsProbe supportsBattleFocus={supportsBattleFocus} />
          )}
        </GlobalAudioProvider>
      </LayoutContextProvider>,
    );
  };
  it("stores the sidebar choice in the game layout category", () => {
    const view = renderSettings();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Game layout" }), {
      button: 0,
      ctrlKey: false,
    });
    const toggle = view.getByRole("switch", { name: "Swap sidebars" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(view.getByText("Layout default")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(SWAP_SIDEBARS_STORAGE_KEY)).toBe("true");
  });

  it("keeps graphics in their own category and keeps the graphics preferences independent", () => {
    const view = renderSettings();
    expect(view.queryByRole("switch", { name: "Day/night colors" })).toBeNull();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Visual effects" }), {
      button: 0,
      ctrlKey: false,
    });
    const lighting = view.getByRole("switch", { name: "Day/night colors" });
    const shadows = view.getByRole("switch", { name: "Shadows" });
    const animations = view.getByRole("switch", { name: "Sprite animations" });
    fireEvent.click(shadows);
    fireEvent.click(animations);
    fireEvent.click(lighting);
    expect(shadows.hasAttribute("disabled")).toBe(false);
    expect(shadows.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(lighting);
    expect(shadows.hasAttribute("disabled")).toBe(false);
    expect(shadows.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(VISUAL_EFFECT_KEYS.shadows)).toBe("false");
    expect(localStorage.getItem(VISUAL_EFFECT_KEYS.spriteAnimations)).toBe("false");
    expect(view.queryByRole("switch", { name: "Swap sidebars" })).toBeNull();
    expect(localStorage.getItem("gameSettingsTab")).toBe('"effects"');
    view.unmount();
    const reopened = renderSettings();
    expect(
      reopened
        .getByRole("tab", { name: "Visual effects" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(reopened.getByRole("switch", { name: "Day/night colors" })).toBeTruthy();
  });

  it("shares graphics between game and combat, remembers the combat category and keeps hidden panels out of ordering", () => {
    const view = renderSettings(true);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Visual effects" }), {
      button: 0,
      ctrlKey: false,
    });
    const sharedShadows = view.getByRole("switch", { name: "Shadows" });
    fireEvent.click(sharedShadows);
    fireEvent.click(view.getByRole("switch", { name: "Sprite animations" }));
    fireEvent.click(view.getByRole("button", { name: "Open combat settings" }));
    let dialog = within(view.getByRole("dialog", { name: "Combat settings" }));
    expect(
      dialog.getByRole("tab", { name: "Battle" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(dialog.getByRole("combobox", { name: "Resource bars" })).toBeTruthy();
    fireEvent.mouseDown(dialog.getByRole("tab", { name: "Visual effects" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      dialog.getByRole("switch", { name: "Shadows" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      dialog
        .getByRole("switch", { name: "Sprite animations" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.click(dialog.getByRole("switch", { name: "Day/night colors" }));
    expect(sharedShadows.hasAttribute("disabled")).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("dialog", { name: "Combat settings" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Open combat settings" }));
    dialog = within(view.getByRole("dialog", { name: "Combat settings" }));
    expect(
      dialog.getByRole("tab", { name: "Visual effects" }).getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.mouseDown(dialog.getByRole("tab", { name: "Layout" }), {
      button: 0,
      ctrlKey: false,
    });
    const battleFocus = dialog.getByRole("switch", { name: "Battle focus" });
    expect(battleFocus.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(battleFocus);
    expect(localStorage.getItem("combatBattleFocus")).toBe("true");
    expect(battleFocus.getAttribute("aria-checked")).toBe("true");
    expect(dialog.queryByRole("switch", { name: "Show timeline" })).toBeNull();
    expect(
      dialog
        .getByRole("switch", { name: "Show basic actions" })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(battleFocus);
    expect(localStorage.getItem("combatBattleFocus")).toBe("false");
    fireEvent.click(dialog.getByRole("switch", { name: "Show timeline" }));
    expect(
      dialog
        .getByRole("switch", { name: "Show basic actions" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(dialog.queryByText("Timeline")).toBeNull();
    expect(dialog.queryByText("Battle Log")).toBeNull();
    expect(dialog.getByText("Battlefield")).toBeTruthy();
  });

  it("keeps embedded viewer controls available while preserving the live focus preference", () => {
    localStorage.setItem("combatBattleFocus", "true");
    const view = renderSettings(true, false);
    fireEvent.click(view.getByRole("button", { name: "Open combat settings" }));
    const dialog = within(view.getByRole("dialog", { name: "Combat settings" }));
    expect(dialog.getByRole("switch", { name: "Small action icons" })).toBeTruthy();
    fireEvent.mouseDown(dialog.getByRole("tab", { name: "Layout" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(dialog.queryByRole("switch", { name: "Battle focus" })).toBeNull();
    expect(dialog.queryByRole("switch", { name: "Swap actions and log" })).toBeNull();
    expect(dialog.getByText("Panel order")).toBeTruthy();
    fireEvent.click(dialog.getByRole("switch", { name: "Show timeline" }));
    expect(
      dialog
        .getByRole("switch", { name: "Show basic actions" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(localStorage.getItem("combatBattleFocus")).toBe("true");
    view.unmount();

    const liveView = renderSettings(true);
    fireEvent.click(liveView.getByRole("button", { name: "Open combat settings" }));
    const liveDialog = within(
      liveView.getByRole("dialog", { name: "Combat settings" }),
    );
    expect(
      liveDialog
        .getByRole("switch", { name: "Battle focus" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.mouseDown(liveDialog.getByRole("tab", { name: "Battle" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(liveDialog.getByRole("switch", { name: "Small action icons" })).toBeTruthy();
    expect(liveDialog.queryByText("Panel order")).toBeNull();
  });
});
