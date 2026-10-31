import { describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { Assets, BufferImageSource, Container, type Geometry, Rectangle, Shader, Sprite, Texture } from "pixi.js";
import sharp from "sharp";
import { WORLD_CYCLE_SECONDS, WORLD_CYCLE_TRANSITION_SECONDS, WORLD_DAY_SECONDS } from "@/drizzle/constants";
import type { GameRenderer } from "@/libs/rendering/runtime";
import * as sceneAssets from "@/libs/rendering/assets";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import * as maskedTextures from "@/libs/rendering/maskedTextures";
import * as worldMaterials from "@/libs/rendering/worldMaterials";
import * as worldFields from "@/libs/rendering/worldOcclusion";
import { sectorSpriteDescriptions } from "@/libs/rendering/sectorSprites";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import type { HexTerrainData } from "@/libs/rendering/terrainData";
import { createWorldShadows, worldSunlight } from "@/libs/rendering/worldShadows";
import { ensureDom } from "../../setup/dom.mjs";
import { worldArtDirectory, worldArtFile } from "../../setup/worldArt";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";

ensureDom();
const viewport = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const fixture = () => {
  const cleanups: (() => void)[] = [];
  const world = new Container(), parent = new Container();
  const render = vi.fn();
  const canvas = document.createElement("canvas");
  const game = { canvas, signal: new AbortController().signal, own: (cleanup: () => void) => cleanups.push(cleanup), renderer: { width: 800, height: 600, render } } as unknown as GameRenderer;
  const shadows = createWorldShadows(game, world);
  world.addChild(shadows.container, parent);
  const terrain = {
    batches: [{ positions: new Float32Array([0, 0, 10, 0, 0, 10]), tiles: [{ key: "0,0", start: 0, count: 3 }] }],
    faceOffsets: new Map([["0,0", -4]]),
  } as unknown as HexTerrainData;
  return { world, parent, shadows, terrain, render, game,
    restore: () => canvas.dispatchEvent(new window.Event("webglcontextrestored")),
    dispose: () => { for (const cleanup of cleanups) cleanup(); if (!world.destroyed) world.destroy({ children: true }); },
  };
};
const materialSourceFixture = (failedImage?: string) => {
  const pixels = new Uint8Array([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]);
  const texture = new Texture({ source: new BufferImageSource({ resource: pixels, width: 2, height: 2, format: "rgba8unorm" }) });
  const load = vi.spyOn(Assets, "load").mockImplementation(async (asset) => {
    const src = typeof asset === "string" ? asset : !Array.isArray(asset) ? asset?.src : "";
    if (failedImage && String(src).startsWith(failedImage)) throw new Error("Missing movement sheet");
    return texture;
  });
  const canvasContext = {
    drawImage() {},
    getImageData: () => ({ data: pixels }),
  } as unknown as CanvasRenderingContext2D;
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((kind: string) => kind === "2d" ? canvasContext : null) as HTMLCanvasElement["getContext"],
  );
  return { texture, dispose: () => { context.mockRestore(); load.mockRestore(); texture.destroy(true); } };
};

describe("world sunlight", () => {
  it("travels from east through south to west with normalized elevated directions", () => {
    const morning = worldSunlight(new Date(WORLD_DAY_SECONDS * 0.25 * 1000));
    const noon = worldSunlight(new Date(WORLD_DAY_SECONDS * 0.5 * 1000));
    const evening = worldSunlight(new Date(WORLD_DAY_SECONDS * 0.75 * 1000));
    expect(morning.x).toBeGreaterThan(0);
    expect(evening.x).toBeLessThan(0);
    expect(noon.x).toBeCloseTo(0);
    expect(morning.x).toBeCloseTo(-evening.x);
    expect(noon.z).toBeGreaterThan(morning.z);
    for (const light of [morning, noon, evening]) {
      expect(light.y).toBeLessThan(0);
      expect(light.z).toBeGreaterThan(0);
      expect(Math.hypot(light.x, light.y, light.z)).toBeCloseTo(1);
      expect(light.day).toBe(1);
    }
  });
  it("changes azimuth and elevation gradually throughout the full day", () => {
    const samples = Array.from({ length: 129 }, (_, index) =>
      worldSunlight(new Date(WORLD_DAY_SECONDS * 1000 * index / 128)));
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1]!, current = samples[index]!;
      expect(current.x).toBeLessThan(previous.x);
      expect(Math.hypot(current.x - previous.x, current.y - previous.y, current.z - previous.z)).toBeLessThan(0.04);
      if (index <= 64) expect(current.z).toBeGreaterThan(previous.z);
      else expect(current.z).toBeLessThan(previous.z);
    }
  });
  it("fades direct sunlight at sunset and restores it during the existing dawn transition", () => {
    const sunset = worldSunlight(new Date((WORLD_DAY_SECONDS - WORLD_CYCLE_TRANSITION_SECONDS / 2) * 1000));
    const night = worldSunlight(new Date((WORLD_DAY_SECONDS + 10) * 1000));
    const dawn = worldSunlight(new Date((WORLD_CYCLE_SECONDS - WORLD_CYCLE_TRANSITION_SECONDS / 2) * 1000));
    expect(sunset.day).toBeCloseTo(0.5);
    expect(sunset.x).toBeLessThan(0);
    expect(night.day).toBe(0);
    expect(dawn.day).toBeCloseTo(0.5);
    expect(dawn.x).toBeGreaterThan(0);
    expect(worldSunlight(new Date((WORLD_DAY_SECONDS - 0.01) * 1000)).day).toBeLessThan(0.001);
  });
  it("repeats with the world cycle and freezes noon when the cycle is disabled", () => {
    const first = worldSunlight(new Date(WORLD_DAY_SECONDS * 0.3 * 1000));
    const repeated = worldSunlight(new Date((WORLD_CYCLE_SECONDS * 4 + WORLD_DAY_SECONDS * 0.3) * 1000));
    expect(repeated).toEqual(first);
    expect(worldSunlight(null)).toEqual(worldSunlight());
    expect(worldSunlight()).toEqual(worldSunlight(new Date(WORLD_DAY_SECONDS * 0.5 * 1000)));
  });
});

