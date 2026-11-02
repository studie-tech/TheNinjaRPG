import {
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  Mesh,
  RenderTarget,
  RenderTexture,
  Shader,
  State,
  UniformGroup,
} from "pixi.js";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldBounds } from "@/libs/rendering/visibility";
import type { MaterialFrame, WorldMaterial } from "@/libs/rendering/worldMaterials";
import {
  MAX_SMALL_WORLD_WIND,
  MAX_WORLD_WIND,
  STILL_WORLD_WIND,
  type WorldWind,
  worldWindShader,
} from "@/libs/rendering/worldWind";

/** Stationary depth stays retained while instanced foliage and actors share the animated depth map. */
export const createSunShadows = (game: GameRenderer) => {
  const staticTexture = RenderTexture.create({
    width: 1024,
    height: 1024,
    scaleMode: "nearest",
    antialias: false,
  });
  const dynamicTexture = RenderTexture.create({
    width: 1024,
    height: 1024,
    scaleMode: "nearest",
    antialias: false,
  });
  const targets = [
    new RenderTarget({ colorTextures: [staticTexture], depth: true }),
    new RenderTarget({ colorTextures: [dynamicTexture], depth: true }),
  ] as const;
  const layers = [new Container(), new Container()] as const;
  // Actor frame changes leave foliage's instanced render instructions retained.
  const windLayer = new Container({ isRenderGroup: true, label: "wind-depth" });
  const wind = new UniformGroup(
    {
      uWind: { value: new Float32Array(4), type: "vec4<f32>" },
      uWindSmall: { value: new Float32Array(4), type: "vec4<f32>" },
    },
    { isStatic: true },
  );
  const uniforms = new UniformGroup(
    {
      uSun: { value: new Float32Array([0, -0.5, 0.866]), type: "vec3<f32>" },
      uSunRight: { value: new Float32Array([1, 0, 0]), type: "vec3<f32>" },
      uSunUp: { value: new Float32Array([0, 0.866, 0.5]), type: "vec3<f32>" },
      uSunOrigin: { value: new Float32Array(3), type: "vec3<f32>" },
      uSunBounds: { value: new Float32Array([-1, -1, 2, 2]), type: "vec4<f32>" },
      uSunDepth: {
        value: new Float32Array([-1, 2, 64 / 510, 1024]),
        type: "vec4<f32>",
      },
    },
    { isStatic: true },
  );
  const geometries = new Map<MaterialFrame, CachedGeometry>();
  const idleGeometries = new Map<MaterialFrame, CachedGeometry>();
  const idleBudget = 4 * 1024 * 1024;
  let idleBytes = 0;
  const acquireGeometry = (frame: MaterialFrame, compact: boolean) => {
    let cached = geometries.get(frame);
    if (!cached) {
      const indices = compact ? shadowIndices(frame) : frame.indices;
      const buffer = new Buffer({ data: frame.vertices, usage: BufferUsage.VERTEX });
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer, format: "float32x3", stride: 24, offset: 0 },
          aUV: { buffer, format: "float32x2", stride: 24, offset: 12 },
          aCutout: { buffer, format: "float32", stride: 24, offset: 20 },
        },
        indexBuffer: indices,
      });
      cached = {
        geometry,
        references: 0,
        bytes: frame.vertices.byteLength + indices.byteLength,
      };
      geometries.set(frame, cached);
    } else if (idleGeometries.delete(frame)) idleBytes -= cached.bytes;
    cached.references++;
    return cached.geometry;
  };
  const releaseGeometry = (frame: MaterialFrame) => {
    const cached = geometries.get(frame);
    if (!cached || --cached.references > 0) return;
    idleGeometries.set(frame, cached);
    idleBytes += cached.bytes;
  };
  const trimGeometries = () => {
    // Trim after all frame swaps so a frame reused by another actor stays shared.
    for (const [frame, cached] of idleGeometries) {
      if (idleBytes <= idleBudget) break;
      idleGeometries.delete(frame);
      geometries.delete(frame);
      idleBytes -= cached.bytes;
      cached.geometry.destroy(true);
    }
  };
  const entries = new Map<string, SunEntry>();
  const frameIds = new WeakMap<MaterialFrame, number>();
  let nextFrameId = 0;
  const canInstance = typeof game.renderer.gl?.drawElementsInstanced === "function";
  const releaseEntry = (entry: SunEntry) => {
    entry.shader.destroy();
    const geometry = entry.mesh.geometry;
    entry.mesh.destroy();
    if (entry.instances) {
      geometry.destroy();
      entry.instances.destroy();
    }
    releaseGeometry(entry.frame);
  };
  let cachedView = "",
    cachedWind = "",
    staticDirty = true,
    dynamicDirty = true,
    disposed = false;
  let previousCasters: SunCaster[][] = [[], []];
  let previousBatchView = "";
  /** Wind and light changes redraw retained geometry without rebuilding its batches. */
  const renderDepth = () => {
    if (staticDirty) {
      game.renderer.render({
        container: layers[0],
        target: targets[0],
        clear: true,
        clearColor: [0, 0, 0, 0],
      });
    }
    if (dynamicDirty) {
      game.renderer.render({
        container: layers[1],
        target: targets[1],
        clear: true,
        clearColor: [0, 0, 0, 0],
      });
    }
    staticDirty = dynamicDirty = false;
  };
  return {
    staticTexture,
    dynamicTexture,
    uniforms,
    /** Updates diffuse light without drawing depth; the next shadowed frame restores its matching basis. */
    setUnshadowedDirection: (direction: { x: number; y: number; z: number }) => {
      uniforms.uniforms.uSun.set([direction.x, direction.y, direction.z]);
      uniforms.update();
      cachedView = "";
    },
    /** Sun-space bounds are snapped in world coordinates; camera subpixel movement reuses depth contents. */
    update: (
      casters: SunCaster[],
      viewport: WorldBounds,
      direction: { x: number; y: number; z: number },
      breeze: WorldWind = STILL_WORLD_WIND,
      minReceiverHeight = 0,
    ) => {
      if (disposed) return;
      if (cachedWind !== breeze.key) {
        cachedWind = breeze.key;
        wind.uniforms.uWind.set(breeze.large);
        wind.uniforms.uWindSmall.set(breeze.small);
        wind.update();
        if (casters.some((caster) => caster.wind !== undefined)) dynamicDirty = true;
      }
      let maxHeight = 64;
      for (const caster of casters) maxHeight = Math.max(maxHeight, caster.height);
      // Bound each projected step to half a screen pixel, including enlarged maps.
      // Float32 viewport width keeps subpixel camera movement from changing the angular grid.
      const pixelsPerUnit =
        game.renderer.width / Math.max(1, Math.fround(viewport.maxX - viewport.minX));
      const projectionSteps = maxHeight * pixelsPerUnit * 2;
      const elevation = Math.max(0.05, direction.z);
      const x =
          Math.round((direction.x / elevation) * projectionSteps) / projectionSteps,
        y = Math.round((direction.y / elevation) * projectionSteps) / projectionSteps,
        z = 1;
      const length = Math.hypot(x, y, z),
        sun = [x / length, y / length, z / length];
      const horizontal = Math.hypot(sun[0] ?? 0, sun[1] ?? 0);
      const right = [-(sun[1] ?? 0) / horizontal, (sun[0] ?? 0) / horizontal, 0];
      const up = [
        -(sun[2] ?? 0) * (right[1] ?? 0),
        (sun[2] ?? 0) * (right[0] ?? 0),
        horizontal,
      ];
      // A light ray has one sun-space UV. Fit visible receiver rays rather than
      // enlarging the map to include offscreen casters, which only wastes shadow texels.
      const minX = (Math.floor(viewport.minX / 64) - 1) * 64,
        maxX = (Math.ceil(viewport.maxX / 64) + 1) * 64,
        minY = (Math.floor(viewport.minY / 64) - 1) * 64,
        maxY = (Math.ceil(viewport.maxY / 64) + 1) * 64;
      const resolution = game.renderer.width > 900 ? 1536 : 768;
      if (staticTexture.width !== resolution) {
        staticTexture.resize(resolution, resolution);
        dynamicTexture.resize(resolution, resolution);
        staticDirty = dynamicDirty = true;
      }
      const viewKey = `${minX}:${minY}:${maxX}:${maxY}:${maxHeight}:${minReceiverHeight}:${x}:${y}:${z}:${resolution}`;
      if (viewKey !== cachedView) {
        cachedView = viewKey;
        staticDirty = dynamicDirty = true;
        const origin = [(minX + maxX) / 2, minY + maxY, 0];
        const bounds = [Infinity, Infinity, -Infinity, -Infinity, Infinity, -Infinity];
        for (const px of [minX, maxX])
          for (const py of [minY, maxY])
            for (const pz of [minReceiverHeight, maxHeight]) {
              const p = [px - (origin[0] ?? 0), 2 * (py - pz) - (origin[1] ?? 0), pz];
              const r = dot(p, right),
                u = dot(p, up),
                d = dot(p, sun);
              bounds[0] = Math.min(bounds[0] ?? Infinity, r);
              bounds[1] = Math.min(bounds[1] ?? Infinity, u);
              bounds[2] = Math.max(bounds[2] ?? -Infinity, r);
              bounds[3] = Math.max(bounds[3] ?? -Infinity, u);
              bounds[4] = Math.min(bounds[4] ?? Infinity, d);
              bounds[5] = Math.max(bounds[5] ?? -Infinity, d);
            }
        // Sunward casters can lie beyond the receiver depth while sharing its UV.
        bounds[5] =
          (bounds[5] ?? 0) +
          (maxHeight - minReceiverHeight) / Math.max(0.05, sun[2] ?? 1);
        uniforms.uniforms.uSun.set(sun);
        uniforms.uniforms.uSunRight.set(right);
        uniforms.uniforms.uSunUp.set(up);
        uniforms.uniforms.uSunOrigin.set(origin);
        uniforms.uniforms.uSunBounds.set([
          bounds[0] ?? 0,
          bounds[1] ?? 0,
          (bounds[2] ?? 1) - (bounds[0] ?? 0),
          (bounds[3] ?? 1) - (bounds[1] ?? 0),
        ]);
        uniforms.uniforms.uSunDepth.set([
          bounds[4] ?? 0,
          (bounds[5] ?? 1) - (bounds[4] ?? 0),
          maxHeight / 510,
          resolution,
        ]);
        uniforms.update();
      }
      // Cull to the retained atlas footprint so subpixel camera motion reuses its caster batches.
      const batchViewKey = viewKey;
      // Instance batches follow pose ownership; actor motion does not rebuild foliage batches.
      const casterGroups = [
        casters.filter((caster) => !caster.dynamic),
        casters.filter((caster) => caster.dynamic),
      ];
      const retained = casterGroups.map((next, group) => {
        const previous = previousCasters[group] ?? [];
        return (
          previousBatchView === batchViewKey &&
          previous.length === next.length &&
          previous.every((entry, index) => {
            const current = next[index];
            return (
              current &&
              entry.id === current.id &&
              entry.key === current.key &&
              entry.frame === current.frame &&
              entry.material === current.material &&
              entry.wind === current.wind
            );
          })
        );
      });
      if (retained.every(Boolean)) {
        renderDepth();
        return;
      }
      // Include neighbouring filtered samples and grazing receiver planes in the culling margin.
      const padding =
        (Math.hypot(
          uniforms.uniforms.uSunBounds[2] ?? 0,
          uniforms.uniforms.uSunBounds[3] ?? 0,
        ) *
          2) /
        (resolution * 0.08);
      const batches = new Map<string, { casters: SunCaster[]; instanced: boolean }>();
      for (const caster of casters) {
        if (retained[caster.dynamic ? 1 : 0]) continue;
        const layer = depthLayer(caster);
        if (
          !shadowReachesViewport(
            caster,
            { minX, minY, maxX, maxY },
            x,
            y,
            minReceiverHeight,
            padding,
          )
        )
          continue;
        const instanced = canInstance && !caster.dynamic;
        let frameId = frameIds.get(caster.frame);
        if (frameId === undefined) {
          frameId = ++nextFrameId;
          frameIds.set(caster.frame, frameId);
        }
        // Animated actors retain their mesh across frame swaps; repeated scenery shares one draw.
        const id = instanced
          ? `batch:${layer}:${frameId}:${caster.material.texture.source.uid}`
          : `object:${caster.id}`;
        let batch = batches.get(id);
        if (!batch) {
          batch = { casters: [], instanced };
          batches.set(id, batch);
        }
        batch.casters.push(caster);
      }
      for (const [id, batch] of batches) {
        const caster = batch.casters[0];
        if (!caster) continue;
        const layer = depthLayer(caster);
        const parent = layer === 1 && !caster.dynamic ? windLayer : layers[layer];
        if (parent === windLayer && !windLayer.parent) layers[1].addChild(windLayer);
        let entry = entries.get(id);
        if (entry && entry.frame !== caster.frame) {
          entry.mesh.geometry = acquireGeometry(caster.frame, !caster.dynamic);
          releaseGeometry(entry.frame);
          entry.frame = caster.frame;
          entry.shader.resources.uMaterial = caster.material.texture.source;
          entry.key = "";
        }
        if (!entry) {
          const base = acquireGeometry(caster.frame, !caster.dynamic);
          const instances = batch.instanced
            ? new Buffer({
                data: new Float32Array(0),
                usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
                shrinkToFit: false,
              })
            : undefined;
          const geometry = instances
            ? new Geometry({
                attributes: {
                  ...base.attributes,
                  aObject: {
                    buffer: instances,
                    format: "float32x4",
                    stride: 32,
                    offset: 0,
                    instance: true,
                  },
                  aObjectY: {
                    buffer: instances,
                    format: "float32x4",
                    stride: 32,
                    offset: 16,
                    instance: true,
                  },
                },
                indexBuffer: base.indexBuffer,
              })
            : base;
          const shader = Shader.from({
            gl: { vertex: sunVertex(batch.instanced), fragment: sunFragment },
            resources: {
              sun: uniforms,
              wind,
              uMaterial: caster.material.texture.source,
              ...(instances
                ? {}
                : {
                    object: {
                      uObject: { value: new Float32Array(4), type: "vec4<f32>" },
                      uObjectY: { value: new Float32Array(4), type: "vec4<f32>" },
                    },
                  }),
            },
          });
          const state = new State();
          state.blend = false;
          state.depthTest = true;
          state.depthMask = true;
          const mesh = new Mesh({ geometry, shader, state });
          parent.addChild(mesh);
          entry = {
            mesh,
            shader,
            key: "",
            frame: caster.frame,
            layer,
            dynamic: caster.dynamic,
            instances,
          };
          entries.set(id, entry);
        }
        entry.dynamic = caster.dynamic;
        if (entry.layer !== layer || entry.mesh.parent !== parent) {
          entry.layer = layer;
          parent.addChild(entry.mesh);
          staticDirty = dynamicDirty = true;
        }
        const key = batch.casters
          .map((value) => `${value.id}:${value.key}:${value.wind ?? -1}`)
          .join(";");
        if (entry.key !== key) {
          if (entry.layer === 1) dynamicDirty = true;
          else staticDirty = true;
          entry.key = key;
          if (entry.instances) {
            const data = new Float32Array(batch.casters.length * 8);
            for (const [index, value] of batch.casters.entries()) {
              const m = value.transform;
              data.set(
                [
                  m[0] ?? 0,
                  m[2] ?? 0,
                  m[4] ?? 0,
                  value.height,
                  m[1] ?? 0,
                  m[3] ?? 0,
                  m[5] ?? 0,
                  value.wind === undefined ? 0 : value.wind + 1,
                ],
                index * 8,
              );
            }
            entry.instances.data = data;
            entry.instances.update();
            entry.mesh.geometry.instanceCount = batch.casters.length;
          } else {
            const m = caster.transform;
            entry.shader.resources.object.uniforms.uObject.set([
              m[0],
              m[2],
              m[4],
              caster.height,
            ]);
            entry.shader.resources.object.uniforms.uObjectY.set([
              m[1],
              m[3],
              m[5],
              caster.wind === undefined ? 0 : caster.wind + 1,
            ]);
            entry.shader.resources.object.update();
          }
        }
      }
      for (const [id, entry] of entries)
        if (!retained[entry.dynamic ? 1 : 0] && !batches.has(id)) {
          if (entry.layer === 1) dynamicDirty = true;
          else staticDirty = true;
          releaseEntry(entry);
          entries.delete(id);
        }
      if (!windLayer.children.length) windLayer.removeFromParent();
      trimGeometries();
      casterGroups.forEach((next, group) => {
        if (!retained[group])
          previousCasters[group] = next.map((caster) => ({ ...caster }));
      });
      previousBatchView = batchViewKey;
      renderDepth();
    },
    invalidate: () => {
      staticDirty = dynamicDirty = true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) releaseEntry(entry);
      for (const layer of layers) layer.destroy({ children: true });
      if (!windLayer.destroyed) windLayer.destroy({ children: true });
      for (const { geometry } of geometries.values()) geometry.destroy(true);
      entries.clear();
      previousCasters = [];
      geometries.clear();
      idleGeometries.clear();
      idleBytes = 0;
      for (const target of targets) target.destroy();
      staticTexture.destroy(true);
      dynamicTexture.destroy(true);
    },
  };
};

