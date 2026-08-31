"use client";

import {
  memo,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Clock,
  type Mesh,
  OrthographicCamera,
  type Raycaster,
  type Scene,
  type WebGLRenderer,
} from "three";
import { FARM_PLOT_COLUMNS } from "@/drizzle/constants";
import { useDayNightMapOverlays } from "@/hooks/day-night-overlay";
import { usePerformanceMonitor } from "@/hooks/performance-monitor";
import WebGlError from "@/layout/WebGLError";
import { getWorldCycleBrightness } from "@/libs/dayNight";
import { getPlotGrowthStage, isPlotReady } from "@/libs/farming";
import {
  createGroundDayNightOverlay,
  updateDayNightOverlay,
} from "@/libs/threejs/dayNight";
import {
  animateFarmEffects,
  animatePlotEntries,
  createFarmGroups,
  createPlotMesh,
  drawFarmBackground,
  getPlotGridPosition,
  type PlotMeshEntry,
  startFarmEffect,
  startPlotExpandAnimation,
  syncPlotVisual,
  updatePlotHoverRing,
  updatePlotSelectionRing,
} from "@/libs/threejs/farming";
import { cleanUp, setRaycasterFromMouse, setupScene } from "@/libs/threejs/util";
import { useUserData } from "@/utils/UserContext";
import type { FarmPlotState, FarmVisualState } from "@/validators/farming";

export type FarmCanvasHandle = {
  updateState: (state: FarmVisualState) => void;
  expandGrid: (newTotalPlots: number, newSlotIndex: number) => void;
  playEffect: (
    slotIndex: number,
    effect: import("@/validators/farming").FarmEffect,
  ) => void;
};

type FarmCanvasProps = {
  initialState: FarmVisualState;
  onPlotClick: (slotIndex: number, plot: FarmPlotState | undefined) => void;
  ref?: Ref<FarmCanvasHandle>;
};

