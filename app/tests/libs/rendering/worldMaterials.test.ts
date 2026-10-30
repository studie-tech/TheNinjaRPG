import { describe, expect, it, vi } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { BufferImageSource, Polygon, Rectangle, Texture } from "pixi.js";
import sharp from "sharp";
import { WORLD_DAY_SECONDS } from "@/drizzle/constants";
import * as sceneAssets from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { BIOME_DECORATIONS, GROUND_DETAIL_ART, WOODLAND_DECORATIONS, resolveWorldDecoration } from "@/libs/rendering/worldArt";
import { WORLD_STRUCTURE_ART, resolveWorldStructure } from "@/libs/rendering/worldStructures";
import { WORLD_ASSET_SOURCES, worldAssetSource } from "@/libs/rendering/worldAssetSources";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { DECORATION_ASSETS } from "@/libs/sector-map/decorations";
import { STONE_VILLAGE_WALL_KIT } from "@/libs/sector-map/village-wall-assets";
import { acquireWorldMaterial, createCharacterMaterialFrame, type AuthoredMaterialFrame, encodeWorldNormal, type WorldMaterial, worldMaterialFrame } from "@/libs/rendering/worldMaterials";
import { worldSunlight } from "@/libs/rendering/worldShadows";
import { createSunShadows } from "@/libs/rendering/worldSunShadows";

const material = (width: number, height: number): WorldMaterial => {
  const pixels = new Uint8Array(width * height * 4);
  return { pixels, width, height, shape: "building", frames: new Map(), texture: new Texture({ source: new BufferImageSource({ resource: pixels, width, height, format: "rgba8unorm", scaleMode: "nearest", alphaMode: "no-premultiply-alpha" }) }) };
};
const worldSurfaceAtlases = Object.keys(WORLD_ASSET_SOURCES);
const materialUrls = new Set(Object.values(WORLD_ASSET_SOURCES).map((source) => source.material));
const paint = (source: WorldMaterial, x: number, y: number, height: number, flags: number, alpha = 255) => source.pixels.set([128 | flags, 128, height, alpha], (y * source.width + x) * 4);
const decodeNormal = ([u, v]: readonly [number, number]) => {
  let x = u * 2 - 1, y = v * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) [x, y] = [(1 - Math.abs(y)) * (x < 0 ? -1 : 1), (1 - Math.abs(x)) * (y < 0 ? -1 : 1)];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
};

describe("packed character shadow volumes", () => {
  const make = () => {
    const source = material(32, 32); source.isBillboard = true;
    for (let y = 0; y < 29; y++) for (let x = 5; x < 27; x++) {
      // A transparent gap between the legs must stay open in the volume as well as the art.
      if (y > 20 && x >= 13 && x < 19) continue;
      paint(source, x, y, 0, 1);
    }
    const texture = new Texture({ source: source.texture.source, frame: new Rectangle(0, 0, 32, 32),
      orig: new Rectangle(0, 0, 64, 64), trim: new Rectangle(16, 31, 32, 32) });
    return { source, texture, frame: createCharacterMaterialFrame(source, texture), dispose: () => { texture.destroy(false); source.texture.destroy(true); } };
  };
  it("has real rear depth for east/west light while retaining every covered camera pixel", () => {
    const f = make();
    try {
      expect(f.frame.volumes!.length).toBeGreaterThan(0);
      let depth = 0;
      for (const volume of f.frame.volumes!) for (let i = 0; i < volume.vertices.length; i += 4) {
        const u = volume.vertices[i]!, v = volume.vertices[i + 1]!, lower = volume.vertices[i + 2]!, upper = volume.vertices[i + 3]!;
        depth = Math.max(depth, 2 * (60 - (v + upper) * 64));
        expect(lower).toBeGreaterThanOrEqual(0); expect(upper).toBeGreaterThanOrEqual(lower);
        expect(u * 64).toBeGreaterThanOrEqual(21); expect(u * 64).toBeLessThanOrEqual(43);
        expect(v * 64).toBeGreaterThanOrEqual(31); expect((v + upper - lower) * 64).toBeLessThanOrEqual(60.00001);
      }
      expect(depth).toBeGreaterThan(6);
      expect(f.frame.vertices.length / 6).toBeLessThan(2000);
      expect(Array.from(f.frame.vertices).every(Number.isFinite)).toBe(true);
    } finally { f.dispose(); }
  });
  it("keeps transparent leg gaps open and leaves the receiver card in front of the volume", () => {
    const f = make();
    try {
      for (const volume of f.frame.volumes!) {
        const rows = Array.from(volume.vertices).filter((_, i) => i % 4 === 1).map(v => v * 64);
        if (Math.min(...rows) <= 51) continue;
        const xs = Array.from(volume.vertices).filter((_, i) => i % 4 === 0).map(u => u * 64);
        expect(Math.max(...xs) <= 29.00001 || Math.min(...xs) >= 34.99999).toBe(true);
      }
      for (let i = 0; i < f.frame.vertices.length; i += 6) {
        if (f.frame.vertices[i + 5] !== 0) continue;
        const rear = 2 * (60 - (f.frame.vertices[i + 1]! + f.frame.vertices[i + 2]!) * 64);
        expect(rear).toBeGreaterThanOrEqual(-0.00001);
      }
    } finally { f.dispose(); }
  });
});

