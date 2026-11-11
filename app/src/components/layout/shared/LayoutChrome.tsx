"use client";

import { MessageCircle, Music } from "lucide-react";
import type React from "react";
import { Suspense } from "react";
import { SheetHeader } from "@/components/ui/sheet";
import Loader from "@/layout/Loader";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { cn } from "@/libs/shadui";

/** The signed-in chat button sits above the tutorial spotlight, but beneath any open dialog or sheet. */
export const CHAT_BUTTON_LAYER = "z-[65] in-[body[data-scroll-locked]]:z-40";

/** Desktop help button of the Classic and Pixel frames; signed-in players follow the dock side. */
export const FloatingHelpButton: React.FC<{
  hasCharacter: boolean;
  swapSides: boolean;
  iconClassName: string;
}> = ({ hasCharacter, swapSides, iconClassName }) => (
  <div
    data-battle-focus-layer
    className={cn(
      "fixed bottom-1 rounded-full bg-slate-500",
      hasCharacter
        ? cn(
            CHAT_BUTTON_LAYER,
            "md:bottom-5",
            swapSides ? "left-1 md:left-5" : "right-1 md:right-5",
          )
        : "right-1 z-50 md:right-5 md:bottom-5",
    )}
  >
    <LowerRightHelpBtn className="hidden md:block">
      {hasCharacter ? (
        <MessageCircle className={cn(iconClassName)} />
      ) : (
        <Music className={cn(iconClassName)} />
      )}
    </LowerRightHelpBtn>
  </div>
);

/** Left mobile sheet stack: in combat the sidebar takes priority over the main menu. */
export const MobileSidebarStack: React.FC<{
  isCombat: boolean;
  leftSideBar: React.ReactNode;
  mainMenu: React.ReactNode;
}> = ({ isCombat, leftSideBar, mainMenu }) => {
  const sidebar = <div className="relative pt-4">{leftSideBar}</div>;
  return (
    <Suspense fallback={<Loader explanation="Loading..." />}>
      {isCombat ? (
        <>
          {sidebar}
          {mainMenu}
        </>
      ) : (
        <>
          {mainMenu}
          {sidebar}
        </>
      )}
    </Suspense>
  );
};

/** Right mobile sheet body; delegated clicks decide whether navigation closes the sheet. */
export const RightSheetBody: React.FC<{
  headerClassName?: string;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}> = ({ headerClassName, sidebarRef, onClick, children }) => (
  <Suspense fallback={<Loader explanation="Loading..." />}>
    <SheetHeader className={headerClassName}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Sheet panel - clicking outside content closes it, keyboard handled by Sheet component */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Sheet panel uses click to close when clicking non-interactive areas */}
      <div ref={sidebarRef} onClick={onClick}>
        {children}
      </div>
    </SheetHeader>
  </Suspense>
);
