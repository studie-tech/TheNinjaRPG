import { describe, expect, it } from "bun:test";
import { Container, type Mesh } from "pixi.js";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createWorldWeather, getWorldWeather } from "@/libs/rendering/worldWeather";

/** Keep the real retained weather mesh; replace only renderer dimensions and lifetime ownership. */
const fixture = (light = false) => {
  const cleanups: (() => void)[] = [];
  const renderer = { width: 800, height: 600 };
  const game = { renderer, own: (cleanup: () => void) => cleanups.push(cleanup) } as unknown as GameRenderer;
  const weather = createWorldWeather(game, light), stage = new Container();
  stage.addChild(weather.container);
  return { weather, renderer, dispose: () => { stage.destroy({ children: true }); cleanups.forEach((cleanup) => cleanup()); } };
};

describe("regional world weather", () => {
  it("shares a smooth live front across rain, snowy regions and desert sandstorms", () => {
    for (const [biome, kind] of [["ground", "rain"], ["ocean", "rain"], ["snow", "snow"], ["ice", "snow"], ["dessert", "sandstorm"]] as const) {
      expect(getWorldWeather(biome, 180_000)).toEqual({ kind, intensity: 0.7 });
      expect(getWorldWeather(biome, 540_000)).toEqual({ kind: "clear", intensity: 0 });
      const before = getWorldWeather(biome, 120_000).intensity;
      expect(getWorldWeather(biome, 120_016).intensity - before).toBeGreaterThan(0);
      expect(getWorldWeather(biome, 120_016).intensity - before).toBeLessThan(0.001);
    }
    expect(getWorldWeather("default", 180_000).kind).toBe("clear");
    expect(getWorldWeather("ground", Number.NaN).kind).toBe("clear");
  });

  it("allocates no mesh for clear skies, zero/invalid strength or reduced motion", () => {
    const { weather, dispose } = fixture();
    try {
      for (const intensity of [0, Number.NaN]) weather.update({ now: 0, delta: 0, reducedMotion: false }, { kind: "rain", intensity }, { x: 0, y: 0 });
      weather.update({ now: 0, delta: 0, reducedMotion: false }, { kind: "clear", intensity: 1 }, { x: 0, y: 0 });
      weather.update({ now: 0, delta: 0, reducedMotion: true }, { kind: "snow", intensity: 1 }, { x: 0, y: 0 });
      expect(weather.container.visible).toBe(false);
      expect(weather.container.children).toHaveLength(0);
    } finally { dispose(); }
  });

  it.each([false, true])("retains one bounded mesh across mode, viewport and clock changes (light=%s)", (light) => {
    const { weather, renderer, dispose } = fixture(light);
    try {
      weather.update({ now: 1000, delta: 0, reducedMotion: false }, { kind: "rain", intensity: 2 }, { x: 500, y: -300 });
      const mesh = weather.container.children[0] as Mesh, geometry = mesh.geometry;
      expect(weather.container.children).toHaveLength(1);
      expect(mesh.eventMode).toBe("none");
      const count = geometry.getBuffer("aPosition").data.length / 2;
      expect(count).toBeGreaterThan(light ? 384 : 1536);
      expect(count).toBeLessThanOrEqual(light ? 400 : 1600);
      expect(geometry.buffers.reduce((bytes, buffer) => bytes + buffer.data.byteLength, 0)).toBeLessThan(48 * 1024);
      const state = mesh.shader!.resources.weather.uniforms;
      expect(Array.from(state.uWeather)).toEqual([1, 1, 1, 1]);
      for (const [kind, code] of [["snow", 2], ["sandstorm", 3]] as const) {
        weather.update({ now: 1016, delta: .016, reducedMotion: false }, { kind, intensity: .5 }, { x: 500, y: -300 }, .6);
        expect(mesh.geometry).toBe(geometry);
        expect(state.uWeather[0]).toBeCloseTo(1.016);
        expect(state.uWeather[1]).toBe(code);
      }
      renderer.width = 390;
      weather.update({ now: 65_000, delta: .016, reducedMotion: false }, { kind: "rain", intensity: 1 }, { x: 500, y: -300 });
      expect(state.uWeather[0]).toBe(1);
      expect(state.uView[0]).toBe(390);
      expect(mesh.geometry).toBe(geometry);
      weather.update({ now: 0, delta: 0, reducedMotion: true }, { kind: "rain", intensity: 1 }, { x: 0, y: 0 });
      expect(weather.container.visible).toBe(false);
    } finally { dispose(); }
  });
});
