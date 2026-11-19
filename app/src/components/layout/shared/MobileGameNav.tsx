"use client";

import { Compass, Cookie, House } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useNativeShell } from "@/hooks/useNativeShell";
import Link from "@/layout/Link";
import { openCookieConsentDialog } from "@/libs/cookieConsent";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { MobileNavConfig } from "@/libs/mobileNavConfig";
import { getNavOptionById } from "@/libs/mobileNavConfig";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { cn } from "@/libs/shadui";

interface MobileGameNavProps {
  mobileNavConfig: MobileNavConfig;
  location?: NavBarDropdownLink;
  yellowButtonClassName: string;
  mobileNavbarButtonClassName: string;
  className?: string;
}

/** Render a configured navigation shortcut, omitting unavailable travel destinations and unknown IDs. */
const MobileGameNavButton: React.FC<{
  optionId: string;
  location?: NavBarDropdownLink;
  mobileNavbarButtonClassName: string;
}> = ({ optionId, location, mobileNavbarButtonClassName }) => {
  if (optionId === "travel" && !location) return null;

  const option = getNavOptionById(optionId);
  if (!option) return null;

  const { icon: Icon } = option;
  return (
    <Link
      href={option.href}
      aria-label={option.name}
      className="relative -top-2 flex min-h-[44px] min-w-0 justify-center"
    >
      <Icon className={cn(mobileNavbarButtonClassName, "max-w-full")} />
    </Link>
  );
};

/** Shared mobile shortcuts, a fixed web consent control and the raised location action. */
export const MobileGameNav: React.FC<MobileGameNavProps> = ({
  mobileNavConfig,
  location,
  yellowButtonClassName,
  mobileNavbarButtonClassName,
  className,
}) => {
  const isNativeShell = useNativeShell();
  const showCookieSettings =
    isNativeShell === false && !isNativeUserAgent(navigator.userAgent);
  const navRef = useRef<HTMLDivElement>(null);
  useBottomNavInset(navRef);
  return (
    <div
      ref={navRef}
      className={cn(
        // The fixed web consent control balances the configured shortcuts around the centre.
        // Native clients keep two wider left slots; the insets clear a landscape notch.
        "grid items-center justify-center pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
        showCookieSettings ? "grid-cols-7" : "grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_1fr]",
        className,
      )}
    >
      {showCookieSettings && (
        <Link
          href="/consent"
          aria-label="Cookie settings"
          aria-haspopup="dialog"
          title="Cookie settings"
          className="relative -top-2 flex min-h-[44px] min-w-0 justify-center"
          onClick={(event) => {
            if (openCookieConsentDialog()) event.preventDefault();
          }}
        >
          <Cookie className={cn(mobileNavbarButtonClassName, "max-w-full")} />
        </Link>
      )}
      {mobileNavConfig.left.map((optionId) => (
        <div key={optionId} className="min-w-0">
          <MobileGameNavButton
            optionId={optionId}
            location={location}
            mobileNavbarButtonClassName={mobileNavbarButtonClassName}
          />
        </div>
      ))}
      {location ? (
        <Link
          href="/village"
          aria-label="Village"
          className="relative -top-8 flex justify-center"
        >
          <div className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-4">
            <House className={cn(yellowButtonClassName)} />
          </div>
        </Link>
      ) : (
        <Link
          href="/travel"
          aria-label="Travel"
          className="relative -top-8 flex justify-center"
        >
          <div className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-4">
            <Compass className={mobileNavbarButtonClassName} />
          </div>
        </Link>
      )}
      {mobileNavConfig.right.map((optionId) => (
        <div key={optionId} className="min-w-0">
          <MobileGameNavButton
            optionId={optionId}
            location={location}
            mobileNavbarButtonClassName={mobileNavbarButtonClassName}
          />
        </div>
      ))}
    </div>
  );
};

/** CSS variable holding how far the bottom nav reaches up from the viewport's bottom edge. */
export const BOTTOM_NAV_INSET_VARIABLE = "--game-bottom-nav-h";

/**
 * Publish the nav's footprint, including the safe-area padding and the raised centre button,
 * so fixed overlays (install prompt, tournament notice) can sit just above it. The value is
 * 0 while the layout hides the nav at its own breakpoint or in compact mode.
 */
const useBottomNavInset = (navRef: React.RefObject<HTMLDivElement | null>) => {
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const root = document.documentElement;
    /** Include raised links in the overlay inset, and clear it when the nav is hidden. */
    const measure = () => {
      const rect = nav.getBoundingClientRect();
      if (!rect.height) {
        root.style.setProperty(BOTTOM_NAV_INSET_VARIABLE, "0px");
        return;
      }
      const top = Math.min(
        rect.top,
        ...Array.from(
          nav.querySelectorAll("a"),
          (link) => link.getBoundingClientRect().top,
        ),
      );
      const inset = Math.max(0, Math.round(window.innerHeight - top));
      root.style.setProperty(BOTTOM_NAV_INSET_VARIABLE, `${inset}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty(BOTTOM_NAV_INSET_VARIABLE);
    };
  }, [navRef]);
};
