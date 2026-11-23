"use client";

import {
  Map as MapIcon,
  MessageCircle,
  PanelLeftOpen,
  PanelRightOpen,
} from "lucide-react";
import { Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActivityDock } from "@/hooks/useActivityDock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ActivityDockButton } from "@/layout/ActivityDockButton";
import {
  ContentBoxPriorityActions,
  type HeaderActionItem,
} from "@/layout/ContentBoxHeaderActions";
import Footer from "@/layout/Footer";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import { usePublicPathname } from "@/utils/routing";
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
  const hasDesktopMenus = useMediaQuery(SIDEBAR_COLUMNS_SHOWN_QUERY);
  const { swapSides } = useActivityDock();
  const isMapPage = !!userData && ["/travel", "/bank", "/itemshop"].includes(pathname);
  const isGuidedTutorial = isTutorialActive(userData);

  const headerItems: HeaderActionItem[] = hasDesktopMenus
    ? [
        {
          key: "activity",
          pinned: "start",
          priority: 0,
          node: <ActivityDockButton className="experimental-tool" />,
        },
      ]
    : [
        {
          key: "player-menu",
          pinned: "start",
          node: (
            <Sheet open={leftSideBarOpen} onOpenChange={onLeftSideBarOpenChange}>
              <SheetTrigger
                className="experimental-tool md:hidden"
                aria-label="Open player menu"
                data-experimental-travel-link={isMapPage || undefined}
              >
                <PanelLeftOpen aria-hidden="true" />
                <span className="sr-only">Player</span>
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
          ),
          priority: 0,
        },
        {
          key: "game-menu",
          pinned: "end",
          node: (
            <Sheet
              open={rightSideBarOpen}
              onOpenChange={onRightSideBarOpenChange}
              modal={!isGuidedTutorial}
            >
              <SheetTrigger
                className="experimental-tool md:hidden"
                aria-label="Open game menu"
                id="tutorial-gameBtn"
              >
                <PanelRightOpen aria-hidden="true" />
                <span className="sr-only">Game menu</span>
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
          ),
          priority: 0,
        },
      ];

  return (
    <div
      data-world-page
      className={cn("experimental-game", isMapPage && "experimental-game-map")}
    >
      <a href="#game-content" className="theme-skip-link">
        Skip to game content
      </a>
      {!isMapPage && (
        <header className="experimental-header">
          <ContentBoxPriorityActions
            items={[
              ...headerItems,
              {
                key: "travel-home",
                node: (
                  <Link
                    href="/travel"
                    data-experimental-travel-link
                    className="experimental-tool"
                    aria-label="Travel"
                  >
                    <MapIcon aria-hidden="true" />
                  </Link>
                ),
                priority: 0,
              },
            ]}
            label="Game"
          />
        </header>
      )}

      {hasDesktopMenus && (
        <>
          <aside
            className="experimental-desktop-menu experimental-player-menu"
            aria-label="Player menu"
            data-reading-surface
          >
            <MobileSidebarStack
              isCombat={isCombatPage}
              leftSideBar={leftSideBar}
              mainMenu={leftSideBarMainMenu}
            />
            <Footer />
          </aside>
          <aside
            className="experimental-desktop-menu experimental-world-menu"
            aria-label="Game menu"
            data-reading-surface
          >
            <Suspense fallback={<Loader explanation="Loading game menu" />}>
              <div ref={rightSideBarRef}>{rightSideBar}</div>
            </Suspense>
          </aside>
        </>
      )}
      <main
        id="game-content"
        tabIndex={-1}
        className={isMapPage ? "experimental-map-main" : "experimental-page"}
        data-reading-surface={!isMapPage || undefined}
      >
        {isMapPage ? (
          <ExperimentalTravelHost
            isGuidedTutorial={isGuidedTutorial}
            headerItems={headerItems}
          >
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
        />
      )}
    </div>
  );
}

/** Load the experimental frame only for an explicit layout selection. */
export const ExperimentalGame = (props: GameFrameProps) => (
  <GameLayout renderer={ExperimentalGameLayout} {...props} />
);
