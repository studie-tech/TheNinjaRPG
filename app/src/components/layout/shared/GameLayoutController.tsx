"use client";

import dynamic from "next/dynamic";
import React, {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import ReactDOM from "react-dom";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import { FONT_SCALE_STORAGE_KEY } from "@/hooks/useFontScale";
import { useGameMenu } from "@/hooks/useGameMenu";
import { usePageActive } from "@/hooks/usePageActive";
import { useRankedQueueCount } from "@/hooks/useRankedQueueCount";
import { useTerritoryWarNotice } from "@/hooks/useTerritoryWarNotice";
import { GlobalAudioProvider } from "@/layout/GlobalAudioProvider";
import { getGameLayout } from "@/libs/gameLayouts";
import {
  LIGHT_LAYOUT_ATTRIBUTE,
  LIGHT_LAYOUT_STORAGE_KEY,
  persistFontScaleCookie,
  SWAP_SIDEBARS_ATTRIBUTE,
  SWAP_SIDEBARS_STORAGE_KEY,
  toFontScale,
} from "@/libs/layoutPreference";
import { getMainNavbarLinks } from "@/libs/menus";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  MOBILE_NAV_STORAGE_KEY,
  type MobileNavConfig,
  normalizeMobileNavConfig,
} from "@/libs/mobileNavConfig";
import { usePublicPathname } from "@/utils/routing";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";
import { getCurrentSeason } from "@/utils/time";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  type AccountMenuState,
  LayoutLeftSidebar,
  LayoutMainMenu,
  LayoutRightSidebarContent,
  SignedInIcons,
} from "./LayoutSidebars";
import type { GameLayoutControllerProps, GameLayoutRenderProps } from "./layoutTypes";
import { shouldCloseRightSidebar } from "./layoutUtils";
import { getImageSet, layoutVariantClasses } from "./layoutVariants";

// Lessons and quest scenes load once a character exists; visitors only need the welcome page.
const TutorialAssistant = dynamic(() => import("@/layout/TutorialAssistant"));

