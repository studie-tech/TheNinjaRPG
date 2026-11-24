"use client";

import {
  Globe,
  MapPinSearch,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActivityDock } from "@/hooks/useActivityDock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import Footer from "@/layout/Footer";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import { TravelNavigationContext } from "@/screens/travel/TravelNavigationContext";
import { usePublicPathname } from "@/utils/routing";
import { ExperimentalPlayerStatus } from "./ExperimentalPlayerStatus";
import { ExperimentalTravelHost } from "./ExperimentalTravelHost";
import { type GameFrameProps, GameLayout } from "./GameLayout";
import { CHAT_BUTTON_LAYER, MobileSidebarStack } from "./shared/LayoutChrome";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import {
  isClerkElement,
  keepSheetOpenForClerk,
  SIDEBAR_COLUMNS_SHOWN_QUERY,
} from "./shared/layoutUtils";
import { MobileGameNav } from "./shared/MobileGameNav";
import { TravelCompass } from "./shared/TravelCompass";
import "../../styles/layout-experimental.css";

/** A compact frame that gives travel the viewport and keeps other pages reachable. */
export function ExperimentalGameLayout(props: GameLayoutRenderProps) {
  const {
    children,
    gameMenuNotificationCount,
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
    mobileNavConfig,
    location,
    variantClasses,
    userData,
  } = props;

  const pathname = usePublicPathname();
  const isDesktop = useMediaQuery(SIDEBAR_COLUMNS_SHOWN_QUERY);
  const { swapSides } = useActivityDock();
  const isMapPage = !!userData && ["/travel", "/bank", "/itemshop"].includes(pathname);
  const isGuidedTutorial = isTutorialActive(userData);
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const [viewTarget, setViewTarget] = useState<HTMLDivElement | null>(null);
  const travelNavigation = useMemo(
    () => ({ controls: controlsTarget, view: viewTarget }),
    [controlsTarget, viewTarget],
  );

  const playerMenu = (
    <Sheet
      open={leftSideBarOpen}
      onOpenChange={onLeftSideBarOpenChange}
      modal={!isDesktop}
    >
      <SheetTrigger
        className="experimental-tool experimental-sidebar-toggle"
        hidden={leftSideBarOpen}
        aria-label="Open player menu"
        data-experimental-travel-link={isMapPage || undefined}
      >
        <PanelLeftOpen aria-hidden="true" />
        <span className="sr-only">Player</span>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="experimental-drawer"
        showCloseButton={false}
        data-experimental-sidebar="player"
        data-reading-surface
        onInteractOutside={(event) => {
          if (isDesktop) event.preventDefault();
          else keepSheetOpenForClerk(event);
        }}
      >
        <SheetHeader className="experimental-drawer-header flex-row items-center space-y-0 text-left">
          <SheetClose
            className="experimental-drawer-close"
            aria-label="Close player menu"
          >
            <PanelLeftClose aria-hidden="true" />
          </SheetClose>
          <SheetTitle>Player menu</SheetTitle>
        </SheetHeader>
        <MobileSidebarStack
          isCombat={isCombatPage}
          leftSideBar={leftSideBar}
          mainMenu={leftSideBarMainMenu}
        />
        <Footer compact />
      </SheetContent>
    </Sheet>
  );
  const gameMenu = (
    <Sheet
      open={rightSideBarOpen}
      onOpenChange={onRightSideBarOpenChange}
      modal={!isDesktop && !isGuidedTutorial}
    >
      <SheetTrigger
        className="experimental-tool experimental-sidebar-toggle relative"
        hidden={rightSideBarOpen}
        aria-label={
          gameMenuNotificationCount > 0
            ? `Open game menu (${gameMenuNotificationCount} ${gameMenuNotificationCount === 1 ? "notification" : "notifications"})`
            : "Open game menu"
        }
        id="tutorial-gameBtn"
      >
        <PanelRightOpen aria-hidden="true" />
        <span className="sr-only">Game menu</span>
        {gameMenuNotificationCount > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] leading-none font-bold text-white shadow-md shadow-black/40"
          >
            {gameMenuNotificationCount > 99 ? "99+" : gameMenuNotificationCount}
          </span>
        )}
      </SheetTrigger>
      <SheetContent
        className="experimental-drawer"
        showCloseButton={false}
        data-experimental-sidebar="game"
        data-reading-surface
        onInteractOutside={(event) => {
          if (isDesktop || isGuidedTutorial || isClerkElement(event.target))
            event.preventDefault();
        }}
      >
        <SheetHeader className="experimental-drawer-header flex-row-reverse items-center space-y-0 text-right">
          <SheetClose
            className="experimental-drawer-close"
            aria-label="Close game menu"
          >
            <PanelRightClose aria-hidden="true" />
          </SheetClose>
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
  );

  return (
    <TravelNavigationContext value={travelNavigation}>
      <div
        data-world-page
        className={cn("experimental-game", isMapPage && "experimental-game-map")}
      >
        <a href="#game-content" className="theme-skip-link">
          Skip to game content
        </a>
        <header className="experimental-header">
          {userData && <ExperimentalPlayerStatus hasLocation={!!location} />}
        </header>
        <div className="experimental-sidebar-controls">
          <div>{playerMenu}</div>
          <div>{gameMenu}</div>
        </div>

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
        <div
          className={cn(
            "experimental-chat-launcher",
            CHAT_BUTTON_LAYER,
            swapSides ? "left-4 md:left-5" : "right-4 md:right-5",
          )}
        >
          <LowerRightHelpBtn className="experimental-tool bg-background rounded-full border shadow-md">
            <MessageCircle aria-hidden="true" />
            <span className="sr-only">Chat</span>
          </LowerRightHelpBtn>
        </div>
        {userData && (
          <MobileGameNav
            mobileNavConfig={mobileNavConfig}
            location={location}
            yellowButtonClassName={variantClasses.yellowButton}
            mobileNavbarButtonClassName={variantClasses.mobileNavbarButton}
            className="experimental-mobile-nav"
            centerControl={location ? undefined : <TravelCompass />}
            travelControls={{
              menu: (
                <div ref={setControlsTarget} className="experimental-nav-map-controls">
                  {!isMapPage && (
                    <Link
                      href="/travel?controls=open"
                      aria-label="Map controls"
                      title="Map controls"
                      className="experimental-nav-control"
                    >
                      <MapPinSearch aria-hidden />
                    </Link>
                  )}
                </div>
              ),
              view: (
                <div ref={setViewTarget} className="experimental-nav-view">
                  {!isMapPage && (
                    <Link
                      href="/travel?view=global"
                      aria-label="Show global map"
                      title="Show global map"
                      className="experimental-nav-control"
                    >
                      <Globe aria-hidden />
                    </Link>
                  )}
                </div>
              ),
            }}
          />
        )}
      </div>
    </TravelNavigationContext>
  );
}

/** Load the experimental frame only for an explicit layout selection. */
export const ExperimentalGame = (props: GameFrameProps) => (
  <GameLayout renderer={ExperimentalGameLayout} {...props} />
);