const sourceBounds = new WeakMap<
  MaterialFrame,
  { u: number; v: number; du: number; dv: number; height: number }
>();
/** A caster can shade receivers between its own height and the lowest terrain, including offscreen casters. */
const shadowReachesViewport = (
  caster: SunCaster,
  viewport: WorldBounds,
  sunX: number,
  sunY: number,
  minReceiverHeight: number,
  padding: number,
) => {
  let bounds = sourceBounds.get(caster.frame);
  if (!bounds) {
    let minU = Infinity,
      minV = Infinity,
      maxU = -Infinity,
      maxV = -Infinity,
      height = 0;
    const vertices = caster.frame.vertices;
    for (let i = 0; i < vertices.length; i += 6) {
      minU = Math.min(minU, vertices[i] ?? 0);
      maxU = Math.max(maxU, vertices[i] ?? 0);
      minV = Math.min(minV, vertices[i + 1] ?? 0);
      maxV = Math.max(maxV, vertices[i + 1] ?? 0);
      height = Math.max(height, vertices[i + 2] ?? 0);
    }
    bounds = {
      u: (minU + maxU) * 0.5,
      v: (minV + maxV) * 0.5,
      du: (maxU - minU) * 0.5,
      dv: (maxV - minV) * 0.5,
      height,
    };
    sourceBounds.set(caster.frame, bounds);
  }
  const m = caster.transform,
    a = m[0] ?? 0,
    b = m[1] ?? 0,
    c = m[2] ?? 0,
    d = m[3] ?? 0;
  const x = a * bounds.u + c * bounds.v + (m[4] ?? 0);
  const y = b * bounds.u + d * bounds.v + (m[5] ?? 0);
  const sway =
    caster.wind === undefined
      ? 0
      : (caster.wind < 4 ? MAX_WORLD_WIND : MAX_SMALL_WORLD_WIND) *
        Math.max(
          Math.abs(1 - bounds.v + bounds.dv),
          Math.abs(1 - bounds.v - bounds.dv),
        );
  const dx = Math.abs(a) * bounds.du + Math.abs(c) * bounds.dv + sway;
  const dy = Math.abs(b) * bounds.du + Math.abs(d) * bounds.dv;
  const reach = Math.max(0, caster.height * bounds.height - minReceiverHeight);
  const shiftX = -sunX * reach,
    shiftY = -(1 + sunY * 0.5) * reach;
  return (
    x + dx + Math.max(0, shiftX) + padding >= viewport.minX &&
    x - dx + Math.min(0, shiftX) - padding <= viewport.maxX &&
    y + dy + Math.max(0, shiftY) + padding >= viewport.minY &&
    y - dy + Math.min(0, shiftY) - padding <= viewport.maxY
  );
};

