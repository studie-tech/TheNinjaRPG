"use client";

import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  CircleHelp,
  Earth,
  Eye,
  EyeOff,
  House,
  LogIn,
  Menu,
  MessageCircleWarning,
  Music,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  IMG_LAYOUT_MOBILE_TOP,
  IMG_LAYOUT_SCROLLBOTTOM_DECOR,
  IMG_LAYOUT_SIDESCROLL,
  IMG_LAYOUT_SIDETOPBANNER_BOTTOM,
  IMG_LAYOUT_SIDETOPBANNER_CONTENT,
  IMG_LOGO_FULL,
  IMG_LOGO_SHORT,
} from "@/drizzle/constants";
import Footer from "@/layout/Footer";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";
import GameLayoutController from "./shared/GameLayoutController";
import { LayoutBackground } from "./shared/LayoutBackground";
import { MobileNotificationsPopover } from "./shared/LayoutNotifications";
import { StrongestUsersBanner } from "./shared/LayoutSidebars";
import type { GameLayoutRenderProps } from "./shared/layoutTypes";
import {
  forwardVerticalWheelToDocumentScroll,
  isClerkElement,
} from "./shared/layoutUtils";
import { MobileGameNav } from "./shared/MobileGameNav";

export { SideBannerTitle } from "./shared/LayoutSidebars";
export { getImageSet } from "./shared/layoutVariants";

export interface LayoutProps {
  children: React.ReactNode;
}

