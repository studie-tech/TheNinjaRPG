import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { GameFrame } from "@/libs/rendering/runtime";
import { createGlowTexture } from "@/libs/rendering/scenes/combatTransformation";
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

  // Floating numbers from a glyph atlas
  const atlas = createGlyphAtlas();
  const numbers = Array.from({ length: NUMBERS }, () => {
    const root = new Container();
    root.visible = false;
    const glyphs = Array.from({ length: 8 }, () => {
      const glyph = new Sprite(atlas.views[0]);
      glyph.anchor.set(0.5);
      root.addChild(glyph);
      return glyph;
    });
    numberLayer.addChild(root);
    return { root, glyphs, age: 0, life: 0.8, vy: 0 };
  });
  let nextNumber = 0;
  const number = (
    x: number,
    y: number,
    value: number,
    options: { color: number; crit?: boolean; scale?: number; prefix?: string },
  ) => {
    const record = numbers[nextNumber];
    nextNumber = (nextNumber + 1) % numbers.length;
    if (!record) return;
    const text =
      `${options.prefix ?? ""}${formatTdNumber(value)}${options.crit ? "!" : ""}`.slice(
        0,
        record.glyphs.length,
      );
    const scale = (options.scale ?? 1) * (options.crit ? 0.016 : 0.011);
    record.root.position.set(
      x + (Math.random() - 0.5) * 0.5,
      y + 0.4 + Math.random() * 0.3,
    );
    record.root.scale.set(scale, -scale);
    record.root.alpha = 1;
    record.root.visible = true;
    record.age = 0;
    record.life = options.crit ? 1.1 : 0.75;
    record.vy = options.crit ? 1.6 : 1.1;
    record.glyphs.forEach((glyph, index) => {
      const character = text[index];
      glyph.visible = character !== undefined;
      glyph.texture =
        atlas.views[Math.max(0, atlas.characters.indexOf(character ?? "0"))] ??
        Texture.EMPTY;
      glyph.tint = options.color;
      glyph.position.set((index - (text.length - 1) / 2) * 24, 0);
    });
  };

  // Camera shake and full-screen flashes
  let shakeLeft = 0,
    shakePower = 0;
  const flashes: { color: number; alpha: number; age: number; life: number }[] = [];
  const shake = (power: number, seconds = 0.3) => {
    shakePower = Math.max(shakePower * (shakeLeft > 0 ? 1 : 0), power);
    shakeLeft = Math.max(shakeLeft, seconds);
  };
  const flash = (color: number, alpha: number, seconds = 0.35) => {
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
    for (let i = rings.length - 1; i >= 0; i--) {
      const entry = rings[i];
      if (!entry) continue;
      entry.age += dt;
      if (entry.age >= entry.life) {
        rings.splice(i, 1);
        continue;
      }
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
    for (let i = bolts.length - 1; i >= 0; i--) {
      const entry = bolts[i];
      if (!entry) continue;
      entry.age += dt;
      if (entry.age >= entry.life) {
        bolts.splice(i, 1);
        continue;
      }
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
    for (let i = streaks.length - 1; i >= 0; i--) {
      const entry = streaks[i];
      if (!entry) continue;
      entry.age += dt;
      if (entry.age >= entry.life) {
        streaks.splice(i, 1);
        continue;
      }
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
      if (record.age >= record.life) {
        record.root.visible = false;
        continue;
      }
      if (!reduced) record.root.y += record.vy * dt;
      record.vy *= Math.max(0, 1 - 2.5 * dt);
      const t = record.age / record.life;
      record.root.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
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
    for (let i = flashes.length - 1; i >= 0; i--) {
      const entry = flashes[i];
      if (!entry) continue;
      entry.age += dt;
      if (entry.age >= entry.life) {
        flashes.splice(i, 1);
        continue;
      }
      const alpha = entry.alpha * (1 - entry.age / entry.life);
      if (!overlay || alpha > overlay.alpha) overlay = { color: entry.color, alpha };
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
    glow,
    burst,
    ring,
    bolt,
    streak,
    number,
    shake,
    flash,
    update,
    dispose: () => {
      atlas.dispose();
      glow.destroy(true);
    },
  };
};

export type TowerDefenseFx = ReturnType<typeof createTowerDefenseFx>;

const PARTICLES = 900;
const NUMBERS = 48;

const createGlyphAtlas = () => {
  const characters = "0123456789.KMBTqQsSond!-+∞";
  const canvas = document.createElement("canvas");
  canvas.width = characters.length * 32;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Damage numbers need a 2D canvas");
  context.font = "900 40px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 7;
  context.strokeStyle = "rgba(0,0,0,0.85)";
  context.fillStyle = "white";
  [...characters].forEach((character, index) => {
    context.strokeText(character, index * 32 + 16, 33);
    context.fillText(character, index * 32 + 16, 33);
  });
  const source = Texture.from(canvas);
  const views = [...characters].map(
    (_, index) =>
      new Texture({
        source: source.source,
        frame: new Rectangle(index * 32, 0, 32, 64),
      }),
  );
  return {
    characters,
    views,
    dispose: () => {
      for (const view of views) view.destroy(false);
      source.destroy(true);
    },
  };
};
