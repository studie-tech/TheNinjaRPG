"use client";

import { useEffect, useState } from "react";
import {
  readRenderQualityStatus,
  subscribeRenderQualityStatus,
} from "@/libs/rendering/renderQuality";
import {
  DEFAULT_VISUAL_EFFECTS,
  type RenderQuality,
  readRenderQuality,
  readVisualEffects,
  setRenderQuality,
  setVisualEffect,
  subscribeRenderQuality,
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

/** The device quality preference and what automatic quality is lowering on visible scenes. */
export const useRenderQuality = () => {
  const [quality, setQuality] = useState<RenderQuality>("auto");
  const [status, setStatus] = useState(readRenderQualityStatus);
  useEffect(() => {
    setQuality(readRenderQuality());
    setStatus(readRenderQualityStatus());
    const unsubscribeQuality = subscribeRenderQuality(setQuality);
    const unsubscribeStatus = subscribeRenderQualityStatus(() =>
      setStatus(readRenderQualityStatus()),
    );
    return () => {
      unsubscribeQuality();
      unsubscribeStatus();
    };
  }, []);
  return { quality, status, setRenderQuality };
};
