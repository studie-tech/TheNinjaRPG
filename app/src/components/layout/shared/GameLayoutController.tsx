"use client";

import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import { FONT_SCALE_STORAGE_KEY } from "@/hooks/useFontScale";
import { GlobalAudioProvider } from "@/layout/GameSettings";
import TutorialAssistant from "@/layout/TutorialAssistant";
import { persistFontScaleCookie, toFontScale } from "@/libs/layoutPreference";
import { getMainNavbarLinks, useGameMenu } from "@/libs/menus";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  MOBILE_NAV_STORAGE_KEY,
  type MobileNavConfig,
  normalizeMobileNavConfig,
} from "@/libs/mobileNavConfig";
import { useUserData } from "@/utils/UserContext";
import {
  LayoutLeftSidebar,
  LayoutMainMenu,
  LayoutRightSidebarContent,
  SignedInIcons,
} from "./LayoutSidebars";
import type { GameLayoutControllerProps, GameLayoutRenderProps } from "./layoutTypes";
import { shouldCloseRightSidebar } from "./layoutUtils";
import { getImageSet, layoutVariantClasses } from "./layoutVariants";

const GameLayoutController: React.FC<GameLayoutControllerProps> = ({
  variant,
  renderer: Renderer,
  initialIsSignedIn = false,
  children,
}) => {
  ReactDOM.prefetchDNS("https://o4507797256601600.ingest.de.sentry.io");
  ReactDOM.prefetchDNS("https://consentcdn.cookiebot.com");
  ReactDOM.prefetchDNS("https://region1.analytics.google.com");
  ReactDOM.prefetchDNS("https://connect.facebook.net");
  ReactDOM.prefetchDNS("https://api.github.com");

  const {
    data: userData,
    notifications,
    isClerkLoaded,
    userId,
    updateUser,
  } = useUserData();
  const pathname = usePathname();
  const { systems, location } = useGameMenu(userData);
  const [leftSideBarOpen, setLeftSideBarOpen] = useState(false);
  const [rightSideBarOpen, setRightSideBarOpen] = useState(false);
  const rightSideBarRef = React.useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lightLayout, setLightLayout] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (variant === "pixel") {
      document.documentElement.classList.add("dark");
    } else {
      const savedTheme = safeLocalStorageGetItem("theme");
      if (savedTheme === "dark" || savedTheme === "light") {
        setTheme(savedTheme);
      }

      const savedLayout = safeLocalStorageGetItem("lightLayout");
      if (savedLayout !== null) {
        setLightLayout(JSON.parse(savedLayout) as boolean);
      }
    }

    // The scale is inlined on <html> during SSR from the font-scale cookie, so this is
    // only a recovery path for visitors who have a stored preference but no cookie yet.
    // Writing the cookie means the next request renders at the right size server-side
    // instead of re-flowing the document once this effect runs.
    const savedFontScale = safeLocalStorageGetItem(FONT_SCALE_STORAGE_KEY);
    if (savedFontScale) {
      try {
        const parsed = toFontScale(JSON.parse(savedFontScale) as number);
        if (parsed) {
          const root = document.documentElement;
          if (root.style.getPropertyValue("--font-scale") !== String(parsed)) {
            root.style.setProperty("--font-scale", String(parsed));
          }
          persistFontScaleCookie(parsed);
        }
      } catch {
        // Use the default scale if localStorage contains stale data.
      }
    }
    setIsMounted(true);
  }, [variant]);

  useEffect(() => {
    if (variant !== "beta" || !isMounted) return;
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme, isMounted, variant]);

  const toggleLightLayout = () => {
    setLightLayout((prev) => {
      const newState = !prev;
      safeLocalStorageSetItem("lightLayout", JSON.stringify(newState));
      return newState;
    });
  };

  const toggleTheme = () => {
    if (!theme || theme === "light") {
      safeLocalStorageSetItem("theme", "dark");
      setTheme("dark");
    } else {
      safeLocalStorageSetItem("theme", "light");
      setTheme("light");
    }
  };

  const navbarMenuItems = getMainNavbarLinks(notifications);
  const shownNotifications = notifications?.filter(
    (n) =>
      n.color !== "toast" &&
      n.color !== "hidden" &&
      (n.alwaysShow || n.href !== pathname),
  );
  const navbarMenuItemsLeft = navbarMenuItems.slice(0, 3);
  const navbarMenuItemsRight = navbarMenuItems.slice(3);
  const isSignedInLayout =
    !!userData || !!userId || (!isClerkLoaded && initialIsSignedIn);
  const isAnonymousLayout = !isSignedInLayout;
  const showMobileNotifications = pathname !== "/combat";
  const mobileNotificationCount = shownNotifications?.length ?? 0;
  const imageset = getImageSet(userData);
  const variantClasses = layoutVariantClasses[variant];

  const [rawMobileNavConfig] = useLocalStorage<MobileNavConfig>(
    MOBILE_NAV_STORAGE_KEY,
    DEFAULT_MOBILE_NAV_CONFIG,
  );
  const mobileNavConfig = normalizeMobileNavConfig(rawMobileNavConfig);

  const signedInIcons = (
    <SignedInIcons
      variant={variant}
      userData={userData}
      updateUser={updateUser}
      onEventClick={() => setLeftSideBarOpen(false)}
      onThemeToggle={toggleTheme}
    />
  );

  const leftSideBar = (
    <LayoutLeftSidebar
      variant={variant}
      isClerkLoaded={isClerkLoaded}
      isSignedInLayout={isSignedInLayout}
      userData={userData}
    />
  );

  const rightSideBar = (
    <LayoutRightSidebarContent
      variant={variant}
      isClerkLoaded={isClerkLoaded}
      isSignedInLayout={isSignedInLayout}
      userData={userData}
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
    userData,
    isClerkLoaded,
    isSignedInLayout,
    isAnonymousLayout,
    pathname,
    navbarMenuItems,
    navbarMenuItemsLeft,
    navbarMenuItemsRight,
    shownNotifications,
    systems,
    location,
    leftSideBarOpen,
    setLeftSideBarOpen,
    rightSideBarOpen,
    setRightSideBarOpen,
    rightSideBarRef,
    mobileNavConfig,
    signedInIcons,
    leftSideBar,
    rightSideBar,
    leftSideBarMainMenu,
    handleRightSidebarClick,
    lightLayout,
    toggleLightLayout,
    imageset,
    variantClasses,
    showMobileNotifications,
    mobileNotificationCount,
  };

  return (
    <GlobalAudioProvider userData={userData}>
      <TutorialAssistant
        rightSideBarOpen={rightSideBarOpen}
        setRightSideBarOpen={setRightSideBarOpen}
        rightSideBarRef={rightSideBarRef}
      />
      <Renderer {...renderProps} />
    </GlobalAudioProvider>
  );
};

export default GameLayoutController;
