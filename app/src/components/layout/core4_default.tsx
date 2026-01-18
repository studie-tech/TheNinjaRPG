"use client";

import ReactDOM from "react-dom";
import { Suspense } from "react";
import Image from "@/layout/Image";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import MenuBoxCombat from "@/layout/MenuBoxCombat";
import Footer from "@/layout/Footer";
import Loader from "@/layout/Loader";
import AvatarImage from "@/layout/Avatar";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import {
  CircleUserRound,
  MessagesSquare,
  CircleHelp,
  Compass,
  LogIn,
  Menu,
  Cog,
  Milk,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Bell,
  Info,
  ShieldAlert,
  ShieldCheck,
  Eclipse,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Earth, House, MessageCircleWarning, Inbox } from "lucide-react";
import { Link2, Music } from "lucide-react";
import { useGameMenu, getMainNavbarLinks } from "@/libs/menus";
import { GameSettingsPopover, GlobalAudioProvider } from "@/layout/GameSettings";
import { useUserData } from "@/utils/UserContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetHeader,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SiGithub, SiDiscord } from "@icons-pack/react-simple-icons";
import { api } from "@/app/_trpc/client";
import { useUser } from "@clerk/nextjs";
import { groupBy } from "@/utils/grouping";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getCurrentSeason } from "@/utils/time";
import TutorialAssistant from "@/layout/TutorialAssistant";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import {
  IMG_WALLPAPER_WINTER,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_FALL,
  IMG_LOGO_FULL,
  IMG_LOGO_SHORT,
  IMG_ICON_DISCORD,
  IMG_ICON_FACEBOOK,
  IMG_ICON_GITHUB,
  IMG_ICON_GOOGLE,
  IMG_LAYOUT_NAVBAR,
  IMG_LAYOUT_MOBILE_TOP,
  IMG_LAYOUT_NAVBAR_HALLOWEEN,
  IMG_LAYOUT_HANDSIGN,
  IMG_LAYOUT_HANDSIGN_HALLOWEEN,
  IMG_LAYOUT_USERBANNER_MIDDLE,
  IMG_LAYOUT_SIDESCROLL,
  IMG_LAYOUT_SIDETOPBANNER_CONTENT,
  IMG_LAYOUT_SIDETOPBANNER_BOTTOM,
  IMG_LAYOUT_SCROLLBOTTOM_DECOR,
  IMG_LAYOUT_USERSBANNER_TOP,
  IMG_LAYOUT_USERSBANNER_BOTTOM,
  DISCORD_INVITE_URL,
} from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/routers/profile";
import { usePathname } from "next/navigation";
import { cn } from "src/libs/shadui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface LayoutProps {
  children: React.ReactNode;
}

