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

/** Retained scenery and actor depth maps follow their own sun, pose and wind changes. */
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
  const wind = new UniformGroup({
    uWind: { value: new Float32Array(4), type: "vec4<f32>" },
    uWindSmall: { value: new Float32Array(4), type: "vec4<f32>" },
  });
  const uniforms = new UniformGroup({
    uSun: { value: new Float32Array([0, -0.5, 0.866]), type: "vec3<f32>" },
    uSunRight: { value: new Float32Array([1, 0, 0]), type: "vec3<f32>" },
    uSunUp: { value: new Float32Array([0, 0.866, 0.5]), type: "vec3<f32>" },
    uSunOrigin: { value: new Float32Array(3), type: "vec3<f32>" },
    uSunBounds: { value: new Float32Array([-1, -1, 2, 2]), type: "vec4<f32>" },
    uSunDepth: { value: new Float32Array([-1, 2, 64 / 510, 1024]), type: "vec4<f32>" },
  });
  const geometries = new Map<MaterialFrame, CachedGeometry>();
  const idleGeometries = new Map<MaterialFrame, CachedGeometry>();
  const idleBudget = 4 * 1024 * 1024;
  let idleBytes = 0;
  const acquireGeometry = (frame: MaterialFrame) => {
    let cached = geometries.get(frame);
    if (!cached) {
      const buffer = new Buffer({ data: frame.vertices, usage: BufferUsage.VERTEX });
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer, format: "float32x3", stride: 24, offset: 0 },
          aUV: { buffer, format: "float32x2", stride: 24, offset: 12 },
          aCutout: { buffer, format: "float32", stride: 24, offset: 20 },
        },
        indexBuffer: frame.indices,
      });
      cached = {
        geometry,
        references: 0,
        bytes: frame.vertices.byteLength + frame.indices.byteLength,
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
  return {
    staticTexture,
    dynamicTexture,
    uniforms,
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
        for (const caster of casters) {
          if (caster.wind === undefined) continue;
          if (caster.dynamic) dynamicDirty = true;
          else staticDirty = true;
        }
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
      const reach = Math.min(
        384,
        Math.max(64, (maxHeight * horizontal) / Math.max(0.2, sun[2] ?? 1)),
      );
      const minX = Math.floor((viewport.minX - reach) / 64) * 64,
        maxX = Math.ceil((viewport.maxX + reach) / 64) * 64;
      const minY = Math.floor((viewport.minY - reach * 0.5) / 64) * 64,
        maxY = Math.ceil((viewport.maxY + reach * 0.5) / 64) * 64;
      const resolution = game.renderer.width > 900 ? 1536 : 768;
      if (staticTexture.width !== resolution) {
        staticTexture.resize(resolution, resolution);
        dynamicTexture.resize(resolution, resolution);
        staticDirty = dynamicDirty = true;
      }
      const viewKey = `${minX}:${minY}:${maxX}:${maxY}:${maxHeight}:${x}:${y}:${z}:${resolution}`;
      if (viewKey !== cachedView) {
        cachedView = viewKey;
        staticDirty = dynamicDirty = true;
        const origin = [(minX + maxX) / 2, minY + maxY, 0];
        const bounds = [Infinity, Infinity, -Infinity, -Infinity, Infinity, -Infinity];
        for (const px of [minX, maxX])
          for (const py of [2 * minY - 2 * maxHeight, 2 * maxY])
            for (const pz of [0, maxHeight]) {
              const p = [px - (origin[0] ?? 0), py - (origin[1] ?? 0), pz];
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
        if (!shadowReachesViewport(caster, viewport, x, y, minReceiverHeight, padding))
          continue;
        const instanced = canInstance && !caster.dynamic;
        let frameId = frameIds.get(caster.frame);
        if (frameId === undefined) {
          frameId = ++nextFrameId;
          frameIds.set(caster.frame, frameId);
        }
        // Animated actors retain their mesh across frame swaps; repeated scenery shares one draw.
        const id = instanced
          ? `batch:${frameId}:${caster.material.texture.source.uid}`
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
        let entry = entries.get(id);
        if (entry && entry.frame !== caster.frame) {
          entry.mesh.geometry = acquireGeometry(caster.frame);
          releaseGeometry(entry.frame);
          entry.frame = caster.frame;
          entry.shader.resources.uMaterial = caster.material.texture.source;
          entry.key = "";
        }
        if (!entry) {
          const base = acquireGeometry(caster.frame);
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
          layers[caster.dynamic ? 1 : 0]?.addChild(mesh);
          entry = {
            mesh,
            shader,
            key: "",
            frame: caster.frame,
            dynamic: caster.dynamic,
            instances,
          };
          entries.set(id, entry);
        }
        if (entry.dynamic !== caster.dynamic) {
          entry.dynamic = caster.dynamic;
          layers[caster.dynamic ? 1 : 0]?.addChild(entry.mesh);
          staticDirty = dynamicDirty = true;
        }
        const key = batch.casters
          .map((value) => `${value.id}:${value.key}:${value.wind ?? -1}`)
          .join(";");
        if (entry.key !== key) {
          if (entry.dynamic) dynamicDirty = true;
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
        if (!batches.has(id)) {
          if (entry.dynamic) dynamicDirty = true;
          else staticDirty = true;
          releaseEntry(entry);
          entries.delete(id);
        }
      trimGeometries();
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
    },
    invalidate: () => {
      staticDirty = dynamicDirty = true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) releaseEntry(entry);
      for (const layer of layers) layer.destroy({ children: true });
      for (const { geometry } of geometries.values()) geometry.destroy(true);
      entries.clear();
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
  dynamic: boolean;
  instances?: Buffer;
};