/** Share navigation, live notifications and sidebar state across layout variants. */
const GameLayoutController: React.FC<GameLayoutControllerProps> = ({
  variant,
  renderer: Renderer,
  initialIsSignedIn = false,
  children,
}) => {
  ReactDOM.prefetchDNS("https://region1.analytics.google.com");
  ReactDOM.prefetchDNS("https://connect.facebook.net");
  ReactDOM.prefetchDNS("https://api.github.com");

  const {
    data: userData,
    notifications,
    isClerkLoaded,
    isSignedIn,
    status: userStatus,
    userId,
    pusher,
    timeDiff,
    updateUser,
  } = useUserDataSelector((user) => ({
    wallpaperOverwrite: user.village?.wallpaperOverwrite,
  }));
  const pathname = usePublicPathname();
  const isPageActive = usePageActive();
  const { systems, location } = useGameMenu();
  const [leftSideBarOpen, setLeftSideBarOpen] = useState(false);
  const [rightSideBarOpen, setRightSideBarOpen] = useState(false);
  const rightSideBarRef = React.useRef<HTMLDivElement | null>(null);
  // Opening or closing a sheet mounts or unmounts its whole menu; as a
  // transition, that render does not block the tap's next paint. Links
  // inside a sheet close it directly instead: a close sharing a transition
  // with the navigation it starts would keep the sheet up until the page loads.
  const onLeftSideBarOpenChange = (open: boolean) =>
    startTransition(() => setLeftSideBarOpen(open));
  const onRightSideBarOpenChange = (open: boolean) =>
    startTransition(() => setRightSideBarOpen(open));
  const [lightLayout, setLightLayout] = useLocalStorage<boolean>(
    LIGHT_LAYOUT_STORAGE_KEY,
    false,
  );
  const [isMounted, setIsMounted] = useState(false);

  // The root layout's head script sets this before first paint; keep it in step with a
  // toggle, and restore it before paint after a remount of the shell strips it.
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute(
      LIGHT_LAYOUT_ATTRIBUTE,
      lightLayout === true,
    );
  }, [lightLayout]);

  const [swapSidebars] = useLocalStorage<boolean>(SWAP_SIDEBARS_STORAGE_KEY, false);

  // Like the light layout, the head script marks swapped sidebars before first paint and
  // the layout stylesheets place the columns; this applies a change from the settings
  // immediately and restores the attribute after a remount of the shell strips it.
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute(
      SWAP_SIDEBARS_ATTRIBUTE,
      swapSidebars === true,
    );
  }, [swapSidebars]);

  const { data: rankedQueueCount = 0 } = useRankedQueueCount(
    !!userId && isPageActive,
    pusher,
  );

  const activeTerritoryWar = useTerritoryWarNotice(!!userData, timeDiff, isPageActive);

  useEffect(() => {
    // Deep links and notification taps navigate without clicking a sidebar item.
    setLeftSideBarOpen(false);
    setRightSideBarOpen(false);
  }, [pathname]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const keepEditorVisible = () => {
      const field = document.activeElement;
      const isEditing =
        field instanceof HTMLElement &&
        field.matches("input, textarea, [contenteditable='true']");
      // A landscape keyboard can leave less room than the decorative game masthead.
      document.body.classList.toggle(
        "game-keyboard-compact",
        isEditing && viewport.height < 220 && window.innerWidth > window.innerHeight,
      );
      cancelAnimationFrame(frame);
      if (isEditing) {
        frame = requestAnimationFrame(() => field.scrollIntoView({ block: "nearest" }));
      }
    };
    viewport.addEventListener("resize", keepEditorVisible);
    document.addEventListener("focusin", keepEditorVisible);
    document.addEventListener("focusout", keepEditorVisible);
    keepEditorVisible();
    return () => {
      viewport.removeEventListener("resize", keepEditorVisible);
      document.removeEventListener("focusin", keepEditorVisible);
      document.removeEventListener("focusout", keepEditorVisible);
      cancelAnimationFrame(frame);
      document.body.classList.remove("game-keyboard-compact");
    };
  }, []);

  useEffect(() => {
    // The root layout's head script applies the scale from the cookie before first paint,
    // so this is only a recovery path for visitors with a stored preference but no cookie.
    // Restore the cookie for the next request without changing this document after
    // hydration; active changes still apply immediately through useFontScale.
    const savedFontScale = safeLocalStorageGetItem(FONT_SCALE_STORAGE_KEY);
    if (savedFontScale) {
      try {
        const parsed = toFontScale(JSON.parse(savedFontScale) as number);
        if (parsed) {
          persistFontScaleCookie(parsed);
        }
      } catch {
        // Use the default scale if localStorage contains stale data.
      }
    }
    setIsMounted(true);
  }, [variant]);

  const toggleLightLayout = () => {
    setLightLayout(!lightLayout);
  };

  // The head script and applyGameLayout apply the stored theme; a toggle flips both.
  const toggleTheme = () => {
    const dark = !document.documentElement.classList.contains("dark");
    safeLocalStorageSetItem("theme", dark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", dark);
  };

  const navbarMenuItems = useMemo(
    () => getMainNavbarLinks(notifications),
    [notifications],
  );
  const shownNotifications = useMemo(() => {
    const base =
      notifications?.filter(
        (n) =>
          n.color !== "toast" &&
          n.color !== "hidden" &&
          (n.alwaysShow || n.href !== pathname),
      ) ?? [];
    if (activeTerritoryWar) {
      base.push({
        href: "/territory-war",
        name: `Territory War · Sector ${activeTerritoryWar.sector}`,
        color: "blue",
        alwaysShow: true,
      });
    }
    if (!userId || rankedQueueCount <= 0) return base;
    return [
      ...base,
      {
        href: "/battlearena#PVP%20Rank",
        name:
          rankedQueueCount === 1
            ? "1 player in ranked queue"
            : `${rankedQueueCount} players in ranked queue`,
        color: "blue" as const,
        alwaysShow: true,
      },
    ];
  }, [notifications, pathname, rankedQueueCount, userId, activeTerritoryWar]);
  const isSignedInLayout = isClerkLoaded ? isSignedIn : initialIsSignedIn;
  let accountState: AccountMenuState = null;
  if (isSignedInLayout && !userData) {
    if (!isClerkLoaded || userStatus === "pending") accountState = "loading";
    else if (userStatus === "error") accountState = "error";
    else if (userId && userStatus === "success") accountState = "create-character";
  }
  const showMobileNotifications = pathname !== "/combat";
  const season = getCurrentSeason();
  const wallpaperOverwrite = userData?.wallpaperOverwrite;
  const imageset = useMemo(
    () => getImageSet(wallpaperOverwrite, season),
    [wallpaperOverwrite, season],
  );
  const variantClasses = layoutVariantClasses[variant];

  const [rawMobileNavConfig] = useLocalStorage<MobileNavConfig>(
    MOBILE_NAV_STORAGE_KEY,
    DEFAULT_MOBILE_NAV_CONFIG,
  );
  const mobileNavConfig = normalizeMobileNavConfig(rawMobileNavConfig);

  // Only presentation values flow into the shell; position stays in the location menu.
  const { data: layoutUser } = useUserDataSelector((user) => ({
    userId: user.userId,
    username: user.username,
    status: user.status,
    village: user.village,
    tutorialOn: user.tutorialOn,
    tutorialStep: user.tutorialStep,
    musicOn: user.musicOn,
    buttonSfxOn: user.buttonSfxOn,
    sfxOn: user.sfxOn,
    isOutlaw: user.isOutlaw,
    bloodlineId: user.bloodlineId,
  }));

  const signedInIcons = (
    <SignedInIcons
      variant={variant}
      isSignedIn={isClerkLoaded && isSignedIn}
      userData={layoutUser}
      updateUser={updateUser}
      onEventClick={() => setLeftSideBarOpen(false)}
      onThemeToggle={toggleTheme}
    />
  );

  const leftSideBar = (
    <LayoutLeftSidebar
      variant={variant}
      isSignedInLayout={isSignedInLayout}
      accountState={accountState}
      userData={layoutUser}
    />
  );

  const rightSideBar = (
    <LayoutRightSidebarContent
      variant={variant}
      isSignedInLayout={isSignedInLayout}
      accountState={accountState}
      userData={layoutUser}
      systems={systems}
      notifications={shownNotifications}
      location={location}
    />
  );

  const leftSideBarMainMenu = (
    <LayoutMainMenu
      variant={variant}
      navbarMenuItems={navbarMenuItems}
      signedInIcons={signedInIcons}
      onNavigate={() => setLeftSideBarOpen(false)}
    />
  );

  const handleRightSidebarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (shouldCloseRightSidebar(e.target as HTMLElement)) {
      setRightSideBarOpen(false);
    }
  };

  const renderProps: GameLayoutRenderProps = {
    children,
    variant,
    userData: layoutUser,
    isSignedInLayout,
    pathname,
    navbarMenuItems,
    shownNotifications,
    location,
    leftSideBarOpen,
    onLeftSideBarOpenChange,
    rightSideBarOpen,
    onRightSideBarOpenChange,
    rightSideBarRef,
    mobileNavConfig,
    signedInIcons,
    leftSideBar,
    rightSideBar,
    leftSideBarMainMenu,
    handleRightSidebarClick,
    lightLayout: isMounted ? lightLayout : false,
    toggleLightLayout,
    imageset,
    variantClasses,
    showMobileNotifications,
  };

  return (
    <GlobalAudioProvider userData={layoutUser}>
      {layoutUser && (
        <TutorialAssistant
          sidebarBreakpoint={getGameLayout(variant).sidebarBreakpoint}
          rightSideBarOpen={rightSideBarOpen}
          setRightSideBarOpen={setRightSideBarOpen}
          rightSideBarRef={rightSideBarRef}
        />
      )}
      <Renderer {...renderProps} />
    </GlobalAudioProvider>
  );
};

export default GameLayoutController;
