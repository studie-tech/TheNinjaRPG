"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";
import { createDockMotion } from "@/libs/dockMotion";

/**
 * Moves the Activity dock when its place changes. Rendered as the dock's first child: React
 * updates a child before its parent, so the effect's cleanup still finds the dock where the
 * player sees it.
 */
export const DockMotion = ({
  dockRef,
  place,
  isOpen,
  isPlaced,
}: {
  dockRef: RefObject<HTMLElement | null>;
  /** Names the place the dock is in. */
  place: string;
  isOpen: boolean;
  /** The dock stands beside its subject, hung from its top. */
  isPlaced: boolean;
}) => {
  const motionRef = useRef<ReturnType<typeof createDockMotion> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `place` is what moves the dock.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const motion = motionRef.current ?? createDockMotion(dock);
    motionRef.current = motion;
    motion.arrive({ isOpen, isPlaced });
    return () => motion.leave(isOpen);
  }, [dockRef, place, isOpen, isPlaced]);
  return null;
};
