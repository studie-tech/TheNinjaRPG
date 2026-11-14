"use client";

import { Compass, Menu, MessageCircle } from "lucide-react";
import { Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { IMG_LOGO_SHORT } from "@/drizzle/constants";
import { useActivityDock } from "@/hooks/useActivityDock";
import Footer from "@/layout/Footer";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import { CHAT_BUTTON_LAYER, MobileSidebarStack } from "./shared/LayoutChrome";
import { MobileNotificationsPopover } from "./shared/LayoutNotifications";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import { isClerkElement, keepSheetOpenForClerk } from "./shared/layoutUtils";
import { MobileGameNav } from "./shared/MobileGameNav";

export function PanelGameLayout(props: GameLayoutRenderProps) {
  const {
    children,
    userData,
    pathname,
    navbarMenuItems,
    signedInIcons,
    leftSideBar,
    rightSideBar,
    leftSideBarMainMenu,
    rightSideBarRef,
    leftSideBarOpen,
    onLeftSideBarOpenChange,
    rightSideBarOpen,
    onRightSideBarOpenChange,
    handleRightSidebarClick,
    shownNotifications,
    showMobileNotifications,
    mobileNavConfig,
    location,
    variantClasses,
  } = props;
  const { swapSides } = useActivityDock();
  const isGuidedTutorial = isTutorialActive(userData);

  return (
    <div data-world-page className="tnr-theme-game" data-layout-variant={props.variant}>
      {/* The primary nav's Chat button is the launcher; this bubble only appears while
          the battle focus view covers that nav (see .theme-focus-chat). */}
      <div
        data-battle-focus-layer
        className={cn(
          "theme-focus-chat fixed",
          userData
            ? cn(
                "bottom-5",
                // The non-modal tutorial menu can stay open after resizing to desktop.
                rightSideBarOpen ? "z-40" : CHAT_BUTTON_LAYER,
                swapSides ? "left-5" : "right-5",
              )
            : "right-5 bottom-5 z-50",
        )}
      >
        <LowerRightHelpBtn className="theme-header-button shadow-lg">
          <MessageCircle aria-hidden="true" />
        </LowerRightHelpBtn>
      </div>
      <a className="theme-skip-link" href="#game-content">
        Skip to game content
      </a>
      <div className="theme-frame">
        <header className="theme-brand" data-compact-hide>
          <div className="theme-drawer-buttons">
            <Sheet open={leftSideBarOpen} onOpenChange={onLeftSideBarOpenChange}>
              <SheetTrigger
                className="theme-header-button"
                aria-label="Open player menu"
              >
                <Menu aria-hidden="true" />
              </SheetTrigger>
              <SheetContent
                side="left"
                className="theme-drawer"
                data-reading-surface
                onInteractOutside={keepSheetOpenForClerk}
              >
                <SheetHeader className="text-left">
                  <SheetTitle>Player menu</SheetTitle>
                </SheetHeader>
                <MobileSidebarStack
                  isCombat={pathname === "/combat"}
                  leftSideBar={leftSideBar}
                  mainMenu={leftSideBarMainMenu}
                />
              </SheetContent>
            </Sheet>
            {showMobileNotifications && (
              <MobileNotificationsPopover
                notifications={shownNotifications}
                variant={props.variant}
              />
            )}
          </div>
          <Link
            href="/profile"
            className="theme-logo"
            aria-label="The Ninja RPG profile"
          >
            <Image
              id="tutorial-logo"
              src={IMG_LOGO_SHORT}
              alt="The Ninja RPG"
              width={250}
              height={63}
            />
          </Link>
          <div className="theme-account-controls">
            {signedInIcons}
            {props.variant === "20-eclipse-observatory" && (
              <div className="theme-world-access">
                <LowerRightHelpBtn className="theme-header-button">
                  <MessageCircle aria-hidden="true" />
                </LowerRightHelpBtn>
              </div>
            )}
          </div>
          <div className="theme-world-access">
            <Sheet
              open={rightSideBarOpen}
              onOpenChange={onRightSideBarOpenChange}
              modal={!isGuidedTutorial}
            >
              <SheetTrigger
                className="theme-header-button"
                aria-label="Open game menu"
                id="tutorial-gameBtn"
              >
                <Compass aria-hidden="true" />
              </SheetTrigger>
              <SheetContent
                className="theme-drawer"
                data-reading-surface
                onInteractOutside={(event) => {
                  // Lemu's controls live above the drawer. Keep them accessible
                  // and let the tutorial decide when navigation closes the menu.
                  if (isGuidedTutorial || isClerkElement(event.target))
                    event.preventDefault();
                }}
              >
                <SheetHeader className="text-left">
                  <SheetTitle>Game menu</SheetTitle>
                </SheetHeader>
                <Suspense fallback={<Loader explanation="Loading game menu" />}>
                  {/* The Sheet supplies keyboard dismissal; delegated clicks close it after navigation. */}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: Sheet owns keyboard interaction. */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated navigation dismissal. */}
                  <div ref={rightSideBarRef} onClick={handleRightSidebarClick}>
                    {rightSideBar}
                  </div>
                </Suspense>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <nav
          className="theme-primary-nav"
          aria-label="Community and resources"
          data-compact-hide
        >
          {navbarMenuItems.map((link) => (
            <Link key={link.name} href={link.href}>
              {link.icon}
              <span>{link.name}</span>
              {(link.notificationCount ?? 0) > 0 && (
                <span className="theme-count">
                  {link.notificationCount}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          ))}
          <LowerRightHelpBtn className="theme-help">
            <MessageCircle aria-hidden="true" />
            <span>Chat</span>
          </LowerRightHelpBtn>
        </nav>

        <aside
          className="theme-player theme-side-panel"
          aria-label="Player status"
          data-reading-surface
        >
          {leftSideBar}
        </aside>
        <main
          id="game-content"
          tabIndex={-1}
          className="theme-main"
          data-reading-surface
          data-compact-content
        >
          {children}
        </main>
        <aside
          className="theme-world theme-side-panel"
          aria-label="World and activity"
          data-reading-surface
        >
          {rightSideBar}
        </aside>
        <footer className="theme-footer">
          <Footer />
        </footer>
      </div>
      {userData && (
        <MobileGameNav
          mobileNavConfig={mobileNavConfig}
          location={location}
          yellowButtonClassName={variantClasses.yellowButton}
          mobileNavbarButtonClassName={variantClasses.mobileNavbarButton}
          className="theme-mobile-nav"
        />
      )}
    </div>
  );
}
