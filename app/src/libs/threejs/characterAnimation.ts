import {
  NearestFilter,
  type Sprite,
  SpriteMaterial,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { AvatarFacing } from "@/drizzle/constants";
import type {
  CharacterAnimation,
  CharacterAnimations,
  SpriteAnimationEvent,
} from "@/libs/spriteAnimations";
import { resolveSpriteAnimation, spriteAnimationFrame } from "@/libs/spriteAnimations";
import {
  acquireAnimationTexture,
  animationTextureKey,
} from "@/libs/threejs/animationTextures";
import { createSpriteMaterial, type loadTexture } from "@/libs/threejs/util";

/**
 * Characters retain their existing Sprite while swapping sheets with different grids.
 * SpriteMixer's ActionSprite fixes its grid at construction; this adapter owns a private
 * map per actor so grid changes and cell mirroring never mutate a shared atlas.
 * Movement has priority over queued one-shots. `now` is the render loop's monotonic
 * millisecond clock; the scene cleanup hook releases only this actor's owned resources.
 */
export const updateCharacterAnimation = (info: {
  sprite: Sprite;
  animations: CharacterAnimations | undefined;
  event: SpriteAnimationEvent | undefined;
  moving: boolean;
  facing: AvatarFacing;
  staticMap: Texture;
  now: number;
  enabled?: boolean;
  cellSize?: number;
  renderer?: WebGLRenderer;
  textureForPath?: typeof loadTexture;
}) => {
  const { sprite, animations, event, moving, facing, staticMap, now } = info;
  let runtime = sprite.userData.characterAnimation as AnimationRuntime | undefined;
  if (info.enabled === false || !animations || Object.keys(animations).length === 0) {
    if (runtime) sprite.userData.disposeCharacterAnimation();
    if (sprite.material.map !== staticMap)
      sprite.material = createSpriteMaterial(staticMap);
    return;
  }
  if (!runtime) {
    // A newly mounted scene starts idle instead of replaying an old persisted action.
    runtime = {
      material: new SpriteMaterial({
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
      }),
      startedAt: now,
      eventId: event?.id,
      events: [],
      sources: new Map(),
    };
    sprite.userData.characterAnimation = runtime;
    const owned = runtime;
    sprite.userData.disposeCharacterAnimation = () => {
      owned.events.length = 0;
      if (owned.material.userData.ownsMap) owned.material.map?.dispose();
      // Hidden actors stay in the scene; disposal alone retains the decoded image.
      owned.material.map = null;
      for (const source of owned.sources.values()) source.release();
      owned.sources.clear();
      owned.material.dispose();
      delete sprite.userData.characterAnimation;
      delete sprite.userData.disposeCharacterAnimation;
    };
  }
  if (event && runtime.eventId !== event.id) {
    runtime.eventId = event.id;
    if (event.actionKey !== "move" && animations[event.actionKey])
      runtime.events.push(event);
  }
  let actionEvent = runtime.events[0];
  let action = actionEvent ? animations[actionEvent.actionKey] : undefined;
  if (
    !moving &&
    runtime.eventStartedAt !== undefined &&
    (!action || now - runtime.eventStartedAt >= (action.frameCount / action.fps) * 1000)
  ) {
    runtime.events.shift();
    runtime.eventStartedAt = undefined;
    actionEvent = runtime.events[0];
    action = actionEvent ? animations[actionEvent.actionKey] : undefined;
  }
  // Travel can outlast several delivered actions. Start each assigned one-shot
  // in order after travel, so a later action or wait cannot erase an unseen cast.
  const actionPlaying =
    action &&
    (runtime.eventStartedAt === undefined ||
      now - runtime.eventStartedAt < (action.frameCount / action.fps) * 1000);
  const key = moving
    ? "move"
    : actionPlaying
      ? (actionEvent?.actionKey ?? "idle")
      : "idle";
  let animation = resolveSpriteAnimation(animations, key);
  const cellSize = info.cellSize ?? 128;
  const needed = new Set<string>();
  const textureForAnimation = (sheet: CharacterAnimation) => {
    const sourceKey = animationTextureKey(sheet, cellSize, info.renderer);
    needed.add(sourceKey);
    let source = runtime.sources.get(sourceKey);
    if (!source) {
      source = info.textureForPath
        ? {
            texture: info.textureForPath(sheet.url, sheet.columns * cellSize),
            release: () => {},
          }
        : acquireAnimationTexture(sheet, cellSize, info.renderer);
      if (source) runtime.sources.set(sourceKey, source);
    }
    return source?.texture;
  };
  // Failed or still-loading action atlases also fall back through idle to the image.
  let source = animation ? textureForAnimation(animation) : undefined;
  if (animation && !source && runtime.sources.size > 0) {
    // The outgoing sheet may prevent an otherwise admissible replacement from fitting.
    // Detach its private map before eviction; use static art if the new sheet is pending.
    if (runtime.material.userData.ownsMap) runtime.material.map?.dispose();
    runtime.material.map = null;
    runtime.material.userData.ownsMap = false;
    runtime.sourceKey = undefined;
    for (const lease of runtime.sources.values()) lease.release();
    runtime.sources.clear();
    source = textureForAnimation(animation);
  }
  if (animation === action && (!source || source.userData.failed)) {
    runtime.events.shift();
    runtime.eventStartedAt = undefined;
  }
  if (!source?.image || source.userData.failed) {
    animation = animations.idle;
    source = animation ? textureForAnimation(animation) : undefined;
  }
  for (const [sourceKey, lease] of runtime.sources) {
    if (needed.has(sourceKey)) continue;
    lease.release();
    runtime.sources.delete(sourceKey);
  }
  if (!animation || !source?.image || source.userData.failed) {
    if (runtime.material.userData.ownsMap) runtime.material.map?.dispose();
    runtime.material.userData.ownsMap = false;
    if (runtime.material.map !== staticMap) {
      runtime.material.map = staticMap;
      runtime.material.needsUpdate = true;
    }
    runtime.animationId = undefined;
    runtime.sourceKey = undefined;
    runtime.stateKey = undefined;
    sprite.material = runtime.material;
    return;
  }
  const sourceKey = animationTextureKey(animation, cellSize, info.renderer);
  if (runtime.sourceKey !== sourceKey) {
    if (runtime.material.userData.ownsMap) runtime.material.map?.dispose();
    const map = source.clone();
    map.generateMipmaps = false;
    map.minFilter = map.magFilter = NearestFilter;
    map.needsUpdate = true;
    runtime.material.map = map;
    runtime.material.userData.ownsMap = true;
    runtime.material.needsUpdate = true;
    runtime.animationId = animation.id;
    runtime.sourceKey = sourceKey;
  }
  // Event identity restarts repeated casts even when they share the same atlas.
  const isActionAnimation = !moving && actionPlaying && animation === action;
  // Network latency must not consume a one-shot's playback before its first frame.
  if (isActionAnimation && runtime.eventStartedAt === undefined)
    runtime.eventStartedAt = now;
  const stateKey = isActionAnimation ? actionEvent?.id : key;
  if (runtime.stateKey !== stateKey) {
    runtime.stateKey = stateKey;
    runtime.startedAt = isActionAnimation ? (runtime.eventStartedAt ?? now) : now;
  }
  const frame = spriteAnimationFrame(
    animation,
    now - runtime.startedAt,
    !isActionAnimation,
  );
  const map = runtime.material.map;
  if (!map) return;
  applySpriteAnimationFrame(map, animation, frame, animation.facing !== facing);
  sprite.material = runtime.material;
};

/** Mirror inside one cell, rather than flipping the entire atlas or its frame order. */
export const applySpriteAnimationFrame = (
  texture: Texture,
  animation: CharacterAnimation,
  frame: number,
  mirrored: boolean,
) => {
  const column = frame % animation.columns;
  const row = Math.floor(frame / animation.columns);
  texture.repeat.set((mirrored ? -1 : 1) / animation.columns, 1 / animation.rows);
  texture.offset.set(
    (column + (mirrored ? 1 : 0)) / animation.columns,
    1 - (row + 1) / animation.rows,
  );
};

/** Actor-owned GPU resources and separate receipt, queued-action and visible-sheet clocks. */
type AnimationRuntime = {
  material: SpriteMaterial;
  animationId?: string;
  sourceKey?: string;
  sources: Map<string, { texture: Texture; release: () => void }>;
  stateKey?: string;
  startedAt: number;
  eventId?: string;
  events: SpriteAnimationEvent[];
  eventStartedAt?: number;
};
