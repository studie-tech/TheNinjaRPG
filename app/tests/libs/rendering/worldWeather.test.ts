import { describe, expect, it } from "bun:test";
import { Container, type Mesh } from "pixi.js";
import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createWorldWeather, getWorldWeather } from "@/libs/rendering/worldWeather";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";

/** Keep the real retained weather mesh; replace only renderer dimensions and lifetime ownership. */
const fixture = (light = false) => {
  const cleanups: (() => void)[] = [];
  const renderer = { width: 800, height: 600 };
  const game = {
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    renderer,
    own: (cleanup: () => void) => cleanups.push(cleanup),
  } as unknown as GameRenderer;
  const weather = createWorldWeather(game, light),
    stage = new Container();
  stage.addChild(weather.container);
  return {
    weather,
    renderer,
    game,
    dispose: () => {
      stage.destroy({ children: true });
      cleanups.forEach((cleanup) => cleanup());
    },
  };
};

describe("regional world weather", () => {
  it("toggles precipitation independently of sprite motion and reuses its mesh", () => {
    const { weather, game, dispose } = fixture();
    const frame = { now: 1000, delta: 0.016, reducedMotion: false };
    try {
      game.visualEffects.spriteAnimations = false;
      weather.update(frame, { kind: "rain", intensity: 1 }, { x: 0, y: 0 });
      expect(weather.container.visible).toBe(true);
      const mesh = weather.container.children[0];
      game.visualEffects.weather = false;
      weather.update(frame, { kind: "rain", intensity: 1 }, { x: 0, y: 0 });
      expect(weather.container.visible).toBe(false);
      game.visualEffects.weather = true;
      weather.update(frame, { kind: "rain", intensity: 1 }, { x: 0, y: 0 });
      expect(weather.container.visible).toBe(true);
      expect(weather.container.children[0]).toBe(mesh);
    } finally {
      dispose();
    }
  });
  it("shares a smooth live front across rain, snowy regions and desert sandstorms", () => {
    for (const [biome, kind] of [
      ["ground", "rain"],
      ["ocean", "rain"],
      ["snow", "snow"],
      ["ice", "snow"],
      ["dessert", "sandstorm"],
    ] as const) {
      expect(getWorldWeather(biome, 180_000)).toEqual({ kind, intensity: 0.7 });
      expect(getWorldWeather(biome, 540_000)).toEqual({ kind: "clouds", intensity: 1 });
      const before = getWorldWeather(biome, 120_000).intensity;
      expect(getWorldWeather(biome, 120_016).intensity - before).toBeGreaterThan(0);
      expect(getWorldWeather(biome, 120_016).intensity - before).toBeLessThan(0.001);
    }
    expect(getWorldWeather("default", 180_000).kind).toBe("clear");
    expect(getWorldWeather("ground", Number.NaN).kind).toBe("clear");
  });

  it("fades clouds in from the end of a front and out before the next", () => {
    const before = getWorldWeather("ground", 361_000);
    expect(before.kind).toBe("clouds");
    expect(before.intensity).toBeGreaterThan(0);
    expect(before.intensity).toBeLessThan(0.02);
    expect(getWorldWeather("ground", 719_000).kind).toBe("clouds");
    expect(getWorldWeather("ground", 719_000).intensity).toBeLessThan(0.02);
    expect(getWorldWeather("default", 540_000).kind).toBe("clear");
  });

  it("shades only clear daylight, fading through dusk and hidden at night", () => {
    const { weather, game, dispose } = fixture();
    const frame = { now: 1000, delta: 0.016, reducedMotion: false };
    const clouds = { kind: "clouds", intensity: 1 } as const;
    const camera = { x: 0, y: 0 };
    try {
      weather.update(frame, clouds, camera, WORLD_NIGHT_BRIGHTNESS);
      expect(weather.container.visible).toBe(false);
      expect(weather.container.children).toHaveLength(0);
      weather.update(frame, clouds, camera, WORLD_DAY_BRIGHTNESS);
      expect(weather.container.visible).toBe(true);
      const mesh = weather.container.getChildByLabel("weather-cloud-shadows") as Mesh;
      const view = mesh.shader!.resources.clouds.uniforms.uView;
      const noon = view[3];
      expect(noon).toBeGreaterThan(0);
      weather.update(
        frame,
        clouds,
        camera,
        (WORLD_DAY_BRIGHTNESS + WORLD_NIGHT_BRIGHTNESS) / 2,
      );
      expect(view[3]).toBeCloseTo(noon / 2);
      game.visualEffects.weather = false;
      weather.update(frame, clouds, camera, WORLD_DAY_BRIGHTNESS);
      expect(weather.container.visible).toBe(false);
      game.visualEffects.weather = true;
      weather.update(
        { ...frame, reducedMotion: true },
        clouds,
        camera,
        WORLD_DAY_BRIGHTNESS,
      );
      expect(weather.container.visible).toBe(false);
    } finally {
      dispose();
    }
  });

  it("swaps retained meshes between clouds and precipitation", () => {
    const { weather, dispose } = fixture();
    const frame = { now: 1000, delta: 0.016, reducedMotion: false },
      camera = { x: 0, y: 0 };
    try {
      weather.update(frame, { kind: "clouds", intensity: 1 }, camera);
      const clouds = weather.container.getChildByLabel("weather-cloud-shadows")!;
      expect(weather.container.getChildByLabel("weather-particles")).toBeNull();
      weather.update(frame, { kind: "rain", intensity: 1 }, camera);
      const particles = weather.container.getChildByLabel("weather-particles")!;
      expect([clouds.visible, particles.visible]).toEqual([false, true]);
      weather.update(frame, { kind: "clouds", intensity: 1 }, camera);
      expect([clouds.visible, particles.visible]).toEqual([true, false]);
      expect(weather.container.children).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it.each([false, true])(
    "keeps clouds on the ground and bounded across zoom and drift (light=%s)",
    (light) => {
      const { weather, renderer, dispose } = fixture(light);
      try {
        weather.update(
          { now: 0, delta: 0, reducedMotion: false },
          { kind: "clouds", intensity: 1 },
          { x: 0, y: 0 },
          1,
          1,
        );
        const mesh = weather.container.children[0] as Mesh;
        const geometry = mesh.geometry;
        const { uField } = mesh.shader!.resources.clouds.uniforms;
        expect(geometry.getBuffer("aPosition").data.length / 8).toBe(light ? 16 : 36);
        expect(Array.from(uField)).toEqual([0, 0, 2048, 2048]);
        // Panning shifts the field by exactly the world's canvas offset.
        weather.update(
          { now: 0, delta: 0, reducedMotion: false },
          { kind: "clouds", intensity: 1 },
          { x: 300, y: -40 },
          1,
          1,
        );
        expect(Array.from(uField).slice(0, 2)).toEqual([300, -40]);
        // Zooming scales the period with the ground.
        weather.update(
          { now: 0, delta: 0, reducedMotion: false },
          { kind: "clouds", intensity: 1 },
          { x: 0, y: 0 },
          1,
          2,
        );
        expect(Array.from(uField).slice(2)).toEqual([4096, 4096]);
        // Clouds always wrap beyond a view larger than the base field.
        renderer.height = 3000;
        weather.update(
          { now: 0, delta: 0, reducedMotion: false },
          { kind: "clouds", intensity: 1 },
          { x: 0, y: 0 },
          1,
          1,
        );
        expect(uField[3]).toBeGreaterThanOrEqual(3000 + 2 * 190);
        // Offsets stay wrapped however long the page has been open.
        weather.update(
          { now: 1e10, delta: 0, reducedMotion: false },
          { kind: "clouds", intensity: 1 },
          { x: 0, y: 0 },
          1,
          1,
        );
        expect(Math.abs(uField[0])).toBeLessThan(uField[2]);
        expect(mesh.geometry).toBe(geometry);
      } finally {
        dispose();
      }
    },
  );

  it("allocates no mesh for clear skies, zero/invalid strength or reduced motion", () => {
    const { weather, dispose } = fixture();
    try {
      for (const intensity of [0, Number.NaN])
        weather.update(
          { now: 0, delta: 0, reducedMotion: false },
          { kind: "rain", intensity },
          { x: 0, y: 0 },
        );
      weather.update(
        { now: 0, delta: 0, reducedMotion: false },
        { kind: "clear", intensity: 1 },
        { x: 0, y: 0 },
      );
      weather.update(
        { now: 0, delta: 0, reducedMotion: true },
        { kind: "snow", intensity: 1 },
        { x: 0, y: 0 },
      );
      expect(weather.container.visible).toBe(false);
      expect(weather.container.children).toHaveLength(0);
    } finally {
      dispose();
    }
  });

  it.each([false, true])(
    "retains one bounded mesh across mode, viewport and clock changes (light=%s)",
    (light) => {
      const { weather, renderer, dispose } = fixture(light);
      try {
        weather.update(
          { now: 1000, delta: 0, reducedMotion: false },
          { kind: "rain", intensity: 2 },
          { x: 500, y: -300 },
        );
        const mesh = weather.container.children[0] as Mesh,
          geometry = mesh.geometry;
        expect(weather.container.children).toHaveLength(1);
        expect(mesh.eventMode).toBe("none");
        const count = geometry.getBuffer("aPosition").data.length / 2;
        expect(count).toBeGreaterThan(light ? 380 : 1500);
        expect(count).toBeLessThanOrEqual(light ? 400 : 1600);
        expect(
          geometry.buffers.reduce((bytes, buffer) => bytes + buffer.data.byteLength, 0),
        ).toBeLessThan(48 * 1024);
        const state = mesh.shader!.resources.weather.uniforms;
        expect(Array.from(state.uWeather)).toEqual([1, 1, 1, 1]);
        for (const [kind, code] of [
          ["snow", 2],
          ["sandstorm", 3],
        ] as const) {
          weather.update(
            { now: 1016, delta: 0.016, reducedMotion: false },
            { kind, intensity: 0.5 },
            { x: 500, y: -300 },
            0.6,
          );
          expect(mesh.geometry).toBe(geometry);
          expect(state.uWeather[0]).toBeCloseTo(1.016);
          expect(state.uWeather[1]).toBe(code);
        }
        renderer.width = 390;
        weather.update(
          { now: 65_000, delta: 0.016, reducedMotion: false },
          { kind: "rain", intensity: 1 },
          { x: 500, y: -300 },
        );
        expect(state.uWeather[0]).toBe(1);
        expect(state.uView[0]).toBe(390);
        expect(mesh.geometry).toBe(geometry);
        weather.update(
          { now: 0, delta: 0, reducedMotion: true },
          { kind: "rain", intensity: 1 },
          { x: 0, y: 0 },
        );
        expect(weather.container.visible).toBe(false);
      } finally {
        dispose();
      }
    },
  );
});
