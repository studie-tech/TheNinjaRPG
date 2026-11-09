import { describe, expect, it } from "bun:test";
import {
  WORLD_CYCLE_SECONDS,
  WORLD_CYCLE_TRANSITION_SECONDS,
  WORLD_DAY_SECONDS,
} from "@/drizzle/constants";
import { farmLightingClock, nextFarmVisualAt } from "@/libs/rendering/scenes/farmClock";

const start = new Date("2026-10-27T12:00:00.000Z");
const plot = (overrides = {}) => ({
  seedItemId: "seed",
  plantedAt: start,
  finishAt: new Date(start.getTime() + 400_000),
  lastWateredAt: null,
  ...overrides,
});

describe("farm visual deadlines", () => {
  it("leaves empty or harvested farms asleep when shading is disabled", () => {
    expect(nextFarmVisualAt([], start, false)).toBeNull();
    expect(nextFarmVisualAt([plot({ seedItemId: null })], start, false)).toBeNull();
  });

  it("wakes just after a growth boundary, then advances to the next one", () => {
    const boundary = start.getTime() + 100_000;
    expect(nextFarmVisualAt([plot()], start, false)).toBe(boundary + 1);
    expect(nextFarmVisualAt([plot()], new Date(boundary), false)).toBe(boundary + 1);
    expect(nextFarmVisualAt([plot()], new Date(boundary + 1), false)).toBe(
      start.getTime() + 200_001,
    );
  });

  it("wakes at readiness and stops scheduling growth once the crop is ready", () => {
    const end = start.getTime() + 400_000;
    expect(nextFarmVisualAt([plot()], new Date(end - 1), false)).toBe(end);
    expect(nextFarmVisualAt([plot()], new Date(end), false)).toBeNull();
  });

  it("chooses the earliest crop or watering deadline from the live state", () => {
    const watered = new Date(start.getTime() + WORLD_CYCLE_SECONDS * 1000 - 1000);
    const longPlot = plot({
      finishAt: new Date(start.getTime() + 8 * 3600_000),
      lastWateredAt: watered,
    });
    expect(nextFarmVisualAt([longPlot], watered, false)).toBe(
      start.getTime() + WORLD_CYCLE_SECONDS * 1000,
    );
    expect(
      nextFarmVisualAt(
        [
          longPlot,
          plot({ plantedAt: watered, finishAt: new Date(watered.getTime() + 2000) }),
        ],
        watered,
        false,
      ),
    ).toBe(watered.getTime() + 501);
  });

  it("does not poll or animate during constant day/night phases", () => {
    const transition =
      start.getTime() + (WORLD_DAY_SECONDS - WORLD_CYCLE_TRANSITION_SECONDS) * 1000;
    expect(farmLightingClock(start, true)).toEqual({
      alpha: 0,
      isTransitioning: false,
      nextAt: transition,
    });
    const fading = farmLightingClock(new Date(transition + 1), true);
    expect(fading.isTransitioning).toBe(true);
    expect(fading.alpha).toBeGreaterThan(0);
    expect(fading.nextAt).toBe(start.getTime() + WORLD_DAY_SECONDS * 1000);
    const night = farmLightingClock(
      new Date(start.getTime() + WORLD_DAY_SECONDS * 1000),
      true,
    );
    expect(night.isTransitioning).toBe(false);
    expect(night.alpha).toBeGreaterThan(0);
  });

  it("cancels the lighting clock when the user's shading preference is off", () => {
    expect(farmLightingClock(start, false)).toEqual({
      alpha: 0,
      isTransitioning: false,
      nextAt: null,
    });
  });
});
