"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type React from "react";
import { useDeferredValue, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { LayoutParticles } from "@/components/layout/shared/LayoutParticles";
import { applyGameLayout } from "@/hooks/useGameLayout";
import { type GameLayoutId, getGameLayout } from "@/libs/gameLayouts";
import {
  applyFontScaleCookie,
  LAYOUT_PREFERENCE_COOKIE,
  persistLayoutPreferenceCookie,
  storedValueToLayout,
} from "@/libs/layoutPreference";
import type { WallpaperVariant } from "@/libs/wallpaperExperiment";
import { LayoutContextProvider } from "@/utils/LayoutContext";
import { usePublicPathname } from "@/utils/routing";
import { safeLocalStorageGetItem } from "@/utils/storage";
import { useUserInfo } from "@/utils/UserContext";

/**
 * A visitor renders one of these frames, so each is its own chunk: the server render
 * preloads the frame a variant shows, and the others never download. Without a loading
 * state the frames suspend into the switch below rather than into a fallback.
 */
const GameLayout = dynamic(() =>
  import("@/components/layout/GameLayout").then((module) => module.GameLayout),
);
const PanelPublicLayout = dynamic(() =>
  import("@/components/layout/PanelPublicLayout").then(
    (module) => module.PanelPublicLayout,
  ),
);
const PixelPublicLayout = dynamic(
  () => import("@/components/layout/PixelPublicLayout"),
);

/**
 * The cookie repair below refreshes at most once per document, so a cookie the server
 * never receives (blocked, or shadowed by another cookie of the same name) cannot loop.
 */
let hasRefreshedForRepairedCookie = false;

/** Whether the layout cookie the next request sends now carries this layout. */
const cookieCarriesLayout = (layout: GameLayoutId) =>
  document.cookie
    .split("; ")
    .some((entry) => entry === `${LAYOUT_PREFERENCE_COOKIE}=${layout}`);

interface LayoutSwitcherProps {
  children: React.ReactNode;
  initialIsSignedIn: boolean;
  initialLayout: GameLayoutId;
  wallpaper?: WallpaperVariant;
}

/**
 * LayoutSwitcher renders the shell for the layout the proxy chose
 * - Layout choices apply both in game and on the welcome page
 * - Authentication determines the frame, independently of the selected design
 */
const LayoutSwitcher: React.FC<LayoutSwitcherProps> = ({
  children,
  initialIsSignedIn,
  initialLayout,
  wallpaper,
}) => {
  // Error reporting and consent load in every frame, signed in or not.
  ReactDOM.prefetchDNS("https://o4507797256601600.ingest.de.sentry.io");
  ReactDOM.prefetchDNS("https://consentcdn.cookiebot.com");
  const pathname = usePublicPathname();
  const { isClerkLoaded, isSignedIn } = useUserInfo();
  // Explicit choices replace only the presentation; remounting the root shell would
  // also restart Clerk and could activate another saved account after sign-out.
  const [displayedLayout, setDisplayedLayout] = useState(initialLayout);

  // The server picks the layout from the cookie; localStorage is only a recovery source
  // for when that cookie is lost (Safari caps JS-set cookies at 7 days, so it expires
  // for anyone who visits less often than weekly). Swapping the shell here after
  // hydration would replace the entire viewport in one frame, a large layout shift, so
  // the current render is left alone and the stored preference is only re-synced to the
  // cookie for the *next* request.
  // When the stored choice differs from what the server rendered, pages the router has
  // already fetched or prefetched carry the wrong shell too, and navigating to them would
  // flip between layouts; a single refresh re-renders under the repaired cookie.
  const router = useRouter();
  useEffect(() => {
    // The server rendered from this cookie, so it is authoritative; rewriting it only
    // renews its expiry. A localStorage copy that failed to update must not replace it.
    if (cookieCarriesLayout(initialLayout)) {
      persistLayoutPreferenceCookie(initialLayout);
      return;
    }
    const stored = storedValueToLayout(
      safeLocalStorageGetItem(LAYOUT_PREFERENCE_COOKIE),
    );
    // A public welcome rollout must not become the visitor's game preference.
    if (stored || initialIsSignedIn) {
      persistLayoutPreferenceCookie(stored ?? initialLayout);
    }
    if (
      stored &&
      stored !== initialLayout &&
      !hasRefreshedForRepairedCookie &&
      cookieCarriesLayout(stored)
    ) {
      hasRefreshedForRepairedCookie = true;
      router.refresh();
    }
  }, [initialLayout, initialIsSignedIn, router]);

  // A sign-in, sign-out or layout choice can need a frame that has not downloaded yet.
  // Deferred, the current frame stays on screen until the next one can render.
  const isKnownAnonymous = useDeferredValue(
    isClerkLoaded ? !isSignedIn : !initialIsSignedIn,
  );
  const shownLayout = useDeferredValue(displayedLayout);
  useEffect(() => {
    applyGameLayout(shownLayout);
    // A change of shell variant mid-session remounts everything under <html>, and React
    // strips what the head script set on it; put the font scale back.
    applyFontScaleCookie();
  }, [shownLayout]);

  const definition = getGameLayout(shownLayout);
  const isPixelLanding =
    definition.publicFrame === "landing" && pathname === "/" && isKnownAnonymous;
  const publicFrames = { landing: PixelPublicLayout, page: PanelPublicLayout };
  const PublicFrame =
    definition.publicFrame === "game"
      ? undefined
      : publicFrames[definition.publicFrame];
  const content =
    isKnownAnonymous &&
    PublicFrame &&
    (isPixelLanding || definition.publicFrame === "page") ? (
      <PublicFrame>{children}</PublicFrame>
    ) : (
      <GameLayout initialIsSignedIn={initialIsSignedIn}>{children}</GameLayout>
    );

  return (
    <LayoutContextProvider
      isPixelLanding={isPixelLanding}
      value={shownLayout}
      onLayoutChange={setDisplayedLayout}
      wallpaper={wallpaper}
    >
      {content}
      <LayoutParticles />
    </LayoutContextProvider>
  );
};

export default LayoutSwitcher;
