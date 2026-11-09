"use client";

import { UserButton } from "@clerk/nextjs";
import { SiDiscord, SiGithub } from "@icons-pack/react-simple-icons";
import { Bell, Bug, Eclipse, Link2 } from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DISCORD_INVITE_URL,
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  IMG_ICON_DISCORD,
  IMG_ICON_FACEBOOK,
  IMG_ICON_GITHUB,
  IMG_ICON_GOOGLE,
  IMG_LAYOUT_USERBANNER_MIDDLE,
  IMG_LAYOUT_USERSBANNER_BOTTOM,
  IMG_LAYOUT_USERSBANNER_TOP,
  STRONGEST_USERS_COUNT,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import { GameSettingsPopover, type GameSettingsUser } from "@/layout/GameSettings";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import { SideBannerTitle } from "@/layout/SideBannerTitle";
import { type GameLayoutId, getGameLayout } from "@/libs/gameLayouts";
import { getMainNavbarLinks, type NavBarDropdownLink } from "@/libs/menus";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { usePublicPathname } from "@/utils/routing";
import { useUserData, useUserDataSelector } from "@/utils/UserContext";
import { CollapsibleNotifications } from "./LayoutNotifications";
import { layoutVariantClasses } from "./layoutVariants";

// On desktop the default layout stacks StrongestUsersBanner under the left sidebar. While
// the account loads, its skeletons hold the height the loaded sidebars take at the default
// font scale (in rem, to follow the font scale), so nothing under them moves when it
// arrives. The right one stops above the location card, which a later query fills in.

const SidebarLoadingSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("pt-6", className)}>
    <Skeleton className="h-6 w-full bg-muted/70" />
    <div className="flex flex-row gap-4 pt-4">
      <Skeleton className="h-16 w-full bg-muted/70" />
      <Skeleton className="h-16 w-full bg-muted/70" />
    </div>
  </div>
);

const RightSidebarLoadingSkeleton: React.FC<{ className?: string }> = ({
  className,
}) => (
  <div className={className}>
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

const AccountLoadError: React.FC = () => {
  const utils = api.useUtils();
  return (
    <div className="p-2 text-sm">
      <p>We couldn&apos;t load your account.</p>
      <Button variant="outline" onClick={() => void utils.profile.getUser.invalidate()}>
        Try again
      </Button>
    </div>
  );
};

export type AccountMenuState = "loading" | "create-character" | "error" | null;

const PARTICIPATE_LINKS = [
  { href: GITHUB_ISSUES_URL, label: "GitHub", Icon: SiGithub },
  { href: DISCORD_INVITE_URL, label: "Discord", Icon: SiDiscord },
];

const SOCIAL_PROVIDERS = [
  { src: IMG_ICON_DISCORD, alt: "DiscordProvider" },
  { src: IMG_ICON_FACEBOOK, alt: "FacebookProvider" },
  { src: IMG_ICON_GOOGLE, alt: "GoogleProvider" },
  { src: IMG_ICON_GITHUB, alt: "GithubProvider" },
];

const MenuBoxCombat = dynamic(() => import("@/layout/MenuBoxCombat"), {
  loading: () => <SidebarLoadingSkeleton />,
});

const GithubStar: React.FC = () => (
  <div className="flex justify-center pt-6 pl-2 align-center">
    <Link
      href={GITHUB_REPO_URL}
      className="inline-flex min-h-10 items-center gap-2 font-bold hover:underline"
    >
      <SiGithub aria-hidden="true" className="h-4 w-4" />
      Star on GitHub
    </Link>
  </div>
);

interface LayoutLeftSidebarProps {
  variant: GameLayoutId;
  isSignedInLayout: boolean;
  accountState: AccountMenuState;
  userData?: Pick<
    NonNullable<UserWithRelations>,
    "userId" | "username" | "status"
  > | null;
}

export const LayoutLeftSidebar: React.FC<LayoutLeftSidebarProps> = ({
  variant,
  isSignedInLayout,
  accountState,
  userData,
}) => {
  const showPublicContent = shouldShowPublicContent({
    variant,
    isSignedInLayout,
    accountState,
    userData,
  });
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
      {showPublicContent && (
        <>
          <SideBannerTitle>Participate</SideBannerTitle>
          <div className="flex flex-row gap-4 pt-3">
            {PARTICIPATE_LINKS.map(({ href, label, Icon }) => (
              <Link
                key={label}
                href={href}
                aria-label={label}
                className="flex flex-col items-center font-bold hover:opacity-50"
              >
                <Icon
                  size={60}
                  className={cn(
                    "p-2",
                    getGameLayout(variant).frame !== "panel" &&
                      "text-black md:text-white dark:text-white",
                  )}
                />
              </Link>
            ))}
          </div>
        </>
      )}
      {accountState === "loading" && (
        <SidebarLoadingSkeleton
          className={layoutVariantClasses[variant].leftSidebarReservation}
        />
      )}
      {accountState === "error" && <AccountLoadError />}
    </div>
  );
};

