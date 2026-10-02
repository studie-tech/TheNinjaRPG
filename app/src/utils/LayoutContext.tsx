"use client";

import type React from "react";
import { createContext, useContext } from "react";
import type { EffectiveLayout } from "@/libs/layoutPreference";
import type { WallpaperVariant } from "@/libs/wallpaperExperiment";

const LayoutContext = createContext<EffectiveLayout>("default");
const WallpaperContext = createContext<WallpaperVariant | undefined>(undefined);
export const useWallpaperVariant = () => useContext(WallpaperContext);

const PixelLandingContext = createContext(false);

export const LayoutContextProvider: React.FC<{
  children: React.ReactNode;
  isPixelLanding: boolean;
  value: EffectiveLayout;
  wallpaper?: WallpaperVariant;
}> = ({ children, isPixelLanding, value, wallpaper }) => {
  return (
    <LayoutContext value={value}>
      <WallpaperContext value={wallpaper}>
        <PixelLandingContext value={isPixelLanding}>{children}</PixelLandingContext>
      </WallpaperContext>
    </LayoutContext>
  );
};

export const useActiveLayout = () => {
  return useContext(LayoutContext);
};

export const useIsPixelLanding = () => {
  return useContext(PixelLandingContext);
};
