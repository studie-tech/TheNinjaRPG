import type React from "react";
import type { GameSettingsUser } from "@/layout/GameSettings";
import type { GameLayoutId } from "@/libs/gameLayouts";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { MobileNavConfig } from "@/libs/mobileNavConfig";
import type { UserWithRelations } from "@/routers/profile";
import type { getImageSet, layoutVariantClasses } from "./layoutVariants";

export type GameLayoutVariantClasses = (typeof layoutVariantClasses)[GameLayoutId];
export type LayoutImageSet = ReturnType<typeof getImageSet>;

/** Profile fields rendered by the shell, independent of map position. */
export type LayoutUserData = GameSettingsUser &
  Pick<
    NonNullable<UserWithRelations>,
    "userId" | "username" | "status" | "village" | "tutorialOn" | "tutorialStep"
  >;

export interface GameLayoutRenderProps {
  children: React.ReactNode;
  variant: GameLayoutId;
  userData?: LayoutUserData | null;
  isSignedInLayout: boolean;
  pathname: string;
  navbarMenuItems: NavBarDropdownLink[];
  shownNotifications: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
  leftSideBarOpen: boolean;
  onLeftSideBarOpenChange: (open: boolean) => void;
  rightSideBarOpen: boolean;
  onRightSideBarOpenChange: (open: boolean) => void;
  rightSideBarRef: React.RefObject<HTMLDivElement | null>;
  mobileNavConfig: MobileNavConfig;
  signedInIcons: React.ReactNode;
  leftSideBar: React.ReactNode;
  rightSideBar: React.ReactNode;
  leftSideBarMainMenu: React.ReactNode;
  handleRightSidebarClick: React.MouseEventHandler<HTMLDivElement>;
  lightLayout: boolean;
  toggleLightLayout: () => void;
  imageset: LayoutImageSet;
  variantClasses: GameLayoutVariantClasses;
  showMobileNotifications: boolean;
}

export type GameLayoutRenderer = React.FC<GameLayoutRenderProps>;

export interface GameLayoutControllerProps {
  variant: GameLayoutId;
  renderer: GameLayoutRenderer;
  initialIsSignedIn?: boolean;
  children: React.ReactNode;
}
