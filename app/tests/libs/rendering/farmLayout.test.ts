import { describe, expect, it } from "bun:test";
import { FARM_MAX_PLOTS } from "@/drizzle/constants";
import {
  FARM_CANVAS_MIN_HEIGHT,
  FARM_MAX_PIXELS_PER_UNIT,
  FARM_VIEW_HEIGHT,
  farmPlotPosition,
  farmViewScale,
} from "@/libs/rendering/scenes/farmLayout";

describe("farm view scale", () => {
  it("never shows less of the field than the full-height view", () => {
    expect(farmViewScale(320, 300, FARM_MAX_PLOTS)).toBeGreaterThanOrEqual(
      300 / FARM_VIEW_HEIGHT,
    );
  });

  it("zooms toward the plots on wide canvases up to the size cap", () => {
    expect(farmViewScale(900, 495, 5)).toBe(FARM_MAX_PIXELS_PER_UNIT);
    expect(farmViewScale(600, 330, 5)).toBeGreaterThan(330 / FARM_VIEW_HEIGHT);
  });

  it.each([5, 12, FARM_MAX_PLOTS])(
    "keeps all %i plots inside a phone-sized canvas",
    (total) => {
      const width = 320;
      const height = FARM_CANVAS_MIN_HEIGHT;
      const scale = farmViewScale(width, height, total);
      for (let slot = 0; slot < total; slot++) {
        const { x, y } = farmPlotPosition(slot, total);
        expect(Math.abs(x) * scale).toBeLessThan(width / 2);
        expect(Math.abs(y) * scale).toBeLessThan(height / 2);
      }
    },
  );
});
