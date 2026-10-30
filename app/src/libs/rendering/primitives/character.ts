import { Container, Rectangle, Sprite, Texture, type TextureSource } from "pixi.js";
import {
  LPC_ATTACK_FRAME_MS,
  lpcCatalog,
  lpcFrame,
  spriteLayerSheets,
} from "@/libs/lpc/catalog";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

/**
 * Acquire shared atlas leases and build a unit-square actor with lazily cached frame views.
 * Movement mode omits attack atlases; image sources own shared frame views until eviction.
 */
export const createLpcCharacter = async (
  game: GameRenderer,
  appearance: SpriteAppearance,
  mode: "all" | "travel" = "all",
) => {
  const parts = appearance.layers.flatMap((layer) => {
    const sheets = spriteLayerSheets(appearance, layer, mode);
    // Oversized weapons split held and attack poses across separate sheets.
    const authored = new Set(
      sheets.flatMap((sheet) =>
        Object.keys(lpcCatalog.layouts[sheet.layout]?.clips ?? {}),
      ),
    );
    return sheets.map((sheet) => ({ layer, sheet, authored }));
  });
  const loaded = await Promise.all(
    parts.map(async (part) => ({
      ...part,
      texture: await game.assets.texture(part.sheet.image, 0, "nearest"),
    })),
  );
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Character cancelled", "AbortError");
  // A unit-square root preserves the existing actor/hit-testing contract.
  const sprite = new Container({ boundsArea: new Rectangle(-0.5, -0.5, 1, 1) });
  sprite.sortableChildren = true;
  const layers = loaded.map((part) => {
    const child = new Sprite(Texture.EMPTY);
    child.anchor.set(0.5);
    child.scale.set((part.layer.mirror ? -1 : 1) / 64, 1 / 64);
    child.zIndex = part.sheet.z;
    sprite.addChild(child);
    return { ...part, child };
  });
  const durations: Partial<Record<LpcAnimation, number>> = {};
  const poseOwners = new Map<LpcAnimation, (typeof parts)[number]>();
  for (const part of parts)
    for (const [animation, directions] of Object.entries(
      lpcCatalog.layouts[part.sheet.layout]!.clips,
    ))
      if (animation !== "idle" && animation !== "walk") {
        const state = animation as LpcAnimation;
        durations[state] = Math.max(
          durations[state] ?? 0,
          ...directions.map((frames) => frames.length * LPC_ATTACK_FRAME_MS),
        );
        if (
          !poseOwners.has(state) &&
          lpcCatalog.layouts[part.sheet.layout]?.bodyPoses?.[state]
        )
          poseOwners.set(state, part);
      }
  for (const [animation, part] of poseOwners)
    durations[animation] = Math.max(
      ...lpcCatalog.layouts[part.sheet.layout]!.bodyPoses![animation]!.frames.map(
        (frames) => frames.length * LPC_ATTACK_FRAME_MS,
      ),
    );
  let state: LpcAnimation = "idle",
    direction: LpcDirection = 2,
    startedAt = 0,
    disposed = false;
  /** Restart retriggers the same animation for a new cue; elapsed time comes from the scene clock. */
  const render = (
    frame: GameFrame,
    nextState: LpcAnimation = "idle",
    nextDirection: LpcDirection = direction,
    restart = false,
  ) => {
    if (disposed) return;
    if (state !== nextState || restart) {
      state = nextState;
      startedAt = frame.now;
    }
    direction = nextDirection;
    // A custom weapon drives the body timeline while retaining its own authored columns.
    const poseOwner = poseOwners.get(state);
    const pose =
      poseOwner && lpcCatalog.layouts[poseOwner.sheet.layout]!.bodyPoses![state]!;
    const opposite = direction === 1 ? 3 : direction === 3 ? 1 : direction;
    const poses = pose?.frames[poseOwner?.layer.mirror ? opposite : direction];
    const elapsed = frame.now - startedAt;
    const poseStep =
      poses?.[
        Math.min(
          frame.reducedMotion
            ? 0
            : Math.floor(Math.max(0, elapsed) / LPC_ATTACK_FRAME_MS),
          poses.length - 1,
        )
      ];
    for (const entry of layers) {
      const usesBodyPose = pose && entry.layer !== poseOwner?.layer;
      const animation = usesBodyPose ? pose.animation : state;
      if (
        entry.authored.has(animation) &&
        !lpcCatalog.layouts[entry.sheet.layout]?.clips[animation]
      ) {
        entry.child.visible = false;
        continue;
      }
      // Flipping an off-hand pose reverses its horizontal facing, so sample the opposite row first.
      const sample = lpcFrame(
        entry.sheet,
        animation,
        entry.layer.mirror ? opposite : direction,
        usesBodyPose ? (poseStep ?? 0) * LPC_ATTACK_FRAME_MS : elapsed,
        usesBodyPose ? false : frame.reducedMotion,
      );
      entry.child.visible = !!sample;
      if (!sample) continue;
      const texture = frameTexture(entry.texture.source, sample);
      if (entry.child.texture !== texture) entry.child.texture = texture;
    }
  };
  render({ now: 0, delta: 0, reducedMotion: true });
  game.own(() => {
    disposed = true;
    if (!sprite.destroyed)
      sprite.destroy({ children: true, texture: false, textureSource: false });
  });
  return { sprite, render, durations };
};

const sourceFrames = new WeakMap<TextureSource, Map<string, Texture>>();

/** GPU unload preserves frame views so context restoration can reupload the leased source. */
const frameTexture = (
  source: TextureSource,
  sample: NonNullable<ReturnType<typeof lpcFrame>>,
) => {
  let views = sourceFrames.get(source);
  if (!views) {
    const owned = new Map<string, Texture>();
    views = owned;
    sourceFrames.set(source, owned);
    source.once("destroy", () => {
      for (const texture of owned.values()) texture.destroy(false);
      owned.clear();
      sourceFrames.delete(source);
    });
  }
  const key = `${sample.x}:${sample.y}:${sample.width}:${sample.height}:${sample.size}:${sample.trim?.x ?? ""}:${sample.trim?.y ?? ""}`;
  let texture = views.get(key);
  if (!texture) {
    texture = new Texture({
      source,
      frame: new Rectangle(sample.x, sample.y, sample.width, sample.height),
      orig: new Rectangle(0, 0, sample.size, sample.size),
      trim: sample.trim
        ? new Rectangle(sample.trim.x, sample.trim.y, sample.width, sample.height)
        : undefined,
    });
    views.set(key, texture);
  }
  return texture;
};

export type LpcCharacter = Awaited<ReturnType<typeof createLpcCharacter>>;
