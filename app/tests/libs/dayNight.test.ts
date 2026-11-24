import { describe, expect, it } from "bun:test";
import {
  WORLD_CYCLE_SECONDS,
  WORLD_CYCLE_TRANSITION_SECONDS,
  WORLD_DAY_BRIGHTNESS,
  WORLD_DAY_SECONDS,
  WORLD_NIGHT_BRIGHTNESS,
  WORLD_NIGHT_SECONDS,
} from "@/drizzle/constants";
import {
  getMorningShift,
  getWorldCycleBrightness,
  getWorldCyclePosition,
  getWorldCycleState,
} from "@/libs/dayNight";

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

  it("starts a clock set back by the morning shift at dawn, from any time of day", () => {
    const cycleMs = WORLD_CYCLE_SECONDS * 1000;
    for (const share of [0, 0.2, 0.5, 0.75, 0.999]) {
      const at = cycleMs * (5 + share);
      const shown = new Date(at - getMorningShift(at));
      expect(getWorldCyclePosition(shown)).toMatchObject({
        phase: "day",
        phaseOffset: 0,
      });
      expect(getWorldCycleBrightness(shown)).toBe(WORLD_DAY_BRIGHTNESS);
    }
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
    expect(getWorldCycleBrightness(justBeforeDay)).toBeCloseTo(WORLD_DAY_BRIGHTNESS, 4);
    expect(getWorldCycleBrightness(dayStart)).toBe(WORLD_DAY_BRIGHTNESS);
  });
});
