import {
  Color,
  Container,
  Filter,
  GlProgram,
  Matrix,
  Rectangle,
  Sprite,
  Texture,
  UniformGroup,
} from "pixi.js";
import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import { textureGroundContact } from "@/libs/rendering/assets";
import {
  type BakedShadowAtlas,
  bakedShadowBounds,
  bakedShadowKey,
  bakedShadowTransform,
  hasBakedShadow,
  loadBakedShadowAtlas,
  placeBakedShadow,
} from "@/libs/rendering/bakedShadowAtlas";
import { worldLighting } from "@/libs/rendering/color";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import type { HexTerrainData } from "@/libs/rendering/terrainData";
import type { VillageLightField } from "@/libs/rendering/villageLightField";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";
import type { worldSunlight } from "@/libs/rendering/worldSunlight";
import type { WorldWind } from "@/libs/rendering/worldWind";

/** Ground silhouettes share artwork textures; one color pass supplies ambient light to the lit world. */
export const createProjectedWorldLighting = (
  game: GameRenderer,
  world: Container,
  options: { restoreWarmWindows?: boolean; groundOrder?: number } = {},
) => {
  const container = new Container({ label: "projected-world" });
  const ground = new Container({ label: "projected-shadows", isRenderGroup: true });
  ground.sortableChildren = true;
  container.addChild(ground);
  const night = new UniformGroup(
    {
      uNight: { value: 0, type: "f32" },
      uLocalNight: { value: 0, type: "f32" },
      uAmbient: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
      uWarmSource: { value: Number(options.restoreWarmWindows ?? false), type: "f32" },
    },
    { isStatic: true },
  );
  const warmMapping = new UniformGroup(
    {
      uWarmU: { value: new Float32Array(3), type: "vec3<f32>" },
      uWarmV: { value: new Float32Array(3), type: "vec3<f32>" },
    },
    { isStatic: true },
  );
  const previousWarmWorld = new Matrix(),
    warmInverse = new Matrix();
  let warmMappingDirty = true;
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex, fragment }),
    resolution: game.renderer.resolution ?? 1,
    resources: { night, warmMapping, uWarmMap: Texture.EMPTY.source },
  });
  filter.enabled = false;
  container.filters = [filter];
  const records = new Set<ProjectedShadowRecord>();
  const loadedAtlases = new Map<string, BakedShadowAtlas>();
  const atlases = createLeaseCache<BakedShadowAtlas>({
    load: async (key) => {
      const atlas = await loadBakedShadowAtlas(
        game,
        key,
        options.restoreWarmWindows ?? false,
      );
      loadedAtlases.set(key, atlas);
      return atlas;
    },
    unload: async (key) => {
      const atlas = loadedAtlases.get(key);
      if (!atlas) return;
      atlas.destroy();
      atlas.releaseTextures();
      loadedAtlases.delete(key);
    },
    bytes: (atlas) => atlas.bytes,
    idleBudget: 4 * 1024 * 1024,
  });
  let dirty = true;
  let previousDirection = "";
  let viewport: WorldBounds | null = null;
  let order = 0;
  let warmField: VillageLightField | null = null;
  game.own(() => {
    for (const record of records) record.releaseAtlas?.();
    records.clear();
    for (const atlas of loadedAtlases.values()) atlas.destroy();
    loadedAtlases.clear();
    filter.destroy();
  });
  return {
    kind: "projected" as const,
    container,
    acquireAtlas: atlases.acquire,
    /** Borrow the caller-leased field; screen-to-world sampling is refreshed on the next lighting update. */
    setWarmField: (field: VillageLightField | null) => {
      warmField = field;
      warmMappingDirty = true;
      filter.resources.uWarmMap = (field?.texture ?? Texture.EMPTY).source;
    },
    invalidate: () => {
      dirty = true;
    },
    registerTerrain: (_parent: Container, _data: HexTerrainData) => () => {},
    /** Return instance cleanup plus a ready promise; shared atlas pages remain governed by their leases. */
    register: (
      source: Sprite,
      description: WorldSpriteDescription,
      _textures: readonly Texture[] = [],
      _character?: Container,
      _owner?: Container,
    ) => {
      if (
        !description.shadowCaster ||
        description.shadowCaster === "character" ||
        description.small
      ) {
        return Object.assign(() => {}, { ready: Promise.resolve() });
      }
      const upright =
        description.shadowCaster === "canopy" ||
        description.shadowCaster === "conifer" ||
        description.shadowCaster === "column";
      const baked = hasBakedShadow(source.texture, description);
      const record: ProjectedShadowRecord = {
        source,
        contact:
          upright && !baked
            ? textureGroundContact(source.texture)
            : {
                x: source.anchor.x * source.texture.orig.width,
                y: source.texture.orig.height,
              },
        shadows: [],
        atlas: null,
        description,
        transform: new Matrix(),
        bounds: null,
        poseDirty: true,
        order: order++,
      };
      records.add(record);
      dirty = true;
      const lease = baked
        ? atlases.acquire(bakedShadowKey(source.texture, description))
        : null;
      record.releaseAtlas = lease?.release;
      const ready = lease
        ? lease.resource
            .then((atlas) => {
              if (!records.has(record)) return;
              record.atlas = atlas;
              for (const shadow of record.shadows) shadow.destroy();
              record.shadows = [];
              dirty = true;
              game.invalidate();
            })
            .catch((error) => {
              if (!records.has(record) || game.isDisposed()) return;
              if (upright) record.contact = textureGroundContact(source.texture);
              for (const shadow of record.shadows) shadow.destroy();
              record.shadows = [];
              dirty = true;
              game.invalidate();
              console.warn(
                "Authored shadow unavailable; retaining the artwork fallback",
                error,
              );
            })
        : Promise.resolve();
      return Object.assign(
        () => {
          records.delete(record);
          for (const shadow of record.shadows) if (!shadow.destroyed) shadow.destroy();
          record.shadows = [];
          record.releaseAtlas?.();
          dirty = true;
        },
        { ready },
      );
    },
    update: (
      light: ReturnType<typeof worldSunlight>,
      view: WorldBounds,
      _breeze?: WorldWind,
    ) => {
      const shade = game.visualEffects.dayNight ? 1 - light.day : 0;
      // Village lamps reach useful ground brightness during dusk, before full night arrives.
      const localNight = game.visualEffects.localLights
        ? 1 - (options.restoreWarmWindows ? light.day * light.day : light.day)
        : 0;
      if (warmField) {
        world.updateLocalTransform();
        const next = world.localTransform;
        if (warmMappingDirty || !previousWarmWorld.equals(next)) {
          warmMappingDirty = false;
          previousWarmWorld.copyFrom(next);
          const m = warmInverse.copyFrom(next).invert(),
            b = warmField.bounds;
          const w = b.maxX - b.minX,
            h = b.maxY - b.minY;
          warmMapping.uniforms.uWarmU.set([m.a / w, m.c / w, (m.tx - b.minX) / w]);
          warmMapping.uniforms.uWarmV.set([m.b / h, m.d / h, (m.ty - b.minY) / h]);
          warmMapping.update();
        }
      }
      filter.enabled = shade > 0 || localNight > 0;
      if (
        night.uniforms.uNight !== shade ||
        night.uniforms.uLocalNight !== localNight
      ) {
        night.uniforms.uNight = shade;
        night.uniforms.uLocalNight = localNight;
        const brightness =
          WORLD_DAY_BRIGHTNESS -
          shade * (WORLD_DAY_BRIGHTNESS - WORLD_NIGHT_BRIGHTNESS);
        night.uniforms.uAmbient.set(
          new Color(worldLighting(brightness).tint).toArray().slice(0, 3),
        );
        night.update();
      }
      container.filterArea = new Rectangle(
        view.minX,
        view.minY,
        view.maxX - view.minX,
        view.maxY - view.minY,
      );
      ground.visible =
        game.visualEffects.sunlight && game.visualEffects.shadows && light.day > 0;
      // Terrain draws first; silhouettes stay below scenery, routes and actor contact markers.
      const groundOrder = options.groundOrder ?? 1;
      if (
        container.children[groundOrder] !== ground &&
        container.children.length > groundOrder
      )
        container.setChildIndex(ground, groundOrder);
      ground.alpha = light.day;
      // Hidden sunlight defers pose work and silhouette allocation until visible.
      if (!ground.visible) return;
      const direction = `${light.x}:${light.y}:${light.z}`;
      if (dirty || direction !== previousDirection) {
        const posesChanged = dirty;
        dirty = false;
        previousDirection = direction;
        viewport = null;
        const parents = new Map<Container, Matrix>();
        const origin = (parent: Container | null): Matrix => {
          if (!parent || parent === world) return new Matrix();
          const previous = parents.get(parent);
          if (previous) return previous;
          parent.updateLocalTransform();
          const matrix = origin(parent.parent).clone().append(parent.localTransform);
          parents.set(parent, matrix);
          return matrix;
        };
        for (const record of records) {
          const { source, description } = record;
          if (source.destroyed || !source.parent) {
            record.bounds = null;
            continue;
          }
          // Compass changes replace masks; stationary authored footprints retain their geometry and bounds.
          if (record.atlas && !posesChanged && record.bounds) continue;
          const parent = origin(source.parent);
          if (record.atlas) {
            source.updateLocalTransform();
            record.transform.copyFrom(
              bakedShadowTransform(
                record.atlas,
                source,
                parent.clone().append(source.localTransform),
              ),
            );
            record.bounds = bakedShadowBounds(record.atlas, record.transform);
            record.poseDirty = true;
            continue;
          }
          const height = Math.abs(source.height);
          const foot = description.entrance?.y ?? description.groundY;
          source.updateLocalTransform();
          const local = source.localTransform;
          const upright =
            description.shadowCaster === "canopy" ||
            description.shadowCaster === "conifer" ||
            description.shadowCaster === "column";
          const x = record.contact.x - source.anchor.x * source.texture.orig.width,
            y = record.contact.y - source.anchor.y * source.texture.orig.height;
          const base = parent.apply(
            upright
              ? {
                  x: local.tx + local.a * x + local.c * y,
                  y: local.ty + local.b * x + local.d * y,
                }
              : { x: description.x, y: foot },
          );
          const rise = height / Math.max(1, source.texture.orig.height);
          // Clamp grazing sun silhouettes to keep very long copies from covering distant scenery.
          const slopeX =
            Math.max(-1.4, Math.min(1.4, light.x / Math.max(0.3, light.z))) * rise;
          const slopeY = Math.min(-0.12, light.y / (2 * Math.max(0.3, light.z))) * rise;
          if (upright) {
            const length = Math.hypot(light.x, light.y) || 1;
            const ux = -light.x / length,
              uy = -light.y / length;
            const reach =
              Math.max(0.3, Math.min(1.6, length / Math.max(0.3, light.z))) * rise;
            record.transform.set(
              -uy * source.scale.x,
              (ux * source.scale.x) / 2,
              -ux * reach,
              (-uy * reach) / 2,
              base.x,
              base.y,
            );
          } else
            record.transform.set(source.scale.x, 0, slopeX, slopeY, base.x, base.y);
          record.bounds = projectedBounds(source, record.transform, record.contact);
          record.poseDirty = true;
        }
      }
      if (
        viewport &&
        view.minX >= viewport.minX &&
        view.maxX <= viewport.maxX &&
        view.minY >= viewport.minY &&
        view.maxY <= viewport.maxY
      )
        return;
      // A spare cell retains nearby silhouettes while smooth camera motion stays inside the working set.
      viewport = {
        minX: (Math.floor(view.minX / 64) - 1) * 64,
        maxX: (Math.ceil(view.maxX / 64) + 1) * 64,
        minY: (Math.floor(view.minY / 64) - 1) * 64,
        maxY: (Math.ceil(view.maxY / 64) + 1) * 64,
      };
      for (const record of records) {
        if (!record.bounds || !boundsOverlap(record.bounds, viewport)) {
          for (const shadow of record.shadows) if (!shadow.destroyed) shadow.destroy();
          record.shadows = [];
          continue;
        }
        if (!record.shadows.length) {
          const shadow = new Sprite(record.source.texture);
          shadow.anchor.set(
            record.contact.x / record.source.texture.orig.width,
            record.contact.y / record.source.texture.orig.height,
          );
          shadow.tint = 0x202932;
          shadow.alpha = 0.22;
          shadow.zIndex = record.order;
          shadow.label = `scenery-shadow:${record.description.id}`;
          ground.addChild(shadow);
          record.shadows.push(shadow);
          record.poseDirty = true;
        }
        if (record.atlas) {
          placeBakedShadow(
            record.shadows[0],
            record.atlas,
            record.transform,
            light.x,
            light.y,
            record.description.shadowCaster === "canopy" ||
              record.description.shadowCaster === "conifer"
              ? 0.3
              : 0.22,
          );
          record.poseDirty = false;
        } else if (record.poseDirty) {
          record.shadows[0]?.setFromMatrix(record.transform);
          record.poseDirty = false;
        }
      }
      ground.sortChildren();
    },
  };
};

