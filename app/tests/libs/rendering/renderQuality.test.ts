import { describe, expect, it } from "bun:test";
import {
  baseRenderResolution,
  createRenderQualityGovernor,
  INITIAL_HEALTHY_WINDOWS,
  initialRenderQualityLevel,
  matchingQualityLevel,
  publishRenderQualityStatus,
  readRenderQualityStatus,
  renderQualityLevels,
} from "@/libs/rendering/renderQuality";
import { DEFAULT_VISUAL_EFFECTS, type VisualEffect } from "@/libs/visualEffects";

const FRAME = 1000 / 60;
const device = { devicePixelRatio: 2, isTouch: false };

describe("render quality resolution", () => {
  it("keeps display density on ordinary desktop canvases", () => {
    expect(
      baseRenderResolution({ ...device, quality: "auto", width: 1200, height: 800 }),
    ).toBe(2);
  });
  it("fits very large canvases to the pixel budget in quarter steps", () => {
    expect(
      baseRenderResolution({ ...device, quality: "auto", width: 1900, height: 1250 }),
    ).toBe(1.25);
    expect(
      baseRenderResolution({
        devicePixelRatio: 2,
        isTouch: true,
        quality: "auto",
        width: 1075,
        height: 700,
      }),
    ).toBe(1.5);
  });
  it("never budgets below standard density or above the display", () => {
    expect(
      baseRenderResolution({ ...device, quality: "auto", width: 4000, height: 3000 }),
    ).toBe(1);
    expect(
      baseRenderResolution({
        devicePixelRatio: 0.9,
        isTouch: false,
        quality: "auto",
        width: 400,
        height: 300,
      }),
    ).toBe(0.9);
    expect(
      baseRenderResolution({
        devicePixelRatio: 3,
        isTouch: true,
        quality: "auto",
        width: 390,
        height: 500,
      }),
    ).toBe(2);
  });
  it("keeps display density at high and standard density at low", () => {
    const size = { width: 1900, height: 1250 };
    expect(baseRenderResolution({ ...device, ...size, quality: "high" })).toBe(2);
    expect(baseRenderResolution({ ...device, ...size, quality: "low" })).toBe(1);
  });
});

describe("render quality levels", () => {
  it("steps resolution before switching off effects", () => {
    expect(renderQualityLevels(2, DEFAULT_VISUAL_EFFECTS, new Set())).toEqual([
      { resolution: 2, disabled: [] },
      { resolution: 1.5, disabled: [] },
      { resolution: 1, disabled: [] },
      { resolution: 1, disabled: ["shadows"] },
      { resolution: 1, disabled: ["shadows", "localLights"] },
      { resolution: 1, disabled: ["shadows", "localLights", "weather"] },
    ]);
  });
  it("never switches off an effect the player chose or that is already off", () => {
    const levels = renderQualityLevels(
      1,
      { ...DEFAULT_VISUAL_EFFECTS, weather: false },
      new Set<VisualEffect>(["shadows"]),
    );
    expect(levels).toEqual([
      { resolution: 1, disabled: [] },
      { resolution: 1, disabled: ["localLights"] },
    ]);
  });
  it("keeps no more reduction than before when the ladder changes", () => {
    const before = renderQualityLevels(2, DEFAULT_VISUAL_EFFECTS, new Set());
    const chosen = renderQualityLevels(
      2,
      DEFAULT_VISUAL_EFFECTS,
      new Set<VisualEffect>(["shadows"]),
    );
    // Shadows off at 1x: choosing shadows must not take local lights away instead.
    expect(chosen[matchingQualityLevel(chosen, before[3]!)]).toEqual({
      resolution: 1,
      disabled: [],
    });
    const larger = renderQualityLevels(1.25, DEFAULT_VISUAL_EFFECTS, new Set());
    expect(larger[matchingQualityLevel(larger, before[1]!)]).toEqual({
      resolution: 1.25,
      disabled: [],
    });
  });
  it("starts software rasterizers without shadows or local lights and small devices at 1x", () => {
    const levels = renderQualityLevels(2, DEFAULT_VISUAL_EFFECTS, new Set());
    expect(levels[initialRenderQualityLevel(levels, { software: true })]).toEqual({
      resolution: 1,
      disabled: ["shadows", "localLights"],
    });
    expect(
      levels[initialRenderQualityLevel(levels, { software: false, memory: 2 })],
    ).toEqual({ resolution: 1, disabled: [] });
    expect(
      initialRenderQualityLevel(levels, { software: false, memory: 8, cores: 8 }),
    ).toBe(0);
    // A software start never switches off weather, also when local lights are the player's choice.
    const chosen = renderQualityLevels(
      2,
      DEFAULT_VISUAL_EFFECTS,
      new Set<VisualEffect>(["localLights"]),
    );
    expect(chosen[initialRenderQualityLevel(chosen, { software: true })]).toEqual({
      resolution: 1,
      disabled: ["shadows"],
    });
    const kept = renderQualityLevels(
      2,
      DEFAULT_VISUAL_EFFECTS,
      new Set<VisualEffect>(["localLights", "shadows"]),
    );
    expect(kept[initialRenderQualityLevel(kept, { software: true })]).toEqual({
      resolution: 1,
      disabled: [],
    });
  });
});

