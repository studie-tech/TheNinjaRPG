"use client";

import ReactDOM from "react-dom";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import MenuBoxCombat from "@/layout/MenuBoxCombat";
import Footer from "@/layout/Footer";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import AvatarImage from "@/layout/Avatar";
import SendTicketBtn from "@/layout/SendTicketButton";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { CircleUserRound, CircleHelp, Compass, Cog, Milk } from "lucide-react";
import { Bell, Info, ShieldAlert, ShieldCheck, Eclipse } from "lucide-react";
import { Earth, House, MessageCircleWarning, Inbox } from "lucide-react";
import { Volume2, VolumeX, Link2 } from "lucide-react";
import { useGameMenu, getMainNavbarLinks } from "@/libs/menus";
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
import { showUserRank } from "@/libs/profile";
import { useUser } from "@clerk/nextjs";
import { getCurrentSeason } from "@/utils/time";
import { showMutationToast } from "@/libs/toast";
import Tutorial from "@/layout/Tutorial";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  IMG_WALLPAPER_WINTER,
  IMG_WALLPAPER_SPRING,
  IMG_WALLPAPER_SUMMER,
  IMG_WALLPAPER_FALL,
  IMG_WALLPAPER_HALLOWEEN,
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
  MUSIC_DEFAULT,
  DISCORD_INVITE_URL,
} from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { usePathname } from "next/navigation";
import { cn } from "src/libs/shadui";
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
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme");
      return savedTheme === "dark" || savedTheme === "light" ? savedTheme : "light";
    }
    return "light";
  });

  const [localAudioOn, setLocalAudioOn] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("audioOn");
      return saved !== null ? (JSON.parse(saved) as boolean) : true;
    }
    return true;
  });

  const toggleLocalAudio = () => {
    setLocalAudioOn((prev) => {
      const newState = !prev;
      localStorage.setItem("audioOn", JSON.stringify(newState));
      return newState;
    });
  };

  const pathname = usePathname();

  // Derived data for layout
  const navbarMenuItems = getMainNavbarLinks();
  const shownNotifications = notifications?.filter((n) => n.color !== "toast");

  // Split menu into two parts
  const navbarMenuItemsLeft = navbarMenuItems.slice(0, 3);
  const navbarMenuItemsRight = navbarMenuItems.slice(3);

  // Toggle audio mutation
  const { mutate: toggleAudioMutation } = api.profile.toggleAudio.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success && result.data && userData) {
        await updateUser({ audioOn: result.data.audioOn });
      }
    },
  });

  // Set theme
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Images
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
    <div className="flex flex-row">
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
        <Bell className="h-7 w-7 hover:text-black hover:bg-blue-300 text-slate-700 bg-blue-100 bg-opacity-80 rounded-full mx-1 ml-2 p-1" />
      </Link>
      <div
        className="hover:cursor-pointer h-7 w-7 hover:text-black hover:bg-blue-300 text-slate-700 bg-blue-100 bg-opacity-80 rounded-full mx-1 p-1"
        onClick={userData ? () => toggleAudioMutation() : toggleLocalAudio}
        aria-label="Toggle Audio"
      >
        {(userData ? userData.audioOn : localAudioOn) ? (
          <>
            <Volume2 className="h-5 w-5" />
            <audio autoPlay loop src={MUSIC_DEFAULT}></audio>
          </>
        ) : (
          <VolumeX className="h-5 w-5" />
        )}
      </div>
      <Eclipse
        className={`hover:cursor-pointer h-7 w-7 min-w-7 min-h-7 hover:text-black hover:bg-blue-300 text-slate-700 bg-blue-100 bg-opacity-80 rounded-full mx-1 p-1 ${theme === "light" ? "bg-yellow-100" : "bg-blue-100"}`}
        onClick={() => {
          if (!theme || theme === "light") {
            localStorage.setItem("theme", "dark");
            setTheme("dark");
          } else {
            localStorage.setItem("theme", "light");
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

  return (
    <>
      {userData && (
        <Tutorial
          rightSideBarOpen={rightSideBarOpen}
          setRightSideBarOpen={setRightSideBarOpen}
          rightSideBarRef={rightSideBarRef}
        />
      )}
      <div className="w-full absolute top-0 bottom-0 md:relative">
        <div className="fixed right-1 bottom-1 md:right-5 md:bottom-5 z-50 bg-slate-500 rounded-full">
          <SendTicketBtn>
            <MessageCircleWarning className="h-16 w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-2 shadow-md shadow-red-800 md:shadow-black border-2 hidden md:block" />
          </SendTicketBtn>
        </div>
        {/* WALLPAPER BACKGROUND */}
        <Image
          className="fixed top-0 left-0 w-full h-full object-cover z-[-1] select-none"
          src={imageset.wallpaper}
          width={1600}
          height={800}
          alt="wallpaper"
          loading="eager"
          priority
          unoptimized
        />
        <div className="max-w-[1280px] ml-auto mr-auto w-full absolute top-0 bottom-0 md:relative">
          {/* LOGO */}
          <Link href="/">
            <Image
              className="hidden md:block z-2 relative top-3 left-[50%] translate-x-[-50%] select-none"
              id="tutorial-logo"
              src={IMG_LOGO_FULL}
              width={384}
              height={138}
              alt="logo"
              loading="lazy"
            />
            <Image
              className="block md:hidden absolute top-3 left-[50%] translate-x-[-50%] w-1/2 max-w-250"
              id="tutorial-logo"
              src={IMG_LOGO_SHORT}
              width={250}
              height={63}
              alt="logo"
              loading="lazy"
            />
          </Link>
          {/* DESKTOP NAVBAR */}
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
              {navbarMenuItemsLeft.map((link) => (
                <Link
                  key={link.name}
                  className="hover:text-orange-500 flex flex-row gap-1 z-10 items-center justify-center hover:cursor-pointer"
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
                </Link>
              ))}
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
            className={`relative top-[100px] h-[15px] w-full shrink-0 bg-fill bg-repeat-x md:hidden`}
            style={{ backgroundImage: `url(${IMG_LAYOUT_MOBILE_TOP})` }}
          ></div>
          <div className="relative top-[100px] md:top-[-122px] flex flex-row z-10 h-full">
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
                      <CircleUserRound className="h-16 w-16  hover:bg-slate-500 transition-colors text-orange-100 bg-opacity-50 rounded-full p-2  " />
                    </Link>
                    <Link
                      href="/inbox"
                      className="flex justify-center -top-2 relative"
                      prefetch={true}
                    >
                      <Inbox className="h-16 w-16  hover:bg-slate-500 transition-colors text-orange-100 bg-opacity-50 rounded-full p-2  " />
                    </Link>
                    {location ? (
                      <>
                        <Link
                          href="/village"
                          className="flex justify-center -top-8 relative"
                          prefetch={true}
                        >
                          <div className="p-4 bg-linear-to-b from-black/5 to-black/50 rounded-full">
                            <House className="h-16 w-16 bg-yellow-500 hover:bg-yellow-700 transition-colors text-white rounded-full p-2 border-2 " />
                          </div>
                        </Link>
                        <Link
                          href="/travel"
                          className="flex justify-center -top-2 relative"
                          prefetch={true}
                        >
                          <Compass className="h-16 w-16  hover:bg-slate-500 transition-colors text-orange-100 bg-opacity-50 rounded-full p-2  " />
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
                            <Compass className="h-16 w-16 bg-yellow-500 hover:bg-yellow-700 transition-colors text-white rounded-full p-2 border-2 " />
                          </div>
                        </Link>
                        <Link
                          href="/items"
                          className="flex justify-center -top-2 relative"
                          prefetch={true}
                        >
                          <Milk className="h-16 w-16  hover:bg-slate-500 transition-colors text-orange-100 bg-opacity-50 rounded-full p-2  " />
                        </Link>
                      </>
                    )}

                    <Link
                      href="/profile/edit"
                      className="flex justify-center -top-2 relative"
                      prefetch={true}
                    >
                      <Cog className="h-16 w-16  hover:bg-slate-500 transition-colors text-orange-100 bg-opacity-50 rounded-full p-2  " />
                    </Link>
                    <div className="flex justify-center -top-2 relative">
                      <SendTicketBtn>
                        <CircleHelp className="h-16 w-16  hover:bg-slate-500 transition-colors text-orange-100 bg-opacity-50 rounded-full p-2  " />
                      </SendTicketBtn>
                    </div>
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
            <SheetTrigger className="absolute top-4 left-4" aria-label="homeBtn">
              <House
                className={cn(
                  "block md:hidden h-16 w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-2 shadow-md shadow-black border-2",
                  pathname === "/combat"
                    ? "animate-[wiggle_1s_ease-in-out_infinite]"
                    : "",
                )}
              />
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
          <Sheet open={rightSideBarOpen} onOpenChange={setRightSideBarOpen}>
            <SheetTrigger
              className={"absolute top-4 right-4"}
              aria-label="gameBtn"
              id="tutorial-gameBtn"
            >
              <Earth
                className={cn(
                  "block md:hidden h-16 w-16 bg-yellow-500 hover:bg-yellow-300 transition-colors text-orange-100 rounded-full p-2 shadow-md shadow-black border-2",
                  pathname === "/combat"
                    ? "animate-[wiggle_1s_ease-in-out_infinite]"
                    : "",
                )}
              />
            </SheetTrigger>
            <SheetContent>
              <VisuallyHidden.Root>
                <SheetTitle>Test</SheetTitle>
              </VisuallyHidden.Root>
              <Suspense fallback={<Loader explanation="Loading..." />}>
                <SheetHeader>
                  <div ref={rightSideBarRef} onClick={() => setRightSideBarOpen(false)}>
                    {rightSideBar}
                  </div>
                </SheetHeader>
              </Suspense>
            </SheetContent>
          </Sheet>

          {/* MOBILE NOTIFICATIONS */}
          <div className="absolute top-[75px] right-0 left-0 flex flex-row justify-end md:hidden p-1 gap-2">
            {pathname !== "/combat" &&
              shownNotifications?.map((notification, i) => (
                <Link key={i} href={notification.href}>
                  <div
                    className={`flex flex-row text-xs items-center rounded-lg border-2 border-slate-800 py-[1px] px-3 hover:opacity-70 ${
                      notification.color
                        ? `bg-${notification.color}-600`
                        : "bg-slate-500"
                    }`}
                  >
                    {notification.color === "red" && (
                      <ShieldAlert className="mr-1 h-5 w-5" />
                    )}
                    {notification.color === "blue" && <Info className="mr-1 h-5 w-5" />}
                    {notification.color === "green" && (
                      <ShieldCheck className="mr-1 h-5 w-5" />
                    )}
                    {notification.name}
                  </div>
                </Link>
              ))}
          </div>
          {/* <div className="p-3 pt-24 min-h-[1200px] bg-background bg-opacity-50">
          {props.children}
        </div> */}
        </div>
      </div>
    </>
  );
};

export default LayoutCore4;

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

  // Render
  return (
    <>
      {/* COMBAT */}
      <MenuBoxCombat />
      {/* NOTIFICATIONS */}
      {userData && notifications && notifications.length > 0 && (
        <>
          <SideBannerTitle>Notifications</SideBannerTitle>
          <ul className="grid grid-cols-1 gap-[1px]">
            {notifications.map((notification, i) => (
              <Link key={i} href={notification.href}>
                <div
                  className={`flex flex-row text-xs lg:text-base items-center rounded-lg border-2 border-slate-800 py-[1px] pl-3 hover:opacity-70 ${
                    notification.color ? `bg-${notification.color}-600` : "bg-slate-500"
                  }`}
                >
                  {notification.color === "red" && (
                    <ShieldAlert className="mr-1 h-5 w-5" />
                  )}
                  {notification.color === "blue" && <Info className="mr-1 h-5 w-5" />}
                  {notification.color === "green" && (
                    <ShieldCheck className="mr-1 h-5 w-5" />
                  )}
                  {notification.name}
                </div>
              </Link>
            ))}
          </ul>
        </>
      )}
      <SideBannerTitle break={userData && notifications && notifications.length > 0}>
        Main Menu
      </SideBannerTitle>
      <div className="mt-1 grid grid-cols-1 gap-3 lg:grid-cols-2">
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
                className={`w-full ${system.className || ""} ${disabled ? "opacity-30" : "hover:bg-orange-200"}`}
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
};

// Get wallpaper based on the season
const getImageSet = (userData: UserWithRelations) => {
  // Base settings
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
      base.wallpaper = IMG_WALLPAPER_HALLOWEEN;
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
