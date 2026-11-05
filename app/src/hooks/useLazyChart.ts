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
 * @returns Whether the import or the draw failed, so the caller can show a fallback. A chunk
 * can 404 after a deploy. The next run clears the flag.
 */
export const useLazyChart = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: ((ChartJS: typeof Chart, canvas: HTMLCanvasElement) => ChartHandle) | null,
  deps: DependencyList,
) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!draw) return;
    let cancelled = false;
    let chart: ChartHandle | undefined;
    setFailed(false);
    void (async () => {
      try {
        const { Chart: ChartJS } = await import("chart.js/auto");
        if (cancelled || !canvasRef.current) return;
        chart = draw(ChartJS, canvasRef.current);
      } catch (error) {
        console.error("Could not draw the chart", error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, deps);
  return failed;
};

/** Only destroy() is called on a drawn chart, and its generics vary per dataset shape. */
type ChartHandle = { destroy: () => void };
