import {
  Color,
  Container,
  Rectangle,
  type RenderLayer,
  Sprite,
  Texture,
} from "pixi.js";
import { sampleAnimationClip } from "@/libs/rendering/animation";
import { createSceneAssets } from "@/libs/rendering/assets";
import { worldLighting } from "@/libs/rendering/color";
import { acquireMaskedTexture } from "@/libs/rendering/maskedTextures";
import { createClipTextures } from "@/libs/rendering/primitives/animation";
import {
  createLpcCharacter,
  type LpcCharacter,
} from "@/libs/rendering/primitives/character";
import {
  acquireSoftShadowTexture,
  createPixelLightTexture,
} from "@/libs/rendering/primitives/shadow";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import type {
  WorldMotionDirection,
  WorldSpriteDescription,
} from "@/libs/rendering/sectorSprites";
import {
  boundsOverlap,
  type WorldBounds,
  worldSpriteBounds,
} from "@/libs/rendering/visibility";
import type { WorldShadows } from "@/libs/rendering/worldShadows";
import {
  MAX_SMALL_WORLD_WIND,
  MAX_WORLD_WIND,
  sampleWorldWind,
  type WorldWind,
  worldWindGroup,
} from "@/libs/rendering/worldWind";

/**
 * Owns upright artwork in a Y-up world. Resolves after all art attempts, counting
 * skipped images in missing; cancellation rejects. Viewport bounds/padding are
 * container-local world units, and animate's zoom is renderer pixels per world unit.
 */