const LayoutCore4: React.FC<LayoutProps> = (props) => {
  // Prefetching
  ReactDOM.prefetchDNS("https://o4507797256601600.ingest.de.sentry.io");
  ReactDOM.prefetchDNS("https://consentcdn.cookiebot.com");
  ReactDOM.prefetchDNS("https://region1.analytics.google.com");
  ReactDOM.prefetchDNS("https://connect.facebook.net");
  ReactDOM.prefetchDNS("https://api.github.com");

  // Get data
  const {
    data: userData,
    timeDiff,
    notifications,
    isClerkLoaded,
    updateUser,
  } = useUserData();
  const { systems, location } = useGameMenu(userData);
  const [leftSideBarOpen, setLeftSideBarOpen] = useState(false);
  const [rightSideBarOpen, setRightSideBarOpen] = useState(false);
  const rightSideBarRef = React.useRef<HTMLDivElement | null>(null);

  // State
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lightLayout, setLightLayout] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize state once mounted to avoid hydration mismatch
  useEffect(() => {
    // Theme
    const savedTheme = safeLocalStorageGetItem("theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
    // Layout
    const savedLayout = safeLocalStorageGetItem("lightLayout");
    if (savedLayout !== null) {
      setLightLayout(JSON.parse(savedLayout) as boolean);
    }
    setIsMounted(true);
  }, []);

  const toggleLightLayout = () => {
    setLightLayout((prev) => {
      const newState = !prev;
      safeLocalStorageSetItem("lightLayout", JSON.stringify(newState));
      return newState;
    });
  };

  const pathname = usePathname();

  // Derived data for layout
  const navbarMenuItems = getMainNavbarLinks(notifications);
  const shownNotifications = notifications?.filter(
    (n) =>
      n.color !== "toast" &&
      n.color !== "hidden" &&
      (n.alwaysShow || n.href !== pathname),
  );

  // Split menu into two parts
  const navbarMenuItemsLeft = navbarMenuItems.slice(0, 3);
  const navbarMenuItemsRight = navbarMenuItems.slice(3);

  // Set theme
  useEffect(() => {
    if (!isMounted) return;
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme, isMounted]);

  // Images - calculated based on season (UTC-consistent) and user's village
  const imageset = getImageSet(userData);

  /**
   * SIDEBAR: Left Side
   */
  const leftSideBar = (
    <div>
      <SignedIn>
        {userData && (
          <SideBannerTitle>
            <Link
              href={`/userid/${userData.userId}`}
              className="inline-block hover:text-orange-500 flex flex-row"
            >
              {userData.username} <Link2 className="inline-block h-5 w-5" />
            </Link>
          </SideBannerTitle>
        )}
        <MenuBoxProfile />
      </SignedIn>
      <SignedOut>
        <SideBannerTitle>Participate</SideBannerTitle>
        <div className="flex flex-row gap-4 pt-3">
          <Link
            href="https://github.com/studie-tech/TheNinjaRPG/issues"
            className="flex flex-col items-center font-bold hover:opacity-50"
          >
            <SiGithub
              size={60}
              className="dark:text-white text-black md:text-white p-2"
            />
          </Link>
          <Link
            href={DISCORD_INVITE_URL}
            className="flex flex-col items-center font-bold hover:opacity-50"
          >
            <SiDiscord
              size={60}
              className="dark:text-white text-black md:text-white p-2"
            />
          </Link>
        </div>
      </SignedOut>
      {!isClerkLoaded && (
        <div>
          <Skeleton className="h-6 w-full bg-muted/70 mt-6" />
          <div className="flex flex-row gap-4 pt-4">
            <Skeleton className="h-16 w-full bg-muted/70" />
            <Skeleton className="h-16 w-full bg-muted/70" />
          </div>
        </div>
      )}
    </div>
  );

  /**
   * SIDEBAR: Right Side
   */
  const rightSideBar = (
    <>
      <SignedIn>
        <RightSideBar
          notifications={shownNotifications}
          systems={systems}
          userData={userData}
          location={location}
          timeDiff={timeDiff}
        />
      </SignedIn>
      <SignedOut>
        <SideBannerTitle>Welcome</SideBannerTitle>
        <p className="hidden md:block text-orange-100 italic px-1">Socials Login</p>
        <p className="block md:hidden text-foreground italic px-1">Socials Login</p>
        <div className="grid grid-cols-4">
          <Image
            className="grayscale my-4 w-full"
            src={IMG_ICON_DISCORD}
            alt="DiscordProvider"
            width={50}
            height={50}
          ></Image>
          <Image
            className="grayscale my-4 w-full"
            src={IMG_ICON_FACEBOOK}
            alt="FacebookProvider"
            width={50}
            height={50}
          ></Image>
          <Image
            className="grayscale my-4 w-full"
            src={IMG_ICON_GOOGLE}
            alt="GoogleProvider"
            width={50}
            height={50}
          ></Image>
          <Image
            className="grayscale my-4 w-full"
            src={IMG_ICON_GITHUB}
            alt="GithubProvider"
            width={50}
            height={50}
          ></Image>
        </div>
        <Link href="/login" className="relative">
          <Button variant="default" size="sm" className="w-full" decoration="gold">
            Sign in
          </Button>
        </Link>
      </SignedOut>
      {!isClerkLoaded && (
        <div>
          <div className="flex flex-col gap-2 pt-5">
            <Skeleton className="h-6 w-3/4 bg-muted/70" />
            <Skeleton className="h-6 w-4/5 bg-muted/70" />
          </div>
          <div className="flex flex-row gap-2 pt-2">
            <Skeleton className="aspect-square w-full bg-muted/70" />
            <Skeleton className="aspect-square w-full bg-muted/70" />
            <Skeleton className="aspect-square w-full bg-muted/70" />
            <Skeleton className="aspect-square w-full bg-muted/70" />
          </div>
          <Skeleton className="h-8 w-full bg-muted/70 mt-3" />
        </div>
      )}

      <div className="pl-2 pt-6 flex align-center justify-center">
        <iframe
          src="https://ghbtns.com/github-btn.html?user=studie-tech&repo=TheNinjaRPG&type=star&count=true"
          width="90"
          height="20"
          title="GitHub"
        ></iframe>
      </div>
    </>
  );

  /**
   * Icons shown to logged in users in navbar
   */
  const signedInIcons = (
    <div className="flex flex-row items-center">
      <SignedIn>
        <UserButton
          appearance={{
            elements: { userButtonPopoverCard: { pointerEvents: "initial" } },
          }}
        />
      </SignedIn>
      <Link
        href="/event"
        onClick={() => setLeftSideBarOpen(false)}
        aria-label="Event Notifications"
      >
        <Bell className="h-6 w-6 xl:h-7 xl:w-7 hover:text-black hover:bg-blue-300 text-slate-700 bg-blue-100 bg-opacity-80 rounded-full mx-1 ml-2 p-1" />
      </Link>
      <GameSettingsPopover userData={userData} updateUser={updateUser} />
      <Eclipse
        className={`hover:cursor-pointer h-6 w-6 xl:h-7 xl:w-7 min-w-6 min-h-6 xl:min-w-7 xl:min-h-7 hover:text-black hover:bg-blue-300 text-slate-700 bg-blue-100 bg-opacity-80 rounded-full mx-1 p-1 bg-yellow-100 dark:bg-blue-100`}
        onClick={() => {
          if (!theme || theme === "light") {
            safeLocalStorageSetItem("theme", "dark");
            setTheme("dark");
          } else {
            safeLocalStorageSetItem("theme", "light");
            setTheme("light");
          }
        }}
      />
    </div>
  );

  /**
   * SIDEBAR: Left side main menu
   */
  const leftSideBarMainMenu = (
    <>
      <SideBannerTitle>Main Menu</SideBannerTitle>
      <div className="mt-1 grid gap-3 grid-cols-2">
        {navbarMenuItems.map((system, i) => {
          return (
            <Link
              key={i}
              href={system.href}
              onClick={() => setLeftSideBarOpen(false)}
              className={system.className ? system.className : ""}
            >
              <Button decoration="gold" className={`w-full hover:bg-orange-200`}>
                <div className="grow">{system.name}</div>
                <div>{system.icon && system.icon}</div>
              </Button>
            </Link>
          );
        })}
        <div className="flex flex-row items-center justify-center">{signedInIcons}</div>
      </div>
    </>
  );

  // Styling for yellow buttons
  const yellowButtonStyle =
    "h-14 w-14 sm:h-15 sm:w-15 md:h-16 md:w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-3 shadow-md shadow-black border-2 stroke-3";
  const mobileNavbarButtonStyle =
    "h-16 w-16  hover:text-red-300 transition-colors text-orange-100 bg-opacity-50 p-2";

  return (
    <GlobalAudioProvider userData={userData}>
      <TutorialAssistant
        rightSideBarOpen={rightSideBarOpen}
        setRightSideBarOpen={setRightSideBarOpen}
        rightSideBarRef={rightSideBarRef}
      />
      <div className="w-full absolute top-0 bottom-0 md:relative">
        <div className="fixed right-1 bottom-1 md:right-5 md:bottom-5 z-50 bg-slate-500 rounded-full">
          <LowerRightHelpBtn className="hidden md:block">
            {userData ? (
              <MessageCircleWarning className={cn(yellowButtonStyle)} />
            ) : (
              <Music className={cn(yellowButtonStyle)} />
            )}
          </LowerRightHelpBtn>
        </div>
        {/* WALLPAPER BACKGROUND */}
        <Image
          className="fixed md:top-0 md:left-0 md:w-full md:h-full md:object-cover object-contain z-[-1] select-none"
          src={imageset.wallpaper}
          width={1600}
          height={800}
          alt="wallpaper"
          loading="eager"
          priority
          unoptimized
        />
        <div className="max-w-[1280px] ml-auto mr-auto w-full relative top-0 bottom-0 md:relative">
          {/* LOGO WITH TOGGLE */}
          <div className="relative z-2 top-3 w-full flex justify-center select-none z-50">
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
            {/* Mobile logo (always visible) */}
            <Link href="/">
              <Image
                className="block md:hidden absolute top-0 left-[42%] translate-x-[-50%] w-1/2 max-w-[220px]"
                id="tutorial-logo-mobile"
                src={IMG_LOGO_SHORT}
                width={250}
                height={63}
                alt="logo"
                loading="lazy"
              />
            </Link>
            {/* Toggle button (desktop only) */}
            <button
              aria-label={lightLayout ? "Show Layout" : "Hide Layout"}
              onClick={toggleLightLayout}
              className="hidden md:flex items-center justify-center absolute top-0 right-2 h-8 w-8 bg-slate-700/70 hover:bg-slate-600 text-white rounded-full"
            >
              {lightLayout ? (
                <Eye className="h-6 w-6" />
              ) : (
                <EyeOff className="h-6 w-6" />
              )}
            </button>
          </div>
          {/* DESKTOP NAVBAR */}
          {!lightLayout && (
            <div className="hidden md:block z-1 relative top-[-10px] left-[50%] translate-x-[-50%] text-orange-100 font-bold text-lg lg:text-2xl">
              <Image
                className="select-none"
                src={imageset.navbar}
                width={1280}
                height={133}
                alt="navbar"
                loading="lazy"
              />
              <div className="absolute top-6 grid grid-cols-3 w-1/2 px-24 lg:px-36">
                {navbarMenuItemsLeft.map((link) => {
                  const count = link.notificationCount ?? 0;
                  return (
                    <Link
                      key={link.name}
                      className="relative hover:text-orange-500 flex flex-row gap-1 z-10 items-center justify-center hover:cursor-pointer"
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
                        <div className="absolute top-0 right-2 flex items-center justify-center text-sm text-orange-100 bg-orange-500 rounded-full w-5 h-5 z-50">
                          {count}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
              <div className="absolute top-6 right-0 grid grid-cols-3 w-1/2 px-24 lg:px-36">
                {navbarMenuItemsRight.map((link) => (
                  <Link
                    key={link.name}
                    className="hover:text-orange-500 flex flex-row gap-1 z-10 items-center justify-center"
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
          {/* DESKTOP HANDSIGN */}
          <Image
            className="hidden md:block z-10 relative top-[-120px] left-[50%] translate-x-[-50%] select-none"
            src={imageset.handsign}
            width={127}
            height={112}
            alt="handsign"
            loading="lazy"
          />
          <div
            className={cn(
              "relative h-[15px] w-full shrink-0 bg-fill bg-repeat-x md:hidden",
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
              "relative md:top-[-122px] flex flex-row z-10 h-full",
              shownNotifications &&
                shownNotifications.length > 0 &&
                pathname !== "/combat"
                ? "top-[100px]"
                : "top-[70px]",
            )}
          >
            {/* LEFT SIDEBANNER DESKTOP */}
            <div className="hidden md:block relative w-[200px] lg:w-[250px] shrink-0">
              <div className="relative">
                <Image
                  className="left-0 absolute -z-10 select-none"
                  src={IMG_LAYOUT_SIDETOPBANNER_CONTENT}
                  width={250}
                  height={235}
                  style={{ width: "100%", height: "100%" }}
                  alt="leftbanner"
                  loading="lazy"
                ></Image>
                <div className="text-white z-10 pl-20 pr-4 pt-4">{leftSideBar}</div>
              </div>
              <Image
                className="left-0 relative select-none"
                src={IMG_LAYOUT_SIDETOPBANNER_BOTTOM}
                width={250}
                height={68}
                alt="leftbanner"
                loading="lazy"
              ></Image>
              <StrongestUsersBanner />
            </div>
            {/* MAIN CONTENT */}
            <div className="w-full flex-1 min-w-0 flex flex-col ">
              <div className="w-full flex flex-row min-h-screen md:min-h-0">
                <div
                  className={`w-12 shrink-0 bg-fill bg-repeat-y hidden lg:block`}
                  style={{ backgroundImage: `url(${IMG_LAYOUT_SIDESCROLL})` }}
                ></div>
                <div className="w-full bg-background grow flex flex-col overflow-x-scroll min-h-[200px]">
                  <div className="p-3 pb-28 md:pb-3">{props.children}</div>
                </div>
                <div
                  className={`w-12 shrink-0 bg-fill bg-repeat-y hidden lg:block`}
                  style={{ backgroundImage: `url(${IMG_LAYOUT_SIDESCROLL})` }}
                ></div>
              </div>
              <div className="h-20 max-h-28 flex flex-col fixed bottom-0  w-full md:relative">
                <div className="absolute top-0 left-[-20px] right-0 md:right-[-20px] -z-30">
                  <div className="h-5 bg-linear-to-b from-rose-950 to-rose-800"></div>
                  <div className="h-8 bg-rose-800"></div>
                  <div className="h-7 bg-linear-to-b from-rose-800 to-rose-950"></div>
                </div>
                <Image
                  className="left-[-120px] top-[-195px] absolute select-none -z-20 hidden md:block"
                  src={IMG_LAYOUT_SCROLLBOTTOM_DECOR}
                  width={143}
                  height={272}
                  alt="leftbottomdecor"
                  loading="lazy"
                ></Image>
                <Image
                  className="right-[-120px] top-[-195px] absolute select-none scale-x-[-1] -z-20 hidden md:block"
                  src={IMG_LAYOUT_SCROLLBOTTOM_DECOR}
                  width={143}
                  height={272}
                  alt="rightbottomdecor"
                  loading="lazy"
                ></Image>
                <div className="absolute top-2 left-0 right-0 hidden md:block">
                  <Footer />
                </div>
                {userData ? (
                  <div className="absolute top-0 left-0 right-0 bottom-0 md:hidden grid grid-cols-7 items-center justify-center">
                    <div></div>
                    <Link
                      href="/profile"
                      className="flex justify-center -top-2 relative"
                      prefetch={true}
                    >
                      <CircleUserRound className={mobileNavbarButtonStyle} />
                    </Link>
                    <Link
                      href="/inbox"
                      className="flex justify-center -top-2 relative"
                      prefetch={true}
                    >
                      <Inbox className={mobileNavbarButtonStyle} />
                    </Link>
                    {location ? (
                      <>
                        <Link
                          href="/village"
                          className="flex justify-center -top-8 relative"
                          prefetch={true}
                        >
                          <div className="p-4 bg-linear-to-b from-black/5 to-black/50 rounded-full">
                            <House className={cn(yellowButtonStyle)} />
                          </div>
                        </Link>
                        <Link
                          href="/travel"
                          className="flex justify-center -top-2 relative"
                          prefetch={true}
                        >
                          <Compass className={mobileNavbarButtonStyle} />
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          href="/travel"
                          className="flex justify-center -top-8 relative"
                          prefetch={true}
                        >
                          <div className="p-4 bg-linear-to-b from-black/5 to-black/50 rounded-full">
                            <Compass className={mobileNavbarButtonStyle} />
                          </div>
                        </Link>
                        <Link
                          href="/items"
                          className="flex justify-center -top-2 relative"
                          prefetch={true}
                        >
                          <Milk className={mobileNavbarButtonStyle} />
                        </Link>
                      </>
                    )}

                    <Link
                      href="/tavern"
                      className="flex justify-center -top-2 relative"
                      prefetch={true}
                    >
                      <MessagesSquare className={mobileNavbarButtonStyle} />
                    </Link>
                    <Link
                      href="/profile/edit"
                      className="flex justify-center -top-2 relative"
                      prefetch={true}
                    >
                      <Cog className={mobileNavbarButtonStyle} />
                    </Link>
                  </div>
                ) : (
                  <div className="absolute top-4 left-0 right-0 block md:hidden">
                    <Footer />
                  </div>
                )}
              </div>
            </div>
            {/* RIGHT SIDEBANNER DESKTOP */}
            <div className="hidden md:block relative w-[200px] lg:w-[250px] shrink-0">
              <div className="relative">
                <Image
                  className="right-0 absolute -z-10 scale-x-[-1] select-none"
                  src={IMG_LAYOUT_SIDETOPBANNER_CONTENT}
                  width={250}
                  height={235}
                  style={{ width: "100%", height: "100%" }}
                  alt="rightbanner"
                  loading="lazy"
                ></Image>
                <div className="text-white p-2 pl-4 pr-20">{rightSideBar}</div>
              </div>
              <Image
                className="left-0 relative select-none scale-x-[-1]"
                src={IMG_LAYOUT_SIDETOPBANNER_BOTTOM}
                width={250}
                height={68}
                alt="leftbanner"
                loading="lazy"
              ></Image>
            </div>
          </div>
          {/* LEFT SIDEBAR MOBILE */}
          <Sheet open={leftSideBarOpen} onOpenChange={setLeftSideBarOpen}>
            <SheetTrigger
              className="absolute top-4 left-4 block md:hidden"
              aria-label="homeBtn"
            >
              {userData ? (
                <House className={cn(yellowButtonStyle)} />
              ) : (
                <Menu className={cn(yellowButtonStyle)} />
              )}
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader className="text-left">
                <VisuallyHidden.Root>
                  <SheetTitle>Test</SheetTitle>
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

          {/* RIGHT SIDEBAR MOBILE */}
          <div className="grid grid-cols-2 gap-2 absolute top-4 right-4 block md:hidden">
            <div className="flex justify-center">
              <LowerRightHelpBtn className="block md:hidden">
                {userData ? (
                  <CircleHelp className={cn(yellowButtonStyle)} />
                ) : (
                  <Music className={cn(yellowButtonStyle)} />
                )}
              </LowerRightHelpBtn>
            </div>
            <Sheet open={rightSideBarOpen} onOpenChange={setRightSideBarOpen}>
              <SheetTrigger aria-label="gameBtn" id="tutorial-gameBtn">
                {userData ? (
                  <Earth className={cn(yellowButtonStyle)} />
                ) : (
                  <LogIn className={cn(yellowButtonStyle)} />
                )}
              </SheetTrigger>
              <SheetContent>
                <VisuallyHidden.Root>
                  <SheetTitle>Test</SheetTitle>
                </VisuallyHidden.Root>
                <Suspense fallback={<Loader explanation="Loading..." />}>
                  <SheetHeader>
                    <div
                      ref={rightSideBarRef}
                      onClick={(e) => {
                        // Don't close the sheet if clicking on interactive elements
                        const target = e.target as HTMLElement;

                        // Check if the target or any of its parents is a tab-related element
                        const isTabElement =
                          target.closest('[role="tab"]') ||
                          target.closest("[data-state]") ||
                          target.closest("[data-radix-tabs-trigger]") ||
                          target.closest("[data-radix-tabs-list]") ||
                          target.closest("[data-radix-tabs-content]");

                        // Check if it's any other interactive element
                        const isOtherInteractive =
                          target.closest("input") ||
                          target.closest("select") ||
                          target.closest("textarea");

                        // Check if the target has a cursor pointer style (indicating it's clickable)
                        const hasPointerCursor =
                          target.style.cursor === "pointer" ||
                          target.closest('[style*="cursor: pointer"]') ||
                          target.closest('[class*="cursor-pointer"]');

                        const isInteractive =
                          isTabElement || isOtherInteractive || hasPointerCursor;
                        const isButtonOrLink =
                          target.closest("button") !== null ||
                          target.closest("a") !== null;

                        if (!isInteractive || isButtonOrLink) {
                          setRightSideBarOpen(false);
                        }
                      }}
                    >
                      {rightSideBar}
                    </div>
                  </SheetHeader>
                </Suspense>
              </SheetContent>
            </Sheet>
          </div>

          {/* MOBILE NOTIFICATIONS */}
          <div className="absolute top-[75px] right-0 left-0 flex flex-row justify-end md:hidden p-1 gap-2">
            {pathname !== "/combat" && (
              <CollapsibleNotifications
                notifications={shownNotifications}
                layout="mobile"
              />
            )}
          </div>
          {/* <div className="p-3 pt-24 min-h-[1200px] bg-background bg-opacity-50">
          {props.children}
        </div> */}
        </div>
      </div>
    </GlobalAudioProvider>
  );
};
export default LayoutCore4;

/**
 * Reusable component for rendering notifications with grouping support
 */
interface NotificationListProps {
  notifications?: NavBarDropdownLink[];
  layout: "desktop" | "mobile";
  className?: string;
}

const NotificationList: React.FC<NotificationListProps> = ({
  notifications,
  layout,
  className = "",
}) => {
  if (!notifications || notifications.length === 0) return null;

  // Separate grouped and ungrouped notifications
  const grouped = notifications.filter((n) => n.group);
  const ungrouped = notifications.filter((n) => !n.group);

  // Group the grouped notifications by their group field
  const groupedByCategory = groupBy(grouped, "group");

  // Mapping object for notification colors to prevent Tailwind purging
  const notificationColorMap = {
    default: "bg-slate-600",
    red: "bg-red-600",
    green: "bg-green-600",
    blue: "bg-blue-600",
    toast: "bg-orange-600",
    hidden: "bg-gray-600",
  } as const;

  // Render individual notification
  const renderNotification = (
    notification: NavBarDropdownLink,
    key: string,
    isInPopover = false,
  ) => (
    <Link key={key} href={notification.href} id={notification.id}>
      <div
        className={`flex flex-row items-center rounded-lg border-2 border-slate-800 hover:opacity-70 ${
          layout === "mobile"
            ? "text-xs py-[1px] px-3"
            : "text-xs lg:text-base py-[1px] pl-3"
        } ${notification.color ? notificationColorMap[notification.color] : "bg-slate-500"} ${
          isInPopover ? "border border-slate-600 py-2 px-3" : ""
        }`}
      >
        {notification.color === "red" && (
          <ShieldAlert
            className={`text-white mr-1 ${isInPopover ? "h-4 w-4 mr-2" : "h-5 w-5"}`}
          />
        )}
        {notification.color === "blue" && (
          <Info
            className={`text-white mr-1 ${isInPopover ? "h-4 w-4 mr-2" : "h-5 w-5"}`}
          />
        )}
        {notification.color === "green" && (
          <ShieldCheck
            className={`text-white mr-1 ${isInPopover ? "h-4 w-4 mr-2" : "h-5 w-5"}`}
          />
        )}
        <span className="text-white">{notification.name}</span>
      </div>
    </Link>
  );

  // Render ungrouped notifications
  const ungroupedElements = ungrouped.map((notification, i) =>
    renderNotification(notification, `ungrouped-${i}`),
  );

  // Render grouped notifications
  const groupedElements = Array.from(groupedByCategory.entries())
    .map(([group, groupNotifications]) => {
      const firstNotification = groupNotifications[0];
      const count = groupNotifications.length;

      if (!firstNotification) return null;

      // For desktop, show popover with all notifications
      return (
        <Popover key={`group-${group}`}>
          <PopoverTrigger asChild>
            <div
              className={`flex flex-row text-xs lg:text-base items-center rounded-lg border-2 border-slate-800 py-[1px] pl-3 hover:opacity-70 cursor-pointer ${
                firstNotification.color
                  ? `bg-${firstNotification.color}-600`
                  : "bg-slate-500"
              }`}
            >
              {firstNotification.color === "red" && (
                <ShieldAlert className="mr-1 h-5 w-5" />
              )}
              {firstNotification.color === "blue" && <Info className="mr-1 h-5 w-5" />}
              {firstNotification.color === "green" && (
                <ShieldCheck className="mr-1 h-5 w-5" />
              )}
              {group} ({count})
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0">
            <div className="p-4">
              <h4 className="font-semibold text-sm mb-3">{group}</h4>
              <div className="flex flex-col gap-1">
                {groupNotifications.map((notification, i) =>
                  renderNotification(notification, `${group}-${i}`, true),
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      );
    })
    .filter(Boolean);

  const allElements = [...ungroupedElements, ...groupedElements];

  if (layout === "mobile") {
    return <>{allElements}</>;
  }

  return <ul className={`grid grid-cols-1 gap-[1px] ${className}`}>{allElements}</ul>;
};

/**
 * Collapsible wrapper for notifications that allows users to fold/expand the notification list
 */
interface CollapsibleNotificationsProps {
  notifications?: NavBarDropdownLink[];
  layout: "desktop" | "mobile";
  className?: string;
}

const CollapsibleNotifications: React.FC<CollapsibleNotificationsProps> = ({
  notifications,
  layout,
  className = "",
}) => {
  // Persist collapsed state with default to expanded (false = not collapsed)
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    "notificationsCollapsed",
    false,
  );

  // Check for critical notifications (red color) - compute before early return
  const hasCritical = notifications?.some((n) => n.color === "red") ?? false;
  const count = notifications?.length ?? 0;

  // Don't render anything if no notifications
  if (!notifications || notifications.length === 0) return null;

  // Badge styling based on critical status
  const badgeClass = hasCritical ? "bg-red-500 text-white" : "bg-slate-500 text-white";

  if (layout === "mobile") {
    // Mobile layout with smooth horizontal transition
    return (
      <div className="flex flex-row items-start gap-2">
        {/* Toggle button - different structure for collapsed vs expanded */}
        {isCollapsed ? (
          <button
            onClick={() => setIsCollapsed(false)}
            className="flex items-stretch rounded-lg border-2 border-slate-800 overflow-hidden hover:opacity-70 transition-opacity duration-200"
            aria-label={`Show ${count} notifications`}
            aria-expanded={false}
          >
            <span className="flex items-center justify-center px-2 py-[1px] bg-slate-700">
              <Bell className="h-5 w-5 text-white" />
            </span>
            <span
              className={`flex items-center justify-center px-2 py-[1px] text-xs font-bold ${badgeClass}`}
            >
              {count}
            </span>
          </button>
        ) : (
          <button
            onClick={() => setIsCollapsed(true)}
            className="flex items-center justify-center rounded-lg border-2 border-slate-800 bg-slate-700 hover:opacity-70 transition-opacity duration-200 aspect-square"
            aria-label="Hide notifications"
            aria-expanded={true}
          >
            <ChevronRight className="h-5 w-5 text-white m-[1px]" />
          </button>
        )}
        {/* Animated notification list container */}
        <div
          className="grid transition-all duration-300 ease-in-out"
          style={{
            gridTemplateColumns: isCollapsed ? "0fr" : "1fr",
          }}
        >
          <div
            className={`overflow-hidden flex flex-row flex-nowrap items-start gap-2 transition-opacity duration-300 ${
              isCollapsed ? "opacity-0" : "opacity-100"
            }`}
          >
            <NotificationList
              notifications={notifications}
              layout="mobile"
              className={className}
            />
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout with smooth transition
  return (
    <div>
      {/* Header button - always visible */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between text-xl font-bold text-orange-100 px-1 pt-2 hover:text-orange-300 transition-colors duration-200 cursor-pointer"
        aria-label={isCollapsed ? `Show ${count} notifications` : "Hide notifications"}
        aria-expanded={!isCollapsed}
      >
        <span className="flex items-center gap-2">
          Notifications
          {/* Badge only shown when collapsed */}
          <span
            aria-hidden="true"
            className={`flex items-center justify-center min-w-[24px] h-[24px] text-sm font-bold rounded-full px-2 transition-all duration-300 ${badgeClass} ${
              isCollapsed ? "opacity-100 scale-100" : "opacity-0 scale-75"
            }`}
          >
            {count}
          </span>
        </span>
        {/* Animated chevron */}
        <ChevronDown
          className={`h-5 w-5 transition-transform duration-300 ${
            isCollapsed ? "rotate-0" : "rotate-180"
          }`}
        />
      </button>
      {/* Animated notification list using grid for height animation */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{
          gridTemplateRows: isCollapsed ? "0fr" : "1fr",
        }}
      >
        <div className="overflow-hidden">
          <NotificationList
            notifications={notifications}
            layout="desktop"
            className={className}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Show strongest users
 */
const StrongestUsersBanner: React.FC = () => {
  // State
  const { isLoaded } = useUser();

  // Get user data
  const { data: userData } = useUserData();

  // Query
  const { data: usersData, isPending } = api.profile.getPublicUsers.useQuery(
    { limit: 10, orderBy: "Ranked", isAi: false },
    { enabled: isLoaded, staleTime: 1000 * 60 * 5 },
  );
  const users = usersData?.data;

  return (
    <div className="relative top-[-30px]">
      <Image
        className="left-0 relative -z-10 select-none w-[200px] lg:w-[260px] max-w-[200px] lg:max-w-[260px]"
        src={IMG_LAYOUT_USERSBANNER_TOP}
        width={260}
        height={138}
        alt="usersbanner_top"
        loading="lazy"
      ></Image>
      <div
        className="text-orange-100 relative left-0 w-[200px] lg:w-[260px] max-w-[200px] lg:max-w-[260px] bg-contain bg-repeat-y"
        style={{ backgroundImage: `url(${IMG_LAYOUT_USERBANNER_MIDDLE})` }}
      >
        <div className="relative top-[-40px]">
          <div className="relative left-10 lg:left-14 w-[140px] max-w-[140px] lg:w-[178px] lg:max-w-[178px]">
            <Link href={userData ? "/battlearena#PVP%20Rank" : "/login"}>
              <Button decoration="gold" className="w-full" animation="pulse">
                Join Ranked PvP
              </Button>
            </Link>
          </div>
          {users?.map((user, i) => (
            <Link
              href={`/username/${user.username}`}
              key={i}
              className="hover:opacity-50"
            >
              <div
                className={`py-1 grid grid-cols-12 items-center justify-center relative top-2 left-8 lg:left-10 w-[154px] max-w-[154px] lg:w-[200px] lg:max-w-[200px] ${
                  i % 2 == 0 ? "bg-pink-900" : ""
                } bg-opacity-50 text-xs lg:text-base`}
              >
                <p className="pl-2">{i + 1}</p>
                <div className="col-span-2">
                  <AvatarImage
                    href={user.avatarLight}
                    alt={user.username}
                    size={100}
                    priority
                  />
                </div>
                <p className="col-span-5">{user.username}</p>
                <p className="col-span-4">{user.rankedLp}</p>
              </div>
            </Link>
          ))}
          {isPending && (
            <div className="flex flex-col gap-1 items-center pb-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton
                  className="h-9 lg:h-10 w-full w-[154px] max-w-[154px] lg:w-[200px] lg:max-w-[200px] bg-muted/70"
                  key={i}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <Image
        className="left-0 top-[-10px] relative -z-10 select-none w-[200px] lg:w-[260px] max-w-[200px] lg:max-w-[260px]"
        src={IMG_LAYOUT_USERSBANNER_BOTTOM}
        width={260}
        height={138}
        alt="usersbanner_bottom"
        loading="lazy"
      ></Image>
    </div>
  );
};

/**
 * Renders a side banner title component.
 *
 * @param children - The content to be displayed as the title.
 * @returns The rendered side banner title component.
 */
export const SideBannerTitle: React.FC<{
  children: React.ReactNode;
  break?: boolean;
}> = (props) => {
  return (
    <>
      {props.break && <br />}
      <p className="hidden md:block text-xl font-bold text-orange-100 px-1 pt-2">
        {props.children}
      </p>
      <p className="block md:hidden text-xl font-bold text-foreground px-1 pt-2">
        {props.children}
      </p>
    </>
  );
};

/**
 * Renders the right sidebar component.
 *
 * @param props - The component props.
 * @param props.systems - An array of NavBarDropdownLink objects representing the systems.
 * @param props.userData - The user data.
 * @param props.notifications - An optional array of NavBarDropdownLink objects representing the notifications.
 * @param props.location - An optional NavBarDropdownLink object representing the location.
 * @returns The rendered right sidebar component.
 */
const RightSideBar: React.FC<{
  systems: NavBarDropdownLink[];
  userData: UserWithRelations;
  timeDiff: number;
  notifications?: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
}> = (props) => {
  // Destructure props
  const { notifications, systems, userData, location } = props;

  // Derived data
  const inBattle = userData?.status === "BATTLE";
  // Current pathname to determine if user is on the combat route
  const pathname = usePathname();

  // Helper to render the default sidebar content (without MenuBoxCombat)
  const renderDefaultSidebar = () => (
    <>
      {/* NOTIFICATIONS */}
      {userData && (
        <CollapsibleNotifications notifications={notifications} layout="desktop" />
      )}
      <SideBannerTitle break={userData && notifications && notifications.length > 0}>
        Main Menu
      </SideBannerTitle>
      <div className="mt-1 grid gap-3 grid-cols-2">
        {systems.map((system, i) => {
          const disabled = system.requireAwake && userData?.status !== "AWAKE";
          return (
            <Link
              key={i}
              href={system.href}
              className={system.className ? system.className : ""}
              id={system.id}
            >
              <Button
                decoration="gold"
                className={`relative w-full ${system.className || ""} ${disabled ? "opacity-30" : "hover:bg-orange-200"}`}
                count={system.notificationCount}
              >
                <div className="grow">{system.name}</div>
                <div>{system.icon && system.icon}</div>
              </Button>
            </Link>
          );
        })}
      </div>
      {location && (
        <>
          <SideBannerTitle break>Location Menu</SideBannerTitle>
          <div className={inBattle && location.requireAwake ? "opacity-30" : ""}>
            <Link
              href={inBattle && location.requireAwake ? "/combat" : location.href}
              className="text-center flex flex-row justify-center"
              id={location.id}
            >
              {location.icon}
            </Link>
          </div>
        </>
      )}
    </>
  );

  // Render
  if (inBattle && pathname === "/combat") {
    return (
      <Tabs defaultValue="battle" className="w-full">
        <TabsContent value="menu">{renderDefaultSidebar()}</TabsContent>
        <TabsContent value="battle">
          <MenuBoxCombat />
        </TabsContent>
        <TabsList className="w-full  border-2">
          <TabsTrigger value="menu">Menu</TabsTrigger>
          <TabsTrigger value="battle">Battle</TabsTrigger>
        </TabsList>
      </Tabs>
    );
  }

  // Default (either not in battle or not on combat route)
  return renderDefaultSidebar();
};

// Get wallpaper based on the season
// Note: getCurrentSeason uses UTC to ensure consistent results between server and client
export const getImageSet = (userData: UserWithRelations) => {
  // Base settings with seasonal wallpaper
  const base = {
    navbar: IMG_LAYOUT_NAVBAR,
    handsign: IMG_LAYOUT_HANDSIGN,
    wallpaper: IMG_WALLPAPER_SUMMER,
  };

  // Check for seasonal overwrites
  switch (getCurrentSeason()) {
    case "winter":
      base.wallpaper = IMG_WALLPAPER_WINTER;
      break;
    case "spring":
      base.wallpaper = IMG_WALLPAPER_SPRING;
      break;
    case "summer":
      base.wallpaper = IMG_WALLPAPER_SUMMER;
      break;
    case "fall":
      base.wallpaper = IMG_WALLPAPER_FALL;
      break;
    case "halloween":
      base.wallpaper = IMG_WALLPAPER_FALL;
      base.navbar = IMG_LAYOUT_NAVBAR_HALLOWEEN;
      base.handsign = IMG_LAYOUT_HANDSIGN_HALLOWEEN;
      break;
  }

  // Check for location-specific overwrites
  if (userData?.village?.wallpaperOverwrite) {
    base.wallpaper = userData.village.wallpaperOverwrite;
  }

  return base;
};
