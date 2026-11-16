import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { createGlowTexture } from "@/libs/rendering/primitives/shadow";
import type { GameFrame } from "@/libs/rendering/runtime";
import {
  NUMBER_FONT_FAMILY,
  NUMBER_STOPS,
  overshoot,
} from "@/libs/rendering/scenes/combatFeedback";
import type { TdElement } from "@/libs/towerDefense/content";
import { formatTdNumber } from "@/libs/towerDefense/format";

/**
 * Transient tower-defense effects in arena units (y up): additive particles, rings,
 * lightning, streaks, floating numbers, screen flashes and camera shake. Particles and
 * numbers are pooled; rings, bolts and streaks are redrawn while any are alive, so a
 * crowded late wave allocates nothing per hit and an idle arena redraws nothing.
 */
export const createTowerDefenseFx = () => {
  const container = new Container();
  const glow = createGlowTexture();
  const shapes = new Graphics();
  shapes.blendMode = "add";
  let shapesDrawn = false;
  const particleLayer = new Container();
  const numberLayer = new Container();
  container.addChild(shapes, particleLayer, numberLayer);

  // Particles
  const particles = Array.from({ length: PARTICLES }, () => {
    const sprite = new Sprite(glow);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.visible = false;
    particleLayer.addChild(sprite);
    return {
      sprite,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      max: 1,
      size: 0,
      grow: 0,
      drag: 0,
      gravity: 0,
    };
  });
  let nextParticle = 0;
  const burst = (
    x: number,
    y: number,
    options: {
      color: number;
      count?: number;
      speed?: number;
      size?: number;
      life?: number;
      spread?: number;
      grow?: number;
      gravity?: number;
      drag?: number;
      angle?: number;
      arc?: number;
    },
  ) => {
    const count = options.count ?? 8;
    for (let i = 0; i < count; i++) {
      const particle = particles[nextParticle];
      nextParticle = (nextParticle + 1) % particles.length;
      if (!particle) continue;
      const angle =
        (options.angle ?? 0) + (Math.random() - 0.5) * (options.arc ?? Math.PI * 2);
      const speed = (options.speed ?? 2) * (0.35 + Math.random() * 0.65);
      const spread = options.spread ?? 0;
      particle.x = x + (Math.random() - 0.5) * spread;
      particle.y = y + (Math.random() - 0.5) * spread;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.max = particle.life =
        (options.life ?? 0.5) * (0.6 + Math.random() * 0.4);
      particle.size = (options.size ?? 0.25) * (0.6 + Math.random() * 0.6);
      particle.grow = options.grow ?? 0;
      particle.gravity = options.gravity ?? 0;
      particle.drag = options.drag ?? 2;
      particle.sprite.tint = options.color;
      particle.sprite.visible = true;
    }
  };

  // Rings, bolts and streaks, redrawn each frame
  const rings: {
    x: number;
    y: number;
    from: number;
    to: number;
    age: number;
    life: number;
    color: number;
    width: number;
    fill: number;
  }[] = [];
  const bolts: {
    points: { x: number; y: number }[];
    age: number;
    life: number;
    color: number;
    width: number;
    jitter: number;
  }[] = [];
  const streaks: {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    age: number;
    life: number;
    color: number;
    width: number;
  }[] = [];
  const ring = (
    x: number,
    y: number,
    options: {
      from?: number;
      to: number;
      life?: number;
      color: number;
      width?: number;
      fill?: number;
    },
  ) => {
    if (rings.length > 160) rings.shift();
    rings.push({
      x,
      y,
      from: options.from ?? 0,
      to: options.to,
      age: 0,
      life: options.life ?? 0.5,
      color: options.color,
      width: options.width ?? 0.12,
      fill: options.fill ?? 0,
    });
  };
  const bolt = (
    points: { x: number; y: number }[],
    options: { color: number; life?: number; width?: number; jitter?: number },
  ) => {
    if (bolts.length > 80) bolts.shift();
    bolts.push({
      points,
      age: 0,
      life: options.life ?? 0.3,
      color: options.color,
      width: options.width ?? 0.08,
      jitter: options.jitter ?? 0.25,
    });
  };
  const streak = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    options: { color: number; life?: number; width?: number },
  ) => {
    if (streaks.length > 80) streaks.shift();
    streaks.push({
      ax,
      ay,
      bx,
      by,
      age: 0,
      life: options.life ?? 0.25,
      color: options.color,
      width: options.width ?? 0.15,
    });
  };

  // Floating numbers: combat's lettering baked once into a glyph atlas, so a crowded wave
  // positions sprites instead of rasterising text. Bounties have their own pool so damage
  // numbers never recycle a kill's ryo before it is read.
  const atlas = createGlyphAtlas();
  const createPool = (size: number, length: number) =>
    Array.from({ length: size }, () => {
      const root = new Container();
      root.visible = false;
      const glyphs = Array.from({ length }, () => {
        const glyph = new Sprite(Texture.EMPTY);
        glyph.anchor.set(0.5);
        root.addChild(glyph);
        return glyph;
      });
      numberLayer.addChild(root);
      return {
        root,
        glyphs,
        age: 0,
        life: 1,
        x: 0,
        y: 0,
        dirX: 0,
        rise: 0,
        tilt: 0,
        scale: 0,
        pop: 0,
      };
    });
  const damagePool = { records: createPool(NUMBERS, 8), next: 0 };
  const ryoPool = { records: createPool(RYO_NUMBERS, 24), next: 0 };
  const numbers = [...damagePool.records, ...ryoPool.records];
  const showText = (
    pool: typeof damagePool,
    x: number,
    y: number,
    lines: { text: string; tone: NumberTone; size: number }[][],
    motion: Pick<
      (typeof damagePool.records)[number],
      "life" | "dirX" | "rise" | "tilt" | "scale" | "pop"
    >,
  ) => {
    const record = pool.records[pool.next];
    pool.next = (pool.next + 1) % pool.records.length;
    if (!record) return;
    Object.assign(record, motion, { x, y, age: 0 });
    record.root.visible = true;
    let used = 0;
    lines.forEach((segments, line) => {
      const width = segments.reduce(
        (sum, segment) =>
          sum +
          [...segment.text].reduce((w, c) => w + atlas.advance(c) * segment.size, 0),
        0,
      );
      let cursor = -width / 2;
      for (const segment of segments) {
        for (const character of segment.text) {
          const glyph = record.glyphs[used];
          if (!glyph) break;
          used += 1;
          const advance = atlas.advance(character) * segment.size;
          glyph.texture = atlas.view(segment.tone, character);
          glyph.visible = true;
          glyph.scale.set(segment.size);
          // Smaller lettering shares the line's baseline rather than its middle.
          glyph.position.set(
            cursor + advance / 2,
            line * GLYPH_LINE + (1 - segment.size) * GLYPH_BASELINE,
          );
          cursor += advance;
        }
      }
    });
    for (let index = used; index < record.glyphs.length; index++) {
      const glyph = record.glyphs[index];
      if (glyph) glyph.visible = false;
    }
  };
  /** A hit: combat's pop, tilt and sideways arc; critical hits in its crushing red. */
  const number = (
    x: number,
    y: number,
    value: number,
    options: { element: TdElement; crit?: boolean },
  ) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    showText(
      damagePool,
      x + (Math.random() - 0.5) * 0.3,
      y + 0.3,
      [
        [
          {
            text: `${formatTdNumber(value)}${options.crit ? "!" : ""}`,
            tone: options.crit ? "crit" : options.element,
            size: 1,
          },
        ],
      ],
      {
        life: options.crit ? 1.1 : 0.8,
        dirX: side * (0.3 + Math.random() * 0.3),
        rise: options.crit ? 0.95 : 0.7,
        tilt: -side * (0.08 + Math.random() * 0.08),
        scale: options.crit ? 0.015 : 0.0105,
        pop: 1.3,
      },
    );
  };
  /**
   * Ryo earned: a gold "+12" with a smaller "ryo", and under a bonus the reason it paid,
   * rising straight up and lingering longer than damage so it never reads as a hit.
   */
  const ryo = (x: number, y: number, amount: number, reason?: string) =>
    showText(
      ryoPool,
      x,
      y,
      [
        [
          { text: `+${formatTdNumber(amount)}`, tone: "ryo", size: 1 },
          { text: " ryo", tone: "ryo", size: 0.8 },
        ],
        ...(reason ? [[{ text: reason, tone: "label" as const, size: 0.6 }]] : []),
      ],
      {
        life: reason ? 2.2 : 1.4,
        dirX: 0,
        rise: reason ? 0.8 : 0.6,
        tilt: 0,
        scale: reason ? 0.015 : 0.0115,
        pop: 0.6,
      },
    );

  // Camera shake and full-screen flashes
  let shakeLeft = 0,
    shakePower = 0;
  const flashes: { color: number; alpha: number; age: number; life: number }[] = [];
  const shake = (power: number, seconds: number) => {
    shakePower = Math.max(shakePower * (shakeLeft > 0 ? 1 : 0), power);
    shakeLeft = Math.max(shakeLeft, seconds);
  };
  const flash = (color: number, alpha: number, seconds: number) => {
    if (flashes.length > 6) flashes.shift();
    flashes.push({ color, alpha, age: 0, life: seconds });
  };

  const update = (frame: GameFrame, reduced: boolean) => {
    const dt = Math.min(0.1, Math.max(0, frame.delta));
    for (const particle of particles) {
      if (!particle.sprite.visible) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.sprite.visible = false;
        continue;
      }
      const damping = Math.max(0, 1 - particle.drag * dt);
      particle.vx *= damping;
      particle.vy = particle.vy * damping - particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.size += particle.grow * dt;
      const t = particle.life / particle.max;
      particle.sprite.position.set(particle.x, particle.y);
      particle.sprite.alpha = Math.min(1, t * 1.6);
      const size = Math.max(0.01, particle.size) / 128;
      particle.sprite.scale.set(size * 2.2);
    }
    // Rings, bolts and streaks change every frame while they live; with none alive and
    // none drawn last frame the geometry is left untouched.
    if (shapesDrawn || rings.length + bolts.length + streaks.length > 0) shapes.clear();
    for (const entry of ageEntries(rings, dt)) {
      const t = entry.age / entry.life;
      const eased = 1 - (1 - t) * (1 - t);
      const radius = entry.from + (entry.to - entry.from) * eased;
      if (entry.fill > 0)
        shapes
          .circle(entry.x, entry.y, radius)
          .fill({ color: entry.color, alpha: entry.fill * (1 - t) });
      shapes.circle(entry.x, entry.y, Math.max(0.01, radius)).stroke({
        color: entry.color,
        alpha: 1 - t,
        width: entry.width * (1 - t * 0.5),
      });
    }
    for (const entry of ageEntries(bolts, dt)) {
      const alpha = 1 - entry.age / entry.life;
      for (const pass of [2.6, 1]) {
        const [first, ...rest] = entry.points;
        if (!first) continue;
        shapes.moveTo(first.x, first.y);
        let previous = first;
        for (const point of rest) {
          const segments = 4;
          for (let s = 1; s <= segments; s++) {
            const f = s / segments;
            const jitter = s === segments ? 0 : entry.jitter;
            shapes.lineTo(
              previous.x + (point.x - previous.x) * f + (Math.random() - 0.5) * jitter,
              previous.y + (point.y - previous.y) * f + (Math.random() - 0.5) * jitter,
            );
          }
          previous = point;
        }
        shapes.stroke({
          color: pass > 1 ? entry.color : 0xffffff,
          alpha: alpha * (pass > 1 ? 0.45 : 1),
          width: entry.width * pass,
        });
      }
    }
    for (const entry of ageEntries(streaks, dt)) {
      const t = entry.age / entry.life;
      const head = Math.min(1, t * 3);
      const tail = Math.max(0, t * 3 - 1.2);
      shapes
        .moveTo(
          entry.ax + (entry.bx - entry.ax) * tail,
          entry.ay + (entry.by - entry.ay) * tail,
        )
        .lineTo(
          entry.ax + (entry.bx - entry.ax) * head,
          entry.ay + (entry.by - entry.ay) * head,
        )
        .stroke({ color: entry.color, alpha: 1 - t, width: entry.width });
    }
    shapesDrawn = rings.length + bolts.length + streaks.length > 0;
    for (const record of numbers) {
      if (!record.root.visible) continue;
      record.age += dt;
      const progress = record.age / record.life;
      if (progress >= 1) {
        record.root.visible = false;
        continue;
      }
      const landed = Math.min(1, progress / 0.14);
      const pop = reduced ? 1 : 1 + record.pop - record.pop * overshoot(landed);
      const scale = record.scale * pop * (1 - progress * 0.12);
      const arc = reduced ? 0 : progress * (2 - progress);
      // The arena's Y axis points up, so text flips back to read upright.
      record.root.scale.set(scale, -scale);
      record.root.rotation = reduced ? 0 : record.tilt;
      record.root.position.set(
        record.x + record.dirX * arc,
        record.y + record.rise * arc,
      );
      record.root.alpha = progress < 0.7 ? 1 : (1 - progress) / 0.3;
    }
    let offsetX = 0,
      offsetY = 0;
    if (shakeLeft > 0 && !reduced) {
      shakeLeft -= dt;
      const power = shakePower * Math.max(0, Math.min(1, shakeLeft / 0.25));
      offsetX = (Math.random() - 0.5) * 2 * power;
      offsetY = (Math.random() - 0.5) * 2 * power;
    }
    let overlay: { color: number; alpha: number } | null = null;
    // The newest of equally bright flashes sets the colour.
    for (const entry of ageEntries(flashes, dt)) {
      const alpha = entry.alpha * (1 - entry.age / entry.life);
      if (!overlay || alpha >= overlay.alpha) overlay = { color: entry.color, alpha };
    }
    return {
      offsetX,
      offsetY,
      overlay:
        reduced && overlay ? { ...overlay, alpha: overlay.alpha * 0.3 } : overlay,
    };
  };

  return {
    container,
    burst,
    ring,
    bolt,
    streak,
    number,
    ryo,
    shake,
    flash,
    update,
    dispose: () => {
      atlas.dispose();
      glow.destroy(true);
    },
  };
};

