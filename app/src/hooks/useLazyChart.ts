import type { Chart } from "chart.js/auto";
import type { DependencyList, RefObject } from "react";
import { useEffect, useState } from "react";

/**
 * Draws one chart on `canvasRef`, loading chart.js only when it is needed: chart.js/auto
 * registers every controller, so nothing tree-shakes it out of a static import.
 *
 * `draw` runs after the import with the constructor and canvas, and returns the new chart.
 * Pass null while there is nothing to draw. It redraws when `deps` change, like an effect:
 * keep them stable, because each change destroys the chart and starts a fresh import.
 * A superseded or unmounted run never draws, and the chart is destroyed on cleanup.
 *
 * @returns Whether the import or the draw failed for the current `deps`, so the caller can
 * show a fallback. A chunk can 404 after a deploy. The flag belongs to the failed deps, so a
 * fallback that replaces the canvas gives it back in the render that starts the next run.
 */
export const useLazyChart = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: ((ChartJS: typeof Chart, canvas: HTMLCanvasElement) => ChartHandle) | null,
  deps: DependencyList,
) => {
  const [failedDeps, setFailedDeps] = useState<DependencyList | null>(null);
  useEffect(() => {
    if (!draw) return;
    let cancelled = false;
    let chart: ChartHandle | undefined;
    setFailedDeps(null);
    void (async () => {
      try {
        const { Chart: ChartJS } = await import("chart.js/auto");
        if (cancelled || !canvasRef.current) return;
        chart = draw(ChartJS, canvasRef.current);
      } catch (error) {
        console.error("Could not draw the chart", error);
        if (!cancelled) setFailedDeps(deps);
      }
    })();
    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, deps);
  return !!failedDeps && isSameDeps(failedDeps, deps);
};

/** Match React's dependency equality so failures belong only to the inputs that failed. */
const isSameDeps = (a: DependencyList, b: DependencyList) =>
  a.length === b.length && a.every((dep, index) => Object.is(dep, b[index]));

/** Only destroy() is called on a drawn chart, and its generics vary per dataset shape. */
type ChartHandle = { destroy: () => void };
