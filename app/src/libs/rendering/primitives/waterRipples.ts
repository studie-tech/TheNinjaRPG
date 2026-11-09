import { BufferImageSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { HEX_ASPECT_RATIO } from "@/drizzle/constants";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";

const SMALLEST_RADIUS = 3;
const LARGEST_RADIUS = 16;
const LIFETIME = 1.7;
const MAX_RINGS = 64;

/**
 * Expanding one-texel rings on the ground plane. Each radius has its own frame in
 * one shared atlas, so the outline keeps a constant pixel width as it grows while
 * frame changes only move texture coordinates. Pooled sprites stay attached and
 * fade to transparent instead of toggling visibility, so the scene graph never
 * changes shape per ring. Rings stay where they were emitted, leaving a wake
 * behind moving walkers; the owner positions the container in the emitters'
 * coordinate space.
 */
export const createWaterRipples = (game: GameRenderer) => {
  const container = new Container();
  container.label = "water-ripples";
  const { source, frames } = createRingAtlas();
  const rings: { sprite: Sprite; age: number; texel: number; frame: number }[] = [];
  const idle: Sprite[] = [];
  const draw = (ring: (typeof rings)[number]) => {
    const progress = Math.min(1, ring.age / LIFETIME);
    const index = Math.min(
      frames.length - 1,
      Math.floor(Math.sqrt(progress) * frames.length),
    );
    const frame = frames[index];
    if (frame && index !== ring.frame) {
      ring.frame = index;
      ring.sprite.texture = frame;
    }
    ring.sprite.alpha = 0.7 * (1 - progress) ** 1.3;
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed) container.destroy({ children: true });
    for (const frame of frames) frame.destroy(false);
    source.destroy();
  };
  game.own(dispose);
  return {
    container,
    dispose,
    /** Starts a ring at a contact point; texel is the world size of one ring pixel. */
    emit: (x: number, y: number, texel: number) => {
      if (disposed) return;
      const recycled = rings.length >= MAX_RINGS ? rings.shift() : undefined;
      const sprite = recycled?.sprite ?? idle.pop() ?? new Sprite();
      sprite.anchor.set(0.5);
      sprite.position.set(x, y);
      sprite.scale.set(texel);
      if (!sprite.parent) container.addChild(sprite);
      const ring = { sprite, age: 0, texel, frame: -1 };
      rings.push(ring);
      draw(ring);
    },
    update: (frame: GameFrame) => {
      for (let index = rings.length - 1; index >= 0; index--) {
        const ring = rings[index];
        if (!ring) continue;
        ring.age += frame.delta;
        if (ring.age < LIFETIME) {
          draw(ring);
          continue;
        }
        ring.sprite.alpha = 0;
        idle.push(ring.sprite);
        rings.splice(index, 1);
      }
    },
    get active() {
      return rings.length;
    },
  };
};

/** Seconds between rings around a standing or walking character. */
export const RIPPLE_INTERVAL = { idle: 1.05, moving: 0.3 } as const;

/** Approximate texel distance to a ground-plane ellipse outline, even where it runs flat. */
const ellipseDistance = (dx: number, dy: number, radius: number) => {
  const a = radius,
    b = radius * HEX_ASPECT_RATIO;
  const level = (dx * dx) / (a * a) + (dy * dy) / (b * b) - 1;
  const gradient = Math.hypot((2 * dx) / (a * a), (2 * dy) / (b * b)) || 1;
  return Math.abs(level) / gradient;
};

/** Every ring radius stacked in one atlas: a crisp ground-plane ellipse with a softer inner echo, drawn in white for tinting by lighting. */
const createRingAtlas = () => {
  const sizes = Array.from(
    { length: LARGEST_RADIUS - SMALLEST_RADIUS + 1 },
    (_, index) => {
      const radius = SMALLEST_RADIUS + index;
      return {
        radius,
        width: radius * 2 + 3,
        height: Math.ceil(radius * HEX_ASPECT_RATIO) * 2 + 3,
      };
    },
  );
  const width = Math.max(...sizes.map((size) => size.width));
  const height = sizes.reduce((sum, size) => sum + size.height, 0);
  const pixels = new Uint8Array(width * height * 4);
  const rectangles: Rectangle[] = [];
  let top = 0;
  for (const { radius, width: frameWidth, height: frameHeight } of sizes) {
    const cx = (frameWidth - 1) / 2,
      cy = (frameHeight - 1) / 2;
    for (let y = 0; y < frameHeight; y++)
      for (let x = 0; x < frameWidth; x++) {
        const alpha =
          ellipseDistance(x - cx, y - cy, radius) < 0.55
            ? 255
            : radius > 6 && ellipseDistance(x - cx, y - cy, radius * 0.7) < 0.45
              ? 110
              : 0;
        const index = ((top + y) * width + x) * 4;
        pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
        pixels[index + 3] = alpha;
      }
    rectangles.push(new Rectangle(0, top, frameWidth, frameHeight));
    top += frameHeight;
  }
  const source = new BufferImageSource({
    resource: pixels,
    width,
    height,
    format: "rgba8unorm",
    scaleMode: "nearest",
  });
  return { source, frames: rectangles.map((frame) => new Texture({ source, frame })) };
};