const PARTICLES = 900;
const NUMBERS = 48;
const RYO_NUMBERS = 16;
const GLYPH_FONT_PX = 44;
const GLYPH_CELL_WIDTH = 52;
const GLYPH_CELL_HEIGHT = 72;
/** Line spacing and the drop that seats smaller lettering on the baseline, in atlas pixels. */
const GLYPH_LINE = 46;
const GLYPH_BASELINE = 16;
const GLYPH_CHARACTERS = "0123456789.KMBTQS!-+ abcdefghijklmnopqrstuvwxyz";

/** Damage takes its element's colour, critical hits combat's crushing grade, ryo gold. */
const NUMBER_TONES = {
  physical: { stops: ["#ffffff", "#e8edf6", "#9aa6bc"], stroke: 0x14161c },
  fire: NUMBER_STOPS.heavy,
  lightning: { stops: ["#ffffff", "#a8dcff", "#3d7cf0"], stroke: 0x0a1530 },
  water: { stops: ["#eaf8ff", "#56c6ff", "#0b6fb8"], stroke: 0x06203a },
  wind: { stops: ["#f4fff7", "#aef5c6", "#2f9e6a"], stroke: 0x062a18 },
  earth: { stops: ["#fff0dc", "#d9a66c", "#8a5a2b"], stroke: 0x24150a },
  crit: NUMBER_STOPS.crushing,
  ryo: { stops: ["#fffbe3", "#ffd84a", "#d98a00"], stroke: 0x3a2200 },
  label: { stops: ["#ffffff", "#fff6d6", "#ffe3a0"], stroke: 0x2a1c08 },
} satisfies Record<string, { stops: string[]; stroke: number }>;
type NumberTone = keyof typeof NUMBER_TONES;

