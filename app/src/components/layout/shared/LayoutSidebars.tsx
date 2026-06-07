"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { SiDiscord, SiGithub } from "@icons-pack/react-simple-icons";
import { Bell, Eclipse, Link2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DISCORD_INVITE_URL,
  IMG_ICON_DISCORD,
  IMG_ICON_FACEBOOK,
  IMG_ICON_GITHUB,
  IMG_ICON_GOOGLE,
  IMG_LAYOUT_USERBANNER_MIDDLE,
  IMG_LAYOUT_USERSBANNER_BOTTOM,
  IMG_LAYOUT_USERSBANNER_TOP,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import { GameSettingsPopover } from "@/layout/GameSettings";
import Image from "@/layout/Image";
import MenuBoxCombat from "@/layout/MenuBoxCombat";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import type { NavBarDropdownLink } from "@/libs/menus";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { useUserData } from "@/utils/UserContext";
import { CollapsibleNotifications } from "./LayoutNotifications";
import { type LayoutVariant, layoutVariantClasses } from "./layoutVariants";

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

const SidebarLoadingSkeleton: React.FC = () => (
  <div>
    <Skeleton className="mt-6 h-6 w-full bg-muted/70" />
    <div className="flex flex-row gap-4 pt-4">
      <Skeleton className="h-16 w-full bg-muted/70" />
      <Skeleton className="h-16 w-full bg-muted/70" />
    </div>
  </div>
);

const RightSidebarLoadingSkeleton: React.FC = () => (
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
);

const GithubStar: React.FC = () => (
  <div className="flex justify-center pt-6 pl-2 align-center">
    <iframe
      suppressHydrationWarning
      src="https://ghbtns.com/github-btn.html?user=studie-tech&repo=TheNinjaRPG&type=star&count=true"
      width="90"
      height="20"
      title="GitHub"
    ></iframe>
  </div>
);

interface LayoutLeftSidebarProps {
  variant: LayoutVariant;
  isClerkLoaded: boolean;
  isSignedInLayout: boolean;
  userData?: UserWithRelations | null;
}

export const LayoutLeftSidebar: React.FC<LayoutLeftSidebarProps> = ({
  variant,
  isClerkLoaded,
  isSignedInLayout,
  userData,
}) => {
  return (
    <div>
      {userData && (
        <>
          <SideBannerTitle>
            <Link
              href={`/userid/${userData.userId}`}
              className="inline-block flex flex-row hover:text-orange-500"
            >
              {userData.username} <Link2 className="inline-block h-5 w-5" />
            </Link>
          </SideBannerTitle>
          <MenuBoxProfile />
        </>
      )}
      {variant === "beta" && isClerkLoaded && !userData && (
        <>
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
        </>
      )}
      {variant === "beta" && !isClerkLoaded && <SidebarLoadingSkeleton />}
      {variant === "pixel" && isSignedInLayout && !userData && (
        <SidebarLoadingSkeleton />
      )}
    </div>
  );
};

interface LayoutRightSidebarContentProps {
  variant: LayoutVariant;
  isClerkLoaded: boolean;
  isSignedInLayout: boolean;
  userData?: UserWithRelations | null;
  systems: NavBarDropdownLink[];
  notifications?: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
}

export const LayoutRightSidebarContent: React.FC<LayoutRightSidebarContentProps> = ({
  variant,
  isClerkLoaded,
  isSignedInLayout,
  userData,
  systems,
  notifications,
  location,
}) => {
  return (
    <>
      {userData && (
        <RightSideBar
          variant={variant}
          notifications={notifications}
          systems={systems}
          userData={userData}
          location={location}
        />
      )}
      {variant === "beta" && isClerkLoaded && !userData && (
        <>
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
        </>
      )}
      {variant === "beta" && !isClerkLoaded && <RightSidebarLoadingSkeleton />}
      {variant === "pixel" && isSignedInLayout && !userData && (
        <RightSidebarLoadingSkeleton />
      )}
      <GithubStar />
    </>
  );
};

interface SignedInIconsProps {
  variant: LayoutVariant;
  userData?: UserWithRelations | null;
  updateUser: (data: Partial<UserWithRelations>) => Promise<void>;
  onEventClick: () => void;
  onThemeToggle?: () => void;
}

export const SignedInIcons: React.FC<SignedInIconsProps> = ({
  variant,
  userData,
  updateUser,
  onEventClick,
  onThemeToggle,
}) => {
  return (
    <div className="flex flex-row items-center">
      {userData && (
        <UserButton
          appearance={{
            elements: { userButtonPopoverCard: { pointerEvents: "initial" } },
          }}
        />
      )}
      <Link href="/event" onClick={onEventClick} aria-label="Event Notifications">
        <Bell className="mx-1 ml-2 h-6 w-6 rounded-full bg-blue-100 bg-opacity-80 p-1 text-slate-700 hover:bg-blue-300 hover:text-black xl:h-7 xl:w-7" />
      </Link>
      <GameSettingsPopover userData={userData} updateUser={updateUser} />
      {variant === "beta" && (
        <Eclipse
          className="mx-1 h-6 min-h-6 w-6 min-w-6 rounded-full bg-blue-100 bg-yellow-100 bg-opacity-80 p-1 text-slate-700 hover:cursor-pointer hover:bg-blue-300 hover:text-black xl:h-7 xl:min-h-7 xl:w-7 xl:min-w-7 dark:bg-blue-100"
          onClick={onThemeToggle}
        />
      )}
    </div>
  );
};

interface LayoutMainMenuProps {
  variant: LayoutVariant;
  navbarMenuItems: NavBarDropdownLink[];
  signedInIcons: React.ReactNode;
  onNavigate: () => void;
}

export const LayoutMainMenu: React.FC<LayoutMainMenuProps> = ({
  variant,
  navbarMenuItems,
  signedInIcons,
  onNavigate,
}) => {
  const variantClasses = layoutVariantClasses[variant];

  return (
    <>
      <SideBannerTitle>Main Menu</SideBannerTitle>
      <div className="mt-1 grid grid-cols-2 gap-3">
        {navbarMenuItems.map((system) => {
          return (
            <Link
              key={system.href}
              href={system.href}
              onClick={onNavigate}
              className={system.className ? system.className : ""}
            >
              <Button
                decoration={variantClasses.mainMenuDecoration}
                className={variantClasses.mainMenuButton}
              >
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
};

interface RightSideBarProps {
  variant: LayoutVariant;
  systems: NavBarDropdownLink[];
  userData: UserWithRelations;
  notifications?: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
}

export const RightSideBar: React.FC<RightSideBarProps> = ({
  variant,
  notifications,
  systems,
  userData,
  location,
}) => {
  const inBattle = userData?.status === "BATTLE";
  const pathname = usePathname();
  const variantClasses = layoutVariantClasses[variant];

  const renderDefaultSidebar = () => (
    <>
      {userData && <CollapsibleNotifications notifications={notifications} />}
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
                decoration={variantClasses.rightMenuDecoration}
                className={cn(
                  variantClasses.rightMenuButton,
                  system.className,
                  variant === "beta" &&
                    (disabled ? "opacity-30" : "hover:bg-orange-200"),
                  variant === "pixel" && disabled && "opacity-35",
                )}
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

  return renderDefaultSidebar();
};

export const StrongestUsersBanner: React.FC = () => {
  const { isLoaded } = useUser();
  const { data: userData } = useUserData();
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
