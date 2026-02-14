"use client";

import { SignedIn, SignedOut, UserButton, useUser } from "@clerk/nextjs";
import { SiDiscord, SiGithub } from "@icons-pack/react-simple-icons";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Earth,
  Eclipse,
  Eye,
  EyeOff,
  House,
  Info,
  Link2,
  LogIn,
  Menu,
  MessageCircleWarning,
  Music,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DISCORD_INVITE_URL,
  IMG_ICON_DISCORD,
  IMG_ICON_FACEBOOK,
  IMG_ICON_GITHUB,
  IMG_ICON_GOOGLE,
  IMG_LAYOUT_HANDSIGN,
  IMG_LAYOUT_HANDSIGN_HALLOWEEN,
  IMG_LAYOUT_MOBILE_TOP,
  IMG_LAYOUT_NAVBAR,
  IMG_LAYOUT_NAVBAR_HALLOWEEN,
  IMG_LAYOUT_SCROLLBOTTOM_DECOR,
  IMG_LAYOUT_SIDESCROLL,
  IMG_LAYOUT_SIDETOPBANNER_BOTTOM,
  IMG_LAYOUT_SIDETOPBANNER_CONTENT,
  IMG_LAYOUT_USERBANNER_MIDDLE,
  IMG_LAYOUT_USERSBANNER_BOTTOM,
  IMG_LAYOUT_USERSBANNER_TOP,
  IMG_LOGO_FULL,
  IMG_LOGO_SHORT,
  IMG_WALLPAPER_FALL,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_WINTER,
} from "@/drizzle/constants";
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  useLocalStorage,
} from "@/hooks/localstorage";
import AvatarImage from "@/layout/Avatar";
import Footer from "@/layout/Footer";
import { GameSettingsPopover, GlobalAudioProvider } from "@/layout/GameSettings";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import MenuBoxCombat from "@/layout/MenuBoxCombat";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import TutorialAssistant from "@/layout/TutorialAssistant";
import type { NavBarDropdownLink } from "@/libs/menus";
import { getMainNavbarLinks, useGameMenu } from "@/libs/menus";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  getMobileNavIcon,
  getNavOptionById,
  MOBILE_NAV_STORAGE_KEY,
  type MobileNavConfig,
  normalizeMobileNavConfig,
} from "@/libs/mobileNavConfig";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { groupBy } from "@/utils/grouping";
import { getCurrentSeason } from "@/utils/time";
import { useUserData } from "@/utils/UserContext";

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
              className="inline-block flex flex-row hover:text-orange-500"
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
              className="p-2 text-black md:text-white dark:text-white"
            />
          </Link>
          <Link
            href={DISCORD_INVITE_URL}
            className="flex flex-col items-center font-bold hover:opacity-50"
          >
            <SiDiscord
              size={60}
              className="p-2 text-black md:text-white dark:text-white"
            />
          </Link>
        </div>
      </SignedOut>
      {!isClerkLoaded && (
        <div>
          <Skeleton className="mt-6 h-6 w-full bg-muted/70" />
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
        <p className="hidden px-1 text-orange-100 italic md:block">Socials Login</p>
        <p className="block px-1 text-foreground italic md:hidden">Socials Login</p>
        <div className="grid grid-cols-4">
          <Image
            className="my-4 w-full grayscale"
            src={IMG_ICON_DISCORD}
            alt="DiscordProvider"
            width={50}
            height={50}
          ></Image>
          <Image
            className="my-4 w-full grayscale"
            src={IMG_ICON_FACEBOOK}
            alt="FacebookProvider"
            width={50}
            height={50}
          ></Image>
          <Image
            className="my-4 w-full grayscale"
            src={IMG_ICON_GOOGLE}
            alt="GoogleProvider"
            width={50}
            height={50}
          ></Image>
          <Image
            className="my-4 w-full grayscale"
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
          <Skeleton className="mt-3 h-8 w-full bg-muted/70" />
        </div>
      )}

      <div className="flex justify-center pt-6 pl-2 align-center">
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
        <Bell className="mx-1 ml-2 h-6 w-6 rounded-full bg-blue-100 bg-opacity-80 p-1 text-slate-700 hover:bg-blue-300 hover:text-black xl:h-7 xl:w-7" />
      </Link>
      <GameSettingsPopover userData={userData} updateUser={updateUser} />
      <Eclipse
        className={`mx-1 h-6 min-h-6 w-6 min-w-6 rounded-full bg-blue-100 bg-yellow-100 bg-opacity-80 p-1 text-slate-700 hover:cursor-pointer hover:bg-blue-300 hover:text-black xl:h-7 xl:min-h-7 xl:w-7 xl:min-w-7 dark:bg-blue-100`}
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
      <div className="mt-1 grid grid-cols-2 gap-3">
        {navbarMenuItems.map((system) => {
          return (
            <Link
              key={system.href}
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

  // Mobile navigation config from localStorage
  const [rawMobileNavConfig] = useLocalStorage<MobileNavConfig>(
    MOBILE_NAV_STORAGE_KEY,
    DEFAULT_MOBILE_NAV_CONFIG,
  );
  const mobileNavConfig = normalizeMobileNavConfig(rawMobileNavConfig);

  // Styling for yellow buttons
  const yellowButtonStyle =
    "h-14 w-14 sm:h-15 sm:w-15 md:h-16 md:w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-3 shadow-md shadow-black border-2 stroke-3";
  const mobileNavbarButtonStyle =
    "h-16 w-16  hover:text-red-300 transition-colors text-orange-100 bg-opacity-50 p-2";

  // Helper to render a mobile nav button from config.
  // When outside village (!location), skip rendering "travel" since the center button shows Travel.
  // Returns null to hide the button but the grid wrapper div is still rendered to maintain layout.
  const renderMobileNavButton = (optionId: string) => {
    // Skip rendering travel button when outside village (center button shows Travel instead)
    if (optionId === "travel" && !location) return null;
    const option = getNavOptionById(optionId);
    if (!option) return null;
    const Icon = getMobileNavIcon(optionId);
    return (
      <Link
        href={option.href}
        className="relative -top-2 flex justify-center"
        prefetch={true}
      >
        <Icon className={mobileNavbarButtonStyle} />
      </Link>
    );
  };

  return (
    <GlobalAudioProvider userData={userData}>
      <TutorialAssistant
        rightSideBarOpen={rightSideBarOpen}
        setRightSideBarOpen={setRightSideBarOpen}
        rightSideBarRef={rightSideBarRef}
      />
      <div className="absolute top-0 bottom-0 w-full md:relative">
        <div className="fixed right-1 bottom-1 z-50 rounded-full bg-slate-500 md:right-5 md:bottom-5">
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
          className="fixed z-[-1] select-none object-contain md:top-0 md:left-0 md:h-full md:w-full md:object-cover"
          src={imageset.wallpaper}
          width={1600}
          height={800}
          alt="wallpaper"
          loading="eager"
          priority
          unoptimized
        />
        <div className="relative top-0 bottom-0 mr-auto ml-auto w-full max-w-[1280px] md:relative">
          {/* LOGO WITH TOGGLE */}
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
            {/* Mobile logo (always visible) */}
            <Link href="/">
              <Image
                className="absolute top-0 left-[42%] block w-1/2 max-w-[220px] translate-x-[-50%] md:hidden"
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
              type="button"
              aria-label={lightLayout ? "Show Layout" : "Hide Layout"}
              onClick={toggleLightLayout}
              className="absolute top-0 right-2 hidden h-8 w-8 items-center justify-center rounded-full bg-slate-700/70 text-white hover:bg-slate-600 md:flex"
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
          {/* DESKTOP HANDSIGN */}
          <Image
            className="relative top-[-120px] left-[50%] z-10 hidden translate-x-[-50%] select-none md:block"
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
              "relative z-10 flex h-full flex-row md:top-[-122px]",
              shownNotifications &&
                shownNotifications.length > 0 &&
                pathname !== "/combat"
                ? "top-[100px]"
                : "top-[70px]",
            )}
          >
            {/* LEFT SIDEBANNER DESKTOP */}
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
            {/* MAIN CONTENT */}
            <div className="flex w-full min-w-0 flex-1 flex-col">
              <div className="flex min-h-screen w-full flex-row md:min-h-0">
                <div
                  className={`hidden w-12 shrink-0 bg-fill bg-repeat-y lg:block`}
                  style={{ backgroundImage: `url(${IMG_LAYOUT_SIDESCROLL})` }}
                ></div>
                <div className="flex min-h-[200px] w-full grow flex-col overflow-x-scroll bg-background">
                  <div className="p-3 pb-28 md:pb-3">{props.children}</div>
                </div>
                <div
                  className={`hidden w-12 shrink-0 bg-fill bg-repeat-y lg:block`}
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
                  <div className="absolute top-0 right-0 bottom-0 left-0 grid grid-cols-7 items-center justify-center md:hidden">
                    <div></div>
                    {/* Left buttons from config */}
                    {mobileNavConfig.left.map((optionId) => (
                      <div key={optionId}>{renderMobileNavButton(optionId)}</div>
                    ))}
                    {/* CENTER button - unchanged conditional logic */}
                    {location ? (
                      <Link
                        href="/village"
                        className="relative -top-8 flex justify-center"
                        prefetch={true}
                      >
                        <div className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-4">
                          <House className={cn(yellowButtonStyle)} />
                        </div>
                      </Link>
                    ) : (
                      <Link
                        href="/travel"
                        className="relative -top-8 flex justify-center"
                        prefetch={true}
                      >
                        <div className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-4">
                          <Compass className={mobileNavbarButtonStyle} />
                        </div>
                      </Link>
                    )}
                    {/* Right buttons from config */}
                    {mobileNavConfig.right.map((optionId) => (
                      <div key={optionId}>{renderMobileNavButton(optionId)}</div>
                    ))}
                  </div>
                ) : (
                  <div className="absolute top-4 right-0 left-0 block md:hidden">
                    <Footer />
                  </div>
                )}
              </div>
            </div>
            {/* RIGHT SIDEBANNER DESKTOP */}
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
          <div className="absolute top-4 right-4 block grid grid-cols-2 gap-2 md:hidden">
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
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: Sheet panel - clicking outside content closes it, keyboard handled by Sheet component */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: Sheet panel uses click to close when clicking non-interactive areas */}
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
          <div className="absolute top-[75px] right-0 left-0 flex flex-row justify-end gap-2 p-1 md:hidden">
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
        className={`flex flex-row items-center rounded-lg border-2 border-slate-800 hover:opacity-70 ${layout === "mobile" ? "px-3 py-[1px] text-xs" : "py-[1px] pl-3 text-xs lg:text-base"} ${notification.color ? notificationColorMap[notification.color] : "bg-slate-500"} ${
          isInPopover ? "border border-slate-600 px-3 py-2" : ""
        }`}
      >
        {notification.color === "red" && (
          <ShieldAlert
            className={`mr-1 text-white ${isInPopover ? "mr-2 h-4 w-4" : "h-5 w-5"}`}
          />
        )}
        {notification.color === "blue" && (
          <Info
            className={`mr-1 text-white ${isInPopover ? "mr-2 h-4 w-4" : "h-5 w-5"}`}
          />
        )}
        {notification.color === "green" && (
          <ShieldCheck
            className={`mr-1 text-white ${isInPopover ? "mr-2 h-4 w-4" : "h-5 w-5"}`}
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
              className={`flex cursor-pointer flex-row items-center rounded-lg border-2 border-slate-800 py-[1px] pl-3 text-xs hover:opacity-70 lg:text-base ${firstNotification.color ? `bg-${firstNotification.color}-600` : "bg-slate-500"}`}
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
              <h4 className="mb-3 font-semibold text-sm">{group}</h4>
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
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="flex items-stretch overflow-hidden rounded-lg border-2 border-slate-800 transition-opacity duration-200 hover:opacity-70"
            aria-label={`Show ${count} notifications`}
            aria-expanded={false}
          >
            <span className="flex items-center justify-center bg-slate-700 px-2 py-[1px]">
              <Bell className="h-5 w-5 text-white" />
            </span>
            <span
              className={`flex items-center justify-center px-2 py-[1px] font-bold text-xs ${badgeClass}`}
            >
              {count}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="flex aspect-square items-center justify-center rounded-lg border-2 border-slate-800 bg-slate-700 transition-opacity duration-200 hover:opacity-70"
            aria-label="Hide notifications"
            aria-expanded={true}
          >
            <ChevronRight className="m-[1px] h-5 w-5 text-white" />
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
            className={`flex flex-row flex-nowrap items-start gap-2 overflow-hidden transition-opacity duration-300 ${isCollapsed ? "opacity-0" : "opacity-100"}`}
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
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full cursor-pointer items-center justify-between px-1 pt-2 font-bold text-orange-100 text-xl transition-colors duration-200 hover:text-orange-300"
        aria-label={isCollapsed ? `Show ${count} notifications` : "Hide notifications"}
        aria-expanded={!isCollapsed}
      >
        <span className="flex items-center gap-2">
          Notifications
          {/* Badge only shown when collapsed */}
          <span
            aria-hidden="true"
            className={`flex h-[24px] min-w-[24px] items-center justify-center rounded-full px-2 font-bold text-sm transition-all duration-300 ${badgeClass} ${isCollapsed ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
          >
            {count}
          </span>
        </span>
        {/* Animated chevron */}
        <ChevronDown
          className={`h-5 w-5 transition-transform duration-300 ${isCollapsed ? "rotate-0" : "rotate-180"}`}
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
        className="relative left-0 -z-10 w-[200px] max-w-[200px] select-none lg:w-[260px] lg:max-w-[260px]"
        src={IMG_LAYOUT_USERSBANNER_TOP}
        width={260}
        height={138}
        alt="usersbanner_top"
        loading="lazy"
      ></Image>
      <div
        className="relative left-0 w-[200px] max-w-[200px] bg-contain bg-repeat-y text-orange-100 lg:w-[260px] lg:max-w-[260px]"
        style={{ backgroundImage: `url(${IMG_LAYOUT_USERBANNER_MIDDLE})` }}
      >
        <div className="relative top-[-40px]">
          <div className="relative left-10 w-[140px] max-w-[140px] lg:left-14 lg:w-[178px] lg:max-w-[178px]">
            <Link href={userData ? "/battlearena#PVP%20Rank" : "/login"}>
              <Button decoration="gold" className="w-full" animation="pulse">
                Join Ranked PvP
              </Button>
            </Link>
          </div>
          {users?.map((user, i) => (
            <Link
              href={`/username/${user.username}`}
              key={user.userId}
              className="hover:opacity-50"
            >
              <div
                className={`relative top-2 left-8 grid w-[154px] max-w-[154px] grid-cols-12 items-center justify-center py-1 lg:left-10 lg:w-[200px] lg:max-w-[200px] ${i % 2 === 0 ? "bg-pink-900" : ""} bg-opacity-50 text-xs lg:text-base`}
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
            <div className="flex flex-col items-center gap-1 pb-4">
              {Array.from({ length: 10 }, (_, idx) => `menu-skeleton-${idx}`).map(
                (key) => (
                  <Skeleton
                    key={key}
                    className="h-9 w-[154px] w-full max-w-[154px] bg-muted/70 lg:h-10 lg:w-[200px] lg:max-w-[200px]"
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
      <Image
        className="relative top-[-10px] left-0 -z-10 w-[200px] max-w-[200px] select-none lg:w-[260px] lg:max-w-[260px]"
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
      <p className="hidden px-1 pt-2 font-bold text-orange-100 text-xl md:block">
        {props.children}
      </p>
      <p className="block px-1 pt-2 font-bold text-foreground text-xl md:hidden">
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
      <div className="mt-1 grid grid-cols-2 gap-3">
        {systems.map((system) => {
          const disabled = system.requireAwake && userData?.status !== "AWAKE";
          return (
            <Link
              key={system.href}
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
              className="flex flex-row justify-center text-center"
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
        <TabsList className="w-full border-2">
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