const BetaGameLayout: React.FC<GameLayoutRenderProps> = ({
  children,
  userData,
  isSignedInLayout,
  pathname,
  navbarMenuItemsLeft,
  navbarMenuItemsRight,
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
  lightLayout,
  toggleLightLayout,
  imageset,
  variantClasses,
  showMobileNotifications,
  mobileNotificationCount,
}) => {
  return (
    <div className="absolute top-0 bottom-0 w-full md:relative">
      <div className="fixed right-1 bottom-1 z-50 rounded-full bg-slate-500 md:right-5 md:bottom-5">
        <LowerRightHelpBtn className="hidden md:block">
          {userData ? (
            <MessageCircleWarning className={cn(variantClasses.yellowButton)} />
          ) : (
            <Music className={cn(variantClasses.yellowButton)} />
          )}
        </LowerRightHelpBtn>
      </div>
      <LayoutBackground variant="beta" userData={userData} />
      <div className="relative top-0 bottom-0 mr-auto ml-auto w-full max-w-[1280px] md:relative">
        <div className="relative top-3 z-2 z-50 flex w-full select-none justify-center">
          {!lightLayout && (
            <Link href="/">
              <Image
                className="hidden md:block"
                id="tutorial-logo"
                src={IMG_LOGO_FULL}
                width={384}
                height={138}
                alt="logo"
                loading="lazy"
              />
            </Link>
          )}
          <Link
            href="/"
            className="absolute top-0 left-1/2 block min-w-0 -translate-x-1/2 md:hidden"
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
          <button
            type="button"
            aria-label={lightLayout ? "Show Layout" : "Hide Layout"}
            onClick={toggleLightLayout}
            className="absolute top-0 right-2 hidden h-8 w-8 items-center justify-center rounded-full bg-slate-700/70 text-white hover:bg-slate-600 md:flex"
          >
            {lightLayout ? <Eye className="h-6 w-6" /> : <EyeOff className="h-6 w-6" />}
          </button>
        </div>
        {!lightLayout && (
          <div className="relative top-[-10px] left-[50%] z-1 hidden translate-x-[-50%] font-bold text-lg text-orange-100 md:block lg:text-2xl">
            <Image
              className="select-none"
              src={imageset.navbar}
              width={1280}
              height={133}
              alt="navbar"
              loading="lazy"
            />
            <div className="absolute top-6 grid w-1/2 grid-cols-3 px-24 lg:px-36">
              {navbarMenuItemsLeft.map((link) => {
                const count = link.notificationCount ?? 0;
                return (
                  <Link
                    key={link.name}
                    className="relative z-10 flex flex-row items-center justify-center gap-1 hover:cursor-pointer hover:text-orange-500"
                    href={link.href}
                    onClick={async () => {
                      if (link.onClick) {
                        await link.onClick();
                      }
                    }}
                    prefetch={false}
                  >
                    {link.icon}
                    {link.name}
                    {count > 0 && (
                      <div className="absolute top-0 right-2 z-50 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-orange-100 text-sm">
                        {count}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="absolute top-6 right-0 grid w-1/2 grid-cols-3 px-24 lg:px-36">
              {navbarMenuItemsRight.map((link) => (
                <Link
                  key={link.name}
                  className="z-10 flex flex-row items-center justify-center gap-1 hover:text-orange-500"
                  href={link.href}
                  onClick={async () => {
                    if (link.onClick) await link.onClick();
                  }}
                  prefetch={false}
                >
                  {link.icon}
                  {link.name}
                </Link>
              ))}
              {signedInIcons}
            </div>
          </div>
        )}
        <Image
          className="relative top-[-120px] left-[50%] z-10 hidden translate-x-[-50%] select-none md:block"
          src={imageset.handsign}
          width={127}
          height={112}
          alt="handsign"
          loading="lazy"
        />
        <div
          className="relative top-[70px] h-[15px] w-full shrink-0 bg-fill bg-repeat-x md:hidden"
          style={{ backgroundImage: `url(${IMG_LAYOUT_MOBILE_TOP})` }}
        ></div>
        <div className="relative top-[70px] z-10 flex h-full flex-row md:top-[-122px]">
          <div className="relative hidden w-[200px] shrink-0 md:block lg:w-[250px]">
            <div className="relative">
              <Image
                className="absolute left-0 -z-10 select-none"
                src={IMG_LAYOUT_SIDETOPBANNER_CONTENT}
                width={250}
                height={235}
                style={{ width: "100%", height: "100%" }}
                alt="leftbanner"
                loading="lazy"
              ></Image>
              <div className="z-10 pt-4 pr-4 pl-20 text-white">{leftSideBar}</div>
            </div>
            <Image
              className="relative left-0 select-none"
              src={IMG_LAYOUT_SIDETOPBANNER_BOTTOM}
              width={250}
              height={68}
              alt="leftbanner"
              loading="lazy"
            ></Image>
            <StrongestUsersBanner />
          </div>
          <div className="flex w-full min-w-0 flex-1 flex-col">
            <div className="flex min-h-screen w-full flex-row md:min-h-0">
              <div
                className="hidden w-12 shrink-0 bg-fill bg-repeat-y lg:block"
                style={{ backgroundImage: `url(${IMG_LAYOUT_SIDESCROLL})` }}
              ></div>
              <div
                className="flex min-h-[200px] w-full grow flex-col overflow-x-scroll bg-background"
                onWheel={forwardVerticalWheelToDocumentScroll}
              >
                <div className="p-3 pb-28 md:pb-3">{children}</div>
              </div>
              <div
                className="hidden w-12 shrink-0 bg-fill bg-repeat-y lg:block"
                style={{ backgroundImage: `url(${IMG_LAYOUT_SIDESCROLL})` }}
              ></div>
            </div>
            <div className="fixed bottom-0 flex h-20 max-h-28 w-full flex-col md:relative">
              <div className="absolute top-0 right-0 left-[-20px] -z-30 md:right-[-20px]">
                <div className="h-5 bg-linear-to-b from-rose-950 to-rose-800"></div>
                <div className="h-8 bg-rose-800"></div>
                <div className="h-7 bg-linear-to-b from-rose-800 to-rose-950"></div>
              </div>
              <Image
                className="absolute top-[-195px] left-[-120px] -z-20 hidden select-none md:block"
                src={IMG_LAYOUT_SCROLLBOTTOM_DECOR}
                width={143}
                height={272}
                alt="leftbottomdecor"
                loading="lazy"
              ></Image>
              <Image
                className="absolute top-[-195px] right-[-120px] -z-20 hidden scale-x-[-1] select-none md:block"
                src={IMG_LAYOUT_SCROLLBOTTOM_DECOR}
                width={143}
                height={272}
                alt="rightbottomdecor"
                loading="lazy"
              ></Image>
              <div className="absolute top-2 right-0 left-0 hidden md:block">
                <Footer />
              </div>
              {userData ? (
                <MobileGameNav
                  mobileNavConfig={mobileNavConfig}
                  location={location}
                  yellowButtonClassName={variantClasses.yellowButton}
                  mobileNavbarButtonClassName={variantClasses.mobileNavbarButton}
                  className="absolute top-0 right-0 bottom-0 left-0 md:hidden"
                />
              ) : (
                <div className="absolute top-4 right-0 left-0 block md:hidden">
                  <Footer />
                </div>
              )}
            </div>
          </div>
          <div className="relative hidden w-[200px] shrink-0 md:block lg:w-[250px]">
            <div className="relative">
              <Image
                className="absolute right-0 -z-10 scale-x-[-1] select-none"
                src={IMG_LAYOUT_SIDETOPBANNER_CONTENT}
                width={250}
                height={235}
                style={{ width: "100%", height: "100%" }}
                alt="rightbanner"
                loading="lazy"
              ></Image>
              <div className="p-2 pr-20 pl-4 text-white">{rightSideBar}</div>
            </div>
            <Image
              className="relative left-0 scale-x-[-1] select-none"
              src={IMG_LAYOUT_SIDETOPBANNER_BOTTOM}
              width={250}
              height={68}
              alt="leftbanner"
              loading="lazy"
            ></Image>
          </div>
        </div>
        <div className="absolute top-4 left-4 z-50 flex items-center gap-2 md:hidden">
          <Sheet open={leftSideBarOpen} onOpenChange={setLeftSideBarOpen}>
            <SheetTrigger className="block" aria-label="homeBtn">
              {userData ? (
                <House className={cn(variantClasses.yellowButton)} />
              ) : (
                <Menu className={cn(variantClasses.yellowButton)} />
              )}
            </SheetTrigger>
            <SheetContent
              side="left"
              onInteractOutside={(event) => {
                if (isClerkElement(event.target)) event.preventDefault();
              }}
            >
              <SheetHeader className="text-left">
                <VisuallyHidden.Root>
                  <SheetTitle>Main Menu</SheetTitle>
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
          {isSignedInLayout && showMobileNotifications && (
            <MobileNotificationsPopover
              notifications={shownNotifications}
              variant="beta"
              count={mobileNotificationCount}
            />
          )}
        </div>

        <div className="absolute top-4 right-4 block grid grid-cols-2 gap-2 md:hidden">
          <div className="flex justify-center">
            <LowerRightHelpBtn className="block md:hidden">
              {userData ? (
                <CircleHelp className={cn(variantClasses.yellowButton)} />
              ) : (
                <Music className={cn(variantClasses.yellowButton)} />
              )}
            </LowerRightHelpBtn>
          </div>
          <Sheet open={rightSideBarOpen} onOpenChange={setRightSideBarOpen}>
            <SheetTrigger aria-label="gameBtn" id="tutorial-gameBtn">
              {userData ? (
                <Earth className={cn(variantClasses.yellowButton)} />
              ) : (
                <LogIn className={cn(variantClasses.yellowButton)} />
              )}
            </SheetTrigger>
            <SheetContent
              onInteractOutside={(event) => {
                if (isClerkElement(event.target)) event.preventDefault();
              }}
            >
              <VisuallyHidden.Root>
                <SheetTitle>Game Menu</SheetTitle>
              </VisuallyHidden.Root>
              <Suspense fallback={<Loader explanation="Loading..." />}>
                <SheetHeader>
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
  );
};

const LayoutCore4Beta: React.FC<LayoutProps> = ({ children }) => {
  return (
    <GameLayoutController variant="beta" renderer={BetaGameLayout}>
      {children}
    </GameLayoutController>
  );
};

export default LayoutCore4Beta;
