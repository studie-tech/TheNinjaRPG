import { FARM_PLOT_COLUMNS } from "@/drizzle/constants";

/** Farm-local units with Y downward; the scene scales this centered layout to renderer pixels. */
export const FARM_PLOT_SIZE = 1.8;
export const FARM_PLOT_GAP = 0.25;
export const FARM_VIEW_HEIGHT = 14;

/** Center of a zero-based slot, with the complete row layout centered around the origin. */
export const farmPlotPosition = (slot: number, total: number) => {
  const spacing = FARM_PLOT_SIZE + FARM_PLOT_GAP;
  return {
    x: ((slot % FARM_PLOT_COLUMNS) - (FARM_PLOT_COLUMNS - 1) / 2) * spacing,
    y:
      (Math.floor(slot / FARM_PLOT_COLUMNS) -
        (Math.ceil(total / FARM_PLOT_COLUMNS) - 1) / 2) *
      spacing,
  };
};

/** Shortest farm canvas; the view zooms to the plots, so phones need no more height. */
export const FARM_CANVAS_MIN_HEIGHT = 300;
/** Upper bound for on-screen pixels per farm unit, so small farms do not show oversized plots. */
export const FARM_MAX_PIXELS_PER_UNIT = 48;
/** Share of the canvas width or height the plot grid may cover when zooming in. */
const FARM_GRID_FILL = 0.8;

/**
 * Pixels per farm unit. The view zooms toward the plot grid so plots grow with the
 * canvas, but never shows less of the field than the full-height view.
 */
export const farmViewScale = (width: number, height: number, total: number) => {
  const spacing = FARM_PLOT_SIZE + FARM_PLOT_GAP;
  const rows = Math.max(1, Math.ceil(total / FARM_PLOT_COLUMNS));
  const gridWidth = FARM_PLOT_COLUMNS * spacing - FARM_PLOT_GAP;
  const gridHeight = rows * spacing - FARM_PLOT_GAP;
  const fullField = height / FARM_VIEW_HEIGHT;
  const fit = Math.min(
    (width * FARM_GRID_FILL) / gridWidth,
    (height * FARM_GRID_FILL) / gridHeight,
  );
  return Math.max(fullField, Math.min(fit, FARM_MAX_PIXELS_PER_UNIT));
};

/** Uses the same square bounds as the soil artwork without allocating hit meshes. */
export const farmPlotAt = (x: number, y: number, total: number) => {
  const spacing = FARM_PLOT_SIZE + FARM_PLOT_GAP;
  const rows = Math.ceil(total / FARM_PLOT_COLUMNS);
  const col = Math.round(x / spacing + (FARM_PLOT_COLUMNS - 1) / 2);
  const row = Math.round(y / spacing + (rows - 1) / 2);
  const slot = row * FARM_PLOT_COLUMNS + col;
  if (col < 0 || col >= FARM_PLOT_COLUMNS || row < 0 || slot >= total) return null;
  const position = farmPlotPosition(slot, total);
  return Math.abs(x - position.x) <= FARM_PLOT_SIZE / 2 &&
    Math.abs(y - position.y) <= FARM_PLOT_SIZE / 2
    ? slot
    : null;
};
