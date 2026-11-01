"use client";

import { useEffect, useState } from "react";
import {
  readVisualEffects,
  setVisualEffect,
  subscribeVisualEffects,
  type VisualEffects,
} from "@/libs/visualEffects";

/** Hydrates device graphics preferences and keeps open settings and scene controls in sync. */
export const useVisualEffects = () => {
  const [visualEffects, setVisualEffects] = useState<VisualEffects>({
    lighting: true,
    shadows: true,
    animations: true,
  });
  useEffect(() => {
    setVisualEffects(readVisualEffects());
    return subscribeVisualEffects((effect, enabled) =>
      setVisualEffects((current) => ({ ...current, [effect]: enabled })),
    );
  }, []);
  return { visualEffects, setVisualEffect };
};