/** Age every entry by `dt` and drop, in place, those that outlived their `life`. */
const ageEntries = <T extends { age: number; life: number }>(
  entries: T[],
  dt: number,
) => {
  let kept = 0;
  for (const entry of entries) {
    entry.age += dt;
    if (entry.age < entry.life) entries[kept++] = entry;
  }
  entries.length = kept;
  return entries;
};

/** Every tone's glyphs in one canvas: one row per tone, gradient-filled and outlined. */
const createGlyphAtlas = () => {
  const tones = Object.keys(NUMBER_TONES) as NumberTone[];
  const characters = [...GLYPH_CHARACTERS];
  const canvas = document.createElement("canvas");
  canvas.width = characters.length * GLYPH_CELL_WIDTH;
  canvas.height = tones.length * GLYPH_CELL_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Damage numbers need a 2D canvas");
  context.font = `italic 900 ${GLYPH_FONT_PX}px ${NUMBER_FONT_FAMILY}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 7;
  const advances = new Map(
    characters.map((character) => [
      character,
      context.measureText(character).width + 2,
    ]),
  );
  tones.forEach((tone, row) => {
    const { stops, stroke } = NUMBER_TONES[tone];
    const middle = row * GLYPH_CELL_HEIGHT + GLYPH_CELL_HEIGHT / 2;
    const fill = context.createLinearGradient(
      0,
      middle - GLYPH_FONT_PX / 2,
      0,
      middle + GLYPH_FONT_PX / 2,
    );
    stops.forEach((color, index) => {
      fill.addColorStop(index / (stops.length - 1), color);
    });
    characters.forEach((character, column) => {
      const x = column * GLYPH_CELL_WIDTH + GLYPH_CELL_WIDTH / 2;
      // Combat's drop shadow falls under the outline only, as its text style does.
      context.shadowColor = "rgba(0,0,0,0.55)";
      context.shadowOffsetX = 1.5;
      context.shadowOffsetY = 3.7;
      context.strokeStyle = `#${stroke.toString(16).padStart(6, "0")}`;
      context.strokeText(character, x, middle);
      context.shadowColor = "transparent";
      context.fillStyle = fill;
      context.fillText(character, x, middle);
    });
  });
  const source = Texture.from(canvas);
  const views = tones.map((_, row) =>
    characters.map(
      (_, column) =>
        new Texture({
          source: source.source,
          frame: new Rectangle(
            column * GLYPH_CELL_WIDTH,
            row * GLYPH_CELL_HEIGHT,
            GLYPH_CELL_WIDTH,
            GLYPH_CELL_HEIGHT,
          ),
        }),
    ),
  );
  return {
    view: (tone: NumberTone, character: string) =>
      views[tones.indexOf(tone)]?.[characters.indexOf(character)] ?? Texture.EMPTY,
    advance: (character: string) => advances.get(character) ?? GLYPH_FONT_PX / 2,
    dispose: () => {
      for (const row of views) for (const view of row) view.destroy(false);
      source.destroy(true);
    },
  };
};
