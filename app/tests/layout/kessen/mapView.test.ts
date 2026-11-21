import { describe, expect, it } from "bun:test";
import {
  centerOn,
  clampView,
  ensureVisible,
  FIT_VIEW,
  LABEL_MIN_SCALE,
  labelsShown,
  MAP_DESIGN_WIDTH,
  maxZoomFor,
  panBy,
  pinScale,
  sameView,
  zoomAt,
} from "@/layout/kessen/hub/mapView";

const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9);

describe("Circuit map view", () => {
  it("lets phones zoom until the pins pass their design size, wide frames 2x", () => {
    expect(maxZoomFor(360)).toBeCloseTo(2.5);
    expect(maxZoomFor(200)).toBe(4);
    expect(maxZoomFor(1100)).toBe(2);
    expect(maxZoomFor(0)).toBe(1);
  });

  it("scales pins with the map, capped on wide frames, and hides plates when tiny", () => {
    expect(pinScale(MAP_DESIGN_WIDTH, 1)).toBe(1);
    expect(pinScale(360, 1)).toBe(0.5);
    expect(pinScale(360, 2)).toBe(1);
    expect(pinScale(2000, 1)).toBe(1.4);
    expect(labelsShown(pinScale(360, 1))).toBe(false);
    expect(labelsShown(pinScale(360, 1.5))).toBe(true);
    expect(labelsShown(LABEL_MIN_SCALE)).toBe(true);
  });

  it("clamps the zoom and keeps the map covering the frame", () => {
    expect(clampView({ zoom: 0.5, x: 0.3, y: -2 }, 3)).toEqual(FIT_VIEW);
    expect(clampView({ zoom: 5, x: -10, y: 1 }, 3)).toEqual({ zoom: 3, x: -2, y: 0 });
    expect(clampView({ zoom: 2, x: -0.5, y: -0.25 }, 3)).toEqual({
      zoom: 2,
      x: -0.5,
      y: -0.25,
    });
  });

  it("zooms around an anchor, keeping the map point under it in place", () => {
    const view = zoomAt(FIT_VIEW, 2, 0.25, 0.75, 4);
    expect(view.zoom).toBe(2);
    // The map point (0.25, 0.75) stays at frame point (0.25, 0.75).
    close(view.x + 0.25 * view.zoom, 0.25);
    close(view.y + 0.75 * view.zoom, 0.75);
    // Zooming back out at the same anchor returns to the fitted map.
    expect(sameView(zoomAt(view, 1, 0.25, 0.75, 4), FIT_VIEW)).toBe(true);
    // Near an edge the clamp wins over the anchor.
    const edge = zoomAt(FIT_VIEW, 2, 0, 0, 4);
    expect(edge).toEqual({ zoom: 2, x: 0, y: 0 });
  });

  it("centres a pin when it can and stops at the map's edges", () => {
    const middle = centerOn(2, 0.5, 0.5, 4);
    expect(middle).toEqual({ zoom: 2, x: -0.5, y: -0.5 });
    const corner = centerOn(2, 0.9, 0.1, 4);
    expect(corner).toEqual({ zoom: 2, x: -1, y: 0 });
    expect(centerOn(10, 0.5, 0.5, 3).zoom).toBe(3);
  });

  it("pans only while zoomed in", () => {
    expect(panBy(FIT_VIEW, 0.2, -0.2, 4)).toEqual(FIT_VIEW);
    expect(panBy({ zoom: 2, x: -0.5, y: -0.5 }, 0.2, -0.2, 4)).toEqual({
      zoom: 2,
      x: -0.3,
      y: -0.7,
    });
    expect(panBy({ zoom: 2, x: -0.5, y: -0.5 }, 3, -3, 4)).toEqual({
      zoom: 2,
      x: 0,
      y: -1,
    });
  });

  it("pans the least distance that brings a focused pin inside the margins", () => {
    const view = { zoom: 2, x: 0, y: 0 };
    // Already inside: unchanged.
    expect(ensureVisible(view, 0.2, 0.2, 0.1, 0.1, 4)).toBe(view);
    // The pin at map (0.8, 0.3) sits at frame (1.6, 0.6): pan left to 0.9 of the frame.
    const shown = ensureVisible(view, 0.8, 0.3, 0.1, 0.1, 4);
    close(shown.x + 0.8 * 2, 0.9);
    expect(shown.y).toBe(0);
  });
});
