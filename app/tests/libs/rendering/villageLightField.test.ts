import { expect, it, vi } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";
import { BufferImageSource, Container, Texture } from "pixi.js";
import {
  acquirePrebakedVillageLightField,
  acquireVillageLightField,
  lightOcclusionPolygon,
  unpackVillageLightField,
} from "@/libs/rendering/villageLightField";
import published from "@/libs/rendering/bakedVillageLightFields.json";
import bakedSources from "@/libs/rendering/bakedWorldSources.json";
import worldSources from "@/libs/rendering/worldAssetSources.json";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";

it("preserves hidden RGB and independent window eligibility across opaque image decoding", () => {
  const packed = new Uint8Array([
    120, 80, 40, 255, 20, 60, 90, 255, 0, 0, 0, 255, 100, 100, 100, 255, 1, 2, 3, 255,
    4, 5, 6, 255, 240, 240, 240, 255, 8, 8, 8, 255,
  ]);
  expect(Array.from(unpackVillageLightField(packed, 2, 2))).toEqual([
    120, 80, 40, 0, 20, 60, 90, 100, 1, 2, 3, 240, 4, 5, 6, 8,
  ]);
  expect(() => unpackVillageLightField(packed.subarray(4), 2, 2)).toThrow();
});

it("matches published light pools to their authored source catalog", () => {
  expect(
    createHash("sha256")
      .update(JSON.stringify([bakedSources, worldSources]))
      .digest("hex"),
  ).toBe(published.catalog);
});

it.skipIf(!worldArtDirectory)("publishes a lossless complete pool", async () => {
  for (const field of Object.values(published.fields)) {
    const { data, info } = await sharp(readFileSync(worldArtFile(field.image)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([field.width * 2, field.height]);
    const pixels = unpackVillageLightField(data, field.width, field.height);
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(field.rgbaSha256);
    expect(
      pixels.some((n, i) => i % 4 < 3 && n > 0 && pixels[i - (i % 4) + 3] === 0),
    ).toBe(true);
  }
});

it("does not paint or load a guessed pool for an unknown sector signature", async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  const lease = acquirePrebakedVillageLightField("unknown scene signature", {
    x: 100,
    y: -200,
  });
  try {
    expect(await lease.resource).toBeNull();
    expect(canvas).not.toHaveBeenCalled();
  } finally {
    lease.release();
    lease.release();
    canvas.mockRestore();
  }
});

it("cancels a released layout before it paints an obsolete pool", async () => {
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  const lease = acquireVillageLightField([{ x: 0, y: 0, height: 12, reach: 213 }])!;
  lease.release();
  try {
    await expect(lease.resource).rejects.toMatchObject({ name: "AbortError" });
    expect(canvas).not.toHaveBeenCalled();
  } finally {
    canvas.mockRestore();
  }
});

it("shares an RGB pool texture across translated layouts and ignores invalid fixtures", async () => {
  const stops = vi.fn();
  const context = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(768 * 384 * 4) }),
    createRadialGradient: () => ({ addColorStop: stops }),
  };
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as never);
  try {
    expect(
      acquireVillageLightField([{ x: NaN, y: 0, height: 1, reach: 20 }]),
    ).toBeNull();
    const first = acquireVillageLightField([{ x: 20, y: 40, height: 10, reach: 100 }])!;
    const field = await first.resource;
    expect(field.bounds).toEqual({ minX: -105, maxX: 145, minY: -22.5, maxY: 102.5 });
    expect([field.texture.width, field.texture.height]).toEqual([768, 384]);
    const translated = acquireVillageLightField([
      { x: 120, y: 140, height: 10, reach: 100 },
    ])!;
    expect((await translated.resource).texture).toBe(field.texture);
    expect((await translated.resource).bounds.minX).toBe(-5);
    expect(context.fillRect).toHaveBeenCalledTimes(2);
    expect(stops.mock.calls[0]?.[1]).toBe("rgb(200,120,37)");
    first.release();
    translated.release();
  } finally {
    canvas.mockRestore();
  }
});

it("casts finite ground occlusion from a low wall and extends tall wall shadows away from a lamp", () => {
  const light = { x: 0, y: 0, height: 10, reach: 100 };
  const points = [
    { x: 10, y: -1 },
    { x: 12, y: -1 },
    { x: 12, y: 1 },
    { x: 10, y: 1 },
  ];
  const finite = lightOcclusionPolygon(light, { points, height: 5 });
  expect(Math.max(...finite.map((p) => p.x))).toBe(24);
  expect(Math.min(...finite.map((p) => p.x))).toBe(10);
  const tall = lightOcclusionPolygon(light, { points, height: 20 });
  expect(Math.max(...tall.map((p) => p.x))).toBeGreaterThan(190);
  expect(tall.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
});

it("keeps light-map UVs anchored in the world through camera pan and zoom and honors the local-light switch", () => {
  const world = new Container(),
    cleanup: (() => void)[] = [];
  const game = {
    renderer: { resolution: 1 },
    visualEffects: { ...DEFAULT_VISUAL_EFFECTS },
    own: (fn: () => void) => cleanup.push(fn),
  } as unknown as GameRenderer;
  const texture = new Texture({
    source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }),
  });
  const lighting = createProjectedWorldLighting(game, world, {
    restoreWarmWindows: true,
  });
  world.addChild(lighting.container);
  lighting.setWarmField({
    texture,
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
  });
  const filter = lighting.container.filters![0]!,
    uniforms = filter.resources.night.uniforms;
  try {
    for (const [scale, x, y] of [
      [3, 100, 200],
      [8, -400, 800],
    ]) {
      world.scale.set(scale!, -scale!);
      world.position.set(x!, y!);
      lighting.update(
        { x: 0, y: 1, z: 1, day: 0 },
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      );
      const screenX = x! + 20 * scale!,
        screenY = y! - 30 * scale!;
      const u = filter.resources.warmMapping.uniforms.uWarmU,
        v = filter.resources.warmMapping.uniforms.uWarmV;
      expect(u[0] * screenX + u[1] * screenY + u[2]).toBeCloseTo(0.2);
      expect(v[0] * screenX + v[1] * screenY + v[2]).toBeCloseTo(0.3);
    }
    game.visualEffects.localLights = false;
    lighting.update(
      { x: 0, y: 1, z: 1, day: 0 },
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    );
    expect(uniforms.uLocalNight).toBe(0);
    game.visualEffects.localLights = true;
    lighting.update(
      { x: 0, y: 1, z: 1, day: 0.5 },
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    );
    expect(uniforms.uLocalNight).toBe(0.75);
    lighting.update(
      { x: 0, y: 1, z: 1, day: 1 },
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    );
    expect(uniforms.uLocalNight).toBe(0);
    lighting.setWarmField(null);
    expect(filter.resources.uWarmMap).toBe(Texture.EMPTY.source);
  } finally {
    world.destroy({ children: true });
    for (const fn of cleanup) fn();
    texture.destroy(true);
  }
});
