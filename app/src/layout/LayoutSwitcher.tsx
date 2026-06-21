"use client";

import { usePathname } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import LayoutCore4Beta from "@/components/layout/core4_beta";
import LayoutCore4Landing from "@/components/layout/core4_landing";
import LayoutCore4Pixel from "@/components/layout/core4_pixel";
import ParticleProvider from "@/components/ui/particles";
import { safeLocalStorageGetItem } from "@/hooks/localstorage";
import {
  type EffectiveLayout,
  LAYOUT_PREFERENCE_COOKIE,
  persistLayoutPreferenceCookie,
  storedValueToLayout,
} from "@/libs/layoutPreference";
import { LayoutContextProvider } from "@/utils/LayoutContext";
import { useUserData } from "@/utils/UserContext";

interface LayoutSwitcherProps {
  children: React.ReactNode;
  initialIsSignedIn: boolean;
  initialLayout: EffectiveLayout;
}

/**
 * LayoutSwitcher component for A/B testing different layouts
 * - Anonymous users enter the A/B-tested layout from the middleware cookie
 * - Users can override locally from the settings dialog
 */
const LayoutSwitcher: React.FC<LayoutSwitcherProps> = ({
  children,
  initialIsSignedIn,
  initialLayout,
}) => {
  const pathname = usePathname();
  const { data: userData, isClerkLoaded, userId } = useUserData();
  const [layout, setLayout] = useState<EffectiveLayout>(initialLayout);

  useEffect(() => {
    const nextLayout =
      storedValueToLayout(safeLocalStorageGetItem(LAYOUT_PREFERENCE_COOKIE)) ??
      initialLayout;
    setLayout(nextLayout);
    persistLayoutPreferenceCookie(nextLayout);
  }, [initialLayout]);

  const displayedLayout = layout;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", displayedLayout === "pixel");
  }, [displayedLayout]);

  const isKnownAnonymous = isClerkLoaded ? !userId : !initialIsSignedIn;
  const isPixelLanding =
    displayedLayout === "pixel" && pathname === "/" && isKnownAnonymous && !userData;
  const content = isPixelLanding ? (
    <LayoutCore4Landing>{children}</LayoutCore4Landing>
  ) : displayedLayout === "pixel" ? (
    <LayoutCore4Pixel initialIsSignedIn={initialIsSignedIn}>
      {children}
    </LayoutCore4Pixel>
  ) : (
    <LayoutCore4Beta>{children}</LayoutCore4Beta>
  );

  return (
    <LayoutContextProvider isPixelLanding={isPixelLanding} value={displayedLayout}>
      {content}
      <ParticleProvider />
    </LayoutContextProvider>
  );
};

export default LayoutSwitcher;