describe("sampled world material fallback", () => {
  it("keeps atlas UVs, normalized physical heights and semantic classes aligned", () => {
    const source = material(8, 4);
    paint(source, 4, 0, 153, 2);
    paint(source, 6, 2, 204, 3);
    const frame = worldMaterialFrame(source, new Rectangle(4, 0, 4, 4));
    expect(Array.from(frame.vertices.slice(0, 6))).toEqual([0, 0, expect.closeTo(0.6), 0.5, 0, 1]);
    expect(Array.from(frame.points.slice(0, 4))).toEqual([0, 0, expect.closeTo(0.6), 2]);
    expect(Array.from(frame.points).some((_, index, values) => index % 4 === 0 && values[index] === 0.5 && values[index + 1] === 0.5 && values[index + 3] === 3)).toBe(true);
    for (let i = 0; i < frame.vertices.length; i += 6) {
      expect(frame.vertices[i + 3]).toBeGreaterThanOrEqual(0.5);
      expect(frame.vertices[i + 3]).toBeLessThanOrEqual(1);
    }
    source.texture.destroy(true);
  });
  it("excludes transparent coverage while extending nearby height beneath cutout fringe", () => {
    const source = material(4, 4);
    paint(source, 2, 2, 153, 2);
    const frame = worldMaterialFrame(source, new Rectangle(0, 0, 4, 4));
    expect(frame.vertices[2]).toBeCloseTo(0.6);
    expect(frame.points).toHaveLength(4);
    expect(Array.from(frame.points)).toEqual([0.5, 0.5, expect.closeTo(0.6), 2]);
    source.texture.destroy(true);
  });
  it("never reads adjacent atlas frames when a cutout frame has no covered samples", () => {
    const source = material(8, 4);
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) paint(source, x, y, 255, 5);
    const frame = worldMaterialFrame(source, new Rectangle(0, 0, 4, 4));
    expect(frame.points).toHaveLength(0);
    expect(frame.emitters).toHaveLength(0);
    expect(Array.from(frame.vertices).filter((_, index) => index % 6 === 2).every((height) => height === 0)).toBe(true);
    source.texture.destroy(true);
  });
  it.each([0, 0.5])("anchors bounded lights to emissive texel centers in frames starting at %s and ignores isolated pixels", (offset) => {
    const source = material(11, 11);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3]] as const) paint(source, x, y, 153, 5);
    paint(source, 8, 8, 255, 5);
    paint(source, 6, 6, 255, 1);
    const frame = worldMaterialFrame(source, new Rectangle(offset, offset, 10, 10));
    expect(frame.emitters).toHaveLength(1);
    expect(frame.emitters[0]?.x).toBeCloseTo((2.5 - offset) / 10);
    expect(frame.emitters[0]?.y).toBeCloseTo((2.5 - offset) / 10);
    expect(frame.emitters[0]?.height).toBeCloseTo(0.6);
    source.texture.destroy(true);
  });
  it("keeps a light shared by separate windows on a real emitting surface at its own height", () => {
    const source = material(30, 30);
    for (const x of [0, 5]) for (const y of [1, 2, 3]) paint(source, x, y, x === 0 ? 64 : 192, 5);
    const frame = worldMaterialFrame(source, new Rectangle(0, 0, 30, 30));
    expect(frame.emitters).toHaveLength(1);
    const light = frame.emitters[0]!;
    const x = Math.floor(light.x * 30), y = Math.floor(light.y * 30);
    expect([0, 5]).toContain(x);
    expect(y).toBe(2);
    expect(source.pixels[(y * 30 + x) * 4]! & 4).toBe(4);
    expect(light.height).toBeCloseTo(source.pixels[(y * 30 + x) * 4 + 2]! / 255);
    source.texture.destroy(true);
  });
  it("shares immutable frame data and closes odd-sized frame grids at their exact edges", () => {
    const source = material(5, 3), rect = new Rectangle(0, 0, 5, 3);
    const first = worldMaterialFrame(source, rect);
    const repeated = worldMaterialFrame(source, rect.clone());
    expect(repeated).toBe(first);
    expect(source.frames.size).toBe(1);
    expect(first.vertices.length / 6).toBe(12);
    expect(first.indices).toHaveLength(36);
    expect(Math.max(...first.indices)).toBe(11);
    expect(Array.from(first.vertices.slice(-6))).toEqual([1, 1, 0, 1, 1, 1]);
    expect(source.texture.destroyed).toBe(false);
    source.texture.destroy(true);
  });
});