/** Omit discarded collars and exact duplicate faces; retain the source frame for receivers and local occlusion. */
const shadowIndices = (frame: MaterialFrame) => {
  const vertices = new Map<string, number>(),
    canonical = new Uint16Array(frame.vertices.length / 6),
    triangles = new Set<string>(),
    indices: number[] = [];
  for (let i = 0; i < canonical.length; i++) {
    const key = frame.vertices.subarray(i * 6, i * 6 + 6).join(",");
    let id = vertices.get(key);
    if (id === undefined) {
      id = vertices.size;
      vertices.set(key, id);
    }
    canonical[i] = id;
  }
  for (let i = 0; i < frame.indices.length; i += 3) {
    const face = Array.from(frame.indices.subarray(i, i + 3));
    if (face.every((index) => (frame.vertices[index * 6 + 5] ?? 0) > 1.5)) continue;
    const key = face
      .map((index) => canonical[index])
      .sort((a, b) => (a ?? 0) - (b ?? 0))
      .join(":");
    if (triangles.has(key)) continue;
    triangles.add(key);
    indices.push(...face);
  }
  return indices.length === frame.indices.length
    ? frame.indices
    : new Uint16Array(indices);
};

/** Wind changes depth each frame without changing foliage's instanced geometry. */
const depthLayer = (caster: SunCaster): 0 | 1 =>
  caster.dynamic || caster.wind !== undefined ? 1 : 0;

