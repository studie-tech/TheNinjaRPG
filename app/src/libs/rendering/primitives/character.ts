import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import {
  LPC_ATTACK_FRAME_MS,
  lpcFrame,
  lpcFrameDuration,
  lpcOppositeFacing,
  spriteBodyPartMasks,
  spriteLayerSheets,
  visibleSpriteLayers,
} from "@/libs/lpc/catalog";
import { readTexturePixels, sharedFrameTexture } from "@/libs/rendering/assets";
import type { CompositeCell } from "@/libs/rendering/characterComposites";
import {
  type CharacterDepthLayer,
  composeCharacterPixels,
} from "@/libs/rendering/characterDepth";
import { characterFrameOffset } from "@/libs/rendering/characterFrame";
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
  const visibleLayers = visibleSpriteLayers(lpcCatalog, appearance);
  const bodyMasks = spriteBodyPartMasks(lpcCatalog, visibleLayers);
  const parts = visibleLayers.flatMap((layer) => {
    const selected = spriteLayerSheets(lpcCatalog, appearance, layer, mode);
    const hasOffhand = !!layer.mirror && selected.every((sheet) => !!sheet.offhand);
    const sheets = hasOffhand
      ? selected.map((sheet) => ({
          ...sheet.offhand!,
          ...(sheet.component ? { component: sheet.component } : {}),
        }))
      : selected;
    // Oversized weapons split held and attack poses across separate sheets.
    return sheets.map((sheet) => ({
      layer: hasOffhand ? { ...layer, mirror: false } : layer,
      bodyRegions: sheet.bodyRegions ? bodyMasks.get(layer) : undefined,
      sheet,
      authored: new Set(
        sheets
          .filter((candidate) => candidate.component === sheet.component)
          .flatMap((candidate) =>
            Object.keys(lpcCatalog.layouts[candidate.layout]?.clips ?? {}),
          ),
      ),
    }));
  });
  const loaded = await Promise.all(
    parts.map(async (part) => {
      const [texture, depthTexture] = await Promise.all([
        game.assets.texture(part.sheet.image, 0, "nearest"),
        part.sheet.depth ? game.assets.texture(part.sheet.depth, 0, "nearest") : null,
      ]);
      if (
        depthTexture &&
        (texture.source.pixelWidth !== depthTexture.source.pixelWidth ||
          texture.source.pixelHeight !== depthTexture.source.pixelHeight)
      )
        throw new Error("Character colour and depth dimensions must match");
      return {
        ...part,
        texture,
        depthTexture,
        pixels: depthTexture ? characterPixels(texture) : undefined,
        depth: depthTexture ? characterPixels(depthTexture) : undefined,
      };
    }),
  );
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Character cancelled", "AbortError");
  // A unit-square root preserves the existing actor/hit-testing contract.
  const sprite = new Container({ boundsArea: new Rectangle(-0.5, -0.5, 1, 1) });
  const depthComposition = loaded.some((part) => part.depth);
  if (depthComposition && !loaded.every((part) => part.depth))
    throw new Error("Character layers must share the camera depth format");
  const composites =
    mode === "travel" || depthComposition ? game.characterComposites : undefined;
  if (depthComposition && !composites)
    throw new Error("Character compositor unavailable");
  const rig = composites ? new Container() : sprite;
  rig.sortableChildren = true;
  // A still wind sprite shares the scenery's batches, so actors between trees add no draw calls.
  const body = composites ? createWindSprite(game.renderer, Texture.EMPTY, 0) : null;
  if (body) {
    body.anchor.set(0.5);
    body.scale.set(1 / (composites?.pixelsPerUnit ?? 64));
    body.label = "composite";
    sprite.addChild(body);
  }
  const layers = loaded.map((part) => {
    const child = new Sprite(Texture.EMPTY);
    child.anchor.set(0.5);
    const pixelsPerUnit = lpcCatalog.layouts[part.sheet.layout]?.pixelsPerUnit ?? 64;
    child.scale.set((part.layer.mirror ? -1 : 1) / pixelsPerUnit, 1 / pixelsPerUnit);
    child.zIndex = part.sheet.z;
    rig.addChild(child);
    return { ...part, child };
  });
  /** Painted poses by state, direction and step; a walking cycle repeats the same few. */
  const paints = new Map<
    string,
    {
      textures: (Texture | null)[];
      mirrors: boolean[];
      offsets: { x: number; y: number }[];
      depthLayers: CharacterDepthLayer[];
      key: string;
    }
  >();
  let shown: CompositeCell | null = null,
    shownEpoch = -1,
    poseKey = "";
  let rasterize: (() => Uint8Array) | undefined;
  /** Show the composited frame of the rig's current pose, requesting it when new or lost. */
  const present = () => {
    if (!composites || !body) return false;
    if (shown?.key === poseKey && shownEpoch === composites.epoch()) return false;
    const next = composites.acquire(poseKey, rig, rasterize);
    // A full atlas keeps the previous frame on screen rather than a blank figure.
    if (!next) return false;
    if (shown) composites.release(shown);
    shown = next;
    shownEpoch = composites.epoch();
    body.texture = next.texture;
    return true;
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
          ...directions.map(
            (frames) =>
              frames.length *
              lpcFrameDuration(state, lpcCatalog.layouts[part.sheet.layout]),
          ),
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
  const frameDuration = (animation: LpcAnimation) => {
    const durations = parts.flatMap((part) => {
      const layout = lpcCatalog.layouts[part.sheet.layout];
      return layout?.clips[animation] ? [lpcFrameDuration(animation, layout)] : [];
    });
    return durations.length ? Math.min(...durations) : lpcFrameDuration(animation);
  };
  const idleFrames = (animation: LpcAnimation) =>
    Math.max(
      1,
      ...parts.flatMap((part) =>
        (lpcCatalog.layouts[part.sheet.layout]?.clips[animation] ?? []).map(
          (frames) => frames.length,
        ),
      ),
    );
  let paintedState: LpcAnimation | undefined,
    paintedDirection: LpcDirection | undefined;
  let paintedStep = -1,
    paintedReducedMotion = false;
  /**
   * Restart retriggers the same animation for a new cue; elapsed time comes from the scene clock.
   * Returns whether the figure's pose or composited frame changed.
   */
  const render = (
    frame: GameFrame,
    nextState: LpcAnimation = "idle",
    nextDirection: LpcDirection = direction,
    restart = false,
    rate = 1,
  ) => {
    if (disposed) return false;
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
        : idlePhase * idleFrames(sampleState) * frameDuration(sampleState)
      : (frame.now - startedAt) * rate;
    const sampleStep = frame.reducedMotion
      ? 0
      : Math.floor(Math.max(0, elapsed) / frameDuration(sampleState));
    if (
      paintedState === sampleState &&
      paintedDirection === direction &&
      paintedStep === sampleStep &&
      paintedReducedMotion === frame.reducedMotion
    )
      return present();
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
      entry.child.scale.x =
        (painted.mirrors[index] ? -1 : 1) /
        (lpcCatalog.layouts[entry.sheet.layout]?.pixelsPerUnit ?? 64);
      const origin = painted.offsets[index];
      if (origin) entry.child.position.set(origin.x, origin.y);
    }
    poseKey = painted.key;
    const sampledLayers = painted.depthLayers;
    rasterize = depthComposition
      ? () =>
          composeCharacterPixels(
            sampledLayers,
            composites!.cellSize,
            composites!.pixelsPerUnit,
          )
      : undefined;
    present();
    return true;
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
    const opposite = lpcOppositeFacing(direction);
    const poseDirection = poseOwner?.layer.mirror ? opposite : direction;
    const poseLayout = poseOwner && lpcCatalog.layouts[poseOwner.sheet.layout];
    const poseRow =
      poseLayout?.facings?.[poseDirection]?.row ??
      (poseDirection === 4 ? 1 : poseDirection === 5 ? 3 : poseDirection);
    const poses = pose?.frames[poseRow];
    const poseStep = poses?.[Math.min(step, poses.length - 1)];
    const textures: (Texture | null)[] = [];
    const mirrors: boolean[] = [];
    const offsets: { x: number; y: number }[] = [];
    const depthLayers: CharacterDepthLayer[] = [];
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
        mirrors.push(false);
        offsets.push({ x: 0, y: 0 });
        continue;
      }
      const layout = lpcCatalog.layouts[entry.sheet.layout];
      const row =
        layout?.facings?.[facing]?.row ??
        (facing === 4 ? 1 : facing === 5 ? 3 : facing);
      const customFrames = customPose?.frames[row];
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
      const mirrored = !!entry.layer.mirror !== !!sample?.mirror;
      mirrors.push(mirrored);
      const origin = sample
        ? characterFrameOffset(sample, layout?.pixelsPerUnit ?? 64, mirrored)
        : { x: 0, y: 0 };
      offsets.push(origin);
      if (sample && entry.pixels && entry.depth)
        depthLayers.push({
          pixels: entry.pixels,
          depth: entry.depth,
          width: entry.texture.source.pixelWidth,
          height: entry.texture.source.pixelHeight,
          pixelsPerUnit: layout?.pixelsPerUnit ?? 64,
          mirror: mirrored,
          z: entry.sheet.z,
          ...(entry.sheet.intensityTint
            ? { intensityTint: entry.sheet.intensityTint }
            : {}),
          ...(entry.bodyRegions ? { bodyRegions: entry.bodyRegions } : {}),
          frame: sample,
        });
      if (texture)
        key += `${texture.uid}${mirrored ? "m" : ""}:${entry.depthTexture?.source.uid ?? ""}:${entry.sheet.z}:${layout?.pixelsPerUnit ?? 64}:${origin.x}:${origin.y}:${entry.bodyRegions ? [...entry.bodyRegions].join(".") : "-"}:${entry.sheet.intensityTint?.join("/") ?? "-"},`;
    }
    return { textures, mirrors, offsets, depthLayers, key };
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

const decodedCharacterPixels = new WeakMap<Texture["source"], Uint8Array>();
/** Atlas views share one decoded buffer, which leaves memory with the leased source. */
const characterPixels = (texture: Texture) => {
  let pixels = decodedCharacterPixels.get(texture.source);
  if (!pixels) {
    pixels = readTexturePixels(
      texture,
      texture.source.pixelWidth,
      texture.source.pixelHeight,
    );
    decodedCharacterPixels.set(texture.source, pixels);
  }
  return pixels;
};
