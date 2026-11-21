"use client";

import { useLightLayout } from "@/hooks/light-layout";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useVisualEffects } from "@/hooks/visual-effects";

/**
 * Whether Kessen may animate: the visitor allows motion, game animations are on and the
 * light layout is off. Components render `data-motion` from it; kessen.css runs every
 * animation only under `[data-motion="on"]`, so a gated element shows its final frame.
 */
export const useKessenMotion = (override?: boolean) => {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lightLayout = useLightLayout();
  const { visualEffects } = useVisualEffects();
  if (override !== undefined) return override && !reducedMotion;
  return !reducedMotion && !lightLayout && visualEffects.spriteAnimations;
};