describe("world material loading", () => {
  it.each([
    ["unknown", "/fallback-avatar-plane.png", 128, 128, [0, 0, 128, 128]],
    ["missing", "/world-art/practice-rail.webp", 116, 87, [0, 0, 116, 87]],
    ["wrong-sized", "/world-art/training-dummy.webp", 94, 192, [0, 0, 94, 192]],
    ["missing", "/world-art/woodland-village.webp", 640, 640, [350.5, 512, 72, 95.5]],
  ] as const)("keeps receiver heights and shadow geometry on one physical fallback when the material is %s for %s", async (failure, image, width, height, rectangle) => {
    const albedo = material(width, height), auxiliary = material(1, 1);
    for (let i = 3; i < albedo.pixels.length; i += 4) albedo.pixels[i] = 255;
    const dispose = vi.fn();
    const assets = vi.spyOn(sceneAssets, "createSceneAssets").mockImplementation(() => ({
      texture: async (path) => {
        if (!materialUrls.has(path)) return albedo.texture;
        if (failure === "missing") throw new Error("Missing authored material");
        return auxiliary.texture;
      }, dispose,
    }));
    let drawn: Uint8Array = new Uint8Array();
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => kind === "2d" ? {
      drawImage: (pixels: Uint8Array) => { drawn = pixels; },
      getImageData: () => ({ data: drawn }),
    } : null) as HTMLCanvasElement["getContext"]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify([{ frame: [0, 0, width, height], surfaces: [], volumes: [] }])));
    const lease = acquireWorldMaterial(image, "column");
    try {
      const loaded = await lease.resource;
      expect(request).toHaveBeenCalledTimes(failure === "unknown" ? 0 : 1);
      if (failure !== "unknown") expect(request).toHaveBeenCalledWith(worldAssetSource(image)!.surfaces);
      expect(loaded.surfaceFrames).toBeUndefined();
      expect(loaded.isBillboard).toBe(true);
      expect(loaded.pixels[2]).toBe(Math.round((1 - 0.5 / height) * 255));
      const rect = new Rectangle(...rectangle);
      const frame = worldMaterialFrame(loaded, rect);
      expect(frame.volumes).toBeUndefined();
      expect(frame.points.length).toBeGreaterThan(0);
      expect(frame.vertices[5]).toBe(1);
      expect(loaded.pixels.every((value, index) => index % 4 === 0 ? value === 129 : index % 4 === 1 ? value === 0 : index % 4 === 2 ? value === Math.round((1 - (Math.floor(index / 4 / width) + 0.5) / height) * 255) : value === 255)).toBe(true);
      for (let i = 0; i < frame.vertices.length; i += 6)
        expect(frame.vertices[i + 2]! + frame.vertices[i + 1]!).toBeCloseTo(1, 6);
      for (let i = 0; i < frame.points.length; i += 4) {
        expect(frame.points[i + 2]! + frame.points[i + 1]!).toBeCloseTo(1, 6);
        expect(rect.x + frame.points[i]! * rect.width - 0.5).toBeCloseTo(Math.round(rect.x + frame.points[i]! * rect.width - 0.5), 4);
        expect(rect.y + frame.points[i + 1]! * rect.height - 0.5).toBeCloseTo(Math.round(rect.y + frame.points[i + 1]! * rect.height - 0.5), 4);
      }
      expectBillboardSunDepth(loaded, rect);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledTimes(failure === "unknown" ? 0 : 1);
    } finally {
      lease.release(); request.mockRestore(); canvas.mockRestore(); warning.mockRestore(); assets.mockRestore();
      albedo.texture.destroy(true); auxiliary.texture.destroy(true);
    }
  });
  const definition: AuthoredMaterialFrame = {
    frame: [0, 0, 4, 4],
    surfaces: [{ vertices: [[0, 0, 2], [4, 0, 2], [4, 2, 2], [0, 2, 2]], indices: [0, 1, 2, 0, 2, 3] }],
    volumes: [{ vertices: [[0, 0, 0, 2], [4, 0, 0, 2], [4, 2, 0, 2], [0, 2, 0, 2]], indices: [0, 1, 2, 0, 2, 3] }],
  };
  const loadingFixture = (response: () => Response | Promise<Response>) => {
    const albedo = material(4, 4), numerical = material(4, 4), dispose = vi.fn();
    for (let i = 0; i < 16; i++) {
      albedo.pixels.set([20, 40, 60, 255], i * 4);
      numerical.pixels.set([129, 128, 128, 255], i * 4);
    }
    const loadTexture = vi.fn(async (image: string) => materialUrls.has(image) ? numerical.texture : albedo.texture);
    const assets = vi.spyOn(sceneAssets, "createSceneAssets").mockImplementation(() => ({ texture: loadTexture, dispose }));
    let drawn: Uint8Array = new Uint8Array();
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => kind === "2d" ? {
      drawImage: (pixels: Uint8Array) => { drawn = pixels; },
      getImageData: () => ({ data: drawn }),
    } : null) as HTMLCanvasElement["getContext"]);
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    return { request, warning, loadTexture, dispose, restore: () => {
      request.mockRestore(); warning.mockRestore(); canvas.mockRestore(); assets.mockRestore();
      albedo.texture.destroy(true); numerical.texture.destroy(true);
    } };
  };

  it("loads a registered atlas's surface array once through its shared material lease", async () => {
    const image = "/world-art/ground-details.webp", text = JSON.stringify([definition]);
    const fixture = loadingFixture(() => new Response(text));
    const first = acquireWorldMaterial(image, "canopy"), second = acquireWorldMaterial(image, "building");
    try {
      const [source, repeated] = await Promise.all([first.resource, second.resource]);
      expect(source).toBe(repeated);
      expect(fixture.request).toHaveBeenCalledTimes(1);
      expect(fixture.request).toHaveBeenCalledWith(worldAssetSource(image)!.surfaces);
      expect(fixture.loadTexture).toHaveBeenCalledTimes(2);
      expect(source.surfaceFrames).toEqual([definition]);
      expect(source.surfaceBytes).toBe(text.length * 4);
      expect(source.isBillboard).toBe(false);
      const frame = worldMaterialFrame(source, new Rectangle(...definition.frame));
      expect(frame.volumes).toHaveLength(1);
      expect(frame.points).toHaveLength(0);
      expect(source.pixels[2]).toBe(128);
      expect(fixture.warning).not.toHaveBeenCalled();
      expect(fixture.dispose).toHaveBeenCalledTimes(1);
    } finally { first.release(); second.release(); fixture.restore(); }
  });

  it("shares pending metadata and retains a usable resource when both leases release before it resolves", async () => {
    let complete: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { complete = resolve; });
    const fixture = loadingFixture(() => pending), image = "/world-art/oasis-village.webp";
    const first = acquireWorldMaterial(image, "column"), second = acquireWorldMaterial(image, "character");
    first.release(); second.release();
    try {
      await Promise.resolve(); await Promise.resolve();
      expect(fixture.request).toHaveBeenCalledTimes(1);
      expect(fixture.dispose).not.toHaveBeenCalled();
      complete(new Response(JSON.stringify([definition])));
      const [source, repeated] = await Promise.all([first.resource, second.resource]);
      expect(source).toBe(repeated);
      expect(source.surfaceFrames).toEqual([definition]);
      expect(source.texture.destroyed).toBe(false);
      expect(fixture.dispose).toHaveBeenCalledTimes(1);
      const next = acquireWorldMaterial(image, "column");
      try { expect(await next.resource).toBe(source); } finally { next.release(); }
      expect(fixture.request).toHaveBeenCalledTimes(1);
      expect(fixture.warning).not.toHaveBeenCalled();
    } finally { complete(new Response(JSON.stringify([definition]))); first.release(); second.release(); fixture.restore(); }
  });

  it("loads persisted numerical maps at native resolution for artwork outside the catalogue", async () => {
    const published = worldAssetSource("/world-art/ground-details.webp")!;
    const fixture = loadingFixture(() => new Response(JSON.stringify([definition])));
    const lease = acquireWorldMaterial("persisted-structure.webp", "building", 128, published);
    try {
      const source = await lease.resource;
      expect(source.isBillboard).toBe(false);
      expect(fixture.loadTexture).toHaveBeenCalledWith("persisted-structure.webp", 0, "nearest");
      expect(fixture.loadTexture).toHaveBeenCalledWith(published.material, 0, "nearest");
      expect(fixture.request).toHaveBeenCalledWith(published.surfaces);
    } finally { lease.release(); fixture.restore(); }
  });

  it.each([
    ["missing", "/world-art/settlement-wake-island.webp", "", 404],
    ["malformed", "/world-art/settlement-horizon.webp", "{", 200],
    ["empty", "/world-art/village-walls.webp", "[]", 200],
    ["invalid frame", "/world-art/desert-rocks.webp", JSON.stringify([{ frame: [0, 0, null, 4], surfaces: [], volumes: [] }]), 200],
    ["missing surfaces", "/world-art/submerged-rock-shelf.webp", JSON.stringify([{ frame: [0, 0, 4, 4], volumes: [] }]), 200],
  ] as const)("uses one physical billboard when a registered atlas's metadata is %s", async (_failure, image, text, status) => {
    const fixture = loadingFixture(() => new Response(text, { status }));
    const lease = acquireWorldMaterial(image, "column");
    try {
      const source = await lease.resource;
      expect(fixture.request).toHaveBeenCalledWith(worldAssetSource(image)!.surfaces);
      expect(source.surfaceFrames).toBeUndefined();
      expect(source.surfaceBytes ?? 0).toBe(0);
      expect(source.isBillboard).toBe(true);
      const frame = worldMaterialFrame(source, new Rectangle(0, 0, 4, 4));
      expect(frame.volumes).toBeUndefined();
      expect(frame.points.length).toBeGreaterThan(0);
      for (let i = 0; i < frame.vertices.length; i += 6) expect(frame.vertices[i + 1]! + frame.vertices[i + 2]!).toBeCloseTo(1, 6);
      expect(source.pixels.every((value, index) => index % 4 === 0 ? value === 129 : index % 4 === 1 ? value === 0 : index % 4 === 2 ? value === Math.round((1 - (Math.floor(index / 16) + 0.5) / 4) * 255) : value === 255)).toBe(true);
      expect(fixture.warning).toHaveBeenCalledTimes(1);
      expect(fixture.dispose).toHaveBeenCalledTimes(1);
    } finally { lease.release(); fixture.restore(); }
  });

});

const expectBillboardSunDepth = (source: WorldMaterial, rect: Rectangle) => {
  const height = 128, frame = worldMaterialFrame(source, rect);
  const sun = createSunShadows({ renderer: { width: 800, render() {} } } as unknown as GameRenderer);
  const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const normal = decodeNormal([16 / 31, 0]);
  try {
    for (const [progress, facing, texel] of [[0.02, 1, 120], [0.98, -1, 7]] as const) {
      const transform = new Float32Array([height * facing, 0, 0, -height, facing > 0 ? 0 : height, height]);
      sun.update([{ id: "fallback", key: `${facing}`, dynamic: true, frame, material: source, transform, height }], { minX: 0, minY: 0, maxX: 100, maxY: 100 }, worldSunlight(new Date(WORLD_DAY_SECONDS * progress * 1000)));
      const uniforms = sun.uniforms.uniforms, direction = uniforms.uSun;
      const u = (texel + 0.5) / 128, v = 63.5 / 128;
      const receiver = [transform[4]! + transform[0]! * u, 0, height * (1 - v)];
      const relative = receiver.map((value, i) => value - uniforms.uSunOrigin[i]!);
      const r = dot(relative, uniforms.uSunRight), up = dot(relative, uniforms.uSunUp);
      const resolution = uniforms.uSunDepth[3]!;
      const center = [r, up].map((value, i) => uniforms.uSunBounds[i]! + (Math.floor((value - uniforms.uSunBounds[i]!) / uniforms.uSunBounds[i + 2]! * resolution) + 0.5) / resolution * uniforms.uSunBounds[i + 2]!);
      const offset = [center[0]! - r, center[1]! - up];
      const facingSun = dot(normal, direction);
      const reference = dot(relative, direction) - (dot(normal, uniforms.uSunRight) * offset[0]! + dot(normal, uniforms.uSunUp) * offset[1]!) / Math.max(facingSun, 0.08);
      // Intersect the sampled sun ray with the actual mesh plane, whose physical Y is constant.
      const first = frame.indices[0]! * 6;
      const planeY = 2 * (height - frame.vertices[first + 1]! * height - frame.vertices[first + 2]! * height);
      const base = [0, 1, 2].map((i) => uniforms.uSunOrigin[i]! + uniforms.uSunRight[i]! * center[0]! + uniforms.uSunUp[i]! * center[1]!);
      const caster = (planeY - base[1]!) / direction[1]!;
      const packedCaster = Math.round((caster - uniforms.uSunDepth[0]!) / uniforms.uSunDepth[1]! * 65025) / 65025 * uniforms.uSunDepth[1]! + uniforms.uSunDepth[0]!;
      const bias = uniforms.uSunDepth[2]! * Math.abs(normal[2]! - 2 * normal[1]!) / Math.max(facingSun, 0.08) + uniforms.uSunDepth[1]! / 65025;
      expect(facingSun).toBeGreaterThan(0.001);
      expect(packedCaster - reference).toBeLessThan(bias);
    }
  } finally { sun.dispose(); }
};

