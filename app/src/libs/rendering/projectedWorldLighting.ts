import {
  Color,
  Container,
  Filter,
  GlProgram,
  Matrix,
  Rectangle,
  Sprite,
  type Texture,
  UniformGroup,
} from "pixi.js";
import { WORLD_DAY_BRIGHTNESS, WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import { worldLighting } from "@/libs/rendering/color";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import type { HexTerrainData } from "@/libs/rendering/terrainData";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";
import type { worldSunlight } from "@/libs/rendering/worldSunlight";
import type { WorldWind } from "@/libs/rendering/worldWind";

/** Ground silhouettes share artwork textures; one color pass supplies ambient light to the lit world. */
export const createProjectedWorldLighting = (game: GameRenderer, world: Container) => {
  const container = new Container({ label: "projected-world" });
  const ground = new Container({ label: "projected-shadows", isRenderGroup: true });
  ground.sortableChildren = true;
  container.addChild(ground);
  const night = new UniformGroup(
    {
      uNight: { value: 0, type: "f32" },
      uAmbient: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
    },
    { isStatic: true },
  );
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex, fragment }),
    resolution: game.renderer.resolution ?? 1,
    resources: { night },
  });
  filter.enabled = false;
  container.filters = [filter];
  const records = new Set<ProjectedShadowRecord>();
  let dirty = true;
  let previousDirection = "";
  let viewport: WorldBounds | null = null;
  let order = 0;
  game.own(() => {
    records.clear();
    filter.destroy();
  });
  return {
    kind: "projected" as const,
    container,
    invalidate: () => {
      dirty = true;
    },
    registerTerrain: (_parent: Container, _data: HexTerrainData) => () => {},
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
      const record: ProjectedShadowRecord = {
        source,
        shadow: null,
        description,
        transform: new Matrix(),
        bounds: null,
        poseDirty: true,
        order: order++,
      };
      records.add(record);
      dirty = true;
      return Object.assign(
        () => {
          records.delete(record);
          if (record.shadow && !record.shadow.destroyed) record.shadow.destroy();
          record.shadow = null;
          dirty = true;
        },
        { ready: Promise.resolve() },
      );
    },
    update: (
      light: ReturnType<typeof worldSunlight>,
      view: WorldBounds,
      _breeze?: WorldWind,
    ) => {
      const shade = game.visualEffects.lighting ? 1 - light.day : 0;
      filter.enabled = shade > 0;
      if (night.uniforms.uNight !== shade) {
        night.uniforms.uNight = shade;
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
        game.visualEffects.lighting && game.visualEffects.shadows && light.day > 0;
      // Terrain draws first; silhouettes stay below scenery, routes and actor contact markers.
      if (container.children[1] !== ground && container.children.length > 1)
        container.setChildIndex(ground, 1);
      ground.alpha = light.day;
      // Hidden sunlight defers pose work and silhouette allocation until visible.
      if (!ground.visible) return;
      const direction = `${light.x}:${light.y}:${light.z}`;
      if (dirty || direction !== previousDirection) {
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
          const parent = origin(source.parent);
          const height = Math.abs(source.height);
          const foot =
            description.entrance?.y ??
            description.y - height * (1 - (description.anchorY ?? 0.5));
          const base = parent.apply({ x: description.x, y: foot });
          const rise = height / Math.max(1, source.texture.orig.height);
          // Clamp grazing sun silhouettes to keep very long copies from covering distant scenery.
          const slopeX =
            Math.max(-1.4, Math.min(1.4, light.x / Math.max(0.3, light.z))) * rise;
          const slopeY = Math.min(-0.12, light.y / (2 * Math.max(0.3, light.z))) * rise;
          record.transform.set(source.scale.x, 0, slopeX, slopeY, base.x, base.y);
          record.bounds = projectedBounds(source, record.transform);
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
          if (record.shadow && !record.shadow.destroyed) record.shadow.destroy();
          record.shadow = null;
          continue;
        }
        if (!record.shadow) {
          const shadow = new Sprite(record.source.texture);
          shadow.anchor.set(record.source.anchor.x, 1);
          shadow.tint = 0x202932;
          shadow.alpha = 0.22;
          shadow.zIndex = record.order;
          ground.addChild(shadow);
          record.shadow = shadow;
          record.poseDirty = true;
        }
        if (record.poseDirty) {
          record.shadow.setFromMatrix(record.transform);
          record.poseDirty = false;
        }
      }
      ground.sortChildren();
    },
  };
};

/** The full untrimmed rectangle conservatively includes every projected artwork pixel. */
const projectedBounds = (source: Sprite, matrix: Matrix): WorldBounds => {
  const left = -source.anchor.x * source.texture.orig.width;
  const right = (1 - source.anchor.x) * source.texture.orig.width;
  const top = -source.texture.orig.height;
  return {
    minX:
      matrix.tx +
      Math.min(matrix.a * left, matrix.a * right) +
      Math.min(matrix.c * top, 0),
    maxX:
      matrix.tx +
      Math.max(matrix.a * left, matrix.a * right) +
      Math.max(matrix.c * top, 0),
    minY:
      matrix.ty +
      Math.min(matrix.b * left, matrix.b * right) +
      Math.min(matrix.d * top, 0),
    maxY:
      matrix.ty +
      Math.max(matrix.b * left, matrix.b * right) +
      Math.max(matrix.d * top, 0),
  };
};

// One color pass supplies moonlight; warm pixels retain the painted windows' illumination.
const vertex = `precision highp float;
attribute vec2 aPosition;
varying vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  gl_Position = vec4(p.x * 2.0 / uOutputTexture.x - 1.0,
    p.y * 2.0 * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z, 0.0, 1.0);
  vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`;
const fragment = `precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform float uNight;
uniform vec3 uAmbient;
void main() {
  vec4 source = texture2D(uTexture, vTextureCoord);
  vec3 color = source.rgb / max(source.a, 0.0001) * uAmbient;
  float warm = smoothstep(0.18, 0.5, color.r - color.b) * smoothstep(0.1, 0.4, color.g - color.b) * smoothstep(0.02, 0.18, color.r - color.g);
  vec3 moon = color * vec3(0.62, 0.68, 0.76);
  gl_FragColor = vec4(mix(color, mix(moon, min(vec3(1.0), color * 1.6), warm), uNight) * source.a, source.a);
}`;

export type ProjectedWorldLighting = ReturnType<typeof createProjectedWorldLighting>;

type ProjectedShadowRecord = {
  source: Sprite;
  shadow: Sprite | null;
  description: WorldSpriteDescription;
  transform: Matrix;
  bounds: WorldBounds | null;
  poseDirty: boolean;
  order: number;
};
