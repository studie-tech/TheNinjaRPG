"use client";

import { Compass, House } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import Link from "@/layout/Link";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { MobileNavConfig } from "@/libs/mobileNavConfig";
import { getNavOptionById } from "@/libs/mobileNavConfig";
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
      className="relative -top-2 flex justify-center"
    >
      <Icon className={mobileNavbarButtonClassName} />
    </Link>
  );
};

export const MobileGameNav: React.FC<MobileGameNavProps> = ({
  mobileNavConfig,
  location,
  yellowButtonClassName,
  mobileNavbarButtonClassName,
  className,
}) => {
  const navRef = useRef<HTMLDivElement>(null);
  useBottomNavInset(navRef);
  return (
    <div
      ref={navRef}
      className={cn(
        // Two left shortcuts share the width of the three on the right, keeping the raised
        // centre button in the middle without an empty slot. The insets clear a landscape notch.
        "grid grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_1fr] items-center justify-center pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
        className,
      )}
    >
      {mobileNavConfig.left.map((optionId) => (
        <div key={optionId}>
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
        <div key={optionId}>
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
