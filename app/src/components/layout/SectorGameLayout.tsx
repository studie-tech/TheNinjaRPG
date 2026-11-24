"use client";

import {
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
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import { TravelNavigationContext } from "@/screens/travel/TravelNavigationContext";
import { type GameFrameProps, GameLayout } from "./GameLayout";
import { SectorPlayerStatus } from "./SectorPlayerStatus";
import { SectorTravelHost } from "./SectorTravelHost";
import { CHAT_BUTTON_LAYER, MobileSidebarStack } from "./shared/LayoutChrome";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import {
  isClerkElement,
  keepSheetOpenForClerk,
  SIDEBAR_COLUMNS_SHOWN_QUERY,
} from "./shared/layoutUtils";
import { MobileGameNav } from "./shared/MobileGameNav";
import { TravelCompass } from "./shared/TravelCompass";
import "../../styles/layout-sector.css";

/** Keep the sector behind route-backed screens, with shared player and game controls. */
export function SectorGameLayout(props: GameLayoutRenderProps) {
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

  const isDesktop = useMediaQuery(SIDEBAR_COLUMNS_SHOWN_QUERY);
  const { swapSides } = useActivityDock();
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
        className="sector-tool sector-sidebar-toggle"
        hidden={leftSideBarOpen}
        aria-label="Open player menu"
        title="Player menu"
        data-sector-travel-link
      >
        <PanelLeftOpen aria-hidden="true" />
        <span className="sector-menu-label">Player</span>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="sector-drawer"
        showCloseButton={false}
        data-sector-sidebar="player"
        data-reading-surface
        onInteractOutside={(event) => {
          if (isDesktop) event.preventDefault();
          else keepSheetOpenForClerk(event);
        }}
      >
        <SheetHeader className="sector-drawer-header flex-row items-center space-y-0 text-left">
          <SheetClose className="sector-drawer-close" aria-label="Close player menu">
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
        className="sector-tool sector-sidebar-toggle relative"
        hidden={rightSideBarOpen}
        aria-label={
          gameMenuNotificationCount > 0
            ? `Open game menu (${gameMenuNotificationCount} ${gameMenuNotificationCount === 1 ? "notification" : "notifications"})`
            : "Open game menu"
        }
        title="Game menu"
        id="tutorial-gameBtn"
      >
        <PanelRightOpen aria-hidden="true" />
        <span className="sector-menu-label">Game</span>
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
        className="sector-drawer"
        showCloseButton={false}
        data-sector-sidebar="game"
        data-reading-surface
        onInteractOutside={(event) => {
          if (isDesktop || isGuidedTutorial || isClerkElement(event.target))
            event.preventDefault();
        }}
      >
        <SheetHeader className="sector-drawer-header flex-row-reverse items-center space-y-0 text-right">
          <SheetClose className="sector-drawer-close" aria-label="Close game menu">
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
        className="sector-game sector-game-map"
        data-player-menu-open={leftSideBarOpen || undefined}
        data-game-menu-open={rightSideBarOpen || undefined}
      >
        <a href="#game-content" className="theme-skip-link">
          Skip to game content
        </a>
        <header className="sector-header">
          <div className="sector-header-menu" hidden={leftSideBarOpen}>
            {playerMenu}
          </div>
          {userData && <SectorPlayerStatus hasLocation={!!location} />}
          <div className="sector-header-menu" hidden={rightSideBarOpen}>
            {gameMenu}
          </div>
        </header>

        <main id="game-content" tabIndex={-1} className="sector-map-main">
          <SectorTravelHost isGuidedTutorial={isGuidedTutorial}>
            {children}
          </SectorTravelHost>
        </main>
        <div
          className={cn(
            "sector-chat-launcher",
            CHAT_BUTTON_LAYER,
            swapSides ? "left-4 md:left-5" : "right-4 md:right-5",
          )}
        >
          <LowerRightHelpBtn className="sector-tool bg-background rounded-full border shadow-md">
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
            className="sector-mobile-nav"
            centerControl={location ? undefined : <TravelCompass />}
            travelControls={{
              menu: <div ref={setControlsTarget} className="sector-nav-map-controls" />,
              view: <div ref={setViewTarget} className="sector-nav-view" />,
            }}
          />
        )}
      </div>
    </TravelNavigationContext>
  );
}

/** Load the sector frame only for an explicit layout selection. */
export const SectorGame = (props: GameFrameProps) => (
  <GameLayout renderer={SectorGameLayout} {...props} />
);
