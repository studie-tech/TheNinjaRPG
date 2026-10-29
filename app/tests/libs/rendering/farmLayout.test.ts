import { describe, expect, it } from "bun:test";
import { FARM_MAX_PLOTS } from "@/drizzle/constants";
import {
  FARM_CANVAS_MIN_HEIGHT,
  FARM_MAX_PIXELS_PER_UNIT,
  FARM_PLOT_SIZE,
  farmPlotPosition,
  farmViewScale,
} from "@/libs/rendering/scenes/farmLayout";

describe("farm view scale", () => {
  it.each([5, 12, FARM_MAX_PLOTS])(
    "caps plot size on tall canvases with %i plots",
    (total) => {
      expect(farmViewScale(1500, 825, total)).toBeLessThanOrEqual(
        FARM_MAX_PIXELS_PER_UNIT,
      );
    },
  );

  it("zooms toward the plots on wide canvases up to the size cap", () => {
    expect(farmViewScale(900, 495, 5)).toBe(FARM_MAX_PIXELS_PER_UNIT);
    expect(farmViewScale(600, 330, 5)).toBeGreaterThan(farmViewScale(320, 300, 5));
  });

  it.each([5, 12, FARM_MAX_PLOTS])(
    "keeps all %i soil bounds inside narrow and phone-sized canvases",
    (total) => {
      const height = FARM_CANVAS_MIN_HEIGHT;
      for (const width of [180, 320]) {
        const scale = farmViewScale(width, height, total);
        for (let slot = 0; slot < total; slot++) {
          const { x, y } = farmPlotPosition(slot, total);
          expect((Math.abs(x) + FARM_PLOT_SIZE / 2) * scale).toBeLessThan(width / 2);
          expect((Math.abs(y) + FARM_PLOT_SIZE / 2) * scale).toBeLessThan(height / 2);
        }
      }
    },
  );
});
