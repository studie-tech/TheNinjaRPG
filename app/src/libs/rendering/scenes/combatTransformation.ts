import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import {
  ID_SFX_HIT,
  ID_SFX_TRANSFORMATION_BURST,
  ID_SFX_TRANSFORMATION_SURGE,
  TRANSFORMATION_ACTION,
} from "@/drizzle/constants";
import type { ReturnedBattle, ReturnedUserState } from "@/libs/combat/types";

const FONT_SIZE = 72;
/** The field's backdrop reaches well past any zoom, drag or shake. */
const COVER = 40;
/** Plays when a clip is missing, so every arrival keeps its build-up. */
const FALLBACK_CLIP_MS = 2200;
const FLASH_MS = 520;
const BANNER_POP_MS = 220;
const ARC_REFRESH_MS = 70;
const BOLT_REFRESH_MS = 130;
const GLITCH_REFRESH_MS = 60;

/** Every tier is a bigger event than the last; the top one breaks the field open. */
const TIERS: Record<number, TransformationTier> = {
  1: { rings: 1, arcs: 5, sparks: 36, hold: 1300, dim: 0.5, shake: 0.05 },
  2: { rings: 2, arcs: 8, sparks: 54, hold: 1450, dim: 0.6, shake: 0.09 },
  3: { rings: 3, arcs: 11, sparks: 76, hold: 1600, dim: 0.7, shake: 0.14 },
  4: {
    rings: 5,
    arcs: 18,
    sparks: 120,
    hold: 2600,
    dim: 0.82,
    shake: 0.24,
    wild: true,
  },
};

/** The fighter that has just arrived by transformation between two shown battles. */
export const findTransformation = (
  previous: ReturnedBattle,
  next: ReturnedBattle,
): ReturnedUserState | undefined =>
  previous.id !== next.id
    ? undefined
    : next.usersState.find(
        (user) =>
          user.transformation &&
          TIERS[user.transformation.tier] &&
          !previous.usersState.some((row) => row.userId === user.userId),
      );

/** Scene-time strengths of each layer, from the clip's start to the end of the banner. */
export const transformationEnvelope = (
  elapsed: number,
  clipMs: number,
  stage: Pick<TransformationStage, "hold" | "dim" | "shake">,
) => {
  const charge = Math.min(1, Math.max(0, elapsed / clipMs));
  const after = elapsed - clipMs;
  const total = clipMs + stage.hold;
  const fade = after > 0 ? Math.max(0, 1 - after / stage.hold) : 1;
  return {
    charge,
    burst: after >= 0,
    /** 0 to 1 through the burst's expansion. */
    burstProgress: after >= 0 ? Math.min(1, after / stage.hold) : 0,
    dim: stage.dim * Math.min(1, elapsed / 400) * fade,
    flash: after >= 0 && after < FLASH_MS ? (1 - after / FLASH_MS) ** 2 : 0,
    banner:
      after < 0
        ? 0
        : Math.min(1, after / BANNER_POP_MS) *
          Math.min(1, (1 - after / stage.hold) * 4),
    shake: stage.shake * (after < 0 ? charge ** 2 : Math.max(0, 1 - after / 700) * 1.6),
    finished: elapsed >= total,
  };
};

/**
 * A form's arrival: the battle holds on the field while the fallen form morphs into the next
 * through the fighter's own clip, under a build-up of light and arcs, then bursts out with a
 * flash, shockwaves and the new form's name. Drawn in the field's Y-up world units.
 */
