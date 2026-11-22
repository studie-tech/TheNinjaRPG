/**
 * Zoom and pan of the Circuit map, as pure view arithmetic. A view is the zoom factor
 * over the fitted map (1 = the whole map fills its frame) and the map layer's offset in
 * fractions of the frame (`x` in [1 - zoom, 0], `y` likewise), so a resized frame keeps
 * the same part of the map in view. Points are fractions too: of the frame for anchors,
 * of the map for pins.
 */

import { clamp } from "@/utils/math";

export type MapView = { zoom: number; x: number; y: number };

/** The whole map fitted to its frame. */
export const FIT_VIEW: MapView = { zoom: 1, x: 0, y: 0 };

/** Map width (CSS px) at which pins are drawn at their design size. */
export const MAP_DESIGN_WIDTH = 720;

/** Largest pin scale: wide screens grow the pins with the map up to this factor. */
const MAX_PIN_SCALE = 1.4;

/**
 * Below this pin scale the name plates would read under 11 px, so the map shows only the
 * plate of the pin in hand (selected, hovered or focused) until the player zooms in.
 */
export const LABEL_MIN_SCALE = 0.72;

/** Each zoom button press multiplies or divides the zoom by this factor. */
export const ZOOM_STEP = 1.5;

/**
 * The deepest zoom for a frame of `width` CSS px: enough to draw the pins at their design
 * size on a phone, and at least a 2x close-up on wide frames.
 */
export const maxZoomFor = (width: number) => {
  if (!(width > 0)) return 1;
  return Math.min(4, Math.max(2, (1.25 * MAP_DESIGN_WIDTH) / width));
};

/** Pin scale for a frame of `width` CSS px at `zoom`. */
export const pinScale = (width: number, zoom: number) =>
  Math.min(MAX_PIN_SCALE, (Math.max(0, width) * zoom) / MAP_DESIGN_WIDTH);

/** Whether every pin shows its name plate at this pin scale. */
export const labelsShown = (scale: number) => scale >= LABEL_MIN_SCALE;

/** The view with its zoom inside [1, maxZoom] and the map covering the whole frame. */
export const clampView = (view: MapView, maxZoom: number): MapView => {
  const zoom = clamp(view.zoom, 1, Math.max(1, maxZoom));
  return {
    zoom,
    x: clamp(view.x, 1 - zoom, 0),
    y: clamp(view.y, 1 - zoom, 0),
  };
};

/**
 * Zooms to `zoom` keeping the map point under the frame point (`ax`, `ay`) in place: the
 * pinch midpoint or the wheel's pointer.
 */
export const zoomAt = (
  view: MapView,
  zoom: number,
  ax: number,
  ay: number,
  maxZoom: number,
): MapView => {
  const next = clamp(zoom, 1, Math.max(1, maxZoom));
  const u = (ax - view.x) / view.zoom;
  const v = (ay - view.y) / view.zoom;
  return clampView({ zoom: next, x: ax - u * next, y: ay - v * next }, maxZoom);
};

/**
 * Zooms to `zoom` with the map point (`u`, `v`) in the middle of the frame, or as near as
 * the edges allow.
 */
export const centerOn = (
  zoom: number,
  u: number,
  v: number,
  maxZoom: number,
): MapView => {
  const next = clamp(zoom, 1, Math.max(1, maxZoom));
  return clampView({ zoom: next, x: 0.5 - u * next, y: 0.5 - v * next }, maxZoom);
};

/** Moves the map by (`dx`, `dy`) fractions of the frame. */
export const panBy = (view: MapView, dx: number, dy: number, maxZoom: number) =>
  clampView({ zoom: view.zoom, x: view.x + dx, y: view.y + dy }, maxZoom);

/**
 * Pans the least distance that brings the map point (`u`, `v`) at least `marginX` and
 * `marginY` (fractions of the frame) inside it: a pin the keyboard focus reaches.
 */
export const ensureVisible = (
  view: MapView,
  u: number,
  v: number,
  marginX: number,
  marginY: number,
  maxZoom: number,
): MapView => {
  const px = view.x + u * view.zoom;
  const py = view.y + v * view.zoom;
  const mx = Math.min(marginX, 0.5);
  const my = Math.min(marginY, 0.5);
  const dx = px < mx ? mx - px : px > 1 - mx ? 1 - mx - px : 0;
  const dy = py < my ? my - py : py > 1 - my ? 1 - my - py : 0;
  if (dx === 0 && dy === 0) return view;
  return panBy(view, dx, dy, maxZoom);
};

/** Whether two views show the same thing (within rounding). */
export const sameView = (a: MapView, b: MapView) =>
  Math.abs(a.zoom - b.zoom) < 1e-4 &&
  Math.abs(a.x - b.x) < 1e-4 &&
  Math.abs(a.y - b.y) < 1e-4;
