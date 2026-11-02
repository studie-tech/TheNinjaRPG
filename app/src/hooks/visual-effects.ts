"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_VISUAL_EFFECTS,
  readVisualEffects,
  setVisualEffect,
  subscribeVisualEffects,
  type VisualEffects,
} from "@/libs/visualEffects";

/** Hydrates device graphics preferences and keeps open settings and scene controls in sync. */
export const useVisualEffects = () => {
  const [visualEffects, setVisualEffects] =
    useState<VisualEffects>(DEFAULT_VISUAL_EFFECTS);
  useEffect(() => {
    setVisualEffects(readVisualEffects());
    return subscribeVisualEffects((effect, enabled) =>
      setVisualEffects((current) => ({ ...current, [effect]: enabled })),
    );
  }, []);
  return { visualEffects, setVisualEffect };
};