interface LayoutRightSidebarContentProps {
  variant: GameLayoutId;
  isSignedInLayout: boolean;
  accountState: AccountMenuState;
  userData?: Pick<
    NonNullable<UserWithRelations>,
    "userId" | "username" | "status"
  > | null;
  systems: NavBarDropdownLink[];
  notifications?: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
}

export const LayoutRightSidebarContent: React.FC<LayoutRightSidebarContentProps> = ({
  variant,
  isSignedInLayout,
  accountState,
  userData,
  systems,
  notifications,
  location,
}) => {
  const showPublicContent = shouldShowPublicContent({
    variant,
    isSignedInLayout,
    accountState,
    userData,
  });
  const variantClasses = layoutVariantClasses[variant];
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
      {showPublicContent && (
        <>
          <SideBannerTitle>Welcome</SideBannerTitle>
          {isSignedInLayout ? (
            <nav
              aria-label="Explore Seichi"
              className="theme-menu-grid mt-2 grid grid-cols-2 gap-3"
            >
              {getMainNavbarLinks().map((link) => (
                <Link key={link.href} href={link.href}>
                  <Button
                    decoration={variantClasses.rightMenuDecoration}
                    className={variantClasses.rightMenuButton}
                  >
                    <span className="grow">{link.name}</span>
                    {link.icon}
                  </Button>
                </Link>
              ))}
            </nav>
          ) : (
            <>
              <p className="hidden px-1 text-orange-100 italic md:block">
                Socials Login
              </p>
              <p className="block px-1 text-foreground italic md:hidden">
                Socials Login
              </p>
              <div className="grid grid-cols-4">
                {SOCIAL_PROVIDERS.map(({ src, alt }) => (
                  <Image
                    key={alt}
                    className="my-4 w-full grayscale"
                    src={src}
                    alt={alt}
                    width={50}
                    height={50}
                  ></Image>
                ))}
              </div>
              <Link href="/login" className="relative">
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  decoration="gold"
                >
                  Sign in
                </Button>
              </Link>
            </>
          )}
        </>
      )}
      {accountState === "loading" && (
        <RightSidebarLoadingSkeleton
          className={layoutVariantClasses[variant].rightSidebarReservation}
        />
      )}
      {accountState === "error" && <AccountLoadError />}
      <GithubStar />
    </>
  );
};

interface SignedInIconsProps {
  variant: GameLayoutId;
  isSignedIn: boolean;
  userData?: GameSettingsUser | null;
  updateUser: (data: Partial<UserWithRelations>) => Promise<unknown>;
  onEventClick: () => void;
  onThemeToggle?: () => void;
}

