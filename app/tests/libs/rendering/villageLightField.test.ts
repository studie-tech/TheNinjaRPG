import { expect, it, vi } from "bun:test";
import { BufferImageSource, Container, Texture } from "pixi.js";
import { createVillageLightField } from "@/libs/rendering/villageLightField";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";

it("rasterizes broad radiance once per source set and ignores invalid fixtures", () => {
  const context = { setTransform: vi.fn(), fillRect: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }) };
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  try {
    expect(createVillageLightField([{ x: NaN, y: 0, height: 1, reach: 20 }])).toBeNull();
    const field = createVillageLightField([{ x: 20, y: 40, height: 10, reach: 100 }])!;
    expect(field.bounds).toEqual({ minX: -105, maxX: 145, minY: -22.5, maxY: 102.5 });
    expect([field.texture.width, field.texture.height]).toEqual([768, 384]);
    expect(context.fillRect).toHaveBeenCalledTimes(2); field.texture.destroy(true);
  } finally { canvas.mockRestore(); }
});

it("keeps light-map UVs anchored in the world through camera pan and zoom and honors the local-light switch", () => {
  const world = new Container(), cleanup: (() => void)[] = [];
  const game = { renderer: { resolution: 1 }, visualEffects: { ...DEFAULT_VISUAL_EFFECTS }, own: (fn: () => void) => cleanup.push(fn) } as unknown as GameRenderer;
  const texture = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }) });
  const lighting = createProjectedWorldLighting(game, world, { restoreWarmWindows: true }); world.addChild(lighting.container);
  lighting.setWarmField({ texture, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } });
  const filter = lighting.container.filters![0]!, uniforms = filter.resources.night.uniforms;
  try {
    for (const [scale, x, y] of [[3, 100, 200], [8, -400, 800]]) {
      world.scale.set(scale!, -scale!); world.position.set(x!, y!);
      lighting.update({ x: 0, y: 1, z: 1, day: 0 }, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
      const screenX = x! + 20 * scale!, screenY = y! - 30 * scale!;
      const u = filter.resources.warmMapping.uniforms.uWarmU, v = filter.resources.warmMapping.uniforms.uWarmV;
      expect(u[0] * screenX + u[1] * screenY + u[2]).toBeCloseTo(.2);
      expect(v[0] * screenX + v[1] * screenY + v[2]).toBeCloseTo(.3);
    }
    game.visualEffects.localLights = false;
    lighting.update({ x: 0, y: 1, z: 1, day: 0 }, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(uniforms.uLocalNight).toBe(0);
    game.visualEffects.localLights = true;
    lighting.update({ x: 0, y: 1, z: 1, day: .5 }, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(uniforms.uLocalNight).toBe(.75);
    lighting.update({ x: 0, y: 1, z: 1, day: 1 }, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(uniforms.uLocalNight).toBe(0);
    lighting.setWarmField(null); expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
  } finally { world.destroy({ children: true }); for (const fn of cleanup) fn(); texture.destroy(true); }
});
