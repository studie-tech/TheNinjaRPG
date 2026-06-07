"use client";

import type React from "react";
import { createContext, useContext } from "react";
import type { EffectiveLayout } from "@/libs/layoutPreference";

const LayoutContext = createContext<EffectiveLayout>("default");
const PixelLandingContext = createContext(false);

export const LayoutContextProvider: React.FC<{
  children: React.ReactNode;
  isPixelLanding: boolean;
  value: EffectiveLayout;
}> = ({ children, isPixelLanding, value }) => {
  return (
    <LayoutContext value={value}>
      <PixelLandingContext value={isPixelLanding}>{children}</PixelLandingContext>
    </LayoutContext>
  );
};

export const useActiveLayout = () => {
  return useContext(LayoutContext);
};

export const useIsPixelLanding = () => {
  return useContext(PixelLandingContext);
};