describe("authored world surface topology", () => {
  const authored = (definition: AuthoredMaterialFrame, width = 32, height = 16) => {
    const source = material(width, height);
    source.surfaceFrames = [definition];
    return source;
  };
  const volume: AuthoredMaterialFrame = {
    frame: [8, 4, 8, 8], surfaces: [],
    volumes: [{ vertices: [[1, 1, 2, 6], [7, 1, 2, 6], [7, 3, 2, 6], [1, 3, 2, 6]], indices: [0, 1, 2, 0, 2, 3] }],
  };

  it("keeps ground collars receiver-only while zero-height solid decks and closed bodies still cast", () => {
    const definition: AuthoredMaterialFrame = {
      ...volume,
      surfaces: [
        { surfaceClass: 0, vertices: [[0, 0, 0], [8, 0, 0], [0, 8, 0]], indices: [0, 1, 2] },
        { vertices: [[0, 0, 0], [8, 0, 0], [0, 8, 0]], indices: [0, 1, 2] },
      ],
    };
    const source = authored(definition);
    const frame = worldMaterialFrame(source, new Rectangle(...definition.frame));
    const modes = Array.from(frame.vertices).filter((_, index) => index % 6 === 5);
    expect(modes.slice(0, 3)).toEqual([2, 2, 2]);
    expect(modes.slice(3, 6)).toEqual([1, 1, 1]);
    expect(modes.slice(6)).toEqual(Array(8).fill(0));
    expect(frame.volumes).toHaveLength(1);
    source.texture.destroy(true);
  });

  it("preserves separate stair surfaces without triangles across their gap", () => {
    const definition: AuthoredMaterialFrame = {
      frame: [8, 4, 8, 8],
      surfaces: [
        { vertices: [[0, 0, 6], [8, 0, 6], [0, 2, 6]], indices: [0, 1, 2] },
        { vertices: [[0, 5, 2], [8, 5, 2], [0, 7, 2]], indices: [0, 1, 2] },
      ], volumes: [],
    };
    const source = authored(definition);
    paint(source, 8, 4, 0, 1);
    const rect = new Rectangle(...definition.frame);
    const frame = worldMaterialFrame(source, rect);
    expect(frame.vertices).toHaveLength(6 * 6);
    expect(Array.from(frame.indices)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(frame.vertices.slice(0, 6))).toEqual([0, 0, 0.75, 0.25, 0.25, 1]);
    for (let i = 0; i < frame.indices.length; i += 3) {
      const heights = Array.from(frame.indices.slice(i, i + 3), (index) => frame.vertices[index * 6 + 2]);
      expect(new Set(heights).size).toBe(1);
    }
    expect(frame.points).toHaveLength(0);
    expect(frame.volumes).toEqual([]);
    expect(worldMaterialFrame(source, rect.clone())).toBe(frame);
    source.texture.destroy(true);
  });

  it("closes volume boundaries without putting walls on shared triangulation edges", () => {
    const source = authored(volume), frame = worldMaterialFrame(source, new Rectangle(...volume.frame));
    expect(frame.vertices).toHaveLength(8 * 6);
    expect(frame.indices).toHaveLength(12 * 3);
    expect(frame.volumes).toHaveLength(1);
    expect(Array.from(frame.volumes![0]!.vertices.slice(0, 4))).toEqual([0.125, 0.125, 0.25, 0.75]);
    const edgeCounts = new Map<string, number>();
    for (let i = 0; i < frame.indices.length; i += 3) {
      const triangle = Array.from(frame.indices.slice(i, i + 3));
      for (let j = 0; j < 3; j++) {
        const a = triangle[j]!, b = triangle[(j + 1) % 3]!;
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
    expect([...edgeCounts.values()].every((count) => count === 2)).toBe(true);
    // Four upper and four lower vertices share opaque hidden-volume coverage.
    expect(Array.from(frame.vertices).filter((_, index) => index % 6 === 5)).toEqual(Array(8).fill(0));
    expect(Array.from(frame.vertices.slice(4 * 6, 4 * 6 + 6))).toEqual([0.125, 0.625, 0.25, 9 / 32, 9 / 16, 0]);
    source.texture.destroy(true);
  });

  it.each([80, -80])("keeps the underside at the same physical XY for horizontal scale %s and negative sprite Y", (horizontal) => {
    const source = authored(volume), frame = worldMaterialFrame(source, new Rectangle(...volume.frame));
    const objectHeight = 120;
    const physical = (index: number) => {
      const u = frame.vertices[index * 6]!, v = frame.vertices[index * 6 + 1]!, height = frame.vertices[index * 6 + 2]! * objectHeight;
      return [u * horizontal + 30, 2 * (-v * objectHeight + 220 - height), height];
    };
    for (let i = 0; i < 4; i++) {
      const top = physical(i), bottom = physical(i + 4);
      expect(bottom[0]).toBeCloseTo(top[0]!);
      expect(bottom[1]).toBeCloseTo(top[1]!);
      expect(bottom[2]).toBeLessThan(top[2]!);
    }
    source.texture.destroy(true);
  });

  it("winds closed faces outward in physical coordinates", () => {
    const source = authored(volume), frame = worldMaterialFrame(source, new Rectangle(...volume.frame));
    const physical = (index: number) => [frame.vertices[index * 6]!, -2 * (frame.vertices[index * 6 + 1]! + frame.vertices[index * 6 + 2]!), frame.vertices[index * 6 + 2]!];
    const center = [0.5, -2, 0.5];
    for (let i = 0; i < frame.indices.length; i += 3) {
      const a = physical(frame.indices[i]!), b = physical(frame.indices[i + 1]!), c = physical(frame.indices[i + 2]!);
      const ab = b.map((value, j) => value - a[j]!), ac = c.map((value, j) => value - a[j]!);
      const normal = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
      const outward = a.map((value, j) => (value + b[j]! + c[j]!) / 3 - center[j]!);
      expect(normal.reduce((sum, value, j) => sum + value * outward[j]!, 0)).toBeGreaterThan(0);
    }
    source.texture.destroy(true);
  });

  it("retains custom-crop fallback and its covered samples without a closed-volume claim", () => {
    const source = authored(volume);
    paint(source, 0, 0, 153, 1);
    const custom = worldMaterialFrame(source, new Rectangle(0, 0, 4, 4));
    expect(custom.volumes).toBeUndefined();
    expect(custom.points.length).toBeGreaterThan(0);
    expect(custom.vertices.length / 6).toBe(9);
    expect(custom.vertices[5]).toBe(1);
    source.texture.destroy(true);
  });

  it("reuses a coincident volume bottom only when its full Float32 vertex matches", () => {
    const source = material(1, 1), rect = new Rectangle(0, 0, 1, 1);
    source.surfaceFrames = [{ frame: [0, 0, 1, 1], surfaces: [], volumes: [{ vertices: [[0, 0, 0.5, 0.5], [1, 0, 0.5, 0.5], [0, 1, 0.5, 0.5]], indices: [0, 1, 2] }] }];
    try {
      const frame = worldMaterialFrame(source, rect);
      expect(frame.vertices.length / 6).toBe(3);
      expect(frame.indices).toHaveLength(6);
      expect(frame.volumes![0]!.vertices).toHaveLength(12);
    } finally { source.texture.destroy(true); }
  });

  it("retains distinct bottom vertices when the source-height cancellation rounds differently", () => {
    const source = material(1, 1), rect = new Rectangle(0, 0, 1, 1), y = 0.5 + 2 ** -25;
    source.surfaceFrames = [{ frame: [0, 0, 1, 1], surfaces: [], volumes: [{ vertices: [[0, y, 0.6, 0.6], [1, y, 0.6, 0.6], [0, 0.75, 0.6, 0.6]], indices: [0, 1, 2] }] }];
    try {
      const frame = worldMaterialFrame(source, rect);
      expect(frame.vertices.length / 6).toBe(5);
      expect(frame.vertices[1]).toBe(0.5);
      const bottom = frame.indices[3]!;
      expect(bottom).not.toBe(frame.indices[0]);
      expect(frame.vertices[bottom * 6 + 1]).toBe(0.5000000596046448);
      expect(frame.vertices[bottom * 6 + 4]).toBe(0.5000000596046448);
    } finally { source.texture.destroy(true); }
  });
});

describe("thin authored foliage backing", () => {
  const definition: AuthoredMaterialFrame = {
    thinBacking: true,
    frame: [0.5, 0.5, 6, 6],
    surfaces: [
      { surfaceClass: 0, vertices: [[0, 0, 0], [6, 0, 0], [6, 6, 0], [0, 6, 0]], indices: [0, 1, 2, 0, 2, 3] },
      { vertices: [[0, 0, 2], [6, 0, 3.5], [6, 6, 4.25], [0, 6, 2.75]], indices: [0, 1, 2, 0, 2, 3] },
    ],
    volumes: [{ vertices: [[0.75, 0.75, 1.78125, 2.28125], [3.25, 0.75, 2.40625, 2.90625], [3.25, 1.25, 2.46875, 2.96875], [0.75, 1.25, 1.84375, 2.34375]], indices: [0, 1, 2, 0, 2, 3] }],
  };
  const fixture = () => {
    const source = material(8, 8);
    source.surfaceFrames = [definition];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++)
      paint(source, x, y, 128, x === 2 && y === 3 ? 0 : 2, x === 4 && y === 2 ? 127 : 255);
    return source;
  };

  it("shares durable leaf backing through the ordinary immutable frame cache", () => {
    const source = fixture(), rect = new Rectangle(...definition.frame);
    try {
      const frame = worldMaterialFrame(source, rect);
      expect(frame.volumes).toHaveLength(1);
      expect(worldMaterialFrame(source, rect.clone())).toBe(frame);
      expect(source.frames.size).toBe(1);
      expect(definition.volumes[0]!.vertices[0]).toEqual([0.75, 0.75, 1.78125, 2.28125]);
    } finally { source.texture.destroy(true); }
  });

  it("keeps every finite backing cell closed and inside native plant support, including holes and fractional crops", () => {
    const source = fixture(), rect = new Rectangle(...definition.frame);
    try {
      const frame = worldMaterialFrame(source, rect);
      for (const volume of frame.volumes!) for (let i = 0; i < volume.vertices.length; i += 4) {
        const [u, v, lower, upper] = Array.from(volume.vertices.slice(i, i + 4)) as [number, number, number, number];
        expect([u, v, lower, upper].every(Number.isFinite)).toBe(true);
        expect(lower).toBeGreaterThanOrEqual(0);
        expect(upper).toBeGreaterThanOrEqual(lower);
        expect((upper - lower) * rect.height).toBeLessThanOrEqual(0.500001);
        expect(upper * rect.height).toBeCloseTo(2 + u * rect.width * 0.25 + v * rect.height * 0.125, 5);
      }
      expectClosedFoliageCoverage(source, rect, frame);
    } finally { source.texture.destroy(true); }
  });

  it("preserves surface-only frames and custom fallback without deriving geometry", () => {
    const source = fixture(), rect = new Rectangle(...definition.frame);
    try {
      source.surfaceFrames = [{ ...definition, thinBacking: undefined, volumes: [] }];
      expect(worldMaterialFrame(source, rect).volumes).toEqual([]);
      source.frames.clear(); source.surfaceFrames = undefined; source.isBillboard = true;
      expect(worldMaterialFrame(source, rect).volumes).toBeUndefined();
    } finally { source.texture.destroy(true); }
  });

  it.skipIf(!worldArtDirectory)("bounds shared native ground-atlas profiles and preserves opaque ownership after Float32 compilation", async () => {
    const image = "/world-art/ground-details.webp";
    const definitions = JSON.parse(readFileSync(worldArtFile(image.replace(/\.webp$/, ".surfaces.json")), "utf8")) as AuthoredMaterialFrame[];
    const albedo = await sharp(worldArtFile(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const numerical = await sharp(worldArtFile(image.replace(/\.webp$/, ".material.png"))).ensureAlpha().raw().toBuffer();
    const source = material(albedo.info.width, albedo.info.height);
    source.surfaceFrames = definitions; source.pixels.set(numerical);
    for (let i = 3; i < source.pixels.length; i += 4) source.pixels[i] = albedo.data[i]!;
    let bytes = 0;
    try {
      for (const definition of definitions) {
        const rect = new Rectangle(...definition.frame), frame = worldMaterialFrame(source, rect);
        expect(worldMaterialFrame(source, rect.clone())).toBe(frame);
        if (!definition.thinBacking) { expect(frame.volumes).toEqual([]); continue; }
        expect(frame.volumes!.length).toBeGreaterThan(0);
        expect(frame.vertices.length / 6).toBeLessThanOrEqual(65535);
        expect(Array.from(frame.vertices).every(Number.isFinite)).toBe(true);
        expect(Array.from(frame.indices).every((index) => index < frame.vertices.length / 6)).toBe(true);
        for (const volume of frame.volumes!) {
          bytes += volume.vertices.byteLength + volume.indices.byteLength;
          for (let i = 0; i < volume.indices.length; i += 3) {
            const points = Array.from(volume.indices.slice(i, i + 3), (index) => {
              const offset = index * 4;
              return [volume.vertices[offset]!, -2 * (volume.vertices[offset + 1]! + volume.vertices[offset + 3]!)];
            });
            const [a, b, c] = points as [number[], number[], number[]];
            expect(Math.abs((b[0]! - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (b[1]! - a[1]!))).toBeGreaterThan(1e-14);
            expect(Array.from(volume.indices.slice(i, i + 3)).some((index) => volume.vertices[index * 4 + 3]! > volume.vertices[index * 4 + 2]!)).toBe(true);
          }
          for (let i = 0; i < volume.vertices.length; i += 4) {
            const [x, y, lower, upper] = Array.from(volume.vertices.slice(i, i + 4)) as [number, number, number, number];
            expect(lower).toBeGreaterThanOrEqual(0);
            expect(upper).toBeGreaterThanOrEqual(lower);
            expect((upper - lower) * rect.height).toBeLessThanOrEqual(0.50001);
            const matchesPlane = definition.surfaces.some((surface) => surface.surfaceClass !== 0 && surface.indices.some((_, j) => {
              if (j % 3) return false;
              const a = surface.vertices[surface.indices[j]!]!, b = surface.vertices[surface.indices[j + 1]!]!, c = surface.vertices[surface.indices[j + 2]!]!;
              const u = x * rect.width, v = y * rect.height;
              const determinant = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (b[1]! - a[1]!);
              if (Math.abs(determinant) < 1e-12) return false;
              const p = ((u - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (v - a[1]!)) / determinant;
              const q = ((b[0]! - a[0]!) * (v - a[1]!) - (u - a[0]!) * (b[1]! - a[1]!)) / determinant;
              const height = a[2]! + p * (b[2]! - a[2]!) + q * (c[2]! - a[2]!);
              // Source-distance tolerance remains small even on very thin contour triangles.
              const inside = [[a, b], [b, c], [c, a]].every(([from, to]) => {
                const dx = to![0]! - from![0]!, dy = to![1]! - from![1]!;
                return Math.sign(determinant) * (dx * (v - from![1]!) - dy * (u - from![0]!)) >= -1e-5 * Math.hypot(dx, dy);
              });
              return inside && Math.abs(height - upper * rect.height) < 1e-4;
            }));
            expect(matchesPlane, JSON.stringify({ rect: definition.frame, point: [x * rect.width, y * rect.height, upper * rect.height] })).toBe(true);
          }
        }
        bytes += frame.vertices.byteLength + frame.indices.byteLength;
        expectClosedFoliageCoverage(source, rect, frame);
      }
      expect(source.frames.size).toBe(definitions.length);
      expect(definitions.filter((frame) => frame.thinBacking)).toHaveLength(7);
      expect(bytes).toBeLessThan(8 * 1024 * 1024);
    } finally { source.texture.destroy(true); }
  });
});

const expectClosedFoliageCoverage = (source: WorldMaterial, rect: Rectangle, frame: ReturnType<typeof worldMaterialFrame>) => {
  const parent = new Map<number, number>();
  const root = (index: number): number => {
    const next = parent.get(index);
    if (next === undefined) { parent.set(index, index); return index; }
    if (next === index) return index;
    const value = root(next); parent.set(index, value); return value;
  };
  const triangles: number[][] = [];
  for (let i = 0; i < frame.indices.length; i += 3) {
    const ids = Array.from(frame.indices.slice(i, i + 3));
    if (!ids.every((index) => frame.vertices[index * 6 + 5] === 0)) continue;
    const component = root(ids[0]!);
    for (const index of ids) parent.set(root(index), component);
    triangles.push(ids);
  }
  const components = new Map<number, number[][]>();
  for (const ids of triangles) {
    const key = root(ids[0]!);
    const component = components.get(key) ?? [];
    component.push(ids); components.set(key, component);
  }
  expect(components.size).toBe(frame.volumes!.length);
  for (const component of components.values()) {
    const edges = new Map<string, number>();
    for (const ids of component) {
      const positions = ids.map((index) => {
        const offset = index * 6;
        return [frame.vertices[offset]!, -2 * (frame.vertices[offset + 1]! + frame.vertices[offset + 2]!), frame.vertices[offset + 2]!].join(",");
      });
      if (new Set(positions).size !== 3) continue;
      for (let j = 0; j < 3; j++) {
        const key = [positions[j]!, positions[(j + 1) % 3]!].sort().join(";");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
  }
  let covered = 0;
  for (let i = 0; i < frame.indices.length; i += 3) {
    const ids = Array.from(frame.indices.slice(i, i + 3));
    if (!ids.every((index) => frame.vertices[index * 6 + 5] === 0)) continue;
    const points = ids.map((index) => [rect.x + frame.vertices[index * 6]! * rect.width, rect.y + frame.vertices[index * 6 + 1]! * rect.height]);
    const polygon = new Polygon(points.flat());
    const minX = Math.floor(Math.min(...points.map((p) => p[0]!))), maxX = Math.ceil(Math.max(...points.map((p) => p[0]!)));
    const minY = Math.floor(Math.min(...points.map((p) => p[1]!))), maxY = Math.ceil(Math.max(...points.map((p) => p[1]!)));
    for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
      if (!polygon.contains(x + 0.5, y + 0.5)) continue;
      covered++;
      const offset = (y * source.width + x) * 4;
      expect(source.pixels[offset + 3]).toBeGreaterThanOrEqual(128);
      expect(source.pixels[offset]! & 3).not.toBe(0);
    }
  }
  expect(covered).toBeGreaterThan(0);
};

describe.skipIf(!worldArtDirectory)("published world surface pixel audit", () => {
  if (!worldArtDirectory) return;
  const surfaceFiles = worldSurfaceAtlases.map((image) => worldArtFile(image.replace(/\.webp$/, ".surfaces.json")));
  const catalogue = Object.fromEntries(worldSurfaceAtlases.map((image, index) => [image, JSON.parse(readFileSync(surfaceFiles[index]!, "utf8")) as AuthoredMaterialFrame[]]));
  const directory = worldArtDirectory;
  const expectFrame = (image: string, frame: { x: number; y: number; width: number; height: number }) => {
    const key = worldSurfaceAtlases.find((key) => worldAssetSource(key) === worldAssetSource(image))!;
    expect(catalogue[key]?.some(({ frame: rectangle }) => rectangle[0] === frame.x && rectangle[1] === frame.y && rectangle[2] === frame.width && rectangle[3] === frame.height), `${image} ${JSON.stringify(frame)}`).toBe(true);
  };

  it("covers every published material atlas", () => {
    const materialAtlases = readdirSync(directory).filter((name) => name.endsWith(".material.png")).map((name) => `/world-art/${name.replace(/\.material\.png$/, ".webp")}`);
    expect(Object.keys(catalogue).sort()).toEqual(materialAtlases.sort());
    expect(new Set(worldSurfaceAtlases).size).toBe(worldSurfaceAtlases.length);
    const surfaceAtlases = readdirSync(directory).filter((name) => name.endsWith(".surfaces.json"));
    expect(surfaceAtlases.sort()).toEqual(worldSurfaceAtlases.map((image) => image.slice("/world-art/".length).replace(/\.webp$/, ".surfaces.json")).sort());
  });

  it("matches the immutable hashes of every published albedo, material and mesh", () => {
    for (const [image, source] of Object.entries(WORLD_ASSET_SOURCES))
      for (const [kind, suffix] of [["image", ".webp"], ["material", ".material.png"], ["surfaces", ".surfaces.json"]] as const) {
        const bytes = readFileSync(worldArtFile(image.replace(/\.webp$/, suffix)));
        expect(createHash("sha256").update(bytes).digest("hex"), `${image} ${kind}`).toBe(source.sha256[kind]);
      }
  });

  it("separates painted roofs, facade banners and the open arena floor", async () => {
    // These visible landmarks guard semantic alignment in addition to the silhouette/height audit.
    for (const [key, u, v, surface] of [
      ["akikaze/academy", .35, .32, 3], ["akikaze/academy", .36, .64, 1],
      ["akikaze/townhall", .65, .32, 3], ["akikaze/townhall", .75, .70, 1],
      ["wake-island/globalanbuhq", .13, .42, 3], ["wake-island/globalanbuhq", .46, .65, 1],
      ["wake-island/colosseum", .53, .40, 0], ["wake-island/colosseum", .20, .35, 1],
    ] as const) {
      const art = WORLD_STRUCTURE_ART[key]!, logical = worldSurfaceAtlases.find((image) => worldAssetSource(image) === worldAssetSource(art.filepath))!;
      const { data, info } = await sharp(worldArtFile(logical.replace(/\.webp$/, ".material.png"))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const x = art.frame.x + Math.floor(art.frame.width * u), y = art.frame.y + Math.floor(art.frame.height * v);
      expect(data[(y * info.width + x) * 4]! % 4, `${key} at ${u},${v}`).toBe(surface);
    }
  });

  it("places each service entrance on an opaque stair or foundation contact", async () => {
    for (const [key, art] of Object.entries(WORLD_STRUCTURE_ART)) {
      const image = worldSurfaceAtlases.find((image) => worldAssetSource(image) === worldAssetSource(art.filepath))!;
      const { data, info } = await sharp(worldArtFile(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const x = art.frame.x + art.stair.x, y = art.frame.y + art.stair.y;
      expect(data[(y * info.width + x) * 4 + 3], key).toBe(255);
    }
  });

  it("bounds shipped surface metadata and compiled mesh storage for low-memory devices", async () => {
    for (const [image, definitions] of Object.entries(catalogue)) {
      const dimensions = await sharp(worldArtFile(image)).metadata();
      // Settlement variants load independently; bound a complete shared kit rather than the installed catalogue.
      const metadataBytes = readFileSync(worldArtFile(image.replace(/\.webp$/, ".surfaces.json"))).byteLength;
      expect(metadataBytes * 4 + dimensions.width! * dimensions.height! * 8, image).toBeLessThanOrEqual(16 * 1024 * 1024);
      let count = 0;
      const source = material(dimensions.width!, dimensions.height!);
      source.surfaceFrames = definitions;
      try {
        for (const definition of definitions)
          count += worldMaterialFrame(source, new Rectangle(...definition.frame)).vertices.length / 6;
      } finally { source.texture.destroy(true); }
      expect(count, image).toBeLessThanOrEqual(125_000);
    }
  });

  it("matches runtime padded structure, scenery, ground-detail and wall frame rectangles", () => {
    for (const asset of [...WOODLAND_DECORATIONS, ...BIOME_DECORATIONS, ...GROUND_DETAIL_ART, ...DECORATION_ASSETS])
      if (asset.filepath.startsWith("/world-art/") && asset.frame) expectFrame(asset.filepath, asset.frame);
    for (const biome of ["ground", "snow", "dessert"] as const) {
      for (const asset of DECORATION_ASSETS) {
        const resolved = resolveWorldDecoration(asset, biome);
        if (resolved.filepath.startsWith("/world-art/") && resolved.frame) expectFrame(resolved.filepath, resolved.frame);
      }
    }
    for (const art of Object.values(WORLD_STRUCTURE_ART)) expectFrame(art.filepath, art.frame);
    const kit = STONE_VILLAGE_WALL_KIT;
    for (const spec of [...Object.values(kit.panels), ...Object.values(kit.gates), kit.pier, kit.tower])
      if (spec.frame) expectFrame(spec.url, spec.frame);
  });

  it("covers the standalone submerged shelf", async () => {
    const image = "/world-art/submerged-rock-shelf.webp";
    const dimensions = await sharp(worldArtFile(image)).metadata();
    expectFrame(image, { x: 0, y: 0, width: dimensions.width!, height: dimensions.height! });
  });

  it.each(Object.entries(catalogue).flatMap(([image, frames]) => frames.map((definition, index) => [image, index, definition] as const)))("keeps opaque volumes within %s frame %i and behind its visible surface", async (image, index, definition) => {
    const label = `${image} frame ${index}`;
    const { data, info } = await sharp(worldArtFile(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const numerical = await sharp(worldArtFile(image.replace(/\.webp$/, ".material.png"))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([numerical.info.width, numerical.info.height]).toEqual([info.width, info.height]);
    const source = material(info.width, info.height);
    source.surfaceFrames = catalogue[image];
    const rect = new Rectangle(...definition.frame);
    const covered = (x: number, y: number) => x + 0.5 >= rect.x && x + 0.5 < rect.x + rect.width && y + 0.5 >= rect.y && y + 0.5 < rect.y + rect.height && x >= 0 && x < info.width && y >= 0 && y < info.height && data[(y * info.width + x) * 4 + 3]! >= 128;
    const withinSilhouette = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (covered(x + dx, y + dy)) return true;
      return false;
    };
    try {
      const frame = worldMaterialFrame(source, rect);
      if (definition.thinBacking) {
        source.pixels.set(numerical.data);
        for (let i = 3; i < source.pixels.length; i += 4) source.pixels[i] = data[i]!;
        expectClosedFoliageCoverage(source, rect, frame);
      }
      const ghosts = new Set<string>();
      const protrusions = new Map<string, { opaque: number; visible: number }>();
      const received = new Uint8Array(info.width * info.height);
      const heightTolerance = rect.height / 255 + 0.1;
      let triangles = 0;
      for (let i = 0; i < frame.indices.length; i += 3) {
        const indices = Array.from(frame.indices.slice(i, i + 3));
        const isOpaque = indices.every((index) => frame.vertices[index * 6 + 5] === 0);
        if (isOpaque) triangles++;
        const positions = indices.map((index) => ({ x: rect.x + frame.vertices[index * 6]! * rect.width, y: rect.y + frame.vertices[index * 6 + 1]! * rect.height, height: frame.vertices[index * 6 + 2]! * rect.height }));
        const polygon = new Polygon(positions.flatMap(({ x, y }) => [x, y]));
        const minX = Math.floor(Math.min(...positions.map(({ x }) => x))), maxX = Math.ceil(Math.max(...positions.map(({ x }) => x)));
        const minY = Math.floor(Math.min(...positions.map(({ y }) => y))), maxY = Math.ceil(Math.max(...positions.map(({ y }) => y)));
        const [a, b, c] = positions as [typeof positions[number], typeof positions[number], typeof positions[number]];
        const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
          if (!polygon.contains(x + 0.5, y + 0.5)) continue;
          if (!isOpaque) {
            if (covered(x, y)) received[y * info.width + x] = 1;
            continue;
          }
          const key = `${x - rect.x},${y - rect.y}`;
          if (!withinSilhouette(x, y)) ghosts.add(key);
          if (!covered(x, y) || Math.abs(denominator) < 1e-12) continue;
          const wa = ((b.y - c.y) * (x + 0.5 - c.x) + (c.x - b.x) * (y + 0.5 - c.y)) / denominator;
          const wb = ((c.y - a.y) * (x + 0.5 - c.x) + (a.x - c.x) * (y + 0.5 - c.y)) / denominator;
          // At the same camera UV, a larger source height lies in front of the visible surface.
          const opaque = wa * a.height + wb * b.height + (1 - wa - wb) * c.height;
          const visible = numerical.data[(y * info.width + x) * 4 + 2]! / 255 * rect.height;
          if (opaque > visible + heightTolerance && opaque > (protrusions.get(key)?.opaque ?? -Infinity))
            protrusions.set(key, { opaque, visible });
        }
      }
      expect(triangles === 0, label).toBe(definition.volumes.length === 0);
      let missing = 0, raisedGround = 0;
      for (let y = Math.floor(rect.y); y < rect.y + rect.height; y++)
        for (let x = Math.floor(rect.x); x < rect.x + rect.width; x++) {
          if (!covered(x, y)) continue;
          const offset = (y * info.width + x) * 4;
          if (!received[y * info.width + x]) missing++;
          if ((numerical.data[offset]! & 3) === 0 && numerical.data[offset + 2] !== 0) raisedGround++;
        }
      expect(missing, `${label}: visible albedo texels without a material surface`).toBe(0);
      expect(raisedGround, `${label}: raised material pixels must use a solid, canopy or roof class`).toBe(0);
      expect(ghosts.size, `${label}: opaque volume projection outside one-pixel albedo dilation; ${ghosts.size} texels; examples ${Array.from(ghosts).slice(0, 6).join("; ")}`).toBe(0);
      const examples = [...protrusions.entries()].slice(0, 6).map(([key, { opaque, visible }]) => `${key}: ${opaque.toFixed(3)} > ${visible.toFixed(3)}`);
      const maxExcess = [...protrusions.values()].reduce((maximum, { opaque, visible }) => Math.max(maximum, opaque - visible), 0);
      expect(protrusions.size, `${label}: opaque volumes protrude through visible PNG height at ${protrusions.size} texels; max excess ${maxExcess.toFixed(3)} source pixels; tolerance ${heightTolerance.toFixed(3)}; examples ${examples.join("; ")}`).toBe(0);
    } finally {
      source.texture.destroy(true);
    }
  });

  it("builds every authored frame without sampled grids, invalid indices or WebGL1 overflow", async () => {
    for (const [image, definitions] of Object.entries(catalogue)) {
      const dimensions = await sharp(worldArtFile(image)).metadata();
      const source = material(dimensions.width!, dimensions.height!);
      source.surfaceFrames = definitions;
      try {
        for (const definition of definitions) {
          for (const surface of [...definition.surfaces, ...definition.volumes]) {
            expect(surface.indices.length % 3, image).toBe(0);
            expect(surface.indices.every((index) => Number.isInteger(index) && index >= 0 && index < surface.vertices.length), image).toBe(true);
          }
          for (const volume of definition.volumes) {
            expect(volume.vertices.every(([, , lower, upper]) => lower >= 0 && upper >= lower && upper <= definition.frame[3] + 1e-6), image).toBe(true);
            const edges = new Map<string, number>();
            for (let i = 0; i < volume.indices.length; i += 3) {
              const triangle = Array.from(volume.indices.slice(i, i + 3));
              const [a, b, c] = triangle.map((index) => volume.vertices[index]!);
              const area = (b![0] - a![0]) * (c![1] + c![3] - a![1] - a![3]) - (b![1] + b![3] - a![1] - a![3]) * (c![0] - a![0]);
              if (definition.thinBacking) {
                const points = [a, b, c].map((point) => [Math.fround(point![0] / definition.frame[2]), -2 * (Math.fround(point![1] / definition.frame[3]) + Math.fround(point![3] / definition.frame[3]))]);
                const [u, v, w] = points as [number[], number[], number[]];
                expect(Math.abs((v[0]! - u[0]!) * (w[1]! - u[1]!) - (w[0]! - u[0]!) * (v[1]! - u[1]!)), image).toBeGreaterThan(1e-14);
              } else expect(Math.abs(area), image).toBeGreaterThan(1e-9);
              for (let j = 0; j < 3; j++) {
                const first = triangle[j]!, second = triangle[(j + 1) % 3]!;
                const key = `${Math.min(first, second)}:${Math.max(first, second)}`;
                edges.set(key, (edges.get(key) ?? 0) + 1);
              }
            }
            expect([...edges.values()].every((count) => count <= 2), image).toBe(true);
          }
          const frame = worldMaterialFrame(source, new Rectangle(...definition.frame));
          const count = frame.vertices.length / 6;
          const surfaceCount = definition.surfaces.reduce((sum, surface) => sum + surface.vertices.length, 0);
          expect(count, image).toBeGreaterThanOrEqual(surfaceCount + definition.volumes.reduce((sum, volume) => sum + volume.vertices.length, 0));
          expect(count, image).toBeLessThanOrEqual(surfaceCount + definition.volumes.reduce((sum, volume) => sum + volume.vertices.length * 2, 0));
          expect(count, image).toBeLessThanOrEqual(65535);
          expect(frame.points.length, image).toBe(0);
          expect(frame.volumes?.length, image).toBe(definition.volumes.length);
          expect(Array.from(frame.vertices).every(Number.isFinite), image).toBe(true);
          expect(Array.from(frame.indices).every((index) => index < count), image).toBe(true);
          expect(frame.vertices.every((value, index) => index % 6 !== 2 || (value >= -1e-6 && value <= 1 + 1e-6)), image).toBe(true);
        }
      } finally {
        source.texture.destroy(true);
      }
    }
  });
});

describe("published world artwork", () => {
  it("pins immutable UploadThing sources without shipping a public world-art directory", () => {
    expect(existsSync(new URL("../../../public/world-art", import.meta.url))).toBe(false);
    for (const source of Object.values(WORLD_ASSET_SOURCES)) {
      for (const field of ["image", "material", "surfaces"] as const) {
        expect(new URL(source[field]).origin).toBe(new URL(UPLOADTHING_HOST).origin);
        expect(new URL(source[field]).search).toBe("");
        expect(source.sha256[field]).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(source.material).not.toBe(source.image);
      expect(worldAssetSource(source.image)).toBe(source);
      for (const [x, y, width, height] of source.frames) {
        expect(x!).toBeGreaterThanOrEqual(0); expect(y!).toBeGreaterThanOrEqual(0);
        expect(x! + width!).toBeLessThanOrEqual(source.width);
        expect(y! + height!).toBeLessThanOrEqual(source.height);
      }
    }
  });
});

describe("world normal encoding", () => {
  it.each([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const)("round trips world direction %s, %s, %s", (x, y, z) => {
    const decoded = decodeNormal(encodeWorldNormal(x, y, z));
    expect(decoded[0]).toBeCloseTo(x);
    expect(decoded[1]).toBeCloseTo(y);
    expect(decoded[2]).toBeCloseTo(z);
  });
});
