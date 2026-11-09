import type { Grid } from "honeycomb-grid";
import {
  Color,
  Container,
  Rectangle,
  type RenderLayer,
  Sprite,
  Texture,
} from "pixi.js";
import type { AvatarFacing } from "@/drizzle/constants";
import { type TerrainHex, tileKeysNear } from "@/libs/hexgrid";
import { sampleAnimationClip } from "@/libs/rendering/animation";
import {
  createSceneAssets,
  readTexturePixels,
  stabilizeNearestTexture,
  textureGroundContact,
  textureOpaqueFrame,
} from "@/libs/rendering/assets";
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
import {
  createWindSprite,
  isWindSprite,
  updateWindSprites,
} from "@/libs/rendering/primitives/windSprites";
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
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";
import { WORLD_DETAIL } from "@/libs/rendering/worldDetail";
import {
  acquireCasterMaterials,
  acquireCasterSurfaces,
  type WorldShadows,
} from "@/libs/rendering/worldShadows";
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
 * staticScenery retains fixed child poses for lighting; layer/owner movement and wind
 * remain live. Call worldShadows.invalidate() after other direct child pose changes.
 */
export const createWorldSprites = async (
  game: GameRenderer,
  descriptions: WorldSpriteDescription[],
  worldShadows?: WorldShadows,
  staticScenery = false,
) => {
  const simpleLighting =
    worldShadows?.kind === "projected" || worldShadows?.kind === "baked";
  /** Only fixed, non-character scenery can share a retained lighting owner. */
  const sceneryOwner = (description: WorldSpriteDescription) =>
    staticScenery && !description.motion && description.shadowCaster !== "character"
      ? container
      : undefined;
  /** Lighting owns replacement state; asynchronous bakes retain grounding while pending or failed. */
  const contactReplacement = (description: WorldSpriteDescription, source?: Sprite) =>
    worldShadows?.kind === "baked"
      ? worldShadows.contactShadowReplacement(
          source,
          description,
          sceneryOwner(description),
        )
      : "preserve";
  /** Keep ambient grounding unless the lighting provider supplies its replacement footprint. */
  const needsContactShadow = (description: WorldSpriteDescription, source?: Sprite) =>
    description.shadow &&
    !(
      description.shadowCaster &&
      (worldShadows?.kind === "physical" ||
        contactReplacement(description, source) === "replace")
    );
  const assets = createSceneAssets();
  const masked: ReturnType<typeof acquireMaskedTexture>[] = [];
  const views: Texture[] = [];
  const materials: ReturnType<WorldShadows["register"]>[] = [];
  // Physical shadow materials and frame topology download beside their artwork;
  // registration reuses these leases.
  const preparedMaterials =
    worldShadows?.kind === "physical"
      ? descriptions
          .filter(
            (description) =>
              !description.character && !description.mask && !description.unlit,
          )
          .flatMap((description) => {
            const surfaces = acquireCasterSurfaces(description);
            const leases = acquireCasterMaterials(description);
            return surfaces ? [...leases, surfaces] : leases;
          })
      : [];
  const releasePreparedMaterials = () => {
    for (const lease of preparedMaterials.splice(0)) lease.release();
  };
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
    groundY: number;
    motion: Awaited<ReturnType<typeof createClipTextures>> | null;
    loop: Awaited<ReturnType<typeof createClipTextures>> | null;
    walk: Awaited<ReturnType<typeof createClipTextures>> | null;
    idleTexture: Texture;
    motionFrame: number;
  }[] = [];
  const pendingContacts = new Set<(typeof entries)[number]>();
  let disposed = false;
  let lastBrightness = Number.NaN;
  let lastDayNight: boolean | undefined;
  let motionElapsed = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const release of materials) release();
    materials.length = 0;
    releasePreparedMaterials();
    pendingContacts.clear();
    if (!container.destroyed)
      container.destroy({ children: true, texture: false, textureSource: false });
    for (const view of views) view.destroy(false);
    for (const entry of entries) {
      entry.motion?.dispose();
      entry.loop?.dispose();
      entry.walk?.dispose();
    }
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
          return {
            texture: null,
            description,
            character,
            motion: null,
            loop: null,
            walk: null,
          };
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
      const [loop, walk] = await Promise.all(
        [description.loop, description.walk].map((sheet) =>
          sheet
            ? createClipTextures(game, sheet.clip, {
                size: description.size,
                rendition: 0,
              }).catch((error: unknown) => {
                if (
                  game.signal.aborted ||
                  game.isDisposed() ||
                  (error instanceof Error && error.name === "AbortError")
                )
                  throw error;
                // The still image remains if an optional loop cannot load.
                console.warn("Looping artwork unavailable", error);
                return null;
              })
            : null,
        ),
      );
      if (disposed || game.signal.aborted) {
        motion?.dispose();
        loop?.dispose();
        walk?.dispose();
        return null;
      }
      return {
        texture,
        description,
        motion,
        loop: loop ?? null,
        walk: walk ?? null,
        character: undefined,
      };
    }),
  );
  let shadowTexture: Texture | null = null;
  if (
    !disposed &&
    !game.signal.aborted &&
    descriptions.some((description) => needsContactShadow(description))
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
  const sourcePixels = new Map<Texture["source"], Uint8Array>();
  /** Decode each shared sheet once per scenery load; only occupied metadata survives this batch. */
  const readSourcePixels = (texture: Texture) => {
    let pixels = sourcePixels.get(texture.source);
    if (!pixels) {
      pixels = readTexturePixels(
        texture,
        texture.source.pixelWidth,
        texture.source.pixelHeight,
      );
      sourcePixels.set(texture.source, pixels);
    }
    return pixels;
  };
  /** Resolve occupied source-pixel bounds with the shared batch readback. */
  const opaqueFrame = (texture: Texture) =>
    textureOpaqueFrame(texture, () => readSourcePixels(texture));
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      const { description } = result.value;
      const { character } = result.value;
      let { texture } = result.value;
      if (texture && description.frame) {
        const { x, y, width, height } = description.frame;
        texture = stabilizeNearestTexture(
          new Texture({
            source: texture.source,
            frame: new Rectangle(x, y, width, height),
          }),
        );
        views.push(texture);
      }
      const sprite =
        character?.sprite ??
        (description.mask || description.unlit || description.motion
          ? new Sprite(texture ?? Texture.EMPTY)
          : createWindSprite(
              game.renderer,
              texture ?? Texture.EMPTY,
              description.wind == null
                ? 0
                : worldWindGroup(description.wind, description.small) + 1,
            ));
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
      const isCharacterCutout =
        sprite instanceof Sprite &&
        texture &&
        description.shadowCaster === "character" &&
        !description.worldMaterial &&
        !worldAssetSource(description.image) &&
        !description.character &&
        !description.mask &&
        !description.motion &&
        !description.loop &&
        !description.walk;
      if (isCharacterCutout && texture) {
        const frame = opaqueFrame(texture);
        const scale = sprite.scale.clone();
        // A view removes transparent margins; the adjusted anchor preserves every pixel and its mirrored pose.
        sprite.anchor.set(
          (sprite.anchor.x * texture.orig.width -
            (texture.trim?.x ?? 0) -
            (frame.x - texture.frame.x)) /
            frame.width,
          (sprite.anchor.y * texture.orig.height -
            (texture.trim?.y ?? 0) -
            (frame.y - texture.frame.y)) /
            frame.height,
        );
        texture = stabilizeNearestTexture(
          new Texture({ source: texture.source, frame }),
        );
        views.push(texture);
        sprite.texture = texture;
        sprite.scale.copyFrom(scale);
      }
      sprite.updateLocalTransform();
      const characterContact =
        description.shadowCaster === "character" && sprite instanceof Sprite
          ? textureGroundContact(sprite.texture, () => readSourcePixels(sprite.texture))
          : undefined;
      const characterFoot =
        characterContact && sprite instanceof Sprite
          ? sprite.localTransform.apply({
              x: characterContact.x - sprite.anchor.x * sprite.texture.orig.width,
              y: characterContact.y - sprite.anchor.y * sprite.texture.orig.height,
            })
          : undefined;
      const footY = character
        ? description.y - (description.size * 28) / 64
        : (characterFoot?.y ??
          description.entrance?.y ??
          description.y - description.size * (1 - (description.anchorY ?? 0.5)));
      let groundY = character ? footY : (characterFoot?.y ?? description.groundY);
      if (
        sprite instanceof Sprite &&
        !description.small &&
        !description.mask &&
        !description.unlit &&
        !description.entrance &&
        (description.kind === "decoration" || description.kind === "garden")
      ) {
        const contact = textureGroundContact(sprite.texture, () =>
          readSourcePixels(sprite.texture),
        );
        // Transparent padding belongs to the artwork, not to its painter-order ground contact.
        const foot = sprite.localTransform.apply({
          x: contact.x - sprite.anchor.x * sprite.texture.orig.width,
          y: contact.y - sprite.anchor.y * sprite.texture.orig.height,
        });
        groundY = foot.y;
      }
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
            undefined,
            sceneryOwner(description),
          ),
        );
      if (
        needsContactShadow(
          description,
          sprite instanceof Sprite ? sprite : undefined,
        ) &&
        description.shadow &&
        shadowTexture
      ) {
        if (!shadows) {
          shadows = new Container({
            isRenderGroup: staticScenery && simpleLighting,
          });
          shadows.label = "scenery-shadows";
          container.addChildAt(shadows, 0);
        }
        // A shared contact mask grounds the footprint without projecting roof or canopy pixels onto the terrain.
        shadow = new Sprite(shadowTexture);
        shadow.anchor.set(0.5);
        shadow.position.set(characterFoot?.x ?? description.x, footY);
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
      if (
        description.light &&
        worldShadows?.kind !== "physical" &&
        worldShadows?.kind !== "baked"
      ) {
        if (!lights) {
          lights = new Container({
            isRenderGroup: staticScenery && simpleLighting,
          });
          lights.label = "scenery-lights";
          lights.alpha = 0;
          container.addChildAt(lights, shadows ? 1 : 0);
        }
        lightTexture ??= createPixelLightTexture();
        light = new Sprite(lightTexture);
        light.anchor.set(0.5);
        light.position.set(characterFoot?.x ?? description.x, footY);
        light.width =
          description.size *
          description.light *
          (simpleLighting && description.shadowCaster === "building" ? 2.2 : 1);
        light.height = light.width * 0.5;
        light.tint = 0xffaa52;
        light.blendMode = "add";
        lights.addChild(light);
      }
      const entry: (typeof entries)[number] = {
        sprite,
        character,
        shadow,
        light,
        description,
        groundY,
        motion: result.value.motion,
        loop: result.value.loop,
        walk: result.value.walk,
        idleTexture: texture ?? Texture.EMPTY,
        motionFrame: -1,
        bounds: worldSpriteBounds({
          x: sprite.x,
          y: sprite.y,
          width: isCharacterCutout
            ? sprite.width
            : (description.width ??
              (description.preserveAspect
                ? (description.size * (texture?.width ?? 1)) / (texture?.height ?? 1)
                : description.size)),
          height: isCharacterCutout ? sprite.height : description.size,
          anchorX: isCharacterCutout ? sprite.anchor.x : (description.anchorX ?? 0.5),
          anchorY: isCharacterCutout ? sprite.anchor.y : (description.anchorY ?? 0.5),
          rotation: sprite.rotation,
          shearY: description.shearY,
        }),
      };
      entries.push(entry);
      if (
        shadow &&
        contactReplacement(
          description,
          sprite instanceof Sprite ? sprite : undefined,
        ) === "pending"
      )
        pendingContacts.add(entry);
      container.addChild(sprite);
    } else if (result.status === "rejected") {
      missing++;
      console.warn("Map scenery unavailable", result.reason);
    }
  }
  sourcePixels.clear();
  await Promise.all(materials.map((material) => material.ready));
  releasePreparedMaterials();
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
      if (!(entry.sprite instanceof Sprite) || isWindSprite(entry.sprite)) return [];
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
  const hasGpuWind = entries.some(
    (entry) => isWindSprite(entry.sprite) && entry.description.wind != null,
  );
  const groundDetails = entries.filter((entry) => entry.description.small);
  let flatGround: Container | null = null;
  let detailZoom = Number.NaN;
  let viewport:
    | (WorldBounds & { padding: number; width: number; height: number })
    | null = null;
  let attached: {
    ground?: RenderLayer;
    world: RenderLayer;
    ui: RenderLayer;
    offsetY: number;
  } | null = null;
  const softEffects = entries.filter((entry) => entry.shadow || entry.light);
  const looping = entries.flatMap((entry) =>
    (entry.loop || entry.walk) && entry.sprite instanceof Sprite
      ? [{ ...entry, sprite: entry.sprite }]
      : [],
  );
  return {
    container,
    entries,
    missing,
    dispose,
    /**
     * Plays each looping artwork from the scene clock: the walk while its owner moves, else the
     * idle loop, mirrored when the heading differs from the way the art faces. Reduced motion
     * holds the still image.
     */
    animateLoops: (
      frame: GameFrame,
      pose: { moving: boolean; heading?: AvatarFacing } = { moving: false },
    ) => {
      if (disposed) return;
      const still =
        frame.reducedMotion || game.visualEffects?.spriteAnimations === false;
      for (const entry of looping) {
        const walking = pose.moving && !!entry.walk;
        const views = walking ? entry.walk : entry.loop;
        const sheet = walking ? entry.description.walk : entry.description.loop;
        const texture =
          still || !views || !sheet
            ? entry.idleTexture
            : (views.views[
                sampleAnimationClip(sheet.clip, frame.now + (sheet.offsetMs ?? 0)).index
              ] ?? entry.idleTexture);
        const facing =
          !still && sheet && pose.heading
            ? sheet.facing === pose.heading
              ? 1
              : -1
            : Math.sign(entry.sprite.scale.x) || 1;
        if (
          entry.sprite.texture === texture &&
          Math.sign(entry.sprite.scale.x) === facing
        )
          continue;
        entry.sprite.texture = texture;
        entry.sprite.width = (entry.description.size * texture.width) / texture.height;
        entry.sprite.height = entry.description.size;
        entry.sprite.scale.x = Math.abs(entry.sprite.scale.x) * facing;
        entry.sprite.scale.y = -Math.abs(entry.sprite.scale.y);
      }
    },
    /** Offscreen sectors retain their art while leaving the renderer's per-frame group traversal. */
    setRenderable: (value: boolean) => {
      if (container.renderable === value) return;
      container.renderable = value;
      if (!staticScenery || !simpleLighting) return;
      for (const group of [shadows, lights, flatGround]) {
        if (!group) continue;
        if (value) group.enableRenderGroup();
        else group.disableRenderGroup();
      }
    },
    /** Moving effects retain their actor transforms while sharing the terrain's draw order. */
    attachGroundEffects: (layer: RenderLayer) => {
      if (shadows) {
        shadows.zIndex = 0;
        layer.attach(shadows);
      }
      if (lights) {
        lights.zIndex = 1;
        layer.attach(lights);
      }
      layer.sortRenderLayerChildren();
    },
    /** Render layers preserve scope ownership/transforms while keeping identity pins outside physical lighting. */
    attachLayers: (
      layers: { ground?: RenderLayer; world: RenderLayer; ui: RenderLayer },
      offsetY = 0,
    ) => {
      if (
        attached &&
        attached.ground === layers.ground &&
        attached.world === layers.world &&
        attached.ui === layers.ui &&
        attached.offsetY === offsetY
      )
        return;
      attached = { ...layers, offsetY };
      worldShadows?.invalidate();
      if (flatGround) flatGround.zIndex = -offsetY;
      const retainGround = staticScenery && simpleLighting;
      if (retainGround) {
        if (shadows) layers.ground?.attach(shadows);
        if (lights) layers.ground?.attach(lights);
      }
      for (const entry of entries) {
        // Contact masks and emitter pools must draw after terrain, before upright artwork.
        if (!retainGround) {
          if (entry.shadow) layers.ground?.attach(entry.shadow);
          if (entry.light) layers.ground?.attach(entry.light);
        }
        entry.sprite.zIndex = -(entry.groundY + offsetY);
        // Ground cover stays below actors at every zoom; screen size controls only its fade.
        if (
          entry.description.small &&
          layers.ground &&
          !entry.description.mask &&
          !entry.description.unlit
        ) {
          flatGround ??= new Container({
            isRenderGroup: container.renderable,
            label: "flat-ground",
          });
          if (!flatGround.parent) container.addChild(flatGround);
          flatGround.zIndex = -offsetY;
          if (entry.sprite.parent !== flatGround) flatGround.addChild(entry.sprite);
          layers.ground.attach(flatGround);
          continue;
        }
        if (flatGround && entry.sprite.parent === flatGround)
          container.addChild(entry.sprite);
        (entry.description.mask || entry.description.unlit
          ? layers.ui
          : layers.world
        ).attach(entry.sprite);
      }
      layers.world.sortRenderLayerChildren();
      layers.ui.sortRenderLayerChildren();
    },
    setLighting: (brightness: number) => {
      if (worldShadows?.kind === "physical") return;
      if (shadows) shadows.visible = game.visualEffects?.shadows !== false;
      if (lights)
        lights.visible = lights.alpha > 0 && game.visualEffects?.localLights !== false;
      brightness = Math.round(brightness * 256) / 256;
      const dayNight = game.visualEffects?.dayNight !== false;
      if (lastBrightness === brightness && lastDayNight === dayNight) return;
      lastBrightness = brightness;
      lastDayNight = dayNight;
      const { night, tint } = worldLighting(brightness);
      // Lamps follow the clock even when ambient colors and contact-shadow fading are disabled.
      const contactNight = dayNight ? night : 0;
      if (lights) {
        lights.alpha = night * (simpleLighting ? 0.8 : 0.3);
        // Zero-opacity emitters must leave the draw list, including actor scopes without scenery animation.
        lights.visible = lights.alpha > 0 && game.visualEffects?.localLights !== false;
      }
      if (simpleLighting) {
        // Shared ambient uniforms keep fades independent of the number of loaded sprites.
        if (shadows) shadows.alpha = 1 - contactNight * 0.75;
        return;
      }
      for (const entry of entries) {
        if (!entry.description.mask && !entry.description.unlit)
          entry.sprite.tint = Color.shared
            .setValue(entry.description.tint ?? 0xffffff)
            .multiply(dayNight ? tint : 0xffffff)
            .toNumber();
        if (entry.shadow) entry.shadow.alpha = 0.6 * (1 - contactNight * 0.75);
      }
    },
    setViewport: (bounds: WorldBounds, padding: number) => {
      const width = bounds.maxX - bounds.minX,
        height = bounds.maxY - bounds.minY;
      // A spare world-space cell prevents camera motion from repeatedly changing batch membership.
      if (
        viewport &&
        viewport.padding === padding &&
        Math.abs(viewport.width - width) <= Math.max(1, width) * 1e-6 &&
        Math.abs(viewport.height - height) <= Math.max(1, height) * 1e-6 &&
        bounds.minX >= viewport.minX &&
        bounds.maxX <= viewport.maxX &&
        bounds.minY >= viewport.minY &&
        bounds.maxY <= viewport.maxY
      )
        return;
      const next = {
        minX: (Math.floor(bounds.minX / 64) - 1) * 64,
        minY: (Math.floor(bounds.minY / 64) - 1) * 64,
        maxX: (Math.ceil(bounds.maxX / 64) + 1) * 64,
        maxY: (Math.ceil(bounds.maxY / 64) + 1) * 64,
        width,
        height,
        padding,
      };
      viewport = next;
      let membershipChanged = false;
      // Offscreen sprites keep their decoded lease but do not upload or join a GPU batch.
      for (const entry of entries) {
        entry.sprite.renderable =
          boundsOverlap(
            entry.bounds,
            viewport,
            padding +
              (entry.description.wind == null
                ? 0
                : entry.description.small
                  ? MAX_SMALL_WORLD_WIND
                  : MAX_WORLD_WIND),
          ) && entry.sprite.alpha > 0;
        if (entry.shadow) entry.shadow.renderable = entry.sprite.renderable;
        if (entry.light) entry.light.renderable = entry.sprite.renderable;
        if (
          attached &&
          !entry.description.mask &&
          !entry.description.unlit &&
          entry.sprite.parent === container
        ) {
          const layer = attached.world;
          if (entry.sprite.renderable && entry.sprite.parentRenderLayer !== layer) {
            layer.attach(entry.sprite);
            membershipChanged = true;
          } else if (
            !entry.sprite.renderable &&
            entry.sprite.parentRenderLayer === layer
          ) {
            layer.detach(entry.sprite);
            membershipChanged = true;
          }
        }
      }
      if (membershipChanged) {
        attached?.world.sortRenderLayerChildren();
      }
    },
    animate: (
      frame: GameFrame,
      zoom: number,
      movement: WorldMotionDirection | null = null,
      sampledWind?: WorldWind,
    ) => {
      if (disposed) return;
      // Bakes settle after art is visible; retire replacement contacts once without frame-time decoding.
      if (pendingContacts.size) {
        for (const entry of pendingContacts) {
          const replacement = contactReplacement(
            entry.description,
            entry.sprite instanceof Sprite ? entry.sprite : undefined,
          );
          if (replacement === "pending") continue;
          pendingContacts.delete(entry);
          if (replacement === "replace") {
            entry.shadow?.destroy();
            entry.shadow = undefined;
          }
        }
        if (shadows && !shadows.children.length) {
          shadows.destroy();
          shadows = null;
        }
      }
      if (staticScenery && simpleLighting) {
        // Fixed scenery owns retained effect groups; viewport culling already mirrors each child's renderability.
        if (shadows) shadows.visible = game.visualEffects?.shadows !== false;
        if (lights)
          lights.visible =
            lights.alpha > 0 && game.visualEffects?.localLights !== false;
      } else {
        for (const entry of softEffects) {
          if (entry.shadow)
            entry.shadow.visible =
              entry.sprite.visible && game.visualEffects?.shadows !== false;
          if (entry.light)
            entry.light.visible =
              entry.sprite.visible &&
              (lights?.alpha ?? 0) > 0 &&
              game.visualEffects?.localLights !== false;
        }
      }
      if (zoom !== detailZoom && groundDetails.length) {
        detailZoom = zoom;
        const [hidden, visible] = WORLD_DETAIL.groundFadePixels;
        for (const entry of groundDetails) {
          const pixels = Math.abs(entry.sprite.height) * zoom;
          const fade =
            visible > hidden
              ? Math.max(0, Math.min(1, (pixels - hidden) / (visible - hidden)))
              : 1;
          entry.sprite.alpha =
            (entry.description.opacity ?? 1) * fade * fade * (3 - 2 * fade);
          entry.sprite.renderable =
            entry.sprite.alpha > 0 &&
            (!viewport ||
              boundsOverlap(
                entry.bounds,
                viewport,
                viewport.padding + MAX_SMALL_WORLD_WIND,
              ));
          if (entry.shadow) entry.shadow.renderable = entry.sprite.renderable;
          if (entry.light) entry.light.renderable = entry.sprite.renderable;
        }
        if (flatGround && !flatGround.children.length) {
          flatGround.destroy();
          flatGround = null;
        }
        flatGround?.sortChildren();
        attached?.ground?.sortRenderLayerChildren();
        attached?.world.sortRenderLayerChildren();
        // Fixed scenery owns retained material poses; a zoom-driven fade changes that snapshot.
        worldShadows?.invalidate();
      }
      const direction =
        frame.reducedMotion || game.visualEffects?.spriteAnimations === false
          ? null
          : movement;
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
      if (!wind.length && !hasGpuWind) return;
      const breeze =
        sampledWind ?? sampleWorldWind(frame, zoom, game.visualEffects?.wind);
      if (hasGpuWind) updateWindSprites(game.renderer, breeze);
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

/** Scenery on or next to `positions` turns translucent so it cannot hide what stands there. */
export const fadeSceneryNearPositions = (
  entries: {
    description: { id: string; small?: boolean };
    sprite: { alpha: number };
  }[],
  grid: Grid<TerrainHex>,
  positions: { col: number; row: number }[],
) => {
  const affected = tileKeysNear(grid, positions);
  for (const entry of entries) {
    if (entry.description.small) continue;
    entry.sprite.alpha = affected.has(entry.description.id.replace("scenery:", ""))
      ? 0.5
      : 1;
  }
};
