import type { Texture } from "pixi.js";
import {
  acquireAnimationTexture,
  animationFrameViews,
} from "@/libs/rendering/animationTextures";
import { readTextureFramePixels } from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { CharacterAnimation, CharacterAnimations } from "@/libs/spriteAnimations";

/** How long a character's sheets outlast its last actor, so a lull keeps them. */
const ROSTER_ART_GRACE_MS = 20_000;
/** How often characters on the field ask again for sheets the atlas budget refused. */
const ROSTER_ART_RETRY_MS = 1_000;
/** Alpha above which a pixel counts as drawn when finding a frame's feet. */
const FOOT_ALPHA = 48;
/** Longest side, in pixels, a frame is sampled at to find its feet. */
const FOOT_SAMPLE_PX = 64;

/** A frame whose feet are unknown stands on its bottom edge. */
export const FRAME_FOOT: ClipFoot = { x: 0, lift: 0 };

/** The art of a pooled actor, which draws nothing. */
export const NO_ROSTER_ART: RosterArt = {
  still: null,
  move: null,
  idle: null,
  users: 0,
  idleSince: 0,
  retry: () => {},
  dispose: () => {},
  disposed: false,
};

/**
 * Animated art for AI characters drawn as minigame enemies: one sheet set per character,
 * shared by every actor drawn with it. Sheets come from the shared atlas budget, so a
 * character nobody has drawn for a while gives its sheets back and the rotating cast of
 * a long run keeps finding room. Actors count themselves in `users` and stamp
 * `idleSince` when the last one leaves; `update` runs once per frame.
 */
export const createRosterArtCache = (game: GameRenderer) => {
  const appearances = new Map<string, RosterArt>();
  // Registered before any sheet lease, so closing the scene disposes each art (and
  // disowns its leases) first, and a sheet that finishes loading later builds nothing.
  game.own(() => {
    for (const art of appearances.values()) art.dispose();
    appearances.clear();
  });
  const maxTexture = game.renderer.gl.getParameter(
    game.renderer.gl.MAX_TEXTURE_SIZE,
  ) as number;
  const artFor = (entry: RosterCharacter | undefined): RosterArt => {
    const key = entry?.userId ?? "none";
    const existing = appearances.get(key);
    if (existing) return existing;
    const leases: (() => void)[] = [];
    /** Sheets the atlas budget had no room for yet. */
    let missing: { animation: CharacterAnimation; slot: "move" | "idle" }[] = [];
    const art: RosterArt = {
      still: null,
      move: null,
      idle: null,
      users: 0,
      idleSince: 0,
      retry: () => {
        if (missing.length === 0 || art.disposed) return;
        missing = missing.filter(({ animation, slot }) => !load(animation, slot));
      },
      dispose: () => {
        art.disposed = true;
        for (const clip of [art.move, art.idle])
          for (const view of clip?.views ?? []) view.destroy(false);
        art.move = art.idle = null;
        for (const release of leases.splice(0)) {
          release();
          game.disown(release);
        }
      },
      disposed: false,
    };
    appearances.set(key, art);
    if (!entry) return art;
    if (entry.avatar)
      void game.assets
        .texture(entry.avatar, 128)
        .then((texture) => {
          art.still = texture;
        })
        .catch(() => {});
    /** Lease a sheet for a slot; false when the atlas budget has no room for it. */
    const load = (animation: CharacterAnimation, slot: "move" | "idle") => {
      const lease = acquireAnimationTexture(animation, 128, maxTexture);
      if (!lease) return false;
      game.own(lease.release);
      leases.push(lease.release);
      void lease.resource
        .then((atlas) => {
          if (art.disposed) return;
          const views = animationFrameViews(atlas, animation);
          art[slot] = { animation, views, foot: clipFoot(views[0]) };
        })
        .catch(() => {});
      return true;
    };
    const move = entry.animations.move ?? entry.animations.idle;
    if (move) missing.push({ animation: move, slot: "move" });
    if (entry.animations.idle)
      missing.push({ animation: entry.animations.idle, slot: "idle" });
    art.retry();
    return art;
  };
  let retriedAt = 0;
  /**
   * Give back the sheets of characters no actor has used for a while, and let the
   * characters on the field claim the room for sheets they were refused.
   */
  const update = (now: number) => {
    for (const [key, art] of appearances)
      if (art.users === 0 && now - art.idleSince > ROSTER_ART_GRACE_MS) {
        art.dispose();
        appearances.delete(key);
      }
    if (now - retriedAt < ROSTER_ART_RETRY_MS) return;
    retriedAt = now;
    for (const art of appearances.values()) if (art.users > 0) art.retry();
  };
  return { artFor, update };
};

/**
 * Feet of a sheet's frame: the lowest drawn row and the middle of the pixels just above it,
 * read from that one cell at low resolution. Unreadable art stands on its frame's edge.
 */
const clipFoot = (texture: Texture | undefined): ClipFoot => {
  if (!texture) return FRAME_FOOT;
  try {
    const pixels = readTextureFramePixels(texture, FOOT_SAMPLE_PX);
    const scale = Math.min(
      1,
      FOOT_SAMPLE_PX / Math.max(texture.frame.width, texture.frame.height),
    );
    const width = Math.max(1, Math.round(texture.frame.width * scale)),
      height = Math.max(1, Math.round(texture.frame.height * scale));
    const drawn = (x: number, y: number) =>
      (pixels[(y * width + x) * 4 + 3] ?? 0) > FOOT_ALPHA;
    let bottom = -1;
    for (let y = height - 1; y >= 0 && bottom < 0; y--)
      for (let x = 0; x < width; x++)
        if (drawn(x, y)) {
          bottom = y;
          break;
        }
    if (bottom < 0) return FRAME_FOOT;
    let sum = 0,
      count = 0;
    for (let y = Math.max(0, bottom - 2); y <= bottom; y++)
      for (let x = 0; x < width; x++)
        if (drawn(x, y)) {
          sum += x + 0.5;
          count++;
        }
    return { x: sum / count / width - 0.5, lift: (height - 1 - bottom) / height };
  } catch {
    return FRAME_FOOT;
  }
};

/** An AI character drawn as enemies; animations come from its sprite sheets. */
export interface RosterCharacter {
  userId: string;
  avatar: string | null;
  animations: CharacterAnimations;
}

export interface RosterClip {
  animation: CharacterAnimation;
  views: Texture[];
  /** Where the feet stand in the first frame; every frame shares it, so steps keep their bob. */
  foot: ClipFoot;
}

/** Feet as a share of the frame: across from its centre, and up from its bottom edge. */
export interface ClipFoot {
  x: number;
  lift: number;
}

export interface RosterArt {
  still: Texture | null;
  move: RosterClip | null;
  idle: RosterClip | null;
  /** Live actors drawn with this art. */
  users: number;
  /** When the last of them left the field. */
  idleSince: number;
  /** Ask again for the sheets the atlas budget refused. */
  retry: () => void;
  /** Destroy the frame views and release the sheets. */
  dispose: () => void;
  disposed: boolean;
}
