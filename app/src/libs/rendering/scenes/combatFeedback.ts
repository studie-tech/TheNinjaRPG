import { Container, FillGradient, Text, TextStyle } from "pixi.js";
import type { HitSeverity } from "@/libs/combat/playback";

/** Fights rarely land more at once; a rush past this reuses the oldest number. */
const NUMBER_POOL_SIZE = 12;
const FONT_SIZE = 48;
const SHAKE_MS = 300;
/** Numbers stay readable on a zoomed-out phone field, whatever the tile size. */
const SEVERITY = {
  light: { size: 0.5, minPx: 16, life: 1000, shake: 0 },
  heavy: { size: 0.68, minPx: 20, life: 1200, shake: 0.05 },
  crushing: { size: 0.95, minPx: 26, life: 1400, shake: 0.13 },
} as const;
const HEAL = { size: 0.5, minPx: 16, life: 1100 };
const NUMBER_STOPS = {
  light: { stops: ["#ffffff", "#ffd36b", "#ff7a2f"], stroke: 0x2a0a0a },
  heavy: { stops: ["#fff4c2", "#ffb02e", "#e3261b"], stroke: 0x2a0a0a },
  crushing: { stops: ["#ffffff", "#ff4a3a", "#8c0a16"], stroke: 0x12040a },
  heal: { stops: ["#f2fff4", "#5eea8d", "#0f9d58"], stroke: 0x06281a },
};

const numberStyle = (fill: FillGradient, stroke: number) =>
  new TextStyle({
    fontFamily: 'Impact, "Arial Black", "Arial Narrow", Arial, sans-serif',
    fontSize: FONT_SIZE,
    fontStyle: "italic",
    fontWeight: "900",
    fill,
    stroke: { color: stroke, width: 7, join: "round" },
    dropShadow: { color: 0x000000, alpha: 0.55, blur: 0, distance: 4, angle: 1.2 },
    padding: 10,
  });

const gradient = (stops: string[]) =>
  new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: "local",
    colorStops: stops.map((color, index) => ({
      offset: index / (stops.length - 1),
      color,
    })),
  });

/** Eases past the target and back, which gives a landed number its snap. */
const overshoot = (time: number) => {
  const t = time - 1;
  return 1 + t * t * (3.2 * t + 2.2);
};

/**
 * What a landing hit adds around the action's own artwork: numbers and the camera's kick.
 * Text is pooled, so only a landing hit touches glyphs; other frames move what exists.
 */
export const createCombatFeedback = (tileHeight: number) => {
  const container = new Container();
  container.label = "combat-feedback";
  const fills: FillGradient[] = [];
  const styles: Partial<Record<keyof typeof NUMBER_STOPS, TextStyle>> = {};
  /** Painted through a canvas on first use, so battles without a hit pay nothing. */
  const styleFor = (kind: keyof typeof NUMBER_STOPS) => {
    const existing = styles[kind];
    if (existing) return existing;
    const { stops, stroke } = NUMBER_STOPS[kind];
    const fill = gradient(stops);
    fills.push(fill);
    const style = numberStyle(fill, stroke);
    styles[kind] = style;
    return style;
  };
  const numbers = Array.from({ length: NUMBER_POOL_SIZE }, () => {
    const text = new Text({ text: "" });
    text.anchor.set(0.5);
    text.visible = false;
    container.addChild(text);
    return {
      text,
      userId: "",
      x: 0,
      y: 0,
      dirX: 0,
      lane: 0,
      tilt: 0,
      size: 0,
      minPx: 0,
      life: 0,
      startedAt: 0,
      active: false,
    };
  });
  /** The latest frame's scene time, which new feedback starts from. */
  let now = 0;
  let shakeAt = 0;
  let shakeSize = 0;
  /** Read each frame by the scene's camera, in world units. */
  const shake = { x: 0, y: 0 };

  return {
    container,
    shake,
    /** Show a health change; repeated hits on a fighter stack rather than overlap. */
    show: (hit: Hit) => {
      const free =
        numbers.find((entry) => !entry.active) ??
        numbers.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
      const lane = numbers.filter(
        (entry) => entry.active && entry !== free && entry.userId === hit.userId,
      ).length;
      const healing = hit.amount > 0;
      const grade = healing ? HEAL : SEVERITY[hit.severity];
      const value = Math.abs(hit.amount).toLocaleString("en-US");
      free.text.text = healing
        ? `+${value}`
        : hit.severity === "crushing"
          ? `${value}!`
          : value;
      free.text.style = styleFor(healing ? "heal" : hit.severity);
      free.text.visible = true;
      Object.assign(free, {
        userId: hit.userId,
        x: hit.x,
        y: hit.y,
        dirX: healing ? 0 : hit.dirX,
        lane,
        tilt: healing ? 0 : (hit.dirX < 0 ? 1 : -1) * (0.08 + Math.random() * 0.08),
        size: grade.size,
        minPx: grade.minPx,
        life: grade.life,
        startedAt: now,
        active: true,
      });
      if (healing) return;
      const kick = SEVERITY[hit.severity].shake;
      if (kick >= shakeSize * (1 - (now - shakeAt) / SHAKE_MS)) {
        shakeSize = kick;
        shakeAt = now;
      }
    },
    animate: (clock: number, reducedMotion: boolean, pixelsPerWorld: number) => {
      now = clock;
      for (const entry of numbers) {
        if (!entry.active) continue;
        const progress = (clock - entry.startedAt) / entry.life;
        if (progress >= 1) {
          entry.active = false;
          entry.text.visible = false;
          continue;
        }
        const size = Math.max(tileHeight * entry.size, entry.minPx / pixelsPerWorld);
        const landed = Math.min(1, progress / 0.14);
        const pop = reducedMotion ? 1 : 2.3 - 1.3 * overshoot(landed);
        const settle = 1 - progress * 0.12;
        const scale = (size / FONT_SIZE) * pop * settle;
        const arc = reducedMotion ? 0 : progress * (2 - progress);
        // The battlefield's Y axis points up, so text flips back to read upright.
        entry.text.scale.set(scale, -scale);
        entry.text.rotation = reducedMotion ? 0 : entry.tilt;
        entry.text.position.set(
          entry.x + entry.dirX * tileHeight * 0.75 * arc,
          entry.y + tileHeight * (0.85 * arc + 0.5 * entry.lane),
        );
        entry.text.alpha = progress < 0.7 ? 1 : (1 - progress) / 0.3;
      }
      const age = (clock - shakeAt) / SHAKE_MS;
      const reach =
        !reducedMotion && age < 1 ? shakeSize * tileHeight * (1 - age) ** 2 : 0;
      shake.x = reach && Math.sin(clock * 0.09) * reach;
      shake.y = reach && Math.cos(clock * 0.113) * reach;
    },
    /** Gradients outlive the pooled text that shares them. */
    dispose: () => {
      if (!container.destroyed) container.destroy({ children: true });
      for (const fill of fills) fill.destroy();
    },
    /** Numbers currently on the field, for tests and diagnostics. */
    active: () => numbers.filter((entry) => entry.active).length,
  };
};

type Hit = {
  userId: string;
  amount: number;
  severity: HitSeverity;
  /** Where the number starts, above the fighter. */
  x: number;
  y: number;
  /** Horizontal direction the blow travels; zero when nothing struck the fighter. */
  dirX: number;
};