/** The full untrimmed rectangle conservatively includes every projected artwork pixel. */
const projectedBounds = (
  source: Sprite,
  matrix: Matrix,
  contact: { x: number; y: number },
): WorldBounds => {
  const left = -contact.x;
  const right = source.texture.orig.width - contact.x;
  const top = -contact.y;
  const bottom = source.texture.orig.height - contact.y;
  return {
    minX:
      matrix.tx +
      Math.min(matrix.a * left, matrix.a * right) +
      Math.min(matrix.c * top, matrix.c * bottom),
    maxX:
      matrix.tx +
      Math.max(matrix.a * left, matrix.a * right) +
      Math.max(matrix.c * top, matrix.c * bottom),
    minY:
      matrix.ty +
      Math.min(matrix.b * left, matrix.b * right) +
      Math.min(matrix.d * top, matrix.d * bottom),
    maxY:
      matrix.ty +
      Math.max(matrix.b * left, matrix.b * right) +
      Math.max(matrix.d * top, matrix.d * bottom),
  };
};

// One color pass supplies moonlight; warm pixels retain the painted windows' illumination.
const vertex = `precision highp float;
attribute vec2 aPosition;
varying vec2 vTextureCoord;
varying vec2 vScreenPosition;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  vScreenPosition = p;
  gl_Position = vec4(p.x * 2.0 / uOutputTexture.x - 1.0,
    p.y * 2.0 * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`;