export const createWorldSprites = async (
  game: GameRenderer,
  descriptions: WorldSpriteDescription[],
  worldShadows?: WorldShadows,
) => {
  const assets = createSceneAssets();
  const masked: ReturnType<typeof acquireMaskedTexture>[] = [];
  const views: Texture[] = [];
  const materials: ReturnType<WorldShadows["register"]>[] = [];
  let lightTexture: Texture | null = null,
    shadowLease: ReturnType<typeof acquireSoftShadowTexture> | null = null;
  const container = new Container();
  const entries: {
    sprite: Sprite | LpcCharacter["sprite"];
    character?: LpcCharacter;
    shadow?: Sprite;
    light?: Sprite;
    description: WorldSpriteDescription;
    bounds: WorldBounds;
    motion: Awaited<ReturnType<typeof createClipTextures>> | null;
    idleTexture: Texture;
    motionFrame: number;
  }[] = [];
  let disposed = false;
  let lastBrightness = 1;
  let motionElapsed = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const release of materials) release();
    materials.length = 0;
    if (!container.destroyed)
      container.destroy({ children: true, texture: false, textureSource: false });
    for (const view of views) view.destroy(false);
    for (const entry of entries) entry.motion?.dispose();
    lightTexture?.destroy(true);
    shadowLease?.release();
    views.length = 0;
    assets.dispose();
    for (const lease of masked) lease.release();
    masked.length = 0;
  };
  game.own(dispose);
  const settled = await Promise.allSettled(
    descriptions.map(async (description) => {
      if (description.character) {
        try {
          const character = await createLpcCharacter(
            game,
            description.character,
            description.characterMode,
          );
          return { texture: null, description, character, motion: null };
        } catch (error) {
          if (game.signal.aborted) throw error;
          console.warn("Character artwork unavailable; showing portrait", error);
        }
      }
      const lease = description.mask
        ? acquireMaskedTexture(
            description.image,
            description.mask,
            description.rendition,
          )
        : null;
      if (lease) masked.push(lease);
      const texture = await (lease?.resource ??
        assets.texture(
          description.image,
          description.rendition,
          description.nearest ? "nearest" : "linear",
        ));
      const motion = description.motion
        ? await createClipTextures(
            game,
            {
              ...description.motion.clip,
              frameCount:
                description.motion.clip.frameCount +
                Math.max(...Object.values(description.motion.frameOffsets)),
            },
            { size: description.motion.size, nearest: true },
          ).catch((error: unknown) => {
            if (
              game.signal.aborted ||
              game.isDisposed() ||
              (error instanceof Error && error.name === "AbortError")
            )
              throw error;
            // The original pose and identity remain usable if optional movement art cannot load.
            console.warn("Movement artwork unavailable", error);
            return null;
          })
        : null;
      if (disposed || game.signal.aborted) {
        motion?.dispose();
        return null;
      }
      return { texture, description, motion, character: undefined };
    }),
  );
  let shadowTexture: Texture | null = null;
  if (
    !disposed &&
    !game.signal.aborted &&
    descriptions.some(
      (description) =>
        description.shadow && !(worldShadows && description.shadowCaster),
    )
  ) {
    shadowLease = acquireSoftShadowTexture();
    try {
      shadowTexture = await shadowLease.resource;
    } catch (error) {
      dispose();
      throw error;
    }
  }
  if (disposed || game.signal.aborted) {
    dispose();
    throw new DOMException("Scenery cancelled", "AbortError");
  }
  let missing = 0;
  let shadows: Container | null = null,
    lights: Container | null = null;
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      const { description } = result.value;
      const { character } = result.value;
      let { texture } = result.value;
      if (texture && description.frame) {
        const { x, y, width, height } = description.frame;
        texture = new Texture({
          source: texture.source,
          frame: new Rectangle(x, y, width, height),
        });
        views.push(texture);
      }
      const sprite = character?.sprite ?? new Sprite(texture ?? undefined);
      sprite.label = description.id;
      if (sprite instanceof Sprite)
        sprite.anchor.set(description.anchorX ?? 0.5, description.anchorY ?? 0.5);
      sprite.position.set(description.x, description.y);
      if (character) sprite.scale.set(description.size, -description.size);
      else {
        sprite.width =
          description.width ??
          (description.preserveAspect
            ? (description.size * (texture?.width ?? 1)) / (texture?.height ?? 1)
            : description.size);
        sprite.height = description.size;
        sprite.scale.y *= -1;
        if (description.shearY) {
          sprite.skew.y = Math.atan(description.shearY);
          sprite.scale.x /= Math.cos(sprite.skew.y);
        }
      }
      sprite.tint = description.tint ?? 0xffffff;
      sprite.alpha = description.opacity ?? 1;
      sprite.rotation = description.rotation ?? 0;
      const footY = character
        ? description.y - (description.size * 28) / 64
        : (description.entrance?.y ??
          description.y - description.size * (1 - (description.anchorY ?? 0.5)));
      let shadow: Sprite | undefined;
      if (worldShadows && character) {
        for (const [index, layer] of character.layers.entries())
          materials.push(
            worldShadows.register(
              layer.sprite,
              {
                ...description,
                id: `${description.id}:${index}`,
                image: layer.image,
                shadowCaster: "character",
              },
              [],
              character.sprite,
            ),
          );
      } else if (
        worldShadows &&
        sprite instanceof Sprite &&
        !description.mask &&
        !description.unlit
      )
        materials.push(
          worldShadows.register(
            sprite,
            result.value.motion ? description : { ...description, motion: undefined },
            result.value.motion?.views,
          ),
        );
      if (
        description.shadow &&
        shadowTexture &&
        !(worldShadows && description.shadowCaster)
      ) {
        if (!shadows) {
          shadows = new Container();
          shadows.label = "scenery-shadows";
          container.addChildAt(shadows, 0);
        }
        // A shared contact mask grounds the footprint without projecting roof or canopy pixels onto the terrain.
        shadow = new Sprite(shadowTexture);
        shadow.anchor.set(0.5);
        shadow.position.set(description.x, footY);
        shadow.width = sprite.width * 0.7;
        shadow.height = Math.min(
          description.size * description.shadow,
          shadow.width * 0.3,
        );
        shadow.alpha = 0.6;
        shadow.label = `shadow:${description.id}`;
        shadows.addChild(shadow);
      }
      let light: Sprite | undefined;
      if (description.light && !worldShadows) {
        if (!lights) {
          lights = new Container();
          lights.label = "scenery-lights";
          lights.alpha = 0;
          container.addChildAt(lights, shadows ? 1 : 0);
        }
        lightTexture ??= createPixelLightTexture();
        light = new Sprite(lightTexture);
        light.anchor.set(0.5);
        light.position.set(description.x, footY);
        light.width = description.size * description.light;
        light.height = light.width * 0.5;
        light.tint = 0xffaa52;
        light.blendMode = "add";
        lights.addChild(light);
      }
      entries.push({
        sprite,
        character,
        shadow,
        light,
        description,
        motion: result.value.motion,
        idleTexture: texture ?? Texture.EMPTY,
        motionFrame: -1,
        bounds: worldSpriteBounds({
          x: sprite.x,
          y: sprite.y,
          width:
            description.width ??
            (description.preserveAspect
              ? (description.size * (texture?.width ?? 1)) / (texture?.height ?? 1)
              : description.size),
          height: description.size,
          anchorX: description.anchorX ?? 0.5,
          anchorY: description.anchorY ?? 0.5,
          rotation: sprite.rotation,
          shearY: description.shearY,
        }),
      });
      container.addChild(sprite);
    } else if (result.status === "rejected") {
      missing++;
      console.warn("Map scenery unavailable", result.reason);
    }
  }
  await Promise.all(materials.map((material) => material.ready));
  if (disposed || game.signal.aborted) {
    dispose();
    throw new DOMException("Scenery cancelled", "AbortError");
  }
  const wind = entries
    .filter(
      (entry) =>
        entry.description.wind !== null && entry.description.wind !== undefined,
    )
    .flatMap((entry) => {
      if (!(entry.sprite instanceof Sprite)) return [];
      const sprite = entry.sprite;
      entry.sprite.updateLocalTransform();
      return [
        {
          ...entry,
          sprite,
          scaleY: entry.sprite.scale.y,
          offset: Number.NaN,
          rotation: entry.sprite.rotation,
          columnX: entry.sprite.localTransform.c,
          columnY: entry.sprite.localTransform.d,
        },
      ];
    });
  const animated = entries.flatMap((entry) =>
    entry.motion && entry.sprite instanceof Sprite
      ? [{ ...entry, sprite: entry.sprite }]
      : [],
  );
  let viewport: (WorldBounds & { padding: number }) | null = null;
  return {
    container,
    entries,
    missing,
    dispose,
    /** Render layers preserve scope ownership/transforms while keeping identity pins outside physical lighting. */
    attachLayers: (
      layers: { ground?: RenderLayer; world: RenderLayer; ui: RenderLayer },
      offsetY = 0,
    ) => {
      for (const entry of entries) {
        // Contact masks and emitter pools must draw after terrain, before upright artwork.
        if (entry.shadow) layers.ground?.attach(entry.shadow);
        if (entry.light) layers.ground?.attach(entry.light);
        entry.sprite.zIndex = -(entry.description.groundY + offsetY);
        (entry.description.mask || entry.description.unlit
          ? layers.ui
          : layers.world
        ).attach(entry.sprite);
      }
      layers.world.sortRenderLayerChildren();
      layers.ui.sortRenderLayerChildren();
    },
    setLighting: (brightness: number) => {
      if (worldShadows) return;
      brightness = Math.round(brightness * 256) / 256;
      if (lastBrightness === brightness) return;
      lastBrightness = brightness;
      const { night, tint } = worldLighting(brightness);
      if (lights) lights.alpha = night * 0.3;
      for (const entry of entries) {
        if (!entry.description.mask && !entry.description.unlit)
          entry.sprite.tint = Color.shared
            .setValue(entry.description.tint ?? 0xffffff)
            .multiply(tint)
            .toNumber();
        if (entry.shadow) entry.shadow.alpha = 0.6 * (1 - night * 0.75);
      }
    },
    setViewport: (bounds: WorldBounds, padding: number) => {
      if (
        viewport &&
        viewport.minX === bounds.minX &&
        viewport.minY === bounds.minY &&
        viewport.maxX === bounds.maxX &&
        viewport.maxY === bounds.maxY &&
        viewport.padding === padding
      )
        return;
      viewport = { ...bounds, padding };
      // Offscreen sprites keep their decoded lease but do not upload or join a GPU batch.
      for (const entry of entries) {
        entry.sprite.renderable = boundsOverlap(
          entry.bounds,
          bounds,
          padding +
            (entry.description.wind == null
              ? 0
              : entry.description.small
                ? MAX_SMALL_WORLD_WIND
                : MAX_WORLD_WIND),
        );
        if (entry.shadow) entry.shadow.renderable = entry.sprite.renderable;
        if (entry.light) entry.light.renderable = entry.sprite.renderable;
      }
    },
    animate: (
      frame: GameFrame,
      zoom: number,
      movement: WorldMotionDirection | null = null,
      sampledWind?: WorldWind,
    ) => {
      const direction = frame.reducedMotion ? null : movement;
      motionElapsed = direction ? motionElapsed + frame.delta * 1000 : 0;
      for (const entry of animated) {
        const motion = entry.description.motion;
        const index =
          direction && motion && entry.motion
            ? motion.frameOffsets[direction] +
              sampleAnimationClip(motion.clip, motionElapsed).index
            : -1;
        if (index === entry.motionFrame) continue;
        entry.motionFrame = index;
        const texture =
          index < 0
            ? entry.idleTexture
            : (entry.motion?.views[index] ?? entry.idleTexture);
        const size =
          index < 0 ? entry.description.size : (motion?.size ?? entry.description.size);
        const facing = Math.sign(entry.sprite.scale.x);
        entry.sprite.texture = texture;
        entry.sprite.width = (size * texture.width) / texture.height;
        entry.sprite.height = size;
        entry.sprite.scale.x = Math.abs(entry.sprite.scale.x) * facing;
      }
      if (!wind.length) return;
      const breeze = sampledWind ?? sampleWorldWind(frame, zoom);
      for (const entry of wind) {
        const { sprite, description } = entry;
        if (!sprite.renderable) continue;
        const group = worldWindGroup(description.wind ?? 0, description.small);
        const dx = (group < 4 ? breeze.large[group] : breeze.small[group - 4]) ?? 0;
        if (entry.offset === dx) continue;
        entry.offset = dx;
        const shift = 1 - (description.anchorY ?? 0.5);
        // Counter-scale the skew so the root row and physical height remain fixed.
        const columnX = entry.columnX - dx / sprite.texture.orig.height;
        const scaleY = Math.sign(entry.scaleY) * Math.hypot(columnX, entry.columnY);
        sprite.scale.y = scaleY;
        sprite.skew.x =
          entry.rotation - Math.atan2(-columnX / scaleY, entry.columnY / scaleY);
        sprite.position.set(description.x + dx * shift, description.y);
      }
    },
  };
};
