"use client";

import { memo, type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { FARM_PLOT_COLUMNS } from "@/drizzle/constants";
import { useDayNightMapOverlays } from "@/hooks/day-night-overlay";
import { useGameScene } from "@/hooks/game-scene";
import WebGlError from "@/layout/WebGLError";
import { createFarmScene } from "@/libs/rendering/scenes/farm";
import { FARM_CANVAS_MIN_HEIGHT } from "@/libs/rendering/scenes/farmLayout";
import { useUserData } from "@/utils/UserContext";
import type { FarmEffect, FarmPlotState, FarmVisualState } from "@/validators/farming";

export type FarmCanvasHandle = {
  updateState: (state: FarmVisualState) => void;
  expandGrid: (newTotalPlots: number, newSlotIndex: number) => void;
  playEffect: (slotIndex: number, effect: FarmEffect) => void;
};

type FarmCanvasProps = {
  initialState: FarmVisualState;
  onPlotClick: (slotIndex: number, plot: FarmPlotState | undefined) => void;
  ref?: Ref<FarmCanvasHandle>;
};

const FarmCanvasInner = ({ initialState, onPlotClick, ref }: FarmCanvasProps) => {
  const { timeDiff } = useUserData();
  const { showDayNightMapOverlays } = useDayNightMapOverlays();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const current = useRef({
    timeDiff,
    showDayNightMapOverlays,
    onPlotClick,
    state: initialState,
  });
  current.current.timeDiff = timeDiff;
  current.current.showDayNightMapOverlays = showDayNightMapOverlays;
  current.current.onPlotClick = onPlotClick;
  const { scene, error, isReady } = useGameScene(
    mountRef,
    async (mount, signal, onError) => {
      const instance = await createFarmScene({
        mount,
        signal,
        onError,
        initialState: current.current.state,
        getTimeDiff: () => current.current.timeDiff,
        showDayNight: () => current.current.showDayNightMapOverlays,
        onPlotClick: (slot, plot) => current.current.onPlotClick(slot, plot),
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
  prev.onPlotClick === next.onPlotClick && prev.ref === next.ref;

export const FarmCanvas = memo(FarmCanvasInner, propsAreEqual);

export const getPlotIdBySlot = (plots: FarmPlotState[], slotIndex: number) =>
  plots.find((plot) => plot.slotIndex === slotIndex)?.id;

export const estimateFarmGridRows = (totalPlots: number) =>
  Math.ceil(totalPlots / FARM_PLOT_COLUMNS);
