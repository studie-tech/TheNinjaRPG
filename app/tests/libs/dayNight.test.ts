import { describe, expect, it } from "vitest";
import {
  WORLD_CYCLE_SECONDS,
  WORLD_CYCLE_TRANSITION_SECONDS,
  WORLD_DAY_BRIGHTNESS,
  WORLD_DAY_SECONDS,
  WORLD_NIGHT_BRIGHTNESS,
  WORLD_NIGHT_SECONDS,
} from "@/drizzle/constants";
import { getWorldCycleBrightness, getWorldCycleState } from "@/libs/dayNight";

describe("dayNight", () => {
  it("derives day/night cycle state and brightness", () => {
    const cycleMs = WORLD_CYCLE_SECONDS * 1000;
    const dayMs = WORLD_DAY_SECONDS * 1000;
    const nightMs = WORLD_NIGHT_SECONDS * 1000;
    const dayStart = new Date(cycleMs * 5);
    const midDay = new Date(dayStart.getTime() + dayMs / 2);
    const midNight = new Date(dayStart.getTime() + dayMs + nightMs / 2);

    expect(getWorldCycleState(midDay).phase).toBe("day");
    expect(getWorldCycleState(midNight).phase).toBe("night");
    expect(getWorldCycleBrightness(midDay)).toBeGreaterThan(
      getWorldCycleBrightness(midNight),
    );
  });

  it("keeps the dawn transition continuous at the day boundary", () => {
    const cycleMs = WORLD_CYCLE_SECONDS * 1000;
    const transitionMs = WORLD_CYCLE_TRANSITION_SECONDS * 1000;
    const nextDayStartMs = cycleMs * 6;
    const dawnStart = new Date(nextDayStartMs - transitionMs);
    const midDawn = new Date(nextDayStartMs - transitionMs / 2);
    const justBeforeDay = new Date(nextDayStartMs - 1);
    const dayStart = new Date(nextDayStartMs);

    expect(getWorldCycleBrightness(dawnStart)).toBe(WORLD_NIGHT_BRIGHTNESS);
    expect(getWorldCycleBrightness(midDawn)).toBeCloseTo(
      (WORLD_NIGHT_BRIGHTNESS + WORLD_DAY_BRIGHTNESS) / 2,
    );
    expect(getWorldCycleBrightness(justBeforeDay)).toBeCloseTo(
      WORLD_DAY_BRIGHTNESS,
      4,
    );
    expect(getWorldCycleBrightness(dayStart)).toBe(WORLD_DAY_BRIGHTNESS);
  });
});