export const createCombatTransformation = (
  tile: { width: number; height: number },
  actors: {
    transform: (id: string, fromId: string, actionKey: string) => void;
    groundPosition: (id: string) => { x: number; y: number } | undefined;
  },
  sounds: (id: string, gain: number) => void,
) => {
  const dim = new Graphics();
  dim
    .rect(
      -COVER * tile.width,
      -COVER * tile.height,
      COVER * 2 * tile.width,
      COVER * 2 * tile.height,
    )
    .fill(0x04060c);
  // Light that must not wash out the morph clip stays behind the fighters.
  const behind = new Container();
  behind.label = "combat-transformation-backdrop";
  behind.visible = false;
  const container = new Container();
  container.label = "combat-transformation";
  container.visible = false;
  const glow = createGlowTexture();
  const column = glowSprite(glow);
  const halo = glowSprite(glow);
  const rays = new Graphics();
  rays.blendMode = "add";
  const arcs = new Graphics();
  arcs.blendMode = "add";
  const bolts = new Graphics();
  bolts.blendMode = "add";
  const rings = new Graphics();
  rings.blendMode = "add";
  const glitch = new Graphics();
  glitch.blendMode = "add";
  const sparks = Array.from({ length: 120 }, () => {
    const sprite = glowSprite(glow);
    return { sprite, angle: 0, reach: 0, speed: 0, size: 0 };
  });
  const flash = new Graphics();
  flash
    .rect(
      -COVER * tile.width,
      -COVER * tile.height,
      COVER * 2 * tile.width,
      COVER * 2 * tile.height,
    )
    .fill(0xffffff);
  flash.alpha = 0;
  const banner = new Text({ text: "" });
  banner.anchor.set(0.5);
  behind.addChild(dim, column, rays, halo);
  container.addChild(
    rings,
    ...sparks.map((s) => s.sprite),
    arcs,
    bolts,
    glitch,
    flash,
    banner,
  );
  /** Read each frame by the scene's camera, in world units. */
  const shake = { x: 0, y: 0 };
  let active:
    | {
        startedAt: number;
        clipMs: number;
        stage: TransformationStage;
        origin: { x: number; y: number };
        burstPlayed: boolean;
        surgePlayed: boolean;
      }
    | undefined;
  let now = 0;
  let arcsAt = 0;
  let boltsAt = 0;
  let glitchAt = 0;

  const drawArcs = (
    stage: TransformationStage,
    charge: number,
    origin: { x: number; y: number },
  ) => {
    arcs.clear();
    const count = Math.ceil(stage.arcs * charge);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = tile.height * (0.7 + Math.random() * (0.9 + charge * 0.9));
      const steps = 5 + Math.floor(Math.random() * 4);
      const cy = origin.y + tile.height * 0.7;
      arcs.moveTo(origin.x + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
      for (let step = steps - 1; step >= 0; step--) {
        const share = step / steps;
        const jitter = tile.height * 0.16 * share;
        arcs.lineTo(
          origin.x + Math.cos(angle) * reach * share + (Math.random() - 0.5) * jitter,
          cy + Math.sin(angle) * reach * share + (Math.random() - 0.5) * jitter,
        );
      }
    }
    arcs.stroke({ color: stage.glow, width: tile.height * 0.035, alpha: 0.9 });
  };

  /** Lightning from above the field onto random ground, with no anchor to any fighter. */
  const drawBolts = (
    stage: TransformationStage,
    charge: number,
    origin: { x: number; y: number },
  ) => {
    bolts.clear();
    const count = 2 + Math.floor(charge * 5);
    for (let i = 0; i < count; i++) {
      let x = origin.x + (Math.random() - 0.5) * tile.width * 14;
      let y = origin.y + (Math.random() - 0.5) * tile.height * 7;
      const top = y + tile.height * 12;
      const stepY = tile.height * 1.1;
      bolts.moveTo(x, y);
      while (y < top) {
        y += stepY;
        x += (Math.random() - 0.5) * tile.width * 0.9;
        bolts.lineTo(x, y);
      }
    }
    bolts.stroke({ color: i2color(stage), width: tile.height * 0.06, alpha: 0.95 });
  };

  /** Bands of displaced colour across the view, as if the battle's signal were failing. */
  const drawGlitch = (
    stage: TransformationStage,
    strength: number,
    origin: { x: number; y: number },
  ) => {
    glitch.clear();
    const bands = Math.floor(3 + strength * 9);
    for (let i = 0; i < bands; i++) {
      const y = origin.y + (Math.random() - 0.5) * tile.height * 16;
      const height = tile.height * (0.05 + Math.random() * 0.4);
      const shift = (Math.random() - 0.5) * tile.width * 6;
      glitch.rect(origin.x + shift - tile.width * 12, y, tile.width * 24, height).fill({
        color: i % 2 ? stage.glow : stage.color,
        alpha: 0.18 + Math.random() * 0.22 * strength,
      });
    }
  };

  const drawRays = (
    stage: TransformationStage,
    progress: number,
    origin: { x: number; y: number },
  ) => {
    rays.clear();
    const count = 14;
    const reach = tile.height * (6 + 16 * progress);
    const spin = now * 0.0006;
    const cy = origin.y + tile.height * 0.8;
    for (let i = 0; i < count; i++) {
      const angle = spin + (i / count) * Math.PI * 2;
      const wedge = 0.05 + 0.04 * Math.sin(now * 0.004 + i);
      rays
        .poly([
          origin.x,
          cy,
          origin.x + Math.cos(angle - wedge) * reach,
          cy + Math.sin(angle - wedge) * reach,
          origin.x + Math.cos(angle + wedge) * reach,
          cy + Math.sin(angle + wedge) * reach,
        ])
        .fill({
          color: i % 2 ? stage.color : stage.glow,
          alpha: 0.32 * (1 - progress),
        });
    }
  };

  const drawRings = (
    stage: TransformationStage,
    progress: number,
    origin: { x: number; y: number },
  ) => {
    rings.clear();
    const cy = origin.y + tile.height * 0.4;
    for (let i = 0; i < stage.rings; i++) {
      const share = Math.max(0, progress * 2.2 - i * 0.2);
      if (share <= 0 || share >= 1) continue;
      const eased = 1 - (1 - share) ** 3;
      const radius = tile.height * (1 + eased * (7 + stage.rings * 2.4));
      rings.ellipse(origin.x, cy, radius, radius * 0.56).stroke({
        color: i % 2 ? stage.glow : stage.color,
        width: tile.height * 0.18 * (1 - share),
        alpha: 1 - share,
      });
    }
  };

  const stop = () => {
    active = undefined;
    behind.visible = false;
    container.visible = false;
    shake.x = 0;
    shake.y = 0;
  };

  return {
    behind,
    container,
    shake,
    /** Start a form's arrival on the field, which already holds its fighter. */
    start: (form: ReturnedUserState) => {
      const { transformation } = form;
      const tier = transformation && TIERS[transformation.tier];
      if (!transformation || !tier) return;
      const stage = { ...tier, color: transformation.color, glow: transformation.glow };
      const origin = actors.groundPosition(form.userId);
      if (!origin) return;
      const clip = form.spriteAnimations?.[TRANSFORMATION_ACTION];
      actors.transform(form.userId, transformation.fromUserId, TRANSFORMATION_ACTION);
      active = {
        startedAt: now,
        clipMs: clip ? (clip.frameCount * 1000) / clip.fps : FALLBACK_CLIP_MS,
        stage,
        origin,
        burstPlayed: false,
        surgePlayed: false,
      };
      behind.visible = true;
      container.visible = true;
      sounds(ID_SFX_TRANSFORMATION_SURGE, 1);
      for (const spark of sparks) {
        spark.angle = Math.random() * Math.PI * 2;
        spark.reach = tile.height * (2.5 + Math.random() * 4);
        spark.speed = 0.6 + Math.random() * 0.8;
        spark.size = tile.height * (0.05 + Math.random() * 0.1);
        spark.sprite.tint = Math.random() < 0.5 ? stage.color : stage.glow;
      }
      banner.text = transformation.announce;
      banner.style = new TextStyle({
        fontFamily: 'Impact, "Arial Black", "Arial Narrow", Arial, sans-serif',
        fontSize: FONT_SIZE,
        fontStyle: "italic",
        fontWeight: "900",
        fill: 0xffffff,
        stroke: { color: stage.color, width: 8, join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 0, distance: 6, angle: 1.2 },
        padding: 14,
      });
      banner.alpha = 0;
    },
    /** `view` is the world point at the centre of the screen and its half extents. */
    animate: (
      clock: number,
      pixelsPerWorld: number,
      view: { x: number; y: number; halfWidth: number; halfHeight: number },
    ) => {
      now = clock;
      if (!active) return;
      const { stage, origin, clipMs } = active;
      const elapsed = clock - active.startedAt;
      const state = transformationEnvelope(elapsed, clipMs, stage);
      if (state.finished) {
        stop();
        return;
      }
      if (!active.surgePlayed && elapsed > clipMs * 0.55) {
        active.surgePlayed = true;
        sounds(ID_SFX_TRANSFORMATION_SURGE, 1);
      }
      if (state.burst && !active.burstPlayed) {
        active.burstPlayed = true;
        sounds(ID_SFX_TRANSFORMATION_BURST, 1);
        sounds(ID_SFX_HIT, 1);
      }
      dim.alpha = state.dim;
      shake.x = state.shake && Math.sin(clock * 0.09) * state.shake * tile.height;
      shake.y = state.shake && Math.cos(clock * 0.113) * state.shake * tile.height;
      const swell = state.burst ? 1 - state.burstProgress : state.charge;
      column.tint = stage.color;
      column.position.set(origin.x, origin.y + tile.height * 3);
      column.width = tile.width * (0.8 + swell * 1.8);
      column.height = tile.height * (8 + swell * 8);
      column.alpha = state.burst ? swell * 0.8 : 0.25 + swell * 0.6;
      halo.tint = stage.glow;
      halo.position.set(origin.x, origin.y + tile.height * 0.8);
      halo.width = halo.height =
        tile.height * (1.4 + swell * (2.8 + stage.rings * 0.5));
      halo.alpha = 0.3 + swell * 0.6;
      if (!state.burst && clock - arcsAt >= ARC_REFRESH_MS) {
        arcsAt = clock;
        drawArcs(stage, state.charge, origin);
      } else if (state.burst) arcs.clear();
      for (const [index, spark] of sparks.entries()) {
        const shown = index < stage.sparks;
        spark.sprite.visible = shown;
        if (!shown) continue;
        // Sparks fall inward through the build-up, then the burst throws them back out.
        const share = state.burst
          ? state.burstProgress * spark.speed * 2.4
          : Math.max(0, 1 - ((state.charge * spark.speed * 3 + index * 0.13) % 1));
        const reach = spark.reach * share;
        spark.sprite.position.set(
          origin.x + Math.cos(spark.angle) * reach,
          origin.y + tile.height * 0.7 + Math.sin(spark.angle) * reach * 0.72,
        );
        spark.sprite.width = spark.sprite.height = spark.size * (state.burst ? 1.7 : 1);
        spark.sprite.alpha = state.burst
          ? 1 - state.burstProgress
          : Math.min(1, (1 - share) * 2);
      }
      if (state.burst) drawRings(stage, state.burstProgress, origin);
      else rings.clear();
      flash.alpha = state.flash;
      if (stage.wild) {
        if (clock - boltsAt >= BOLT_REFRESH_MS) {
          boltsAt = clock;
          if (state.burst && state.burstProgress > 0.3) bolts.clear();
          else drawBolts(stage, state.charge, origin);
        }
        if (clock - glitchAt >= GLITCH_REFRESH_MS) {
          glitchAt = clock;
          const strength = state.burst
            ? Math.max(0, 1 - state.burstProgress * 3)
            : state.charge ** 3;
          if (strength > 0.05) drawGlitch(stage, strength, origin);
          else glitch.clear();
        }
        // False dawns: the screen strobes twice before the true flash.
        if (!state.burst) {
          const strobe = Math.sin(state.charge * Math.PI * 9) ** 8;
          flash.alpha = state.charge > 0.55 ? strobe * 0.55 * state.charge : 0;
        }
        if (state.burst) drawRays(stage, state.burstProgress, origin);
      }
      banner.visible = state.banner > 0;
      if (state.banner > 0) {
        const after = elapsed - clipMs;
        const pop = 1 + 1.4 * Math.max(0, 1 - after / BANNER_POP_MS) ** 2;
        const size = Math.max(
          tile.height * (stage.wild ? 1.5 : 1.15),
          (stage.wild ? 56 : 40) / pixelsPerWorld,
        );
        const fitted = (view.halfWidth * 1.8) / banner.getLocalBounds().width;
        const scale = Math.min(size / FONT_SIZE, fitted) * pop;
        banner.scale.set(scale, -scale);
        // The form can stand at the field's edge; its name stays in the middle of the view.
        banner.position.set(view.x, view.y + view.halfHeight * 0.55);
        banner.alpha = state.banner;
      }
    },
    isPlaying: () => !!active,
    dispose: () => {
      if (!behind.destroyed) behind.destroy({ children: true });
      if (!container.destroyed) container.destroy({ children: true });
      glow.destroy(true);
    },
  };
};

const i2color = (stage: TransformationStage) =>
  Math.random() < 0.5 ? stage.color : stage.glow;

const glowSprite = (texture: Texture) => {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.blendMode = "add";
  return sprite;
};

/** One soft radial falloff shared by every additive light in the sequence. */
const createGlowTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.3, "rgba(255,255,255,.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return Texture.from(canvas, true);
};

type TransformationStage = TransformationTier & { color: number; glow: number };
type TransformationTier = {
  rings: number;
  arcs: number;
  sparks: number;
  /** Milliseconds from the burst until the field returns to the fight. */
  hold: number;
  dim: number;
  shake: number;
  wild?: boolean;
};
