import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MobileGameNav } from "@/components/layout/shared/MobileGameNav";
import * as nativeShell from "@/hooks/useNativeShell";
import * as cookieConsent from "@/libs/cookieConsent";
import type { MobileNavConfig } from "@/libs/mobileNavConfig";
import { DEFAULT_MOBILE_NAV_CONFIG } from "@/libs/mobileNavConfig";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const userAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
const shortcuts: MobileNavConfig = {
  left: ["academy"],
  right: ["items", "tavern", "settings"],
};
const props = {
  mobileNavConfig: shortcuts,
  location: { name: "Village", href: "/village" },
  yellowButtonClassName: "h-14 w-14",
  mobileNavbarButtonClassName: "h-16 w-16",
};

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(nativeShell, "useNativeShell").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
  if (userAgent) Object.defineProperty(navigator, "userAgent", userAgent);
  else Reflect.deleteProperty(navigator, "userAgent");
});

describe("mobile game navigation cookie settings", () => {
  it("places Activity beside Profile and balances the default shortcuts around the center", () => {
    const view = render(
      <MobileGameNav {...props} mobileNavConfig={DEFAULT_MOBILE_NAV_CONFIG} />,
    );
    expect(
      Array.from(view.container.querySelectorAll("a, button"), (control) =>
        control.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Cookie settings",
      "Profile",
      "Activity",
      "Village",
      "Inbox",
      "Tavern",
      "Settings",
    ]);
  });
  it.each([false, true, undefined])(
    "places four experimental controls on each side of the location action (native=%s)",
    (native) => {
      vi.spyOn(nativeShell, "useNativeShell").mockReturnValue(native);
      const view = render(
        <MobileGameNav
          {...props}
          mobileNavConfig={DEFAULT_MOBILE_NAV_CONFIG}
          travelControls={{
            menu: <button type="button" aria-label="Map controls" />,
            view: <button type="button" aria-label="Show global map" />,
          }}
        />,
      );
      const names = Array.from(
        view.container.querySelectorAll("a, button"),
        (control) => control.getAttribute("aria-label"),
      );
      expect(names).toEqual([
        "Map controls",
        "Profile",
        "Activity",
        "Show global map",
        "Village",
        "Inbox",
        "Tavern",
        "Settings",
        ...(native === false ? ["Cookie settings"] : []),
      ]);
    },
  );

  it("publishes the raised center's inset without counting the open travel popup", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const inset =
        this.getAttribute("aria-label") === "Village"
          ? 80
          : this.textContent === "Quick Travel"
            ? 500
            : 60;
      return new window.DOMRect(0, window.innerHeight - inset, 320, 60);
    });
    render(
      <MobileGameNav
        {...props}
        travelControls={{
          menu: (
            <div>
              <button type="button">Map controls</button>
              <section>
                <button type="button">Quick Travel</button>
              </section>
            </div>
          ),
          view: <button type="button">Show global map</button>,
        }}
      />,
    );
    expect(document.documentElement.style.getPropertyValue("--game-bottom-nav-h")).toBe(
      "80px",
    );
  });

  it("opens preferences without leaving the player's current page", () => {
    const open = vi
      .spyOn(cookieConsent, "openCookieConsentDialog")
      .mockReturnValue(true);
    const view = render(<MobileGameNav {...props} />);
    const link = view.getByRole("link", { name: "Cookie settings" });
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("keeps a navigable consent page fallback when the manager is unavailable", () => {
    const open = vi
      .spyOn(cookieConsent, "openCookieConsentDialog")
      .mockReturnValue(false);
    let isNavigationPrevented: boolean | undefined;
    const view = render(
      <div
        onClick={(event) => {
          isNavigationPrevented = event.defaultPrevented;
          event.preventDefault();
        }}
      >
        <MobileGameNav {...props} />
      </div>,
    );
    const link = view.getByRole("link", { name: "Cookie settings" });
    expect(link.getAttribute("href")).toBe("/consent");
    fireEvent.click(link);
    expect(open).toHaveBeenCalledTimes(1);
    expect(isNavigationPrevented).toBe(false);
  });

  it("retains four configured shortcuts beside Activity and the village destination", () => {
    const view = render(<MobileGameNav {...props} />);
    expect(
      view
        .getAllByRole("link")
        .map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")]),
    ).toEqual([
      ["Cookie settings", "/consent"],
      ["Academy", "/academy"],
      ["Village", "/village"],
      ["Items", "/items"],
      ["Tavern", "/tavern"],
      ["Settings", "/profile/edit"],
    ]);
    expect(view.getByRole("button", { name: "Activity" })).toBeTruthy();
  });

  it("preserves travel outside a village and hides an unavailable configured travel link", () => {
    const view = render(
      <MobileGameNav
        {...props}
        location={undefined}
        mobileNavConfig={{ ...shortcuts, left: ["travel"] }}
      />,
    );
    expect(view.getAllByRole("link", { name: "Travel" })).toHaveLength(1);
    expect(view.getByRole("link", { name: "Travel" }).getAttribute("href")).toBe(
      "/travel",
    );
    expect(view.queryByRole("link", { name: "Village" })).toBeNull();
    expect(view.getByRole("link", { name: "Cookie settings" })).toBeTruthy();
  });

  it.each([undefined, true])(
    "keeps web consent out of an unconfirmed or native shell (%s)",
    (native) => {
      vi.spyOn(nativeShell, "useNativeShell").mockReturnValue(native);
      const view = render(<MobileGameNav {...props} />);
      expect(view.queryByRole("link", { name: "Cookie settings" })).toBeNull();
      expect(view.getAllByRole("link")).toHaveLength(5);
    },
  );

  it("keeps web consent out of a native user agent when the bridge is unavailable", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 TNR-Native/1.0.0 (ios)",
    });
    const view = render(<MobileGameNav {...props} />);
    expect(view.queryByRole("link", { name: "Cookie settings" })).toBeNull();
    expect(view.getAllByRole("link")).toHaveLength(5);
  });

  it("keeps configured Travel reachable when a compass replaces the location link", () => {
    const view = render(
      <MobileGameNav
        {...props}
        location={undefined}
        mobileNavConfig={{ ...shortcuts, left: ["travel"] }}
        centerControl={<button type="button">Compass</button>}
      />,
    );
    expect(view.getByRole("link", { name: "Travel" }).getAttribute("href")).toBe(
      "/travel",
    );
    expect(view.getByRole("button", { name: "Compass" })).toBeTruthy();
  });
});
