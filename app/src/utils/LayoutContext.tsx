"use client";

import type React from "react";
import { createContext, useContext } from "react";
import type { GameLayoutId } from "@/libs/gameLayouts";
import type { WallpaperVariant } from "@/libs/wallpaperExperiment";

const LayoutContext = createContext<GameLayoutId>("default");
const LayoutChangeContext = createContext<(layout: GameLayoutId) => void>(() => {});
export const useChangeLayout = () => useContext(LayoutChangeContext);
const WallpaperContext = createContext<WallpaperVariant | undefined>(undefined);
export const useWallpaperVariant = () => useContext(WallpaperContext);

const PixelLandingContext = createContext(false);

export const LayoutContextProvider: React.FC<{
  children: React.ReactNode;
  isPixelLanding: boolean;
  value: GameLayoutId;
  onLayoutChange?: (layout: GameLayoutId) => void;
  wallpaper?: WallpaperVariant;
}> = ({ children, isPixelLanding, value, onLayoutChange, wallpaper }) => {
  return (
    <LayoutContext value={value}>
      <LayoutChangeContext value={onLayoutChange ?? (() => {})}>
        <WallpaperContext value={wallpaper}>
          <PixelLandingContext value={isPixelLanding}>{children}</PixelLandingContext>
        </WallpaperContext>
      </LayoutChangeContext>
    </LayoutContext>
  );
};

export const useActiveLayout = () => {
  return useContext(LayoutContext);
};

export const useIsPixelLanding = () => {
  return useContext(PixelLandingContext);
};