describe("render quality governor", () => {
  const run = (
    governor: ReturnType<typeof createRenderQualityGovernor>,
    milliseconds: number,
    interval: number,
    expected = FRAME,
  ) => {
    const changes: number[] = [];
    for (let elapsed = 0; elapsed < milliseconds; elapsed += interval) {
      if (governor.sample(interval, expected, expected <= FRAME)) changes.push(elapsed);
    }
    return changes;
  };
  const start = (level = 0) => {
    const governor = createRenderQualityGovernor({
      level,
      patience: INITIAL_HEALTHY_WINDOWS,
    });
    governor.setLevel(level, 5, false);
    return governor;
  };

  it("ignores the warm-up and steps down after two slow windows", () => {
    const governor = start();
    expect(run(governor, 3_000, 40)).toEqual([]);
    const changes = run(governor, 4_100, 25);
    expect(changes).toHaveLength(1);
    expect(governor.level).toBe(1);
  });
  it("steps down after one window when frames are severely slow", () => {
    const governor = start();
    run(governor, 3_000, 16);
    expect(run(governor, 2_100, 50)).toHaveLength(1);
  });
  it("holds a level that is slower than full rate but not slow", () => {
    const governor = start(2);
    run(governor, 60_000, 20);
    expect(governor.level).toBe(2);
  });
  it("measures ambient scenes against their own frame rate", () => {
    const governor = start();
    run(governor, 30_000, 1000 / 30, 1000 / 30);
    expect(governor.level).toBe(0);
  });
  it("steps up only after sustained full-rate headroom", () => {
    const governor = start(3);
    run(governor, 3_000, FRAME);
    expect(run(governor, 9_500, FRAME)).toEqual([]);
    expect(run(governor, 1_000, FRAME)).toHaveLength(1);
    expect(governor.level).toBe(2);
  });
  it("needs full-rate frames to step up", () => {
    const governor = start(3);
    run(governor, 60_000, 1000 / 30, 1000 / 30);
    expect(governor.level).toBe(3);
  });
  it("doubles its wait after a step up that slows frames again", () => {
    const governor = start(1);
    run(governor, 3_000, FRAME);
    run(governor, 10_600, FRAME);
    expect(governor.level).toBe(0);
    run(governor, 4_600, 25);
    expect(governor.level).toBe(1);
    expect(governor.patience).toBe(INITIAL_HEALTHY_WINDOWS * 2);
    run(governor, 18_000, FRAME);
    expect(governor.level).toBe(1);
    run(governor, 3_000, FRAME);
    expect(governor.level).toBe(0);
  });
  it("undoes and reports a step that does not speed frames up", () => {
    const governor = start();
    const steps: (string | null)[] = [];
    const record = (milliseconds: number, interval: number) => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += interval) {
        const step = governor.sample(interval, FRAME, true);
        if (step) steps.push(step);
      }
    };
    record(3_000, FRAME);
    record(4_100, 30);
    expect(governor.level).toBe(1);
    // Still just as slow at the lower level: the frames are limited by something else.
    record(2_600, 30);
    expect(steps).toEqual(["lowered", "rejected"]);
    expect(governor.level).toBe(0);
  });
  it("keeps a step that helps and continues while frames are still slow", () => {
    const governor = start();
    run(governor, 3_000, FRAME);
    run(governor, 4_100, 40);
    expect(governor.level).toBe(1);
    run(governor, 4_600, 30);
    expect(governor.level).toBe(2);
  });
  it("tells apart levels of a scene running at a few frames a second", () => {
    const governor = start();
    run(governor, 3_000, FRAME);
    run(governor, 3_700, 300);
    expect(governor.level).toBe(1);
    run(governor, 4_000, 200);
    expect(governor.level).toBe(2);
  });
  it("discards stalls and does not step below the last level", () => {
    const governor = start(5);
    run(governor, 3_000, FRAME);
    run(governor, 10_000, 1_500);
    run(governor, 10_000, 40);
    expect(governor.level).toBe(5);
  });
});

describe("render quality status", () => {
  it("reports the union of reductions on visible scenes", () => {
    const travel = {},
      combat = {};
    publishRenderQualityStatus(travel, { isResolutionReduced: true, disabled: [] });
    publishRenderQualityStatus(combat, {
      isResolutionReduced: false,
      disabled: ["localLights", "shadows"],
    });
    expect(readRenderQualityStatus()).toEqual({
      isResolutionReduced: true,
      disabled: ["shadows", "localLights"],
    });
    publishRenderQualityStatus(travel, null);
    publishRenderQualityStatus(combat, null);
    expect(readRenderQualityStatus()).toEqual({
      isResolutionReduced: false,
      disabled: [],
    });
  });
});