const fragment = `precision mediump float;
varying vec2 vTextureCoord;
varying vec2 vScreenPosition;
uniform sampler2D uTexture;
uniform sampler2D uWarmMap;
uniform vec3 uWarmU;
uniform vec3 uWarmV;
uniform float uNight;
uniform float uLocalNight;
uniform vec3 uAmbient;
uniform float uWarmSource;
void main() {
  vec4 source = texture2D(uTexture, vTextureCoord);
  vec3 base = source.rgb / max(source.a, 0.0001);
  vec3 color = base * uAmbient;
  vec3 emission = color;
  float warm = smoothstep(0.18, 0.5, emission.r - emission.b) * smoothstep(0.1, 0.4, emission.g - emission.b) * smoothstep(0.02, 0.18, emission.r - emission.g);
  vec3 moon = color * vec3(0.62, 0.68, 0.76);
  vec3 lit = mix(color, moon, uNight) + warm * uLocalNight * (1.0 - uWarmSource) * (min(vec3(1.0), color * 1.6) - moon);
  if (uWarmSource > 0.5 && uLocalNight > 0.0) {
    vec3 screenPoint = vec3(vScreenPosition, 1.0);
    vec2 warmUV = vec2(dot(uWarmU, screenPoint), dot(uWarmV, screenPoint));
    float inside = step(0.0, warmUV.x) * step(warmUV.x, 1.0) * step(0.0, warmUV.y) * step(warmUV.y, 1.0);
    vec4 pool = texture2D(uWarmMap, warmUV) * inside;
    vec3 field = pool.rgb;
    // Authored fixture positions gate recovery through the shared ambient pass; red paint stays shaded.
    float glow = pool.a * smoothstep(0.82, 0.98, base.r) * smoothstep(0.52, 0.74, base.g) * smoothstep(0.12, 0.32, base.r - base.b);
    lit = mix(lit, max(lit, base), glow * uLocalNight);
    lit += base * field * uLocalNight;
  }
  gl_FragColor = vec4(min(vec3(1.0), lit) * source.a, source.a);
}`;

/** Shared lighting interface; the renderer scope owns cleanup and callers own warm-field leases. */
export type ProjectedWorldLighting = ReturnType<typeof createProjectedWorldLighting>;

type ProjectedShadowRecord = {
  source: Sprite;
  contact: { x: number; y: number };
  shadows: Sprite[];
  atlas: BakedShadowAtlas | null;
  releaseAtlas?: () => void;
  description: WorldSpriteDescription;
  transform: Matrix;
  bounds: WorldBounds | null;
  poseDirty: boolean;
  order: number;
};
