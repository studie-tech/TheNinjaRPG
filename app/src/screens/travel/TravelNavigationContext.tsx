"use client";

import { createContext } from "react";

/** A retained travel view renders its navigation into the host's bottom-bar slots. */
export const TravelNavigationContext = createContext<{
  controls: HTMLElement | null;
  view: HTMLElement | null;
} | null>(null);
