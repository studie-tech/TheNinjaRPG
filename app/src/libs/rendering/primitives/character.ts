import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import {
  LPC_ATTACK_FRAME_MS,
  LPC_IDLE_FRAME_MS,
  lpcFrame,
  lpcFrameDuration,
  spriteLayerSheets,
} from "@/libs/lpc/catalog";
import { sharedFrameTexture } from "@/libs/rendering/assets";
import type { CompositeCell } from "@/libs/rendering/characterComposites";
import { createWindSprite } from "@/libs/rendering/primitives/windSprites";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

/**
 * Acquire shared atlas leases and build a unit-square actor with lazily cached frame views.
 * Movement mode omits attack atlases; image sources own shared frame views until eviction.
 * With the renderer's composites, movement-mode actors draw one composited frame: their layers
 * stay in an offscreen rig (still posed every frame, so `layers` keep describing the figure).
 */
export const createLpcCharacter = async (
  game: GameRenderer,
  appearance: SpriteAppearance,
  mode: "all" | "travel" = "all",
) => {
  const lpcCatalog = game.lpcCatalog;
  if (!lpcCatalog) throw new Error("Character catalog unavailable");
  const replacementSlots = new Set<string>(
    appearance.layers.flatMap((layer) => {
      const slot = lpcCatalog.designs[layer.profile]?.replacementSlot;
      return slot && slot !== "none" && layer.slot !== slot ? [slot] : [];
    }),
  );
  const parts = appearance.layers
    .filter((layer) => !layer.slot || !replacementSlots.has(layer.slot))
    .flatMap((layer) => {
      const sheets = spriteLayerSheets(lpcCatalog, appearance, layer, mode);
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
  const composites = mode === "travel" ? game.characterComposites : undefined;
  const rig = composites ? new Container() : sprite;
  rig.sortableChildren = true;
  // A still wind sprite shares the scenery's batches, so actors between trees add no draw calls.
  const body = composites ? createWindSprite(game.renderer, Texture.EMPTY, 0) : null;
  if (body) {
    body.anchor.set(0.5);
    body.scale.set(1 / 64);
    body.label = "composite";
    sprite.addChild(body);
  }
  const layers = loaded.map((part) => {
    const child = new Sprite(Texture.EMPTY);
    child.anchor.set(0.5);
    child.scale.set((part.layer.mirror ? -1 : 1) / 64, 1 / 64);
    child.zIndex = part.sheet.z;
    rig.addChild(child);
    return { ...part, child };
  });
  /** Painted poses by state, direction and step; a walking cycle repeats the same few. */
  const paints = new Map<string, { textures: (Texture | null)[]; key: string }>();
  let shown: CompositeCell | null = null,
    shownEpoch = -1,
    poseKey = "";
  /** Show the composited frame of the rig's current pose, requesting it when new or lost. */
  const present = () => {
    if (!composites || !body) return;
    if (shown?.key === poseKey && shownEpoch === composites.epoch()) return;
    const next = composites.acquire(poseKey, rig);
    // A full atlas keeps the previous frame on screen rather than a blank figure.
    if (!next) return;
    if (shown) composites.release(shown);
    shown = next;
    shownEpoch = composites.epoch();
    body.texture = next.texture;
  };
  const durations: Partial<Record<LpcAnimation, number>> = {};
  const poseOwners = new Map<LpcAnimation, (typeof parts)[number]>();
  // Every visible profile must agree on a pose; legacy gear stays attached to the neutral outfit.
  const hasIdle = parts.every((part) => part.authored.has("idle"));
  const hasCombatIdle = parts.every((part) => part.authored.has("combat"));
  for (const part of parts)
    for (const [animation, directions] of Object.entries(
      lpcCatalog.layouts[part.sheet.layout]!.clips,
    ))
      if (!["stand", "idle", "combat", "walk"].includes(animation)) {
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
  // One actor-wide phase keeps its layers together; independent cycles avoid synchronized crowds.
  let idlePhase = Math.random();
  let idleDuration = 1600 + Math.random() * 2000;
  let paintedState: LpcAnimation | undefined,
    paintedDirection: LpcDirection | undefined;
  let paintedStep = -1,
    paintedReducedMotion = false;
  /** Restart retriggers the same animation for a new cue; elapsed time comes from the scene clock. */
  const render = (
    frame: GameFrame,
    nextState: LpcAnimation = "idle",
    nextDirection: LpcDirection = direction,
    restart = false,
    rate = 1,
  ) => {
    if (disposed) return;
    if (state !== nextState || restart) {
      state = nextState;
      startedAt = frame.now;
    }
    direction = nextDirection;
    const idling = state === "idle" || state === "combat";
    if (idling && !frame.reducedMotion) {
      idlePhase += (Math.max(0, frame.delta) * 1000) / idleDuration;
      if (idlePhase >= 1) {
        idlePhase %= 1;
        idleDuration = 1600 + Math.random() * 2000;
      }
    }
    // Outfits without compatible idle artwork keep their neutral pose and planted feet.
    const sampleState = idling
      ? state === "combat" && hasCombatIdle
        ? "combat"
        : hasIdle
          ? "idle"
          : "stand"
      : state;
    const elapsed = idling
      ? frame.reducedMotion
        ? 0
        : idlePhase * 3 * LPC_IDLE_FRAME_MS
      : (frame.now - startedAt) * rate;
    const sampleStep = frame.reducedMotion
      ? 0
      : Math.floor(Math.max(0, elapsed) / lpcFrameDuration(sampleState));
    if (
      paintedState === sampleState &&
      paintedDirection === direction &&
      paintedStep === sampleStep &&
      paintedReducedMotion === frame.reducedMotion
    ) {
      present();
      return;
    }
    paintedState = sampleState;
    paintedDirection = direction;
    paintedStep = sampleStep;
    paintedReducedMotion = frame.reducedMotion;
    // A pose holds every layer until its authored boundary; movement still updates the actor root each frame.
    // A custom weapon drives the body timeline while retaining its own authored columns.
    const poseOwner = poseOwners.get(sampleState);
    const pose =
      poseOwner && lpcCatalog.layouts[poseOwner.sheet.layout]!.bodyPoses![sampleState]!;
    const step = frame.reducedMotion
      ? 0
      : Math.floor(Math.max(0, elapsed) / LPC_ATTACK_FRAME_MS);
    // Without a body pose every layer samples its own clip at the pose's step.
    const paintKey = `${sampleState}:${direction}:${sampleStep}:${pose ? step : ""}:${Number(frame.reducedMotion)}`;
    let painted = paints.get(paintKey);
    if (!painted) {
      painted = paint(sampleState, direction, elapsed, step, frame.reducedMotion);
      paints.set(paintKey, painted);
    }
    for (const [index, entry] of layers.entries()) {
      const texture = painted.textures[index];
      entry.child.visible = !!texture;
      if (texture && entry.child.texture !== texture) entry.child.texture = texture;
    }
    poseKey = painted.key;
    present();
  };
  /** Layer frames of one sampled pose, and its composite key. */
  const paint = (
    sampleState: LpcAnimation,
    direction: LpcDirection,
    elapsed: number,
    step: number,
    reducedMotion: boolean,
  ) => {
    const poseOwner = poseOwners.get(sampleState);
    const pose =
      poseOwner && lpcCatalog.layouts[poseOwner.sheet.layout]!.bodyPoses![sampleState]!;
    const opposite = direction === 1 ? 3 : direction === 3 ? 1 : direction;
    const poses = pose?.frames[poseOwner?.layer.mirror ? opposite : direction];
    const poseStep = poses?.[Math.min(step, poses.length - 1)];
    const textures: (Texture | null)[] = [];
    // Layer textures and mirroring identify a frame; identical outfits share its composite.
    let key = "";
    for (const entry of layers) {
      const facing = entry.layer.mirror ? opposite : direction;
      const customPose =
        lpcCatalog.layouts[entry.sheet.layout]?.bodyPoses?.[sampleState];
      const usesBodyPose = pose && !customPose;
      const animation = usesBodyPose ? pose.animation : sampleState;
      if (
        entry.authored.has(animation) &&
        !lpcCatalog.layouts[entry.sheet.layout]?.clips[animation]
      ) {
        textures.push(null);
        continue;
      }
      const customFrames = customPose?.frames[facing];
      const customStep = customFrames && Math.min(step, customFrames.length - 1);
      // Paired weapons retain their timing when compatible, otherwise match the shared body pose.
      const weaponStep =
        customFrames && customStep !== undefined
          ? customFrames[customStep] === poseStep
            ? customStep
            : customFrames.indexOf(poseStep ?? 0)
          : undefined;
      // Flipping an off-hand pose reverses its horizontal facing, so sample the opposite row first.
      const sample = lpcFrame(
        lpcCatalog,
        entry.sheet,
        animation,
        facing,
        weaponStep !== undefined
          ? Math.max(0, weaponStep) * LPC_ATTACK_FRAME_MS
          : usesBodyPose
            ? (poseStep ?? 0) * LPC_ATTACK_FRAME_MS
            : elapsed,
        usesBodyPose || customPose ? false : reducedMotion,
      );
      const texture = sample
        ? sharedFrameTexture(
            entry.texture.source,
            sample,
            { width: sample.size, height: sample.size },
            sample.trim,
          )
        : null;
      textures.push(texture);
      if (texture) key += `${texture.uid}${entry.layer.mirror ? "m" : ""},`;
    }
    return { textures, key };
  };
  render({ now: 0, delta: 0, reducedMotion: true });
  game.own(() => {
    disposed = true;
    if (shown) composites?.release(shown);
    shown = null;
    if (rig !== sprite && !rig.destroyed)
      rig.destroy({ children: true, texture: false, textureSource: false });
    if (!sprite.destroyed)
      sprite.destroy({ children: true, texture: false, textureSource: false });
  });
  return {
    sprite,
    render,
    durations,
    hasHeadgear: appearance.layers.some(
      (layer) => lpcCatalog.designs[layer.profile]?.category === "headgear",
    ),
    layers: layers.map(({ child, sheet }) => ({ sprite: child, image: sheet.image })),
  };
};

export type LpcCharacter = Awaited<ReturnType<typeof createLpcCharacter>>;
