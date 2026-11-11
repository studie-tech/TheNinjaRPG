"use client";

import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Earth, House, MessageCircle } from "lucide-react";
import type React from "react";
import PixelPublicHeader from "@/components/layout/PixelPublicHeader";
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
import { LayoutBackground } from "./shared/LayoutBackground";
import {
  FloatingHelpButton,
  MobileSidebarStack,
  RightSheetBody,
} from "./shared/LayoutChrome";
import { MobileNotificationsPopover } from "./shared/LayoutNotifications";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import { keepSheetOpenForClerk } from "./shared/layoutUtils";
import {
  ANONYMOUS_PIXEL_NAV_LINKS,
  PIXEL_MOBILE_HEADER_BUTTON_STYLE,
  PIXEL_MOBILE_HEADER_ICON_STYLE,
  PIXEL_SIGNED_IN_SHELL_SURFACE,
} from "./shared/layoutVariants";
import { MobileGameNav } from "./shared/MobileGameNav";

export const PixelGameLayout: React.FC<GameLayoutRenderProps> = ({
  children,
  userData,
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
  variantClasses,
  showMobileNotifications,
}) => {
  const { swapSides } = useActivityDock();
  const isAnonymousLayout = !isSignedInLayout;
  return (
    <div
      data-world-page
      className="tnr-pixel-game absolute top-0 bottom-0 w-full md:relative"
      data-layout-variant="pixel"
    >
      {(userData || isAnonymousLayout) && (
        <FloatingHelpButton
          hasCharacter={!!userData}
          swapSides={swapSides}
          iconClassName={variantClasses.yellowButton}
        />
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
                "relative top-2 left-[50%] z-40 hidden w-[calc(100%-16px)] translate-x-[-50%] items-center justify-between px-4 py-2 font-bold text-slate-100 text-sm md:flex",
                "max-w-[1440px]",
                PIXEL_SIGNED_IN_SHELL_SURFACE,
              )}
            >
              <Link
                href="/profile"
                className="flex items-center"
                aria-label="The Ninja RPG profile"
              >
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
              <div className="grid min-w-0 flex-1 grid-cols-5 items-center gap-1 px-4 uppercase tracking-[0.08em]">
                {navbarMenuItems.map((link) => {
                  const count = link.notificationCount ?? 0;
                  return (
                    <Link
                      key={link.name}
                      className="relative z-10 flex flex-row items-center justify-center gap-1 px-2 py-2 hover:text-amber-300"
                      href={link.href}
                    >
                      <span className="relative flex min-w-0 items-center gap-1">
                        {link.icon}
                        <span className="truncate">{link.name}</span>
                        {count > 0 && (
                          <span className="absolute -top-2 -right-3 z-50 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-orange-100 text-xs">
                            {count}
                          </span>
                        )}
                      </span>
                      {count > 0 && (
                        <span className="sr-only">{count} unread notifications</span>
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
                  <Sheet open={leftSideBarOpen} onOpenChange={onLeftSideBarOpenChange}>
                    <SheetTrigger
                      className={PIXEL_MOBILE_HEADER_BUTTON_STYLE}
                      aria-label="Open player menu"
                    >
                      <House className={PIXEL_MOBILE_HEADER_ICON_STYLE} />
                    </SheetTrigger>
                    <SheetContent
                      data-reading-surface
                      side="left"
                      className="w-[min(88vw,360px)] border-sky-200/20 bg-slate-950/95 p-4 text-slate-50 backdrop-blur-md"
                      onInteractOutside={keepSheetOpenForClerk}
                    >
                      <SheetHeader className="space-y-0 text-left">
                        <VisuallyHidden.Root>
                          <SheetTitle>Player menu</SheetTitle>
                        </VisuallyHidden.Root>
                        <MobileSidebarStack
                          isCombat={pathname === "/combat"}
                          leftSideBar={leftSideBar}
                          mainMenu={leftSideBarMainMenu}
                        />
                      </SheetHeader>
                    </SheetContent>
                  </Sheet>
                  {showMobileNotifications && (
                    <MobileNotificationsPopover
                      notifications={shownNotifications}
                      variant="pixel"
                    />
                  )}
                </div>
                <Link
                  href="/profile"
                  className="absolute left-1/2 min-w-0 -translate-x-1/2"
                  aria-label="The Ninja RPG profile"
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
                      <MessageCircle className={PIXEL_MOBILE_HEADER_ICON_STYLE} />
                    </span>
                  </LowerRightHelpBtn>
                  <Sheet
                    open={rightSideBarOpen}
                    onOpenChange={onRightSideBarOpenChange}
                  >
                    <SheetTrigger
                      className={PIXEL_MOBILE_HEADER_BUTTON_STYLE}
                      aria-label="Open game menu"
                      id="tutorial-gameBtn"
                    >
                      <Earth className={PIXEL_MOBILE_HEADER_ICON_STYLE} />
                    </SheetTrigger>
                    <SheetContent
                      data-reading-surface
                      className="w-[min(88vw,360px)] border-sky-200/20 bg-slate-950/95 p-4 text-slate-50 backdrop-blur-md"
                      onInteractOutside={keepSheetOpenForClerk}
                    >
                      <VisuallyHidden.Root>
                        <SheetTitle>Game menu</SheetTitle>
                      </VisuallyHidden.Root>
                      <RightSheetBody
                        headerClassName="space-y-0 text-left"
                        sidebarRef={rightSideBarRef}
                        onClick={handleRightSidebarClick}
                      >
                        {rightSideBar}
                      </RightSheetBody>
                    </SheetContent>
                  </Sheet>
                </div>
              </div>
            </div>
          )}
        </div>
        <div
          className={cn(
            "relative z-10 flex h-full flex-row",
            isSignedInLayout
              ? "tnr-pixel-mobile-signed-content-row top-[70px] mx-auto mt-6 w-[calc(100%-16px)] max-w-[1440px] items-start gap-0 md:top-0 md:gap-2"
              : shownNotifications.length > 0 && pathname !== "/combat"
                ? "top-[100px]"
                : "top-[70px]",
          )}
          data-sidebar-row
        >
          {isSignedInLayout && (
            <div className="relative hidden w-[200px] shrink-0 md:block lg:w-[250px]">
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
          )}
          <div
            className={cn(
              "flex w-full min-w-0 flex-1 flex-col",
              isSignedInLayout && "px-3 pt-5 pb-3",
              isSignedInLayout && PIXEL_SIGNED_IN_SHELL_SURFACE,
            )}
          >
            <div
              className={cn(
                "flex min-h-0 flex-row md:min-h-0",
                isSignedInLayout
                  ? "w-full flex-1"
                  : "mx-auto w-[calc(100%-32px)] max-w-[1180px]",
              )}
            >
              <div
                data-reading-surface
                className={cn(
                  "flex min-h-[200px] w-full grow flex-col",
                  isAnonymousLayout
                    ? "overflow-x-visible border border-sky-200/15 bg-slate-950/70 text-slate-50 shadow-2xl shadow-black/30 backdrop-blur-md"
                    : "overflow-x-auto bg-transparent text-slate-50",
                )}
              >
                <div
                  className={
                    // The footer bar below sits in normal flow under this wrapper, so it
                    // starts wherever first paint ends -- often a short spinner -- and
                    // travels down as the page loads. On desktop that growth is also when
                    // the document first overflows: the scrollbar styled in globals.css
                    // takes its width and the centred layout shifts sideways. One viewport
                    // of minimum height keeps the bar below the fold, where its movement
                    // cannot register as a shift, and the scrollbar present from first paint.
                    // Phones also leave room to scroll content clear of an open lesson.
                    isSignedInLayout
                      ? "min-h-svh p-0 pb-[calc(7rem+var(--activity-dock-space,0px))] md:pb-8"
                      : "p-5 pb-8 md:p-7"
                  }
                >
                  {children}
                </div>
              </div>
            </div>
            <div
              className={cn(
                "flex flex-col",
                isSignedInLayout
                  ? "relative bottom-0 -mx-3 mt-4 -mb-3 h-auto max-h-none w-[calc(100%+1.5rem)] pb-28 md:relative md:pb-0"
                  : "fixed right-0 bottom-0 left-0 z-30 mx-auto h-auto max-h-none w-[calc(100%-32px)] max-w-[1180px] pb-[calc(env(safe-area-inset-bottom)+1rem)] md:relative md:right-auto md:bottom-auto md:left-auto md:z-auto md:mt-6 md:pb-6",
              )}
            >
              <div
                className={cn(
                  "relative top-auto right-auto left-auto block md:block",
                  isSignedInLayout
                    ? "w-full border-sky-200/15 border-t bg-slate-950/72 px-4 py-4 text-slate-200 backdrop-blur-md"
                    : "rounded-md border border-sky-200/15 bg-slate-950/70 px-4 py-3 text-slate-200 backdrop-blur-md",
                )}
              >
                <Footer />
              </div>
            </div>
          </div>
          {isSignedInLayout && (
            <div className="relative hidden w-[200px] shrink-0 md:block lg:w-[250px]">
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