const dot = (a: number[], b: number[]) =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const sunVertex = (instanced: boolean) => `precision highp float;
attribute vec3 aPosition; attribute vec2 aUV; attribute float aCutout;
varying vec2 vUV; varying float vDepth; varying float vCutout;
${instanced ? "attribute vec4 aObject; attribute vec4 aObjectY;" : "uniform vec4 uObject; uniform vec4 uObjectY;"}
uniform vec3 uSun; uniform vec3 uSunRight; uniform vec3 uSunUp; uniform vec3 uSunOrigin;
uniform vec4 uSunBounds; uniform vec4 uSunDepth;
${worldWindShader}
void main() {
  vec4 object = ${instanced ? "aObject" : "uObject"};
  vec4 objectY = ${instanced ? "aObjectY" : "uObjectY"};
  float height = aPosition.z * object.w;
  vec3 p = vec3(dot(aPosition.xy, object.xy) + object.z,
    2.0 * (dot(aPosition.xy, objectY.xy) + objectY.z - height), height) - uSunOrigin;
  p.x += worldWind(objectY.w) * (1.0 - aPosition.y);
  vec2 uv = (vec2(dot(p, uSunRight), dot(p, uSunUp)) - uSunBounds.xy) / uSunBounds.zw;
  vDepth = (dot(p, uSun) - uSunDepth.x) / uSunDepth.y; vUV = aUV; vCutout = aCutout;
  gl_Position = vec4(uv * 2.0 - 1.0, 1.0 - vDepth * 2.0, 1.0);
}`;
const sunFragment = `precision highp float;
precision highp sampler2D; // Keep material coverage on the same side of the receiver's alpha cutoff.
varying vec2 vUV; varying float vDepth; varying float vCutout; uniform sampler2D uMaterial;
void main() { if (vCutout > 1.5) discard;
  if (vCutout > 0.5 && texture2D(uMaterial, vUV).a < 0.5) discard;
  float d = clamp(vDepth, 0.0, 1.0) * 255.0;
  gl_FragColor = vec4(floor(d) / 255.0, fract(d), 0.0, 1.0);
}`;

export type SunCaster = {
  id: string;
  key: string;
  frame: MaterialFrame;
  material: WorldMaterial;
  transform: Float32Array;
  height: number;
  dynamic: boolean;
  wind?: number;
};
type CachedGeometry = { geometry: Geometry; references: number; bytes: number };

type SunEntry = {
  mesh: Mesh<Geometry, Shader>;
  shader: Shader;
  key: string;
  frame: MaterialFrame;
  layer: 0 | 1;
  dynamic: boolean;
  instances?: Buffer;
};
