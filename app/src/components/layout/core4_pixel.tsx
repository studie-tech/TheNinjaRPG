"use client";

import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { CircleHelp, Earth, House, MessageCircleWarning, Music } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { Suspense } from "react";
import PixelPublicHeader from "@/components/layout/PixelPublicHeader";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { IMG_LAYOUT_MOBILE_TOP, IMG_LOGO_SHORT } from "@/drizzle/constants";
import Footer from "@/layout/Footer";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import GameLayoutController from "./shared/GameLayoutController";
import { LayoutBackground } from "./shared/LayoutBackground";
import { MobileNotificationsPopover } from "./shared/LayoutNotifications";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import { forwardVerticalWheelToDocumentScroll } from "./shared/layoutUtils";
import {
  ANONYMOUS_PIXEL_NAV_LINKS,
  PIXEL_MOBILE_HEADER_BUTTON_STYLE,
  PIXEL_MOBILE_HEADER_ICON_STYLE,
  PIXEL_SIGNED_IN_SHELL_SURFACE,
} from "./shared/layoutVariants";
import { MobileGameNav } from "./shared/MobileGameNav";

const PixelGameLayout: React.FC<GameLayoutRenderProps> = ({
  children,
  userData,
  isSignedInLayout,
  isAnonymousLayout,
  pathname,
  navbarMenuItems,
  shownNotifications,
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
  variantClasses,
  showMobileNotifications,
  mobileNotificationCount,
}) => {
  return (
    <div
      className="tnr-pixel-game absolute top-0 bottom-0 w-full md:relative"
      data-layout-variant="pixel"
    >
      {(userData || isAnonymousLayout) && (
        <div className="fixed right-1 bottom-1 z-50 rounded-full bg-slate-500 md:right-5 md:bottom-5">
          <LowerRightHelpBtn className="hidden md:block">
            {userData ? (
              <MessageCircleWarning className={cn(variantClasses.yellowButton)} />
            ) : (
              <Music className={cn(variantClasses.yellowButton)} />
            )}
          </LowerRightHelpBtn>
        </div>
      )}
      <LayoutBackground
        variant="pixel"
        userData={userData}
        isAnonymousLayout={isAnonymousLayout}
      />
      <div
        className={cn(
          "relative top-0 bottom-0 mr-auto ml-auto w-full md:relative",
          isAnonymousLayout ? "max-w-none" : "max-w-[1440px]",
        )}
      >
        <div>
          {isAnonymousLayout && (
            <PixelPublicHeader showLogo navLinks={ANONYMOUS_PIXEL_NAV_LINKS} />
          )}
          {isSignedInLayout && (
            <div
              className={cn(
                "relative top-2 left-[50%] z-40 hidden w-[calc(100%-32px)] translate-x-[-50%] items-center justify-between px-4 py-2 font-bold text-slate-100 text-sm md:flex",
                "max-w-[1440px]",
                PIXEL_SIGNED_IN_SHELL_SURFACE,
              )}
            >
              <Link href="/" className="flex items-center">
                <Image
                  className="h-auto w-[180px]"
                  id="tutorial-logo"
                  src={IMG_LOGO_SHORT}
                  width={250}
                  height={63}
                  alt="logo"
                  loading="lazy"
                />
              </Link>
              <div className="grid min-w-0 flex-1 grid-cols-6 items-center gap-1 px-4 uppercase tracking-[0.08em]">
                {navbarMenuItems.map((link) => {
                  const count = link.notificationCount ?? 0;
                  return (
                    <Link
                      key={link.name}
                      className="relative z-10 flex flex-row items-center justify-center gap-1 px-2 py-2 hover:text-amber-300"
                      href={link.href}
                      onClick={async () => {
                        if (link.onClick) await link.onClick();
                      }}
                      prefetch={false}
                    >
                      {link.icon}
                      <span className="truncate">{link.name}</span>
                      {count > 0 && (
                        <div className="absolute top-0 right-0 z-50 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-orange-100 text-xs">
                          {count}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
              {signedInIcons}
            </div>
          )}
          {isSignedInLayout && (
            <div className="fixed inset-x-0 top-0 z-50 border-sky-200/15 border-b bg-black/55 shadow-2xl shadow-black/35 backdrop-blur-md md:hidden">
              <div className="relative mx-auto flex min-h-[72px] w-[calc(100%-24px)] items-center justify-between gap-3">
                <div className="z-10 flex shrink-0 justify-start gap-2">
                  <Sheet open={leftSideBarOpen} onOpenChange={setLeftSideBarOpen}>
                    <SheetTrigger
                      className={PIXEL_MOBILE_HEADER_BUTTON_STYLE}
                      aria-label="Open player menu"
                    >
                      <House className={PIXEL_MOBILE_HEADER_ICON_STYLE} />
                    </SheetTrigger>
                    <SheetContent
                      side="left"
                      className="w-[min(88vw,360px)] border-sky-200/20 bg-slate-950/95 p-4 text-slate-50 backdrop-blur-md"
                    >
                      <SheetHeader className="space-y-0 text-left">
                        <VisuallyHidden.Root>
                          <SheetTitle>Player menu</SheetTitle>
                        </VisuallyHidden.Root>
                        <Suspense fallback={<Loader explanation="Loading..." />}>
                          {pathname === "/combat" ? (
                            <>
                              <div className="relative pt-4">{leftSideBar}</div>
                              {leftSideBarMainMenu}
                            </>
                          ) : (
                            <>
                              {leftSideBarMainMenu}
                              <div className="relative pt-4">{leftSideBar}</div>
                            </>
                          )}
                        </Suspense>
                      </SheetHeader>
                    </SheetContent>
                  </Sheet>
                  {showMobileNotifications && (
                    <MobileNotificationsPopover
                      notifications={shownNotifications}
                      variant="pixel"
                      count={mobileNotificationCount}
                    />
                  )}
                </div>
                <Link
                  href="/"
                  className="absolute left-1/2 min-w-0 -translate-x-1/2"
                  aria-label="The Ninja RPG home"
                >
                  <Image
                    className="h-auto w-48 max-w-[48vw] sm:w-66 min-[420px]:w-60"
                    id="tutorial-logo-mobile"
                    src={IMG_LOGO_SHORT}
                    width={250}
                    height={63}
                    alt="logo"
                    loading="lazy"
                  />
                </Link>
                <div className="z-10 ml-auto flex shrink-0 items-center gap-2">
                  <LowerRightHelpBtn className="block">
                    <span className={PIXEL_MOBILE_HEADER_BUTTON_STYLE}>
                      <CircleHelp className={PIXEL_MOBILE_HEADER_ICON_STYLE} />
                    </span>
                  </LowerRightHelpBtn>
                  <Sheet open={rightSideBarOpen} onOpenChange={setRightSideBarOpen}>
                    <SheetTrigger
                      className={PIXEL_MOBILE_HEADER_BUTTON_STYLE}
                      aria-label="Open game menu"
                      id="tutorial-gameBtn"
                    >
                      <Earth className={PIXEL_MOBILE_HEADER_ICON_STYLE} />
                    </SheetTrigger>
                    <SheetContent className="w-[min(88vw,360px)] border-sky-200/20 bg-slate-950/95 p-4 text-slate-50 backdrop-blur-md">
                      <VisuallyHidden.Root>
                        <SheetTitle>Game menu</SheetTitle>
                      </VisuallyHidden.Root>
                      <Suspense fallback={<Loader explanation="Loading..." />}>
                        <SheetHeader className="space-y-0 text-left">
                          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Sheet panel - clicking outside content closes it, keyboard handled by Sheet component */}
                          {/* biome-ignore lint/a11y/noStaticElementInteractions: Sheet panel uses click to close when clicking non-interactive areas */}
                          <div ref={rightSideBarRef} onClick={handleRightSidebarClick}>
                            {rightSideBar}
                          </div>
                        </SheetHeader>
                      </Suspense>
                    </SheetContent>
                  </Sheet>
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          className={cn(
            "relative h-[15px] w-full shrink-0 bg-fill bg-repeat-x md:hidden",
            isAnonymousLayout && "hidden",
            isSignedInLayout && "hidden",
            shownNotifications &&
              shownNotifications.length > 0 &&
              pathname !== "/combat"
              ? "top-[100px]"
              : "top-[70px]",
          )}
          style={{ backgroundImage: `url(${IMG_LAYOUT_MOBILE_TOP})` }}
        ></div>
        <div
          className={cn(
            "relative z-10 flex h-full flex-row",
            isAnonymousLayout
              ? "top-24"
              : isSignedInLayout
                ? "tnr-pixel-mobile-signed-content-row top-[70px] mx-auto mt-6 w-[calc(100%-32px)] max-w-[1440px] items-start gap-4 md:top-0"
                : "md:top-6",
            !isSignedInLayout &&
              (shownNotifications &&
              shownNotifications.length > 0 &&
              pathname !== "/combat"
                ? "top-[100px]"
                : "top-[70px]"),
          )}
        >
          <div
            className={cn(
              "relative hidden shrink-0 md:block",
              isSignedInLayout ? "w-[220px] xl:w-[250px]" : "px-2",
              isAnonymousLayout && "hidden md:hidden",
            )}
          >
            <div className="relative">
              <div
                className={cn(
                  "tnr-pixel-side-panel z-10 p-4 text-white",
                  PIXEL_SIGNED_IN_SHELL_SURFACE,
                )}
              >
                {leftSideBar}
              </div>
            </div>
          </div>
          <div
            className={cn(
              "flex w-full min-w-0 flex-1 flex-col",
              isSignedInLayout && "px-3 pt-5 pb-3",
              isSignedInLayout && PIXEL_SIGNED_IN_SHELL_SURFACE,
            )}
          >
            <div
              className={cn(
                "flex min-h-screen w-full flex-row md:min-h-0",
                isSignedInLayout && "min-h-0 flex-1",
                isAnonymousLayout &&
                  "mx-auto min-h-0 w-[calc(100%-32px)] max-w-[1180px]",
              )}
            >
              <div
                className={cn(
                  "flex min-h-[200px] w-full grow flex-col overflow-x-scroll",
                  isAnonymousLayout
                    ? "overflow-x-visible border border-sky-200/15 bg-slate-950/70 text-slate-50 shadow-2xl shadow-black/30 backdrop-blur-md"
                    : "overflow-x-auto bg-transparent text-slate-50",
                )}
                onWheel={forwardVerticalWheelToDocumentScroll}
              >
                <div
                  className={cn(
                    "p-3 pb-28 md:pb-3",
                    isSignedInLayout && "p-0 pb-28 md:pb-8",
                    isAnonymousLayout && "p-5 pb-8 md:p-7",
                  )}
                >
                  {children}
                </div>
              </div>
            </div>
            <div
              className={cn(
                "fixed bottom-0 flex h-20 max-h-28 w-full flex-col md:relative",
                isSignedInLayout &&
                  "relative -mx-3 mt-4 -mb-3 h-auto max-h-none w-[calc(100%+1.5rem)] pb-28 md:pb-0",
                isAnonymousLayout &&
                  "fixed right-0 bottom-0 left-0 z-30 mx-auto h-auto max-h-none w-[calc(100%-32px)] max-w-[1180px] pb-[calc(env(safe-area-inset-bottom)+1rem)] md:relative md:right-auto md:bottom-auto md:left-auto md:z-auto md:mt-6 md:pb-6",
              )}
            >
              <div
                className={cn(
                  "absolute top-2 right-0 left-0 hidden md:block",
                  isSignedInLayout &&
                    "relative top-auto right-auto left-auto block w-full border-sky-200/15 border-t bg-slate-950/72 px-4 py-4 text-slate-200 backdrop-blur-md",
                  isAnonymousLayout &&
                    "relative top-auto right-auto left-auto block rounded-md border border-sky-200/15 bg-slate-950/70 px-4 py-3 text-slate-200 backdrop-blur-md",
                )}
              >
                <Footer />
              </div>
            </div>
          </div>
          {isSignedInLayout && (
            <div className="relative hidden w-[220px] shrink-0 md:block xl:w-[250px]">
              <div className="relative">
                <div
                  className={cn(
                    "tnr-pixel-side-panel p-4 text-white",
                    PIXEL_SIGNED_IN_SHELL_SURFACE,
                  )}
                >
                  {rightSideBar}
                </div>
              </div>
            </div>
          )}
        </div>
        {isSignedInLayout && userData && (
          <MobileGameNav
            mobileNavConfig={mobileNavConfig}
            location={location}
            yellowButtonClassName={variantClasses.yellowButton}
            mobileNavbarButtonClassName={variantClasses.mobileNavbarButton}
            className="fixed right-0 bottom-0 left-0 z-50 h-[calc(5rem+env(safe-area-inset-bottom))] border-sky-200/15 border-t bg-black/70 pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/50 backdrop-blur-md md:hidden"
          />
        )}
      </div>
    </div>
  );
};

export interface LayoutProps {
  children: React.ReactNode;
  initialIsSignedIn?: boolean;
}

const LayoutCore4Pixel: React.FC<LayoutProps> = ({ children, initialIsSignedIn }) => {
  return (
    <GameLayoutController
      variant="pixel"
      renderer={PixelGameLayout}
      initialIsSignedIn={initialIsSignedIn}
    >
      {children}
    </GameLayoutController>
  );
};

export default LayoutCore4Pixel;