describe("physical world lighting", () => {
  it("maps generated fallback receiver height to its cropped atlas frame", async () => {
    const shaders = vi.spyOn(Shader, "from");
    const f = fixture(), source = materialSourceFixture();
    const view = new Texture({ source: source.texture.source, frame: new Rectangle(0, 1, 1, 1) });
    try {
      const sprite = new Sprite(view);
      sprite.scale.set(-20, -40);
      sprite.position.set(40, 40);
      f.parent.addChild(sprite);
      const registration = f.shadows.register(sprite, {
        id: "fallback-crop", kind: "character", image: "fallback-crop-receiver.png",
        size: 40, x: 40, y: 40, groundY: 0, shadowCaster: "character",
      });
      await registration.ready;
      f.shadows.update(worldSunlight(), viewport);
      const mesh = f.render.mock.calls[1]?.[0]?.container.children[0];
      const geometry = mesh.geometry as Geometry;
      const attribute = geometry.getAttribute("aData");
      expect(attribute.format).toBe("float32x4");
      expect(attribute.stride).toBe(76);
      expect(attribute.offset).toBe(16);
      const data = geometry.getBuffer("aData").data as Float32Array;
      for (let i = 0; i < data.length; i += 19)
        expect(Array.from(data.slice(i + 4, i + 8))).toEqual([40, 0, 0.5, 0.5]);
      const fragment = shaders.mock.calls.map(([options]) => options.gl?.fragment ?? "")
        .find((fragment) => fragment.includes("uniform sampler2D uMaterial0;"))!;
      expect(fragment).toMatch(/^precision highp float;\s*precision highp sampler2D;/);
      expect(fragment.indexOf("precision highp sampler2D;")).toBeLessThan(fragment.indexOf("uniform sampler2D"));
      registration();
    } finally { f.dispose(); view.destroy(false); source.dispose(); shaders.mockRestore(); }
  });

  it("binds exact retained prism tables with matching decoding uniforms and releases every source", async () => {
    const buildFrame = worldMaterials.worldMaterialFrame;
    const frameSpy = vi.spyOn(worldMaterials, "worldMaterialFrame").mockImplementation((material, rect) => ({
      ...buildFrame(material, rect),
      points: new Float32Array(0),
      volumes: [{ vertices: new Float32Array([0, 0, 0, 0.5, 1, 0, 0, 0.5, 0, 0.25, 0, 0.5]), indices: new Uint16Array([0, 1, 2]) }],
    }));
    const f = fixture(), source = materialSourceFixture();
    try {
      const sprite = new Sprite(source.texture);
      sprite.scale.set(20, -20); sprite.position.set(40, 40); f.parent.addChild(sprite);
      const registration = f.shadows.register(sprite, { id: "exact-tables", kind: "character", image: "exact-prism-bindings.png",
        size: 20, x: 40, y: 40, groundY: 40, shadowCaster: "character" });
      await registration.ready; f.shadows.update(worldSunlight(), viewport);
      const pointMesh = f.render.mock.calls.at(-1)?.[0]?.container.children[0];
      const resources = pointMesh.shader.resources;
      const keys = ["uStaticField", "uStaticReferences", "uStaticPrisms", "uDynamicField", "uDynamicReferences", "uDynamicPrisms"];
      const sources = keys.map((key) => resources[key] as BufferImageSource);
      expect(sources.every((source) => source instanceof BufferImageSource)).toBe(true);
      expect(Array.from(resources.lights.uniforms.uDynamicTables)).toEqual([
        resources.uDynamicReferences.pixelWidth, resources.uDynamicReferences.pixelHeight,
        resources.uDynamicPrisms.pixelWidth, resources.uDynamicPrisms.pixelHeight,
      ]);
      expect(Array.from(resources.lights.uniforms.uFieldHeights).slice(0, 3)).toEqual([512, 64, 0]);
      expect(resources.lights.uniforms.uFieldHeights[3]).toBeLessThan(0.01);
      expect((resources.uDynamicPrisms.resource as Uint8Array).some((value) => value !== 0)).toBe(true);
      f.shadows.update(worldSunlight(), viewport);
      expect(keys.map((key) => resources[key])).toEqual(sources);
      registration(); f.dispose(); expect(sources.every((source) => source.destroyed)).toBe(true);
    } finally { f.dispose(); frameSpy.mockRestore(); source.dispose(); }
  });

  it.each([64, 192])("preserves packed %ipx LPC layer geometry and shares one moving foot light across the outfit", async (logicalSize) => {
    const createField = worldFields.createWorldOcclusion;
    let occluders: readonly worldFields.Occluder[] = [];
    const fieldSpy = vi.spyOn(worldFields, "createWorldOcclusion").mockImplementation((options) => {
      const field = createField(options), update = field.update;
      field.update = (records, bounds, heightRange) => {
        if (!options?.incremental) occluders = records;
        update(records, bounds, heightRange);
      };
      return field;
    });
    const f = fixture(), source = materialSourceFixture();
    const root = new Container();
    root.position.set(40, 70); root.scale.set(64, -64); f.parent.addChild(root);
    const views = [logicalSize / 2 + 26, logicalSize / 2 - 12].map((y) => new Texture({ source: source.texture.source,
      frame: new Rectangle(0, 0, 2, 2), orig: new Rectangle(0, 0, logicalSize, logicalSize), trim: new Rectangle(logicalSize / 2 - 8, y, 2, 2) }));
    const children = views.map((texture) => { const child = new Sprite(texture); child.anchor.set(0.5); child.scale.set(1 / 64); root.addChild(child); return child; });
    const leases = children.map((child, index) => f.shadows.register(child, {
      id: `lpc-layer-${index}`, kind: "avatar", image: `native-lpc-layer-${index}.png`,
      x: 40, y: 70, groundY: 42, size: 64, shadowCaster: "character",
    }, [], root));
    try {
      await Promise.all(leases.map((lease) => lease.ready));
      f.shadows.update(worldSunlight(), viewport);
      const points = () => f.render.mock.calls.at(-1)![0]!.container.children[0].geometry.getBuffer("aPosition").data as Float32Array;
      expect(points()).toHaveLength(6 * 10);
      expect(Array.from(points()).filter((_, index) => index % 10 === 9)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(Array.from(points().slice(2, 5))).toEqual([40, 84, 66]);
      expect(occluders).toHaveLength(2);
      for (const occluder of occluders) expect(occluder).toMatchObject({ footX: 40, footY: 84, width: 64, height: logicalSize });
      const receiver = f.render.mock.calls.find(([call]) => call.container.children[0]?.geometry?.attributes?.aData)![0].container.children[0];
      const data = receiver.geometry.getBuffer("aPosition").data as Float32Array;
      const stride = receiver.geometry.attributes.aPosition.stride / 4;
      const first = children[0]!.toGlobal({ x: 24 - 32, y: 58 - 32 });
      expect(data[0]).toBeCloseTo(first.x); expect(data[1]).toBeCloseTo(first.y);
      // The head layer's receiver remains elevated, even though its packed texture is only two pixels high.
      expect(data[6 * stride + 1]).toBeCloseTo(children[1]!.toGlobal({ x: 24 - 32, y: 20 - 32 }).y);
      root.x += 3;
      f.shadows.update(worldSunlight(), viewport);
      expect(Array.from(points().slice(2, 5))).toEqual([43, 84, 66]);
      expect(receiver.geometry.getBuffer("aPosition").data[0]).toBeCloseTo(first.x + 3);
      children[0]!.visible = false;
      f.shadows.update(worldSunlight(), viewport);
      expect(points()).toHaveLength(6 * 10);
      expect(Array.from(points()).filter((_, index) => index % 10 === 9)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(Array.from(points().slice(2, 5))).toEqual([43, 84, 66]);
    } finally { for (const lease of leases) lease(); f.dispose(); for (const view of views) view.destroy(false); source.dispose(); fieldSpy.mockRestore(); }
  });

  it("keeps lamp-post pools compact while buildings extend at night and character lights stay over the feet", async () => {
    const buildFrame = worldMaterials.worldMaterialFrame;
    const frameSpy = vi.spyOn(worldMaterials, "worldMaterialFrame").mockImplementation((material, rect) => ({
      ...buildFrame(material, rect), emitters: [{ x: 0.5, y: 0.5, height: 0.5 }],
    }));
    const f = fixture(), source = materialSourceFixture();
    const registrations: (() => void)[] = [];
    try {
      for (const shadowCaster of ["building", "column", "character"] as const) {
        const kind = shadowCaster === "character" ? "character" : "structure";
        const sprite = new Sprite(source.texture);
        sprite.scale.set(shadowCaster === "column" ? 10 : 20, -20); sprite.position.set(40, 40); f.parent.addChild(sprite);
        const registration = f.shadows.register(sprite, { id: `fixture-${shadowCaster}`, kind,
          image: `fixture-reach-${shadowCaster}.png`, size: 40, x: 40, y: 40, groundY: 40,
          shadowCaster });
        registrations.push(registration);
        await registration.ready;
      }
      const day = worldSunlight(), night = worldSunlight(new Date((WORLD_DAY_SECONDS + 10) * 1000));
      const lightData = () => f.render.mock.calls.at(-1)?.[0]?.container.children[0].geometry.getBuffer("aPosition").data as Float32Array;
      f.shadows.update(day, viewport);
      const daytime = lightData().slice();
      expect(daytime).toHaveLength(3 * 6 * 10);
      const character = daytime.slice(2 * 6 * 10);
      expect(Array.from(character.slice(2, 5))).toEqual([60, 0, 42]);
      f.shadows.update(night, viewport);
      const nighttime = lightData();
      expect(nighttime).toHaveLength(3 * 6 * 10);
      const groundReach = (data: Float32Array) => Math.sqrt(data[5]! ** 2 - data[4]! ** 2);
      expect(groundReach(daytime)).toBeCloseTo(64, 4);
      expect(groundReach(nighttime)).toBeCloseTo(96, 4);
      expect(groundReach(nighttime)).toBeCloseTo(groundReach(daytime) * 1.5, 4);
      expect(groundReach(daytime.slice(6 * 10))).toBeCloseTo(14, 4);
      expect(groundReach(nighttime.slice(6 * 10))).toBeCloseTo(21, 4);
      expect(groundReach(nighttime.slice(2 * 6 * 10))).toBeLessThan(40);
      const footLight = nighttime.slice(2 * 6 * 10);
      // The overhead light must illuminate the ground after its height-dependent falloff.
      const floorFalloff = 1 - footLight[4]! / footLight[5]!;
      expect(footLight[6]! * floorFalloff ** 2).toBeGreaterThan(0.15);
      expect(footLight[4]).toBeGreaterThan(40);
      for (let vertex = 0; vertex < 6; vertex++) {
        expect(nighttime[vertex * 10 + 9]).toBe(1);
        expect(nighttime[6 * 10 + vertex * 10 + 9]).toBe(1);
        expect(footLight[vertex * 10 + 9]).toBe(0);
      }
      f.shadows.update(day, viewport);
      expect(lightData()).toEqual(daytime);
    } finally {
      for (const registration of registrations) registration();
      f.dispose(); source.dispose(); frameSpy.mockRestore();
    }
  });

  it.each([false, true])("shares foliage wind across receivers and shadow passes without uploading retained geometry (casts: %s)", async (castsShadow) => {
    const f = fixture(), source = materialSourceFixture();
    try {
      const art = await createWorldSprites(f.game, [{
        id: "wind-receiver", kind: "decoration", image: `wind-receiver-${castsShadow}.png`, size: 40,
        x: 40, y: 40, groundY: 0, anchorY: 1, wind: 0, shadowCaster: castsShadow ? "canopy" : undefined,
      }], f.shadows);
      f.parent.addChild(art.container);
      const still = { large: new Float32Array(4), small: new Float32Array(4), key: "still" };
      art.animate({ now: 0, delta: 0, reducedMotion: false }, 1, null, still);
      f.shadows.update(worldSunlight(), viewport, still);
      const layer = f.render.mock.calls[1]![0]!.container;
      const mesh = layer.children[0], buffer = mesh.geometry.getBuffer("aPosition");
      const upload = vi.spyOn(buffer, "update");
      const pointMesh = f.render.mock.calls.at(-1)![0]!.container.children[0];
      const pointUpload = vi.spyOn(pointMesh.geometry.getBuffer("aPosition"), "update");
      const tables = [pointMesh.shader.resources.uStaticField, pointMesh.shader.resources.uStaticReferences, pointMesh.shader.resources.uStaticPrisms];
      const tableUploads = tables.map((source) => vi.spyOn(source, "update"));
      const count = f.render.mock.calls.length;
      const gust = { ...still, large: new Float32Array([2, 0, 0, 0]), key: "gust" };
      art.animate({ now: 0, delta: 0, reducedMotion: false }, 1, null, gust);
      f.shadows.update(worldSunlight(), viewport, gust);
      expect(buffer).toBe(mesh.geometry.getBuffer("aPosition"));
      expect(upload).not.toHaveBeenCalled();
      expect(pointUpload).not.toHaveBeenCalled();
      expect(tableUploads.every((spy) => spy.mock.calls.length === 0)).toBe(true);
      expect(Array.from(mesh.shader.resources.wind.uniforms.uWind)).toEqual([2, 0, 0, 0]);
      expect(Array.from(pointMesh.shader.resources.wind.uniforms.uWind)).toEqual([2, 0, 0, 0]);
      const draws = f.render.mock.calls.slice(count).map(([draw]) => draw.container);
      expect(draws).toContain(layer);
      expect(draws).toContain(pointMesh.parent);
      const sun = draws.find((container) => container.children[0]?.shader?.resources.object?.uniforms.uObjectY);
      if (castsShadow) expect(Array.from(sun!.children[0].shader.resources.wind.uniforms.uWind)).toEqual([2, 0, 0, 0]);
      else expect(sun).toBeUndefined();
      const after = f.render.mock.calls.length;
      f.shadows.update(worldSunlight(), viewport, gust);
      expect(f.render.mock.calls.length).toBe(after);
      art.dispose();
    } finally { f.dispose(); source.dispose(); }
  });

  it("keeps receiver sampling at screen density and transforms a sheared wall's normal", async () => {
    const f = fixture(), source = materialSourceFixture();
    try {
      f.world.scale.set(2, -2);
      f.world.y = 400;
      const sprite = new Sprite(source.texture);
      sprite.scale.set(20, -40);
      sprite.skew.y = Math.atan(0.5);
      sprite.anchor.set(0.5);
      sprite.position.set(40, 40);
      f.parent.addChild(sprite);
      const registration = f.shadows.register(sprite, {
        id: "sheared-wall", kind: "village_wall_panel", image: "normal-wall-shear.png",
        size: 80, x: 40, y: 40, groundY: 40, shadowCaster: "wall",
      });
      await registration.ready;
      f.shadows.update(worldSunlight(), viewport);
      const target = f.render.mock.calls[0]?.[0]?.target;
      expect([target.width, target.height]).toEqual([800, 600]);
      const receiverLayer = f.render.mock.calls[1]?.[0]?.container;
      const mesh = receiverLayer.children[0];
      const data = mesh.geometry.getBuffer("aNormalY").data as Float32Array;
      // Under sy=.5Y+Z, a front normal (0,-1,0) becomes (1,-1,0) before normalization.
      expect(Array.from(data.slice(11, 14))).toEqual([expect.closeTo(-1), expect.closeTo(1), expect.closeTo(0)]);
      expect(mesh.geometry.getAttribute("aNormalY").stride).toBe(76);
      registration();
    } finally { f.dispose(); source.dispose(); }
  });

  it.each([-1, 1])("shares local volume data and its full source transform through a mirrored x scale of %s", async (direction) => {
    const buildFrame = worldMaterials.worldMaterialFrame;
    const frameSpy = vi.spyOn(worldMaterials, "worldMaterialFrame").mockImplementation((material, rect) => ({
      ...buildFrame(material, rect),
      points: new Float32Array(0),
      volumes: [{
        vertices: new Float32Array([0, 0, 0.25, 0.5, 0.5, 0, 0.25, 0.5, 0, 0.25, 0.25, 0.5]),
        indices: new Uint16Array([0, 1, 2]),
      }],
    }));
    const createField = worldFields.createWorldOcclusion;
    const requests: { records: readonly worldFields.Occluder[]; heightRange: number | undefined }[] = [];
    const fieldSpy = vi.spyOn(worldFields, "createWorldOcclusion").mockImplementation((options) => {
      const field = createField(options), update = field.update;
      field.update = (records, bounds, heightRange) => {
        requests.push({ records, heightRange });
        update(records, bounds, heightRange);
      };
      return field;
    });
    const f = fixture(), source = materialSourceFixture();
    try {
      f.parent.position.set(-128, -128);
      const sprite = new Sprite(source.texture);
      sprite.scale.set(20 * direction, -40);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(20, 30);
      f.parent.addChild(sprite);
      const registration = f.shadows.register(sprite, {
        id: "authored-volume", kind: "structure", image: "authored-volume-manager.png",
        size: 80, x: 20, y: 30, groundY: 30, shadowCaster: "building",
      });
      await registration.ready;
      f.shadows.update(worldSunlight(), { minX: -256, maxX: 0, minY: -256, maxY: 0 });
      const request = requests.find(({ records }) => records.length > 0);
      expect(request?.heightRange).toBe(128);
      const occluder = request?.records[0];
      expect(occluder?.points).toHaveLength(0);
      expect(Array.from(occluder?.volumes?.[0]?.vertices ?? [])).toEqual([
        0, 0, 0.25, 0.5,
        0.5, 0, 0.25, 0.5,
        0, 0.25, 0.25, 0.5,
      ]);
      expect(Array.from(occluder?.transform ?? [])).toEqual([
        40 * direction, expect.closeTo(0), expect.closeTo(0), -80, -108 - 20 * direction, -18,
      ]);
      registration();
    } finally {
      f.dispose(); source.dispose(); fieldSpy.mockRestore(); frameSpy.mockRestore();
    }
  });

  it("keeps receivers, casters and the character light aligned through fractional movement and retains a still pose", async () => {
    const buildFrame = worldMaterials.worldMaterialFrame;
    const shared = [{ vertices: new Float32Array([0, 0, 0, 0.5, 1, 0, 0, 0.5, 0, 1, 0, 0.5]), indices: new Uint16Array([0, 1, 2]) }];
    let frame: ReturnType<typeof buildFrame> | undefined;
    const frameSpy = vi.spyOn(worldMaterials, "worldMaterialFrame").mockImplementation((material, rect) =>
      frame ??= { ...buildFrame(material, rect), points: new Float32Array(), volumes: shared });
    const createField = worldFields.createWorldOcclusion;
    const requests: worldFields.Occluder[][] = [];
    const fieldSpy = vi.spyOn(worldFields, "createWorldOcclusion").mockImplementation((options) => {
      const field = createField(options), update = field.update;
      field.update = (records, bounds, range) => {
        if (records.length) requests.push([...records]);
        update(records, bounds, range);
      };
      return field;
    });
    const f = fixture(), source = materialSourceFixture();
    try {
      const sprite = new Sprite(source.texture);
      sprite.scale.set(20, -20); sprite.position.set(40.126, 40); f.parent.addChild(sprite);
      f.world.scale.set(4.21875, -4.21875); f.world.y = 600;
      const registration = f.shadows.register(sprite, { id: "fractional-motion", kind: "character",
        image: "fractional-caster-motion.png", size: 40, x: 40, y: 40, groundY: 40, shadowCaster: "character" });
      await registration.ready;
      f.shadows.update(worldSunlight(), viewport);
      const meshes = f.render.mock.calls.flatMap(([call]) => call.container.children);
      const sun = meshes.find((mesh) => mesh.shader?.resources?.object?.uniforms?.uObject);
      const receiver = meshes.find((mesh) => mesh.geometry?.attributes?.aData);
      const point = meshes.find((mesh) => mesh.geometry?.attributes?.aLight);
      let previous = requests.at(-1)?.[0];
      for (const x of [40.374, 40.376]) {
        sprite.x = x;
        f.shadows.update(worldSunlight(), viewport);
        const current = requests.at(-1)?.[0];
        const expected = Math.fround(x);
        expect(current).not.toBe(previous);
        expect(current?.transform?.[4]).toBe(expected);
        expect(sun.shader.resources.object.uniforms.uObject[2]).toBe(expected);
        expect(receiver.geometry.getBuffer("aPosition").data[0]).toBe(expected);
        expect(Array.from(point.geometry.getBuffer("aPosition").data.slice(2, 5))).toEqual([Math.fround(x + 20), 0, 42]);
        const draws = f.render.mock.calls.length;
        f.shadows.update(worldSunlight(), viewport);
        expect(f.render).toHaveBeenCalledTimes(draws);
        expect(requests.at(-1)?.[0]).toBe(current);
        previous = current;
      }
      registration();
    } finally { f.dispose(); source.dispose(); fieldSpy.mockRestore(); frameSpy.mockRestore(); }
  });

  it("registers physical bodies without assigning receivers to masked pins or unmasked UI icons", async () => {
    const f = fixture(), source = materialSourceFixture();
    const mask = vi.spyOn(maskedTextures, "acquireMaskedTexture").mockImplementation(() => ({ resource: Promise.resolve(source.texture), release() {} }));
    const register = vi.spyOn(f.shadows, "register");
    try {
      const game = { ...f.game, signal: new AbortController().signal, isDisposed: () => false };
      const base = { image: "receiver-body-ui-exclusion.png", size: 20, x: 40, y: 40, groundY: 0 };
      const art = await createWorldSprites(game, [
        { ...base, id: "body", kind: "character", shadowCaster: "character" },
        { ...base, id: "pin", kind: "marker", mask: "receiver-pin-mask.png" },
        { ...base, id: "action", kind: "attack", unlit: true },
        { ...base, id: "star", kind: "star", unlit: true },
      ], f.shadows);
      f.parent.addChild(art.container);
      expect(art.entries).toHaveLength(4);
      expect(register.mock.calls.map(([, description]) => description.id)).toEqual(["body"]);
      f.shadows.update(worldSunlight(), viewport);
      const receiverLayer = f.render.mock.calls[1]?.[0]?.container;
      expect(receiverLayer.children).toHaveLength(1);
      const geometry = receiverLayer.children[0].geometry as Geometry;
      expect(geometry.getBuffer("aPosition").data.byteLength / (geometry.getAttribute("aPosition").stride ?? 1)).toBe(6);
    } finally {
      f.dispose(); register.mockRestore(); mask.mockRestore(); source.dispose();
    }
  });
  it.skipIf(!worldArtDirectory)("receives authored stock rock heights and normals without adding sun/local occluders or lights", async () => {
    const f = fixture();
    const surfaces = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(readFileSync(worldArtFile("biome-scenery.surfaces.json"), "utf8")));
    const decoded = await Promise.all(["biome-scenery.webp", "biome-scenery.material.png"].map(async (name) => {
      const { data, info } = await sharp(worldArtFile(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return new Texture({ source: new BufferImageSource({ resource: new Uint8Array(data), width: info.width, height: info.height, format: "rgba8unorm" }) });
    }));
    // Fixture-owned atlas sources preserve real dimensions independently of shared scene image leases.
    const assets = vi.spyOn(sceneAssets, "createSceneAssets").mockImplementation(() => ({
      texture: async (path) => decoded[path === worldAssetSource("/world-art/biome-scenery.webp")!.material ? 1 : 0]!,
      dispose() {},
    }));
    let drawn: Uint8Array = new Uint8Array();
    const canvasContext = { drawImage: (pixels: Uint8Array) => { drawn = pixels; }, getImageData: () => ({ data: drawn }) } as unknown as CanvasRenderingContext2D;
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => kind === "2d" ? canvasContext : null) as HTMLCanvasElement["getContext"]);
    const tile = { col: 1, row: 1, x: 40, y: 40, width: 20, height: 20 };
    try {
      const descriptions = sectorSpriteDescriptions({
        grid: { getHex: () => tile } as never,
        map: { sector: 1, objects: [{ id: "rock", type: "decoration", x: 1, y: 1, assetKey: "rock.grey" }] } as NormalizedSectorMap,
        decorations: DECORATION_ASSETS_BY_KEY, structures: [], wall: null, lightLayout: false,
      });
      expect(descriptions[0]).toMatchObject({ image: "/world-art/biome-scenery.webp", shadow: 0 });
      expect(descriptions[0]?.shadowCaster).toBeUndefined();
      const game = { ...f.game, signal: new AbortController().signal, isDisposed: () => false };
      const register = vi.spyOn(f.shadows, "register");
      const art = await createWorldSprites(game, descriptions, f.shadows);
      f.parent.addChild(art.container);
      expect(register).toHaveBeenCalledTimes(1);
      f.shadows.update(worldSunlight(), viewport);
      const receiverLayer = f.render.mock.calls[1]?.[0]?.container;
      expect(receiverLayer.children).toHaveLength(1);
      const mesh = receiverLayer.children[0];
      const material = mesh.shader.resources.uMaterial0 as BufferImageSource;
      const pixels = material.resource as Uint8Array;
      const frame = descriptions[0]!.frame!;
      const normals = new Set<number>();
      const surfaces = new Set<number>();
      const heights: number[] = [];
      for (let y = Math.ceil(frame.y); y < frame.y + frame.height; y++)
        for (let x = Math.ceil(frame.x); x < frame.x + frame.width; x++) {
          const i = (y * material.pixelWidth + x) * 4;
          if (!(pixels[i + 3] ?? 0) || !(pixels[i + 2] ?? 0)) continue;
          surfaces.add((pixels[i] ?? 0) & 3);
          heights.push(pixels[i + 2] ?? 0);
          normals.add(((pixels[i] ?? 0) << 8) | (pixels[i + 1] ?? 0));
        }
      expect(Math.max(...heights)).toBeGreaterThan(0);
      expect(normals.size).toBeGreaterThan(1);
      expect([...surfaces]).toEqual([1]);
      const sunLayers = f.render.mock.calls.slice(2, 4).map(([call]) => call.container);
      expect(sunLayers.map((layer) => layer.children.length)).toEqual([0, 0]);
      const resources = f.shadows.container.filters![0]!.resources;
      for (const key of ["uStaticField", "uDynamicField"])
        expect(((resources[key] as BufferImageSource).resource as Uint8Array).some((value) => value !== 0)).toBe(false);
      const pointLayer = f.render.mock.calls.at(-1)?.[0]?.container;
      expect(pointLayer.children[0].geometry.getBuffer("aPosition").data).toHaveLength(0);
      const draws = f.render.mock.calls.length;
      f.shadows.update(worldSunlight(), viewport);
      expect(f.render).toHaveBeenCalledTimes(draws);
      art.entries[0]!.sprite.x += 4;
      f.shadows.update(worldSunlight(), viewport);
      expect(f.render.mock.calls.filter(([call]) => call.container === receiverLayer)).toHaveLength(2);
      expect(sunLayers.map((layer) => layer.children.length)).toEqual([0, 0]);
      art.dispose();
      f.shadows.update(worldSunlight(), viewport);
      expect(receiverLayer.children).toHaveLength(0);
    } finally {
      f.dispose(); context.mockRestore(); assets.mockRestore(); surfaces.mockRestore(); for (const texture of decoded) texture.destroy(true);
    }
  });
  it("keeps the physical filter viewport in world units at phone and desktop scales", () => {
    const f = fixture();
    f.world.position.set(100, 400);
    f.world.scale.set(0.5, -0.5);
    f.shadows.update(worldSunlight(), viewport);
    expect(f.shadows.container.filterArea).toMatchObject({ x: -200, y: -400, width: 1600, height: 1200 });
    f.world.scale.set(2, -2);
    f.shadows.update(worldSunlight(), viewport);
    expect(f.shadows.container.filterArea).toMatchObject({ x: -50, y: -100, width: 400, height: 300 });
    f.dispose();
  });

  it("refreshes receiver and occlusion data when same-sized animation images change", async () => {
    const f = fixture();
    const a = new Uint8Array([128,128,128,255,128,128,128,255,128,128,128,255,128,128,128,255]);
    const b = new Uint8Array([128,128,128,0,128,128,128,0,128,128,128,0,128,128,128,255]);
    const textureFor = (resource: Uint8Array) => new Texture({ source: new BufferImageSource({ resource, width: 2, height: 2, format: "rgba8unorm" }) });
    const textures: [Texture, Texture] = [textureFor(a), textureFor(b)];
    const load = vi.spyOn(Assets, "load").mockImplementation(async (asset) => {
      const url = typeof asset === "string" ? asset : !Array.isArray(asset) ? asset?.src : "";
      return String(url).includes("frame-b") ? textures[1] : textures[0];
    });
    let drawn: Uint8Array = a;
    const context = { drawImage: (resource: Uint8Array) => { drawn = resource; }, getImageData: () => ({ data: drawn }) } as unknown as CanvasRenderingContext2D;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => kind === "2d" ? context : null) as HTMLCanvasElement["getContext"]);
    const sprite = new Sprite(textures[0]); sprite.position.set(40,40); sprite.width = sprite.height = 20; f.parent.addChild(sprite);
    const registration = f.shadows.register(sprite, { id: "image-walk", kind: "character", image: "receiver-image-idle.png", size: 20, x: 40, y: 40, groundY: 0, shadowCaster: "character", motion: { clip: { images: ["receiver-image-frame-a.png", "receiver-image-frame-b.png"], columns: 1, rows: 1, frameCount: 2, frameDurationMs: 100, loop: true }, frameOffsets: { horizontal: 0, north: 0, south: 0 }, size: 20 } }, textures);
    try {
      await registration.ready;
      f.shadows.update(worldSunlight(), viewport);
      const receiverLayer = f.render.mock.calls[1]?.[0]?.container;
      const field = f.shadows.container.filters?.[0]?.resources.uDynamicField as BufferImageSource;
      const before = (field.resource as Uint8Array).slice();
      sprite.texture = textures[1];
      f.shadows.update(worldSunlight(), viewport);
      expect(f.render.mock.calls.filter(([call]) => call.container === receiverLayer)).toHaveLength(2);
      expect((field.resource as Uint8Array).some((value, index) => value !== before[index])).toBe(true);
    } finally { registration(); f.dispose(); canvas.mockRestore(); load.mockRestore(); for (const texture of textures) texture.destroy(true); }
  });
  it("keeps the retained idle figure lit by the environment when optional movement artwork fails", async () => {
    const f = fixture(), source = materialSourceFixture("receiver-missing-motion.png");
    const assets = sceneAssets.createSceneAssets();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const game = { ...f.game, assets, signal: new AbortController().signal, isDisposed: () => false };
      const art = await createWorldSprites(game, [{
        id: "idle-fallback", kind: "character", image: "receiver-idle-fallback.png", size: 20,
        x: 40, y: 40, groundY: 0, shadowCaster: "character", nearest: true,
        motion: { clip: { images: ["receiver-missing-motion.png"], columns: 1, rows: 1,
          frameCount: 1, frameDurationMs: 100, loop: true },
          frameOffsets: { horizontal: 0, north: 0, south: 0 }, size: 20 },
      }], f.shadows);
      f.parent.addChild(art.container);
      expect(art.missing).toBe(0);
      expect(art.entries[0]?.motion).toBeNull();
      f.shadows.update(worldSunlight(), viewport);
      const receiverLayer = f.render.mock.calls[1]?.[0]?.container;
      expect(receiverLayer.children).toHaveLength(1);
      const pointLayer = f.render.mock.calls.at(-1)?.[0]?.container;
      expect(pointLayer.children[0].geometry.getBuffer("aPosition").data.length).toBeGreaterThan(0);
    } finally {
      f.dispose(); assets.dispose(); source.dispose(); warning.mockRestore();
    }
  });
  it("keeps a faded foreground prop from replacing its fighter's receiver and refreshes opacity changes", async () => {
    const f = fixture(), source = materialSourceFixture();
    const fighter = new Sprite(source.texture), prop = new Sprite(source.texture);
    const releases: ReturnType<typeof f.shadows.register>[] = [];
    try {
      fighter.position.set(40, 40); fighter.width = fighter.height = 20; fighter.zIndex = 1;
      prop.position.set(40, 40); prop.width = prop.height = 40; prop.zIndex = 2; prop.alpha = 0.5;
      f.parent.addChild(fighter, prop);
      releases.push(
        f.shadows.register(fighter, { id: "fighter", kind: "character", image: "receiver-opacity-fighter.png", size: 20, x: 40, y: 40, groundY: 0, shadowCaster: "character" }),
        f.shadows.register(prop, { id: "prop", kind: "decoration", image: "receiver-opacity-prop.png", size: 40, x: 40, y: 40, groundY: 0, shadowCaster: "building" }),
      );
      await Promise.all(releases.map((release) => release.ready));
      f.shadows.update(worldSunlight(), viewport);
      const layer = f.render.mock.calls[1]?.[0]?.container;
      const heights = () => layer.children.flatMap((mesh: { geometry: Geometry }) => {
        const attribute = mesh.geometry.getAttribute("aData");
        const stride = (attribute.stride ?? 0) / Float32Array.BYTES_PER_ELEMENT;
        const offset = (attribute.offset ?? 0) / Float32Array.BYTES_PER_ELEMENT;
        return Array.from(mesh.geometry.getBuffer("aData").data).filter((_, index) => index % stride === offset);
      });
      expect(heights()).toEqual(Array(6).fill(20));
      const draws = f.render.mock.calls.length;
      prop.alpha = 1;
      f.shadows.update(worldSunlight(), viewport);
      expect(f.render.mock.calls.length).toBeGreaterThan(draws);
      expect(heights()).toEqual([...Array(6).fill(20), ...Array(6).fill(40)]);
      prop.alpha = 0.5;
      f.shadows.update(worldSunlight(), viewport);
      expect(heights()).toEqual(Array(6).fill(20));
    } finally {
      for (const release of releases) release();
      f.dispose(); source.dispose();
    }
  });
  it("keeps fixed scenery receiver buffers while a character moves between their painter-ordered batches", async () => {
    const f = fixture(), source = materialSourceFixture();
    const sprites = [20, 40, 60].map((x, index) => {
      const sprite = new Sprite(source.texture); sprite.position.set(x, 40);
      sprite.width = sprite.height = 20; sprite.zIndex = index + 1; f.parent.addChild(sprite); return sprite;
    });
    const releases = sprites.map((sprite, index) => f.shadows.register(sprite, {
      id: `retained:${index}`, kind: index === 1 ? "character" : "decoration", image: `retained:${index}.png`,
      size: 20, x: sprite.x, y: sprite.y, groundY: 0, shadowCaster: index === 1 ? "character" : "building",
    }, [], undefined, index === 1 ? undefined : f.parent));
    try {
      await Promise.all(releases.map((release) => release.ready));
      f.shadows.update(worldSunlight(), viewport);
      const layer = f.render.mock.calls[1]![0]!.container;
      expect(layer.children).toHaveLength(3);
      const buffers: ReturnType<Geometry["getBuffer"]>[] = layer.children.map((mesh: { geometry: Geometry }) => mesh.geometry.getBuffer("aPosition"));
      const uploads = buffers.map((buffer) => vi.spyOn(buffer, "update"));
      sprites[1]!.x += 0.125;
      f.shadows.update(worldSunlight(), viewport);
      expect(uploads.map((upload) => upload.mock.calls.length)).toEqual([0, 1, 0]);
      expect(layer.children.map((mesh: { geometry: Geometry }) => mesh.geometry.getBuffer("aPosition"))).toEqual(buffers);
    } finally { releases.forEach((release) => release()); f.dispose(); source.dispose(); }
  });
  it("matches mutable scenery across camera anchors, owner transforms, visibility and explicit child invalidation", async () => {
    const source = materialSourceFixture(), cached = fixture(), mutable = fixture();
    const fixtures = [cached, mutable];
    const sprites = fixtures.map((f) => {
      const sprite = new Sprite(source.texture); sprite.position.set(40, 40); sprite.width = sprite.height = 20; f.parent.addChild(sprite); return sprite;
    });
    const releases = fixtures.map((f, index) => f.shadows.register(sprites[index]!, {
      id: "scenery-pose", kind: "decoration", image: "scenery-pose.png", size: 20, x: 40, y: 40, groundY: 0, shadowCaster: "building",
    }, [], undefined, index === 0 ? f.parent : undefined));
    try {
      await Promise.all(releases.map((release) => release.ready));
      const layers: Container[] = [];
      const compare = (bounds = viewport) => {
        fixtures.forEach((f, index) => {
          f.shadows.update(worldSunlight(), bounds);
          layers[index] ??= f.render.mock.calls[1]![0]!.container;
        });
        const values = layers.map((layer) => layer.children.map((mesh) => Array.from((mesh as unknown as { geometry: Geometry }).geometry.getBuffer("aPosition").data)));
        expect(values[0]).toEqual(values[1]);
      };
      compare(); compare();
      compare({ minX: 30.125, maxX: 130.125, minY: 0, maxY: 100 });
      fixtures.forEach((f) => f.parent.position.set(150.25, 10.125));
      compare({ minX: 129.125, maxX: 229.125, minY: 0, maxY: 100 });
      fixtures.forEach((f) => { f.parent.visible = false; }); compare();
      fixtures.forEach((f) => { f.parent.visible = true; f.parent.position.set(0, 0); }); compare();
      sprites.forEach((sprite) => { sprite.x += 1.125; sprite.alpha = 0.5; }); cached.shadows.invalidate(); compare();
      sprites.forEach((sprite) => { sprite.alpha = 1; }); cached.shadows.invalidate(); compare();
      cached.restore(); compare();
      releases.forEach((release) => release()); compare();
    } finally { releases.forEach((release) => release()); fixtures.forEach((f) => f.dispose()); source.dispose(); }
  });
  it("retains unchanged receiver/light passes and refreshes them after context restoration", () => {
    const f = fixture();
    f.shadows.update(worldSunlight(), viewport);
    const first = f.render.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    f.shadows.update(worldSunlight(), viewport);
    expect(f.render).toHaveBeenCalledTimes(first);
    f.restore();
    f.shadows.update(worldSunlight(), viewport);
    expect(f.render.mock.calls.length).toBeGreaterThan(first);
    f.dispose();
  });
  it("retains terrain elevation and follows its translated or hidden owner", () => {
    const f = fixture();
    const release = f.shadows.registerTerrain(f.parent, f.terrain);
    f.shadows.update(worldSunlight(), viewport);
    const layer = f.render.mock.calls[0]?.[0]?.container as Container;
    const mesh = layer.children[0] as unknown as { geometry: { getBuffer: (name: string) => { data: Float32Array } }; shader: { resources: { object: { uniforms: { uOffset: Float32Array } } } }; visible: boolean; destroyed: boolean };
    expect(Array.from(mesh.geometry.getBuffer("aPosition").data)).toEqual([0, 0, -4, 10, 0, -4, 0, 10, -4]);
    f.parent.position.set(8, 12);
    f.shadows.update(worldSunlight(), viewport);
    expect(Array.from(mesh.shader.resources.object.uniforms.uOffset)).toEqual([8, 12]);
    f.parent.visible = false;
    f.shadows.update(worldSunlight(), viewport);
    expect(mesh.visible).toBe(false);
    release(); release();
    expect(mesh.destroyed).toBe(true);
    expect(layer.children).toHaveLength(0);
    f.dispose();
  });
  it("releases the lighting container once and ignores updates after disposal", () => {
    const f = fixture();
    const release = f.shadows.registerTerrain(f.parent, f.terrain);
    f.shadows.update(worldSunlight(), viewport);
    f.dispose(); f.dispose();
    expect(f.shadows.container.destroyed).toBe(true);
    const draws = f.render.mock.calls.length;
    f.restore();
    f.shadows.update(worldSunlight(), viewport);
    expect(f.render).toHaveBeenCalledTimes(draws);
    expect(() => { release(); release(); }).not.toThrow();
  });
});