const FarmCanvasInner = ({ initialState, onPlotClick, ref }: FarmCanvasProps) => {
  const performanceMonitor = usePerformanceMonitor(false);
  const { timeDiff } = useUserData();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const cameraRef = useRef<OrthographicCamera | null>(null);
  const raycasterRef = useRef<Raycaster | null>(null);
  const groupsRef = useRef<ReturnType<typeof createFarmGroups> | null>(null);
  const plotEntriesRef = useRef<PlotMeshEntry[]>([]);
  const farmStateRef = useRef<FarmVisualState>(initialState);
  const selectedSlotRef = useRef<number | null>(null);
  const hoveredSlotRef = useRef<number | null>(null);
  const onPlotClickRef = useRef(onPlotClick);
  const timeDiffRef = useRef(timeDiff);
  const dayNightOverlayRef = useRef<Mesh | null>(null);
  const { showDayNightMapOverlays } = useDayNightMapOverlays();
  const showDayNightMapOverlaysRef = useRef(showDayNightMapOverlays);
  const [webglError, setWebglError] = useState(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    onPlotClickRef.current = onPlotClick;
  }, [onPlotClick]);

  useEffect(() => {
    timeDiffRef.current = timeDiff;
  }, [timeDiff]);

  useEffect(() => {
    showDayNightMapOverlaysRef.current = showDayNightMapOverlays;
  }, [showDayNightMapOverlays]);

  const refreshPlotVisuals = (selectedSlot: number | null) => {
    const groups = groupsRef.current;
    if (!groups) return;
    const now = new Date(Date.now() - timeDiffRef.current);
    const plotsBySlot = new Map(
      farmStateRef.current.plots.map((plot) => [
        plot.slotIndex,
        deriveLivePlotState(plot, now),
      ]),
    );
    for (const entry of plotEntriesRef.current) {
      syncPlotVisual(entry, plotsBySlot.get(entry.slotIndex), groups);
      updatePlotSelectionRing(entry, groups, selectedSlot === entry.slotIndex);
    }
  };

  useImperativeHandle(ref, () => ({
    updateState: (state: FarmVisualState) => {
      farmStateRef.current = state;
      selectedSlotRef.current = state.selectedPlotIndex ?? null;
      refreshPlotVisuals(selectedSlotRef.current);
    },
    expandGrid: (newTotalPlots: number, newSlotIndex: number) => {
      const groups = groupsRef.current;
      if (!groups) return;
      if (plotEntriesRef.current.some((e) => e.slotIndex === newSlotIndex)) return;

      // Reposition existing plots — grid centering shifts when a new row is added
      for (const existing of plotEntriesRef.current) {
        const position = getPlotGridPosition(existing.slotIndex, newTotalPlots);
        existing.soil.position.set(position.x, 0.01, position.z);
      }

      const entry = createPlotMesh(newSlotIndex, newTotalPlots);
      if (!reducedMotionRef.current) startPlotExpandAnimation(entry);
      groups.plots.add(entry.soil);
      plotEntriesRef.current.push(entry);
      farmStateRef.current = {
        ...farmStateRef.current,
        totalPlots: newTotalPlots,
      };
      refreshPlotVisuals(selectedSlotRef.current);
    },
    playEffect: (slotIndex, effect) => {
      const groups = groupsRef.current;
      const entry = plotEntriesRef.current.find((plot) => plot.slotIndex === slotIndex);
      if (!groups || !entry) return;
      startFarmEffect(groups.effects, entry, effect, reducedMotionRef.current);
    },
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = motionQuery.matches;
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    motionQuery.addEventListener("change", onMotionPreferenceChange);

    const width = mount.getBoundingClientRect().width || 640;
    const height = Math.max(360, width * 0.55);
    const { scene, renderer, raycaster, handleResize } = setupScene({
      mountRef,
      width,
      height,
      sortObjects: true,
      color: 0x87ae73,
      colorAlpha: 1,
      width2height: height / width,
    });

    if (!renderer) {
      setWebglError(true);
      return () => {
        motionQuery.removeEventListener("change", onMotionPreferenceChange);
        window.removeEventListener("resize", handleResize);
      };
    }

    sceneRef.current = scene;
    rendererRef.current = renderer;
    raycasterRef.current = raycaster;

    const frustumSize = 14;
    const aspect = width / height;
    const camera = new OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100,
    );
    camera.position.set(0, 20, 0);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 0, -1);
    cameraRef.current = camera;

    const groups = createFarmGroups();
    groupsRef.current = groups;
    drawFarmBackground(groups.background, frustumSize * aspect, frustumSize);
    scene.add(groups.background, groups.plots, groups.crops, groups.effects, groups.ui);

    plotEntriesRef.current = [];
    for (let i = 0; i < farmStateRef.current.totalPlots; i++) {
      const entry = createPlotMesh(i, farmStateRef.current.totalPlots);
      groups.plots.add(entry.soil);
      plotEntriesRef.current.push(entry);
    }
    refreshPlotVisuals(null);
    dayNightOverlayRef.current = createGroundDayNightOverlay(groups.ui);
    updateDayNightOverlay(
      dayNightOverlayRef.current,
      getWorldCycleBrightness(new Date(Date.now() - timeDiffRef.current)),
      showDayNightMapOverlaysRef.current,
    );

    mount.appendChild(renderer.domElement);

    const setHoveredSlot = (slotIndex: number | null) => {
      if (hoveredSlotRef.current === slotIndex) return;
      hoveredSlotRef.current = slotIndex;
      for (const entry of plotEntriesRef.current) {
        updatePlotHoverRing(entry, groups, entry.slotIndex === slotIndex);
      }
      mount.style.cursor = slotIndex === null ? "default" : "pointer";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!raycasterRef.current || !cameraRef.current) return;
      setRaycasterFromMouse(raycasterRef.current, mount, event, cameraRef.current);
      const intersects = raycasterRef.current.intersectObjects(groups.plots.children);
      const hit = intersects[0];
      setHoveredSlot(
        hit?.object.userData.slotIndex !== undefined
          ? (hit.object.userData.slotIndex as number)
          : null,
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      onPointerMove(event);
      const slotIndex = hoveredSlotRef.current;
      if (slotIndex === null) return;
      const plot = farmStateRef.current.plots.find((p) => p.slotIndex === slotIndex);
      onPlotClickRef.current(
        slotIndex,
        plot
          ? deriveLivePlotState(plot, new Date(Date.now() - timeDiffRef.current))
          : undefined,
      );
    };

    const onPointerLeave = () => setHoveredSlot(null);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerdown", onPointerDown);
    mount.addEventListener("pointerleave", onPointerLeave);

    const clock = new Clock();
    let animationId: number;
    let refreshElapsed = 0;
    const REFRESH_INTERVAL = 2;

    const animate = () => {
      performanceMonitor.begin();
      const delta = clock.getDelta();
      animatePlotEntries(plotEntriesRef.current, delta, reducedMotionRef.current);
      animateFarmEffects(groups.effects, delta);

      if (dayNightOverlayRef.current) {
        // Same server-corrected clock the plot state uses. Left on the raw client clock the
        // overlay can show night while the rest of the page is still in day.
        updateDayNightOverlay(
          dayNightOverlayRef.current,
          getWorldCycleBrightness(new Date(Date.now() - timeDiffRef.current)),
          showDayNightMapOverlaysRef.current,
        );
      }

      // Refresh growth stages periodically without full React re-render
      refreshElapsed += delta;
      if (refreshElapsed >= REFRESH_INTERVAL) {
        refreshElapsed = 0;
        refreshPlotVisuals(selectedSlotRef.current);
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      performanceMonitor.end();
      animationId = performanceMonitor.requestFrame(animate);
    };
    animationId = performanceMonitor.requestFrame(animate);

    return () => {
      performanceMonitor.cancelFrame(animationId);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerdown", onPointerDown);
      mount.removeEventListener("pointerleave", onPointerLeave);
      motionQuery.removeEventListener("change", onMotionPreferenceChange);
      window.removeEventListener("resize", handleResize);
      if (scene && renderer) cleanUp(scene, renderer);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  if (webglError) return <WebGlError />;

  return (
    <div
      ref={mountRef}
      className="w-full rounded-lg border bg-emerald-900/40"
      style={{ minHeight: 360 }}
    />
  );
};

const propsAreEqual = (prev: FarmCanvasProps, next: FarmCanvasProps) =>
  prev.onPlotClick === next.onPlotClick && prev.ref === next.ref;

export const FarmCanvas = memo(FarmCanvasInner, propsAreEqual);

export const getPlotIdBySlot = (plots: FarmPlotState[], slotIndex: number) =>
  plots.find((p) => p.slotIndex === slotIndex)?.id;

export const estimateFarmGridRows = (totalPlots: number) =>
  Math.ceil(totalPlots / FARM_PLOT_COLUMNS);

const deriveLivePlotState = (plot: FarmPlotState, now = new Date()) => {
  const isActive = !!plot.seedItemId && !!plot.plantedAt && !!plot.finishAt;
  return {
    ...plot,
    isReady: isActive && isPlotReady(plot.finishAt, now),
    growthStage: isActive ? getPlotGrowthStage(plot.plantedAt, plot.finishAt, now) : 0,
  };
};
