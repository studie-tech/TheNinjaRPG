import { Rectangle, type Sprite, Texture } from "pixi.js";
import type { AvatarFacing } from "@/drizzle/constants";
import {
  acquireAnimationTexture,
  clearUnusedAnimationTextures,
} from "@/libs/rendering/animationTextures";
import { stabilizeNearestTexture } from "@/libs/rendering/assets";
import {
  type CharacterAnimation,
  type CharacterAnimations,
  resolveSpriteAnimation,
  type SpriteAnimationEvent,
  spriteAnimationFrame,
} from "@/libs/spriteAnimations";

/** Actor-owned views share a bounded atlas; movement defers action clocks until arrival. */
export const createCharacterAnimation = (
  sprite: Sprite,
  size: number,
  animations: CharacterAnimations,
  options: { maxTextureSize?: number; initialEventId?: string } = {},
) => {
  const original = {
    texture: sprite.texture,
    anchor: sprite.anchor.clone(),
    scale: sprite.scale.clone(),
  };
  let current:
    | {
        animation: CharacterAnimation;
        lease: NonNullable<ReturnType<typeof acquireAnimationTexture>>;
        views: Texture[];
        ready: boolean;
        cellSize: number;
      }
    | undefined;
  let desired: CharacterAnimation | undefined;
  let disposed = false;
  let seen = options.initialEventId;
  let retryAt = 0;
  const events: SpriteAnimationEvent[] = [];
  let actionAt: number | undefined;
  let loopAt = 0;
  let activeKey = "";
  const restore = (facing: AvatarFacing, sourceFacing: AvatarFacing) => {
    sprite.texture = original.texture;
    sprite.anchor.copyFrom(original.anchor);
    sprite.scale.set(
      Math.abs(original.scale.x) * (facing === sourceFacing ? 1 : -1),
      original.scale.y,
    );
  };
  const release = () => {
    if (!current) return;
    for (const texture of current.views) texture.destroy(false);
    current.lease.release();
    current = undefined;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    release();
    events.length = 0;
  };
  return {
    dispose,
    render: (input: {
      now: number;
      moving: boolean;
      facing: AvatarFacing;
      sourceFacing: AvatarFacing;
      event?: SpriteAnimationEvent;
      enabled: boolean;
      reducedMotion: boolean;
      cellSize?: number;
    }) => {
      if (disposed || sprite.destroyed) return;
      if (input.event && input.event.id !== seen) {
        seen = input.event.id;
        if (
          input.enabled &&
          !["idle", "move"].includes(input.event.actionKey) &&
          animations[input.event.actionKey]
        )
          events.push(input.event);
      }
      if (!input.enabled) {
        release();
        events.length = 0;
        actionAt = undefined;
        activeKey = "";
        restore(input.facing, input.sourceFacing);
        clearUnusedAnimationTextures();
        return;
      }
      if (!input.moving && actionAt !== undefined && events[0]) {
        const action = animations[events[0].actionKey];
        if (
          !action ||
          input.now - actionAt >= (action.frameCount * 1000) / action.fps
        ) {
          events.shift();
          actionAt = undefined;
        }
      }
      const event = input.moving ? undefined : events[0];
      const key = input.moving ? "move" : (event?.actionKey ?? "idle");
      desired = resolveSpriteAnimation(animations, key);
      const cellSize = input.cellSize ?? 128;
      if (
        (current?.animation !== desired ||
          (current && current.cellSize !== cellSize)) &&
        input.now >= retryAt
      ) {
        release();
        if (desired) {
          const lease =
            acquireAnimationTexture(desired, cellSize, options.maxTextureSize) ??
            (cellSize === 256
              ? acquireAnimationTexture(desired, 128, options.maxTextureSize)
              : undefined);
          if (!lease) retryAt = input.now + 1000;
          if (lease) {
            const slot = {
              animation: desired,
              lease,
              views: [] as Texture[],
              ready: false,
              cellSize,
            };
            current = slot;
            void lease.resource.then(
              (atlas) => {
                if (disposed || current !== slot) return;
                const width = atlas.width / slot.animation.columns;
                slot.views = Array.from({ length: slot.animation.frameCount }, (_, i) =>
                  stabilizeNearestTexture(
                    new Texture({
                      source: atlas.source,
                      frame: new Rectangle(
                        (i % slot.animation.columns) * width,
                        Math.floor(i / slot.animation.columns) * width,
                        width,
                        width,
                      ),
                    }),
                  ),
                );
                slot.ready = true;
              },
              () => {},
            );
          }
        }
      }
      if (!current?.ready) {
        restore(input.facing, input.sourceFacing);
        return;
      }
      if (activeKey !== key) {
        activeKey = key;
        loopAt = input.now;
      }
      if (event && animations[event.actionKey] === desired && actionAt === undefined)
        actionAt = input.now;
      const looping = !event || animations[event.actionKey] !== desired;
      const elapsed = input.now - (looping ? loopAt : (actionAt ?? input.now));
      const index = input.reducedMotion
        ? 0
        : spriteAnimationFrame(current.animation, elapsed, looping);
      sprite.texture = current.views[index]!;
      sprite.anchor.set(0.5);
      sprite.scale.set(
        (size / sprite.texture.width) *
          (input.facing === current.animation.facing ? 1 : -1),
        -size / sprite.texture.height,
      );
    },
  };
};
