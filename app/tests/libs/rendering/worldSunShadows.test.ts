import { describe, expect, it, vi } from "bun:test";
import { BufferImageSource, Shader, Texture } from "pixi.js";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { MaterialFrame, WorldMaterial } from "@/libs/rendering/worldMaterials";
import { worldSunlight } from "@/libs/rendering/worldShadows";
import { createSunShadows, type SunCaster } from "@/libs/rendering/worldSunShadows";

const fixture = (instanced = false) => {
  const render = vi.fn();
  const renderer = { width: 800, render, gl: instanced ? { drawElementsInstanced: () => {} } : undefined };
  const sun = createSunShadows({ renderer } as unknown as GameRenderer);
  const frame: MaterialFrame = { vertices: new Float32Array([0, 0, 0.5, 0, 0, 1, 1, 0, 0.5, 1, 0, 1, 0, 1, 0.5, 0, 1, 1]), indices: new Uint16Array([0, 1, 2]), points: new Float32Array(0), emitters: [] };
  const pixels = new Uint8Array([128, 128, 128, 255]);
  const texture = new Texture({ source: new BufferImageSource({ resource: pixels, width: 1, height: 1, format: "rgba8unorm" }) });
  const material: WorldMaterial = { texture, pixels, width: 1, height: 1, shape: "building", frames: new Map() };
  const caster = (id: string, dynamic: boolean, key = id): SunCaster => ({ id, key, dynamic, frame, material, transform: new Float32Array([10, 0, 0, -20, 40, 40]), height: 20 });
  return { render, renderer, sun, material, caster, dispose: () => { sun.dispose(); texture.destroy(true); } };
};
const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe("retained sunlight depth", () => {
  it("detaches source bindings from departed shaders while cached geometry stays reusable", () => {
    const f = fixture(), source = f.material.texture.source;
    const initialSourceListeners = source.listenerCount("change"), initialSamplerListeners = source.style.listenerCount("change");
    f.sun.update([f.caster("first", false), f.caster("second", false)], viewport, worldSunlight());
    expect(source.listenerCount("change")).toBe(initialSourceListeners + 2);
    expect(source.style.listenerCount("change")).toBe(initialSamplerListeners);
    f.sun.update([f.caster("second", false)], viewport, worldSunlight());
    expect(source.listenerCount("change")).toBe(initialSourceListeners + 1);
    f.sun.update([], viewport, worldSunlight());
    expect(source.listenerCount("change")).toBe(initialSourceListeners);
    f.dispose();
  });
  it("binds cutout flags independently of position and UV data", () => {
    const shaders = vi.spyOn(Shader, "from");
    const f = fixture();
    f.sun.update([f.caster("surface", false)], viewport, worldSunlight());
    const mesh = f.render.mock.calls[0]?.[0]?.container.children[0];
    const geometry = mesh.geometry;
    expect(geometry.attributes.aPosition).toMatchObject({ stride: 24, offset: 0, format: "float32x3" });
    expect(geometry.attributes.aUV).toMatchObject({ stride: 24, offset: 12, format: "float32x2" });
    expect(geometry.attributes.aCutout).toMatchObject({ stride: 24, offset: 20, format: "float32" });
    expect(geometry.getBuffer("aCutout")).toBe(geometry.getBuffer("aPosition"));
    expect(mesh.state.culling).toBe(false);
    const fragment = shaders.mock.calls.map(([options]) => options.gl?.fragment ?? "")
      .find((fragment) => fragment.includes("texture2D(uMaterial, vUV).a"))!;
    expect(fragment).toMatch(/^precision highp float;\s*precision highp sampler2D;/);
    expect(fragment.indexOf("precision highp sampler2D;")).toBeLessThan(fragment.indexOf("uniform sampler2D"));
    f.dispose();
    shaders.mockRestore();
  });
  it("updates receiver height precision and texel resolution when the renderer crosses its resolution threshold", () => {
    const f = fixture(), caster = { ...f.caster("hall", false), height: 160 };
    const direction = { x: 0, y: -0.6, z: 1 };
    f.sun.update([caster], viewport, direction);
    expect(f.sun.uniforms.uniforms.uSunDepth[2]).toBeCloseTo(160 / 510);
    expect(f.sun.uniforms.uniforms.uSunDepth[3]).toBe(768);
    const first = f.sun.uniforms.uniforms.uSunDepth.slice(0, 2);
    f.renderer.width = 1000;
    f.sun.update([caster], viewport, direction);
    expect(f.sun.uniforms.uniforms.uSunDepth.slice(0, 2)).toEqual(first);
    expect(f.sun.uniforms.uniforms.uSunDepth[2]).toBeCloseTo(160 / 510);
    expect(f.sun.uniforms.uniforms.uSunDepth[3]).toBe(1536);
    expect(f.sun.staticTexture.width).toBe(1536);
    expect(f.render).toHaveBeenCalledTimes(4);
    f.dispose();
  });
  it.each([0.6, 1, 2.5])("bounds horizon shadow steps to half a screen pixel at scale %s", (scale) => {
    const f = fixture(), caster = { ...f.caster("hall", false), height: 160 };
    f.renderer.width = (viewport.maxX - viewport.minX) * scale;
    try {
      const length = Math.hypot(1, -0.12, 0.28);
      const direction = { x: 1 / length, y: -0.12 / length, z: 0.28 / length };
      f.sun.update([caster], viewport, direction);
      const actual = f.sun.uniforms.uniforms.uSun;
      for (const [axis, value] of [[0, direction.x], [1, direction.y]] as const)
        expect(Math.abs((actual[axis] ?? 0) / (actual[2] ?? 1) - value / direction.z) * caster.height * scale).toBeLessThanOrEqual(0.251);
    } finally { f.dispose(); }
  });
  it("advances an enlarged map's shadow in subpixel steps without uploading geometry", () => {
    const f = fixture(), caster = { ...f.caster("hall", false), height: 160 };
    f.renderer.width = 250;
    try {
      const positions: number[] = [];
      f.sun.update([caster], viewport, { x: 0, y: -0.6, z: 1 });
      const upload = vi.spyOn(f.render.mock.calls[0]![0]!.container.children[0].geometry.getBuffer("aPosition"), "update");
      for (let offset = 0; offset <= 1; offset += 0.05) {
        f.sun.update([caster], viewport, { x: offset / caster.height, y: -0.6, z: 1 });
        const sun = f.sun.uniforms.uniforms.uSun;
        positions.push((sun[0] ?? 0) / (sun[2] ?? 1) * caster.height * 2.5);
      }
      expect(new Set(positions).size).toBeGreaterThan(4);
      for (let i = 1; i < positions.length; i++)
        expect(Math.abs(positions[i]! - positions[i - 1]!)).toBeLessThanOrEqual(0.501);
      expect(upload).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it("instances repeated scenery without uploading geometry or poses for wind-only changes", () => {
    const f = fixture(true);
    const first = { ...f.caster("first", false), wind: 0 };
    const second = { ...f.caster("second", false), wind: 5, transform: new Float32Array([12, 0, 0, -24, 60, 40]) };
    try {
      f.sun.update([first, second, f.caster("actor", true)], viewport, worldSunlight());
      const layer = f.render.mock.calls[0]![0]!.container;
      expect(layer.children).toHaveLength(1);
      const geometry = layer.children[0].geometry;
      expect(geometry.instanceCount).toBe(2);
      expect(geometry.attributes.aObject.instance).toBe(true);
      expect(geometry.attributes.aObjectY.instance).toBe(true);
      const instances = geometry.getBuffer("aObject");
      expect(Array.from(instances.data)).toEqual([10, 0, 40, 20, 0, -20, 40, 1, 12, 0, 60, 20, 0, -24, 40, 6]);
      const upload = vi.spyOn(instances, "update");
      const vertices = vi.spyOn(geometry.getBuffer("aPosition"), "update");
      f.sun.update([first, second, f.caster("actor", true)], viewport, worldSunlight(), {
        large: new Float32Array([0.1, 0, 0, 0]), small: new Float32Array([0, 0.05, 0, 0]), key: "breeze",
      });
      expect(upload).not.toHaveBeenCalled();
      expect(vertices).not.toHaveBeenCalled();
      expect(f.render.mock.calls).toHaveLength(3);
      f.sun.update([second], viewport, worldSunlight());
      expect(layer.children[0].geometry).toBe(geometry);
      expect(geometry.instanceCount).toBe(1);
      expect(upload).toHaveBeenCalledTimes(1);
    } finally { f.dispose(); }
  });
  it("keeps frame batches separate and releases instance buffers without destroying shared actor geometry", () => {
    const f = fixture(true), caster = f.caster("tree", false);
    try {
      const other = { ...caster, id: "other", frame: { ...caster.frame, vertices: caster.frame.vertices.slice() } };
      f.sun.update([caster, other, f.caster("actor", true)], viewport, worldSunlight());
      const layer = f.render.mock.calls[0]![0]!.container;
      const actor = f.render.mock.calls[1]![0]!.container.children[0];
      expect(layer.children).toHaveLength(2);
      const geometry = layer.children[0].geometry, buffer = geometry.getBuffer("aPosition");
      const instances = geometry.getBuffer("aObject");
      const release = vi.spyOn(geometry, "destroy"), releaseInstances = vi.spyOn(instances, "destroy");
      const releaseSource = vi.spyOn(buffer, "destroy");
      expect(actor.geometry.getBuffer("aPosition")).toBe(buffer);
      f.sun.update([f.caster("actor", true)], viewport, worldSunlight());
      expect(release).toHaveBeenCalledTimes(1);
      expect(releaseInstances).toHaveBeenCalledTimes(1);
      expect(releaseSource).not.toHaveBeenCalled();
      f.sun.dispose();
      expect(releaseSource).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    } finally { f.dispose(); }
  });
  it("culls distant casters but retains offscreen shadows that reach recessed terrain", () => {
    const f = fixture(true), caster = { ...f.caster("offscreen", false), transform: new Float32Array([10, 0, 0, -20, 400, 40]) };
    const direction = { x: 16, y: -0.6, z: 1 };
    try {
      f.sun.update([caster], viewport, direction);
      const layer = f.render.mock.calls[0]![0]!.container;
      expect(layer.children).toHaveLength(0);
      f.sun.update([caster], viewport, direction, undefined, -20);
      expect(layer.children).toHaveLength(1);
      f.sun.update([caster], viewport, direction);
      expect(layer.children).toHaveLength(0);
    } finally { f.dispose(); }
  });

  it.each([[1, -0.12, 0.28], [0, -0.65, 1.08], [-1, -0.12, 0.28]])("fits visible receiver rays at sun direction %j without clipping sunward offscreen casters", (x, y, z) => {
    const f = fixture();
    const caster = { ...f.caster("canopy", false), height: 160 };
    const view = { minX: 0, maxX: 341, minY: 0, maxY: 300 };
    try {
      f.sun.update([caster], view, { x, y, z }, undefined, -20);
      const u = f.sun.uniforms.uniforms;
      const project = (p: number[]) => {
        const relative = p.map((value, i) => value - u.uSunOrigin[i]!);
        const dot = (basis: Float32Array) => relative.reduce((sum, value, i) => sum + value * basis[i]!, 0);
        return [(dot(u.uSunRight) - u.uSunBounds[0]!) / u.uSunBounds[2]!,
          (dot(u.uSunUp) - u.uSunBounds[1]!) / u.uSunBounds[3]!,
          (dot(u.uSun) - u.uSunDepth[0]!) / u.uSunDepth[1]!];
      };
      for (const sx of [view.minX, view.maxX]) for (const sy of [view.minY, view.maxY]) for (const height of [-20, 160]) {
        const receiver = [sx, 2 * (sy - height), height];
        const sample = project(receiver);
        for (const value of sample) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
        const toTop = (160 - height) / u.uSun[2]!;
        const front = project(receiver.map((value, i) => value + toTop * u.uSun[i]!));
        expect(front[0]).toBeCloseTo(sample[0]!, 5); expect(front[1]).toBeCloseTo(sample[1]!, 5);
        expect(front[2]).toBeGreaterThanOrEqual(sample[2]!); expect(front[2]).toBeLessThanOrEqual(1.00001);
      }
    } finally { f.dispose(); }
  });

  it("updates a moving actor independently of retained static depth", () => {
    const f = fixture(), scenery = f.caster("tree", false);
    f.sun.update([scenery, f.caster("actor", true)], viewport, worldSunlight());
    expect(f.render).toHaveBeenCalledTimes(2);
    const dynamicTarget = f.render.mock.calls[1]?.[0]?.target;
    f.sun.update([scenery, f.caster("actor", true, "moved")], viewport, worldSunlight());
    expect(f.render).toHaveBeenCalledTimes(3);
    expect(f.render.mock.calls[2]?.[0]?.target).toBe(dynamicTarget);
    f.sun.update([scenery, f.caster("actor", true, "moved")], viewport, worldSunlight());
    expect(f.render).toHaveBeenCalledTimes(3);
    f.dispose();
  });
  it("updates retained vegetation at gust cadence independently of actor motion", () => {
    const f = fixture();
    try {
      const tree = { ...f.caster("wind-tree", false), wind: 2 };
      const hall = f.caster("hall", false), actor = f.caster("actor", true);
      const still = { large: new Float32Array(4), small: new Float32Array(4), key: "still" };
      f.sun.update([hall, tree, actor], viewport, worldSunlight(), still);
      const scenery = f.render.mock.calls[0]![0]!, actors = f.render.mock.calls[1]![0]!;
      const mesh = scenery.container.children[1];
      const buffer = mesh.geometry.getBuffer("aPosition");
      const upload = vi.spyOn(buffer, "update");
      expect(mesh.shader.resources.object.uniforms.uObjectY[3]).toBe(3);
      const gust = { ...still, large: new Float32Array([0, 0, 2, 0]), key: "gust" };
      f.sun.update([hall, tree, actor], viewport, worldSunlight(), gust);
      expect(f.render.mock.calls).toHaveLength(3);
      expect(f.render.mock.calls[2]![0]!.target).toBe(scenery.target);
      expect(mesh.geometry.getBuffer("aPosition")).toBe(buffer);
      expect(upload).not.toHaveBeenCalled();
      expect(Array.from(mesh.shader.resources.wind.uniforms.uWind)).toEqual([0, 0, 2, 0]);
      f.sun.update([hall, tree, { ...actor, key: "moved" }], viewport, worldSunlight(), gust);
      expect(f.render.mock.calls).toHaveLength(4);
      expect(f.render.mock.calls[3]![0]!.target).toBe(actors.target);
      f.sun.update([hall, tree, { ...actor, key: "moved" }], viewport, worldSunlight(), gust);
      expect(f.render.mock.calls).toHaveLength(4);
    } finally { f.dispose(); }
  });
  it("keeps subpixel camera movement cached and invalidates both maps when requested", () => {
    const f = fixture(), caster = f.caster("tree", false);
    f.sun.update([caster], viewport, worldSunlight());
    const first = f.render.mock.calls.length;
    f.sun.update([caster], { minX: 0.1, minY: 0.1, maxX: 100.1, maxY: 100.1 }, worldSunlight());
    expect(f.render).toHaveBeenCalledTimes(first);
    f.sun.invalidate();
    f.sun.update([caster], viewport, worldSunlight());
    expect(f.render).toHaveBeenCalledTimes(first + 2);
    f.dispose();
  });
  it("clears departed casters and releases its resources without destroying shared material", () => {
    const f = fixture();
    f.sun.update([f.caster("tree", false)], viewport, worldSunlight());
    const layer = f.render.mock.calls[0]?.[0]?.container;
    expect(layer.children).toHaveLength(1);
    f.sun.update([], viewport, worldSunlight());
    expect(layer.children).toHaveLength(0);
    f.sun.dispose(); f.sun.dispose();
    expect(f.sun.staticTexture.destroyed).toBe(true);
    expect(f.sun.dynamicTexture.destroyed).toBe(true);
    expect(f.material.texture.destroyed).toBe(false);
    const draws = f.render.mock.calls.length;
    f.sun.update([], viewport, worldSunlight());
    expect(f.render).toHaveBeenCalledTimes(draws);
    f.material.texture.destroy(true);
  });
  it("shares active frames outside the idle budget and evicts the oldest departed geometry", () => {
    const f = fixture();
    const largeFrame = (): MaterialFrame => {
      const base = f.caster("base", false).frame;
      const vertices = new Float32Array(Math.floor((3 * 1024 * 1024) / 24) * 6);
      vertices.set(base.vertices);
      return { ...base, vertices };
    };
    const frameA = largeFrame(), frameB = largeFrame(), frameC = largeFrame();
    const a = { ...f.caster("a", false), frame: frameA };
    const shared = { ...f.caster("shared-a", false), frame: frameA };
    const b = { ...f.caster("b", false), frame: frameB };
    const c = { ...f.caster("c", false), frame: frameC };
    f.sun.update([a, shared, b, c], viewport, worldSunlight());
    const layer = f.render.mock.calls[0]?.[0]?.container;
    const geometryA = layer.children[0].geometry;
    expect(layer.children[1].geometry).toBe(geometryA);
    const geometryB = layer.children[2].geometry, geometryC = layer.children[3].geometry;
    const destroyA = vi.spyOn(geometryA, "destroy");
    const destroyB = vi.spyOn(geometryB, "destroy");
    const destroyC = vi.spyOn(geometryC, "destroy");

    f.sun.update([shared, b], viewport, worldSunlight());
    expect(destroyA).not.toHaveBeenCalled();
    expect(destroyB).not.toHaveBeenCalled();
    expect(destroyC).not.toHaveBeenCalled();
    f.sun.update([shared], viewport, worldSunlight());
    expect(destroyA).not.toHaveBeenCalled();
    expect(destroyB).not.toHaveBeenCalled();
    expect(destroyC).toHaveBeenCalledTimes(1);
    expect(destroyC).toHaveBeenCalledWith(true);

    f.sun.update([], viewport, worldSunlight());
    expect(destroyA).not.toHaveBeenCalled();
    expect(destroyB).toHaveBeenCalledTimes(1);
    f.sun.update([a], viewport, worldSunlight());
    expect(layer.children[0].geometry).toBe(geometryA);
    f.dispose();
    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);
    expect(destroyC).toHaveBeenCalledTimes(1);
  });
  it("retains the actor shader and mesh while reusing animation geometry", () => {
    const f = fixture(), actor = f.caster("actor", true);
    f.sun.update([actor], viewport, worldSunlight());
    const layer = f.render.mock.calls[1]?.[0]?.container;
    const mesh = layer.children[0], firstGeometry = mesh.geometry;
    const shaderDestroy = vi.spyOn(mesh.shader, "destroy");
    const firstGeometryDestroy = vi.spyOn(firstGeometry, "destroy");
    const alternate = { ...actor, key: "alternate", frame: { ...actor.frame, vertices: actor.frame.vertices.slice() } };
    f.sun.update([alternate], viewport, worldSunlight());
    const secondGeometry = mesh.geometry;
    const secondGeometryDestroy = vi.spyOn(secondGeometry, "destroy");
    expect(layer.children[0]).toBe(mesh);
    expect(mesh.destroyed).toBe(false);
    expect(shaderDestroy).not.toHaveBeenCalled();
    expect(firstGeometryDestroy).not.toHaveBeenCalled();
    f.sun.update([actor], viewport, worldSunlight());
    expect(layer.children[0]).toBe(mesh);
    expect(mesh.geometry).toBe(firstGeometry);
    expect(shaderDestroy).not.toHaveBeenCalled();
    f.dispose();
    expect(shaderDestroy).toHaveBeenCalledTimes(1);
    expect(firstGeometryDestroy).toHaveBeenCalledTimes(1);
    expect(secondGeometryDestroy).toHaveBeenCalledTimes(1);
  });
});
