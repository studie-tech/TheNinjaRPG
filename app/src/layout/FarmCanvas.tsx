"use client";

import { memo, type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { useGameScene } from "@/hooks/game-scene";
import { useVisualEffects } from "@/hooks/visual-effects";
import WebGlError from "@/layout/WebGLError";
import { createFarmScene } from "@/libs/rendering/scenes/farm";
import { FARM_CANVAS_MIN_HEIGHT } from "@/libs/rendering/scenes/farmLayout";
import { useUserInfo } from "@/utils/UserContext";
import type { FarmEffect, FarmVisualState } from "@/validators/farming";

export type FarmCanvasHandle = {
  updateState: (state: FarmVisualState) => void;
  expandGrid: (newTotalPlots: number, newSlotIndex: number) => void;
  playEffect: (slotIndex: number, effect: FarmEffect) => void;
};

type FarmCanvasProps = {
  initialState: FarmVisualState;
  onPlotClick: (slotIndex: number) => void;
  /** A press on the field outside every plot. */
  onFieldClick?: () => void;
  ref?: Ref<FarmCanvasHandle>;
};

const FarmCanvasInner = ({
  initialState,
  onPlotClick,
  onFieldClick,
  ref,
}: FarmCanvasProps) => {
  const { timeDiff } = useUserInfo();
  const { visualEffects } = useVisualEffects();
  const showDayNightMapOverlays = visualEffects.dayNight;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const current = useRef({
    timeDiff,
    showDayNightMapOverlays,
    onPlotClick,
    onFieldClick,
    state: initialState,
  });
  current.current.timeDiff = timeDiff;
  current.current.showDayNightMapOverlays = showDayNightMapOverlays;
  current.current.onPlotClick = onPlotClick;
  current.current.onFieldClick = onFieldClick;
  const { scene, error, isReady } = useGameScene(
    "farm",
    mountRef,
    async (mount, signal, onError) => {
      const instance = await createFarmScene({
        mount,
        signal,
        onError,
        initialState: current.current.state,
        getTimeDiff: () => current.current.timeDiff,
        showDayNight: () => current.current.showDayNightMapOverlays,
        onPlotClick: (slot) => current.current.onPlotClick(slot),
        onFieldClick: () => current.current.onFieldClick?.(),
      });
      // Server state can arrive while the renderer and artwork are loading.
      if (!signal.aborted) instance.updateState(current.current.state);
      return instance;
    },
  );
  useImperativeHandle(ref, () => ({
    updateState: (state) => {
      current.current.state = state;
      scene.current?.updateState(state);
    },
    expandGrid: (total, slot) => {
      current.current.state = { ...current.current.state, totalPlots: total };
      scene.current?.expandGrid(total, slot);
    },
    playEffect: (slot, effect) => scene.current?.playEffect(slot, effect),
  }));
  useEffect(() => {
    scene.current?.refresh();
  }, [scene, isReady, timeDiff, showDayNightMapOverlays]);
  if (error) return <WebGlError />;
  return (
    <div
      ref={mountRef}
      className="w-full rounded-lg border bg-emerald-900/40"
      style={{ minHeight: FARM_CANVAS_MIN_HEIGHT }}
    />
  );
};

const propsAreEqual = (prev: FarmCanvasProps, next: FarmCanvasProps) =>
  prev.onPlotClick === next.onPlotClick &&
  prev.onFieldClick === next.onFieldClick &&
  prev.ref === next.ref;

export const FarmCanvas = memo(FarmCanvasInner, propsAreEqual);