/** Shares header controls, arranging them vertically inside a `data-stacked-icons` container. */
export const SignedInIcons: React.FC<SignedInIconsProps> = ({
  variant,
  isSignedIn,
  userData,
  updateUser,
  onEventClick,
  onThemeToggle,
}) => {
  return (
    <div className="flex flex-row items-center in-data-stacked-icons:flex-col in-data-stacked-icons:gap-1.5">
      {isSignedIn && (
        <span
          data-sidebar-keep-open="true"
          data-clerk-element="true"
          className="inline-flex items-center [color-scheme:light]"
        >
          <UserButton
            appearance={{
              elements: {
                rootBox: "[color-scheme:light]",
                userButtonPopoverCard: "[color-scheme:light] [pointer-events:initial]",
                userButtonPopoverMain: "[color-scheme:light]",
              },
            }}
          />
        </span>
      )}
      <Link href="/event" onClick={onEventClick} aria-label="Event Notifications">
        <Bell className="mx-1 ml-2 in-data-stacked-icons:ml-1 h-6 w-6 rounded-full bg-blue-100 bg-opacity-80 p-1 text-slate-700 hover:bg-blue-300 hover:text-black xl:h-7 xl:w-7" />
      </Link>
      <Link href="/help" id="tutorial-bugs" aria-label="Bugs">
        <Bug className="mx-1 h-6 w-6 rounded-full bg-blue-100 bg-opacity-80 p-1 text-slate-700 hover:bg-blue-300 hover:text-black xl:h-7 xl:w-7" />
      </Link>
      <GameSettingsPopover
        userData={userData}
        updateUser={updateUser}
        trigger="settings"
        section={userData ? "audio" : "all"}
      />
      {getGameLayout(variant).supportsColorMode && (
        <Eclipse
          className="mx-1 h-6 min-h-6 w-6 min-w-6 rounded-full bg-blue-100 bg-yellow-100 bg-opacity-80 p-1 text-slate-700 hover:cursor-pointer hover:bg-blue-300 hover:text-black xl:h-7 xl:min-h-7 xl:w-7 xl:min-w-7 dark:bg-blue-100"
          onClick={onThemeToggle}
        />
      )}
    </div>
  );
};

interface LayoutMainMenuProps {
  variant: GameLayoutId;
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
      <div className="theme-menu-grid mt-1 grid grid-cols-2 gap-3">
        {navbarMenuItems.map((system) => {
          return (
            <Link key={system.href} href={system.href} onClick={onNavigate}>
              <Button
                decoration={variantClasses.mainMenuDecoration}
                className={variantClasses.mainMenuButton}
              >
                <div className="grow">{system.name}</div>
                <div>{system.icon}</div>
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
  variant: GameLayoutId;
  systems: NavBarDropdownLink[];
  userData: Pick<NonNullable<UserWithRelations>, "status">;
  notifications?: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
}

const RightSideBar: React.FC<RightSideBarProps> = ({
  variant,
  notifications,
  systems,
  userData,
  location,
}) => {
  const inBattle = userData.status === "BATTLE";
  const pathname = usePublicPathname();
  const variantClasses = layoutVariantClasses[variant];

  const renderDefaultSidebar = () => (
    <>
      <CollapsibleNotifications notifications={notifications} />
      <SideBannerTitle break={notifications && notifications.length > 0}>
        Main Menu
      </SideBannerTitle>
      <div className="theme-menu-grid mt-1 grid grid-cols-2 gap-3">
        {systems.map((system) => {
          const disabled = system.requireAwake && userData.status !== "AWAKE";
          return (
            <Link key={system.href} href={system.href} id={system.id}>
              <Button
                decoration={variantClasses.rightMenuDecoration}
                className={cn(
                  variantClasses.rightMenuButton,
                  disabled
                    ? variantClasses.rightMenuDisabled
                    : variantClasses.rightMenuEnabled,
                )}
                count={system.notificationCount}
              >
                <div className="grow">{system.name}</div>
                <div>{system.icon}</div>
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
  const { data: userData } = useUserDataSelector((user) => ({ status: user.status }));
  const { data: users, isPending } = api.profile.getStrongestUsers.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
  });

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
                  <AvatarImage href={user.avatarLight} alt={user.username} size={100} />
                </div>
                <p className="col-span-5">{user.username}</p>
                <p className="col-span-4">{user.rankedLp}</p>
              </div>
            </Link>
          ))}
          {isPending && (
            <div className="flex flex-col items-center gap-1 pb-4">
              {Array.from(
                { length: STRONGEST_USERS_COUNT },
                (_, idx) => `menu-skeleton-${idx}`,
              ).map((key) => (
                <Skeleton
                  key={key}
                  className="h-9 w-[154px] w-full max-w-[154px] bg-muted/70 lg:h-10 lg:w-[200px] lg:max-w-[200px]"
                />
              ))}
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

/** Visitors without a character get the public sidebars on the frames that have them. */
const shouldShowPublicContent = ({
  variant,
  isSignedInLayout,
  accountState,
  userData,
}: Pick<
  LayoutLeftSidebarProps,
  "variant" | "isSignedInLayout" | "accountState" | "userData"
>) =>
  !userData &&
  (accountState === "create-character" ||
    (getGameLayout(variant).publicFrame === "game" && !isSignedInLayout));
