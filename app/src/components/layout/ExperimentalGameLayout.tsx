"use client";

import { Compass, Map as MapIcon, Menu, MessageCircle, Settings } from "lucide-react";
import { Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import Footer from "@/layout/Footer";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import { usePublicPathname } from "@/utils/routing";
import { ExperimentalTravelHost } from "./ExperimentalTravelHost";
import { type GameFrameProps, GameLayout } from "./GameLayout";
import { MobileSidebarStack } from "./shared/LayoutChrome";
import { MobileNotificationsPopover } from "./shared/LayoutNotifications";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import { isClerkElement, keepSheetOpenForClerk } from "./shared/layoutUtils";
import "../../styles/layout-experimental.css";

/** A compact frame that gives travel the viewport and keeps other pages reachable. */
export function ExperimentalGameLayout(props: GameLayoutRenderProps) {
  const {
    children,
    handleRightSidebarClick,
    isCombatPage,
    leftSideBar,
    leftSideBarMainMenu,
    leftSideBarOpen,
    onLeftSideBarOpenChange,
    onRightSideBarOpenChange,
    rightSideBar,
    rightSideBarOpen,
    rightSideBarRef,
    shownNotifications,
    signedInIcons,
    userData,
    variant,
  } = props;

  const pathname = usePublicPathname();
  const isMapPage = !!userData && ["/travel", "/bank", "/itemshop"].includes(pathname);
  const isGuidedTutorial = isTutorialActive(userData);

  return (
    <div
      data-world-page
      className={cn("experimental-game", isMapPage && "experimental-game-map")}
    >
      <a href="#game-content" className="theme-skip-link">
        Skip to game content
      </a>
      <header className="experimental-header">
        <Sheet open={leftSideBarOpen} onOpenChange={onLeftSideBarOpenChange}>
          <SheetTrigger className="experimental-tool" aria-label="Open player menu">
            <Menu aria-hidden="true" />
            <span className="hidden sm:inline">Player</span>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="experimental-drawer"
            data-reading-surface
            onInteractOutside={keepSheetOpenForClerk}
          >
            <SheetHeader>
              <SheetTitle>Player menu</SheetTitle>
            </SheetHeader>
            <MobileSidebarStack
              isCombat={isCombatPage}
              leftSideBar={leftSideBar}
              mainMenu={leftSideBarMainMenu}
            />
            <Footer />
          </SheetContent>
        </Sheet>
        <Link
          href="/travel"
          data-experimental-travel-link
          className="experimental-tool"
          aria-current={isMapPage ? "page" : undefined}
        >
          <MapIcon aria-hidden="true" />
          <span>Travel</span>
        </Link>
        <Sheet
          open={rightSideBarOpen}
          onOpenChange={onRightSideBarOpenChange}
          modal={!isGuidedTutorial}
        >
          <SheetTrigger
            className="experimental-tool"
            aria-label="Open game menu"
            id="tutorial-gameBtn"
          >
            <Compass aria-hidden="true" />
            <span className="hidden sm:inline">Game menu</span>
          </SheetTrigger>
          <SheetContent
            className="experimental-drawer"
            data-reading-surface
            onInteractOutside={(event) => {
              if (isGuidedTutorial || isClerkElement(event.target))
                event.preventDefault();
            }}
          >
            <SheetHeader>
              <SheetTitle>Game menu</SheetTitle>
            </SheetHeader>
            <Suspense fallback={<Loader explanation="Loading game menu" />}>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: Sheet owns keyboard interaction. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated navigation dismissal. */}
              <div ref={rightSideBarRef} onClick={handleRightSidebarClick}>
                {rightSideBar}
              </div>
            </Suspense>
          </SheetContent>
        </Sheet>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {!isCombatPage && (
            <MobileNotificationsPopover
              notifications={shownNotifications}
              variant={variant}
            />
          )}
          <LowerRightHelpBtn className="experimental-tool">
            <MessageCircle aria-hidden="true" />
            <span className="sr-only">Chat</span>
          </LowerRightHelpBtn>
          <Link
            href={SETTINGS_HREF}
            className="experimental-tool"
            aria-label="Settings"
          >
            <Settings aria-hidden="true" />
          </Link>
          <div className="hidden sm:flex">{signedInIcons}</div>
        </div>
      </header>
      <main
        id="game-content"
        tabIndex={-1}
        className={isMapPage ? "experimental-map-main" : "experimental-page"}
        data-reading-surface={!isMapPage || undefined}
      >
        {isMapPage ? (
          <ExperimentalTravelHost isGuidedTutorial={isGuidedTutorial}>
            {children}
          </ExperimentalTravelHost>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** Load the experimental frame only for an explicit layout selection. */
export const ExperimentalGame = (props: GameFrameProps) => (
  <GameLayout renderer={ExperimentalGameLayout} {...props} />
);
