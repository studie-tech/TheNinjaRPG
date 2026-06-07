import type React from "react";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { MobileNavConfig } from "@/libs/mobileNavConfig";
import type { UserWithRelations } from "@/routers/profile";
import type {
  getImageSet,
  LayoutVariant,
  layoutVariantClasses,
} from "./layoutVariants";

export type GameLayoutVariant = LayoutVariant;
export type GameLayoutVariantClasses = (typeof layoutVariantClasses)[GameLayoutVariant];
export type LayoutImageSet = ReturnType<typeof getImageSet>;

export interface GameLayoutRenderProps {
  children: React.ReactNode;
  variant: GameLayoutVariant;
  userData?: UserWithRelations | null;
  isClerkLoaded: boolean;
  isSignedInLayout: boolean;
  isAnonymousLayout: boolean;
  pathname: string;
  navbarMenuItems: NavBarDropdownLink[];
  navbarMenuItemsLeft: NavBarDropdownLink[];
  navbarMenuItemsRight: NavBarDropdownLink[];
  shownNotifications?: NavBarDropdownLink[];
  systems: NavBarDropdownLink[];
  location?: NavBarDropdownLink;
  leftSideBarOpen: boolean;
  setLeftSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightSideBarOpen: boolean;
  setRightSideBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  mobileNotificationCount: number;
}

export type GameLayoutRenderer = React.FC<GameLayoutRenderProps>;

export interface GameLayoutControllerProps {
  variant: GameLayoutVariant;
  renderer: GameLayoutRenderer;
  initialIsSignedIn?: boolean;
  children: React.ReactNode;
}
