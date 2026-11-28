import {
  Container,
  Graphics,
  GraphicsContext,
  RenderLayer,
  Sprite,
  Texture,
} from "pixi.js";
import { CS_PICKUP_URLS, type CsSfx, TD_SHURIKEN_IMAGE_URL } from "@/drizzle/constants";
import {
  CS_ARENA_HALF,
  CS_BOSS_DASH_SECONDS,
  CS_BOSS_DASH_SPEED,
  CS_BOSS_WINDUP_SECONDS,
  CS_ENEMY_KINDS,
  CS_JUTSU_INFO,
  CS_RUN_SECONDS,
  CS_STAGE_INFO,
  CS_STAGES,
  CS_TICK_SECONDS,
  type CsJutsu,
  type CsStage,
  csPaced,
} from "@/libs/chakraStorm/content";
import {
  CS_DIRECTIONS,
  type CsEnemy,
  type CsEvent,
  type CsState,
  csGroundLayout,
  csHeroStep,
  csInPond,
  csPickupRange,
  csSeconds,
  csSicklePositions,
} from "@/libs/chakraStorm/sim";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { lpcFacing } from "@/libs/lpc/catalog";
import { CHARACTER_FOOT_Y } from "@/libs/rendering/characterFrame";
import {
  createLpcCharacter,
  type LpcCharacter,
} from "@/libs/rendering/primitives/character";
import {
  createRosterArtCache,
  FRAME_FOOT,
  NO_ROSTER_ART,
  type RosterArt,
  type RosterCharacter,
} from "@/libs/rendering/primitives/rosterArt";
import {
  createGlowTexture,
  createSoftShadowTexture,
} from "@/libs/rendering/primitives/shadow";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { createTowerDefenseFx } from "@/libs/rendering/scenes/towerDefenseFx";
import { prepareTowerDefenseTerrain } from "@/libs/rendering/scenes/towerDefenseTerrain";
import { createRenderScope } from "@/libs/rendering/scope";
import { spriteAnimationFrame } from "@/libs/spriteAnimations";
import type { TdElement } from "@/libs/towerDefense/content";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

export interface ChakraStormSceneView {
  state: CsState | null;
  /** Real seconds simulated past `state.tick`, for smooth motion between ticks. */
  pending: number;
}

/** Units the camera shows across the shorter of its two spans, at the least. */
const VIEW_UNITS = 15;
/**
 * Hexes across the terrain: one per unit across, with rows closer than that, and a margin
 * past the battlefield so the camera rarely reaches the terrain's edge.
 */
const TERRAIN_SIZE = 2 * CS_ARENA_HALF + 25;
/** How long the field keeps animating after the run ends, for its closing effects. */
const GAME_OVER_SETTLE_MS = 2_500;
const HERO_SCALE = 1.5;
/** Screen-edge pointers: how far in from the edge they sit, in CSS pixels. */
const POINTER_INSET = 22;
const FROZEN_TINT = 0x9fe8ff;
/** Damage numbers a frame shows before only critical hits still get one. */
const NUMBERS_PER_FRAME = 8;
/** Undercover's hostiles climb the whole roster over this much of its paced clock. */
const ENDLESS_ROSTER_SECONDS = 1_800;
/** Undercover's sun crosses the sky and back every two of these. */
const ENDLESS_DAY_SECONDS = 1_200;

/**
 * Renders a Chakra Storm run from the deterministic simulation: the stage's battlefield,
 * the hero, raiders drawn as the game's AI characters, jutsu, pickups and pointers to
 * what lies off screen. The camera follows the hero; `onFrame` advances the run and
 * `getView` exposes its state.
 */
export const createChakraStormScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  onError: (error: unknown) => void;
  seed: string;
  stage: CsStage;
  lpcCatalog?: LpcCatalog;
  appearance?: SpriteAppearance;
  /** AI characters drawn as hostiles, with the level that ranks them. */
  roster: (RosterCharacter & { level: number })[];
  onFrame: (delta: number) => void;
  /** Play a game sound effect; the caller applies the player's sound settings. */
  playSound?: (cue: CsSfx, volume: number) => void;
  getView: () => ChakraStormSceneView;
}) => {
  const stageInfo = CS_STAGE_INFO[options.stage];
  const game = await createGameRenderer({
    lpcCatalog: options.lpcCatalog,
    surface: "chakra-storm",
    mount: options.mount,
    signal: options.signal,
    onError: options.onError,
    background: 0x0b0d16,
    height: () => Math.max(1, options.mount.clientHeight),
  });
  try {
    const scope = createRenderScope(game);
    const camera = new Container();
    // The camera follows the hero every frame; as a render group the world moves as one
    // transform on the GPU instead of recomputing every terrain sprite's on the CPU.
    const world = new Container({ isRenderGroup: true });
    const terrainLayer = new Container();
    const groundFx = new Graphics();
    const pickups = new Graphics();
    // Pickup glows and art sit in separate layers so each draws as one batch instead of
    // switching blend mode at every orb.
    const pickupGlowLayer = new Container({ label: "chakra-storm-pickup-glows" });
    const pickupLayer = new Container({ label: "chakra-storm-pickups" });
    const actorLayer = new Container({ label: "chakra-storm-actors" });
    const sceneryGround = new RenderLayer();
    const depthLayer = new RenderLayer({ sortableChildren: true });
    const unlitLayer = new RenderLayer();
    const projectileLayer = new Container();
    const projectileGlowLayer = new Container();
    // The hero draws above the crowd, so it is never lost behind raiders.
    const heroLayer = new Container({ label: "chakra-storm-hero" });
    const fx = createTowerDefenseFx();
    game.own(fx.dispose);
    world.addChild(
      terrainLayer,
      groundFx,
      pickups,
      pickupGlowLayer,
      pickupLayer,
      actorLayer,
      depthLayer,
      unlitLayer,
      heroLayer,
      projectileLayer,
      projectileGlowLayer,
      fx.container,
    );
    camera.addChild(world);
    const sky = new Graphics();
    // Held apart from the sprite: tearing the stage down empties the sprite's texture.
    const vignetteTexture = createVignetteTexture();
    const vignette = new Sprite(vignetteTexture);
    game.own(() => vignetteTexture.destroy(true));
    const screenFlash = new Graphics();
    const pointers = new Graphics();
    game.stage.addChild(camera, sky, vignette, screenFlash, pointers);

    // Terrain: the region's biome, one hex per unit, lit like the sector maps. The
    // simulation's ponds, trees and rocks are drawn exactly where it collides with them;
    // beyond the battlefield's edge the forest grows freely.
    const ground = csGroundLayout(options.seed, options.stage);
    const terrain = prepareTowerDefenseTerrain(
      `${options.seed}:${options.stage}`,
      TERRAIN_SIZE,
      { units: CS_ARENA_HALF + 1 },
      stageInfo.biome,
      { half: CS_ARENA_HALF, ponds: ground.ponds, obstacles: ground.obstacles },
    );
    const lighting = createProjectedWorldLighting(game, terrainLayer);
    const [hexes, scenery] = await Promise.all([
      createHexTerrain(scope, terrain.terrain),
      createWorldSprites(scope, terrain.scenery, lighting),
    ]);
    if (game.isDisposed())
      throw new DOMException("Chakra Storm cancelled", "AbortError");
    const { unitPx, center } = terrain;
    lighting.container.addChild(hexes.container, scenery.container, sceneryGround);
    game.own(lighting.registerTerrain(hexes.container, terrain.terrain));
    terrainLayer.addChild(lighting.container);
    terrainLayer.scale.set(1 / unitPx);
    terrainLayer.position.set(-center.x / unitPx, -center.y / unitPx);
    scenery.attachLayers({ ground: sceneryGround, world: depthLayer, ui: unlitLayer });
    const depthOf = (y: number) => -(y * unitPx + center.y);
    // The battlefield's edge, where the hero and raiders stop.
    const border = new Graphics()
      .rect(-CS_ARENA_HALF, -CS_ARENA_HALF, CS_ARENA_HALF * 2, CS_ARENA_HALF * 2)
      .stroke({ color: 0xffd36b, alpha: 0.35, width: 0.12 });
    world.addChildAt(border, 1);

    const contactTexture = createSoftShadowTexture();
    const glow = createGlowTexture();
    game.own(() => {
      contactTexture.destroy(true);
      glow.destroy(true);
    });
    const contact = (width: number) => {
      const sprite = new Sprite(contactTexture);
      sprite.anchor.set(0.5);
      sprite.width = width;
      sprite.height = width * 0.36;
      return sprite;
    };
    const shuriken = await game.assets
      .texture(TD_SHURIKEN_IMAGE_URL, 64)
      .catch((error: unknown) => {
        if (game.signal.aborted || game.isDisposed()) throw error;
        console.warn("Chakra Storm shuriken artwork unavailable", error);
        return Texture.WHITE;
      });

    // Pickup art: painted crystals, onigiri, scrolls and talismans. Any that fail to load
    // fall back to drawn shapes.
    const pickupArt = Object.fromEntries(
      await Promise.all(
        (Object.entries(CS_PICKUP_URLS) as [PickupArt, string][]).map(
          async ([key, url]) =>
            [key, await game.assets.texture(url, 128).catch(() => null)] as const,
        ),
      ),
    ) as Record<PickupArt, Texture | null>;
    if (game.isDisposed())
      throw new DOMException("Chakra Storm cancelled", "AbortError");
    const pickupSprites = new Map<number, PickupView>();
    const sparePickups: PickupView[] = [];
    game.own(() => {
      for (const view of [...sparePickups, ...pickupSprites.values()]) {
        view.glow.destroy();
        view.item.destroy();
      }
    });

    // The hero, standing on a soft chakra glow that picks it out of the crowd.
    const heroRoot = new Container();
    const pickupRing = new Graphics()
      .circle(0, 0, 1)
      .stroke({ color: 0x8fd3ff, alpha: 0.16, width: 0.04 });
    const aura = new Sprite(glow);
    aura.anchor.set(0.5);
    aura.tint = 0x6fd3ff;
    aura.alpha = 0.55;
    aura.blendMode = "add";
    const heroRing = new Graphics()
      .ellipse(0, 0, 0.62, 0.26)
      .stroke({ color: 0xe8fbff, alpha: 0.9, width: 0.06 });
    heroRoot.addChild(aura, contact(1.1), heroRing);
    actorLayer.addChild(pickupRing);
    heroLayer.addChild(heroRoot);
    const hero: LpcCharacter | null =
      options.appearance && game.lpcCatalog
        ? await createLpcCharacter(game, options.appearance, "all").catch(() => null)
        : null;
    if (game.isDisposed())
      throw new DOMException("Chakra Storm cancelled", "AbortError");
    if (hero) {
      hero.sprite.scale.set(HERO_SCALE, -HERO_SCALE);
      hero.sprite.position.set(0, CHARACTER_FOOT_Y * HERO_SCALE);
      heroRoot.addChild(hero.sprite);
    } else
      heroRoot.addChild(
        new Graphics()
          .circle(0, 0.45, 0.4)
          .fill(0x2b2f4a)
          .stroke({ color: 0xffffff, width: 0.06 }),
      );
    let heroAnimation: LpcAnimation = "combat",
      heroAnimationUntil = 0,
      heroDirection: LpcDirection = 2,
      heroRestart = false,
      hurtUntil = 0,
      auraBoostUntil = 0,
      auraColor = 0x6fd3ff;
    const cueHero = (animation: LpcAnimation, now: number) => {
      heroAnimation = animation;
      heroAnimationUntil = now + (hero?.durations[animation] ?? 400);
      heroRestart = true;
    };

    // Hostiles: AI characters from the roster, ranked by level. A window of six climbs
    // the ranks with the region and the run, so the first region starts among wolves and
    // bandits and later ones meet veterans; tougher kinds stand higher in the window, and
    // hunters come from further up. Few characters at a time keeps the sheets few.
    const rosterArt = createRosterArtCache(game);
    const roster = [...options.roster].sort(
      (a, b) => a.level - b.level || a.userId.localeCompare(b.userId),
    );
    const endless = !!stageInfo.endless;
    const stageRank = endless ? 0 : CS_STAGES.indexOf(options.stage) / CS_STAGES.length;
    const rosterFor = (enemy: CsEnemy, seconds: number) => {
      if (roster.length === 0) return undefined;
      // Undercover starts among Horizon's raiders and climbs the whole roster as its
      // clock runs on.
      const climb = endless
        ? Math.min(1, csPaced(options.stage, seconds) / ENDLESS_ROSTER_SECONDS)
        : Math.min(1, seconds / CS_RUN_SECONDS);
      const rank = Math.min(
        0.97,
        0.01 + stageRank * 0.8 + climb * (endless ? 0.96 : 0.18),
      );
      const step = Math.max(1, Math.round(roster.length * 0.01));
      const base = Math.floor(rank * (roster.length - 6 * step));
      const kind = Math.min(5, CS_ENEMY_KINDS.indexOf(enemy.kind));
      const slot =
        enemy.kind === "boss"
          ? Math.round(roster.length * 0.15) + (enemy.id % 3) * step
          : (kind + (enemy.elite ? 2 : 0) + (enemy.id % 2)) * step;
      return roster[Math.min(roster.length - 1, base + slot)];
    };
    const enemies = new Map<number, EnemyRecord>();
    const spareEnemies: EnemyRecord[] = [];
    game.own(() => {
      for (const record of spareEnemies.splice(0))
        record.root.destroy({ children: true });
      for (const record of enemies.values()) record.root.destroy({ children: true });
    });
    // Shapes every hostile shares; each record draws them through its own Graphics.
    const haloShape = new GraphicsContext()
      .ellipse(0, 0.05, 0.8, 0.34)
      .stroke({ color: 0xffffff, width: 0.08 });
    const fallbackShape = new GraphicsContext()
      .circle(0, 0.45, 0.4)
      .fill(0x7a2b2b)
      .stroke({ color: 0x000000, width: 0.05 });
    const iceShape = new GraphicsContext()
      .roundRect(-0.45, 0, 0.9, 1.2, 0.12)
      .fill({ color: FROZEN_TINT, alpha: 0.28 })
      .stroke({ color: 0xe8fbff, alpha: 0.7, width: 0.05 });
    game.own(() => {
      for (const shape of [haloShape, fallbackShape, iceShape]) shape.destroy();
    });
    /**
     * A record holds only its shadow and body until it needs more: the halo, fallback,
     * ice and health bar join while they show and leave after, so a crowd of hundreds
     * keeps the scene graph small.
     */
    const createEnemyRecord = (): EnemyRecord => {
      const root = new Container();
      const halo = new Graphics(haloShape);
      const body = new Sprite(Texture.EMPTY);
      body.anchor.set(0.5, 1);
      const fallback = new Graphics(fallbackShape);
      const ice = new Graphics(iceShape);
      const barBack = new Sprite(Texture.WHITE);
      const barFill = new Sprite(Texture.WHITE);
      barBack.tint = 0x000000;
      barBack.alpha = 0.6;
      root.addChild(contact(1), body);
      return {
        root,
        body,
        fallback,
        halo,
        ice,
        barBack,
        barFill,
        art: NO_ROSTER_ART,
        x: 0,
        y: 0,
        bornAt: 0,
        flashUntil: 0,
        seenFrame: 0,
      };
    };
    const spawnEnemy = (enemy: CsEnemy, seconds: number, now: number) => {
      const record = spareEnemies.pop() ?? createEnemyRecord();
      record.art = rosterArt.artFor(rosterFor(enemy, seconds));
      record.art.users++;
      record.x = enemy.x;
      record.y = enemy.y;
      record.bornAt = now;
      record.flashUntil = 0;
      record.root.scale.set(enemy.radius / 0.4);
      attach(record, record.halo, enemy.elite || enemy.kind === "boss", "below");
      record.halo.tint = enemy.kind === "boss" ? 0xff3b3b : 0xffb02e;
      record.root.alpha = 0;
      actorLayer.addChild(record.root);
      depthLayer.attach(record.root);
      enemies.set(enemy.id, record);
      return record;
    };

    // Sprites for shuriken, comets, wisps, orbs and sickles, pooled across frames.
    const projectileSprites = new Map<number, Sprite>();
    const spareSprites: Sprite[] = [];
    const sickleSprites: Sprite[] = [];
    const takeSprite = () => {
      const sprite = spareSprites.pop() ?? new Sprite({ anchor: 0.5 });
      sprite.alpha = 1;
      sprite.blendMode = "normal";
      projectileLayer.addChild(sprite);
      return sprite;
    };
    /** Captains' charge warnings: the line they are about to rush along. */
    const windups = new Map<
      number,
      { x: number; y: number; dx: number; dy: number; until: number }
    >();

    let viewScale = 1;
    const resize = (width: number, height: number) => {
      viewScale = Math.min(width, height) / VIEW_UNITS;
      world.scale.set(viewScale, -viewScale);
      sky.clear().rect(0, 0, width, height).fill(0xffffff);
      screenFlash.clear().rect(0, 0, width, height).fill(0xffffff);
      screenFlash.alpha = 0;
      // A soft dark rim pulls the eye to the middle of the field.
      vignette.width = width;
      vignette.height = height;
    };
    game.setResize(resize);

    // Each event kind keeps its own gap, so a crowd's hits stay a rhythm, not a roar.
    const lastSound = new Map<string, number>();
    let soundTick = -1;
    let lastWhirl = Number.NEGATIVE_INFINITY;
    let lastWade = Number.NEGATIVE_INFINITY;
    /**
     * Sounds the simulation has no event for, while time runs: the sickles whirling once a
     * turn and the hero's feet splashing through a pond.
     */
    const playAmbient = (state: CsState, now: number) => {
      if (!options.playSound || state.over || state.tick === soundTick) return;
      soundTick = state.tick;
      const gale = state.jutsu.find((entry) => entry.id === "gale");
      if (gale && now - lastWhirl >= (gale.awakened ? 650 : 900)) {
        lastWhirl = now;
        options.playSound("wind", gale.awakened ? 0.16 : 0.12);
      }
      const { hero } = state;
      if (hero.move >= 0 && now - lastWade >= 420 && csInPond(state, hero.x, hero.y)) {
        lastWade = now;
        options.playSound("splash", 0.1);
      }
    };
    const handleEvent = (event: CsEvent, state: CsState, now: number) => {
      const cue = eventSound(event);
      if (cue && options.playSound) {
        const [name, volume, gapMs] = cue;
        const key = `${event.type}:${name}`;
        if (now - (lastSound.get(key) ?? Number.NEGATIVE_INFINITY) >= gapMs) {
          lastSound.set(key, now);
          options.playSound(name, volume);
        }
      }
      switch (event.type) {
        case "hit": {
          const record = enemies.get(event.id);
          if (record) record.flashUntil = now + 90;
          // A crowd takes hundreds of hits a second; past a handful a frame only critical
          // hits still show their numbers, which are the ones worth reading.
          numbersThisFrame++;
          if (numbersThisFrame > NUMBERS_PER_FRAME && !event.crit) break;
          fx.number(event.x, event.y + 1, event.amount, {
            element: event.element,
            crit: event.crit,
          });
          break;
        }
        case "kill":
          fx.burst(event.x, event.y + 0.4, {
            color: event.elite || event.kind === "boss" ? 0xffb02e : 0xff6b6b,
            count: event.kind === "boss" ? 40 : event.elite ? 22 : 6,
            speed: event.kind === "boss" ? 6 : event.elite ? 4 : 2.4,
            size: 0.35,
            life: 0.45,
          });
          if (event.kind === "boss") {
            fx.shake(0.6, 0.8);
            fx.flash(0xfff3c4, 0.4, 0.6);
          } else if (event.elite) fx.shake(0.25, 0.3);
          break;
        case "cast": {
          if (event.jutsu === "ember" || event.jutsu === "thunder")
            cueHero("spellcast", now);
          if (event.jutsu === "tidal")
            fx.burst(event.x, event.y + 0.3, {
              color: CS_JUTSU_INFO.tidal.glow,
              count: 14,
              speed: 3,
              size: 0.3,
              life: 0.5,
            });
          break;
        }
        case "chain":
          fx.bolt(event.points, {
            color: event.awakened ? 0xd6b4ff : CS_JUTSU_INFO.thunder.glow,
            life: 0.3,
            width: event.awakened ? 0.14 : 0.08,
          });
          for (const point of event.points.slice(1))
            fx.burst(point.x, point.y, {
              color: CS_JUTSU_INFO.thunder.glow,
              count: 4,
              speed: 2.5,
              size: 0.25,
              life: 0.3,
            });
          break;
        case "burst":
          fx.ring(event.x, event.y, {
            to: event.radius,
            color: event.awakened ? 0xffd36b : CS_JUTSU_INFO.ember.glow,
            fill: event.awakened ? 0.18 : 0.35,
            life: 0.45,
            width: 0.15,
          });
          fx.burst(event.x, event.y, {
            color: CS_JUTSU_INFO.ember.glow,
            count: event.awakened ? 30 : 14,
            speed: event.radius * 2.2,
            size: 0.45,
            life: 0.55,
          });
          if (event.awakened) fx.shake(0.18, 0.2);
          break;
        case "bloom":
          fx.ring(event.x, event.y, {
            to: event.radius,
            color: CS_JUTSU_INFO.frost.glow,
            fill: 0.3,
            life: 0.6,
            width: 0.1,
          });
          fx.burst(event.x, event.y + 0.3, {
            color: 0xe8fbff,
            count: 12,
            speed: 2,
            size: 0.3,
            life: 0.7,
            gravity: -0.5,
          });
          break;
        case "hurt":
          hurtUntil = now + 220;
          fx.flash(0xff2a2a, 0.2, 0.25);
          fx.shake(0.12, 0.15);
          cueHero("hurt", now);
          break;
        case "pickup":
          if (event.kind === "scroll") {
            fx.ring(state.hero.x, state.hero.y + 0.4, {
              to: 2.2,
              color: 0xffd36b,
              life: 0.7,
              fill: 0.2,
            });
            fx.burst(state.hero.x, state.hero.y + 0.6, {
              color: 0xffd36b,
              count: 18,
              speed: 3,
              size: 0.35,
              life: 0.8,
              gravity: -1,
            });
          } else if (event.kind === "onigiri") {
            fx.burst(state.hero.x, state.hero.y + 0.6, {
              color: 0x7dff9a,
              count: 12,
              speed: 1.8,
              size: 0.3,
              life: 0.6,
              gravity: -2,
            });
          } else if (event.kind === "talisman") {
            fx.ring(state.hero.x, state.hero.y + 0.4, {
              to: 9,
              color: 0x8fd3ff,
              life: 0.8,
              width: 0.2,
            });
          }
          break;
        case "level":
          fx.ring(state.hero.x, state.hero.y + 0.4, {
            to: 3,
            color: 0x8fd3ff,
            life: 0.7,
            fill: 0.15,
          });
          auraBoostUntil = now + 900;
          auraColor = 0x8fd3ff;
          break;
        case "awaken": {
          const color = CS_JUTSU_INFO[event.jutsu].glow;
          fx.ring(state.hero.x, state.hero.y + 0.4, {
            to: 6,
            color,
            life: 1,
            width: 0.25,
          });
          fx.ring(state.hero.x, state.hero.y + 0.4, {
            to: 3,
            color: 0xffffff,
            life: 0.6,
          });
          fx.burst(state.hero.x, state.hero.y + 0.6, {
            color,
            count: 40,
            speed: 5,
            size: 0.45,
            life: 1,
          });
          fx.flash(color, 0.35, 0.6);
          fx.shake(0.35, 0.5);
          auraBoostUntil = now + 2500;
          auraColor = color;
          break;
        }
        case "revive":
          fx.ring(event.x, event.y + 0.4, {
            to: 6,
            color: 0xfff3c4,
            life: 0.9,
            width: 0.3,
          });
          fx.flash(0xfff3c4, 0.5, 0.8);
          break;
        case "boss":
          fx.shake(0.5, 0.8);
          fx.flash(0x400000, 0.45, 0.8);
          break;
        case "bossWindup":
          windups.set(event.id, {
            x: event.x,
            y: event.y,
            dx: event.dx,
            dy: event.dy,
            until: now + CS_BOSS_WINDUP_SECONDS * 1000,
          });
          break;
        case "elite":
          break;
        case "swarm":
          fx.flash(0x200030, 0.35, 0.6);
          break;
        case "bossBurst":
          fx.ring(event.x, event.y + 0.6, { to: 2.4, color: 0xd38cff, life: 0.4 });
          break;
        case "over":
          fx.flash(event.won ? 0xfff3c4 : 0x000000, 0.6, 1.2);
          break;
      }
    };

    let frameNumber = 0;
    let numbersThisFrame = 0;
    let overSince: number | null = null;
    let heroX = 0,
      heroY = 0;
    // The lighting pass covers what the camera sees and a margin, not the whole terrain.
    const lightView = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    game.setUpdate((frame) => {
      options.onFrame(frame.delta);
      const view = options.getView();
      const state = view.state;
      const now = frame.now;
      const reduced = frame.reducedMotion || !game.visualEffects.spriteAnimations;
      if (!state) {
        game.setAnimating(true);
        return;
      }
      frameNumber++;
      const seconds = csSeconds(state);
      // A share of the next tick, so motion moves between the simulation's steps.
      const live = !state.draft && !state.over;
      const ahead = live ? Math.min(1, view.pending / CS_TICK_SECONDS) : 0;
      const smoothing = 1 - Math.exp(-Math.min(0.1, frame.delta) * 20);

      numbersThisFrame = 0;
      for (const event of state.events) handleEvent(event, state, now);
      state.events.length = 0;
      playAmbient(state, now);

      // Hero: where the simulation has it, carried along its walk between ticks.
      const walking = CS_DIRECTIONS[state.hero.move];
      const step = walking ? csHeroStep(state) * ahead : 0;
      heroX = clampArena(state.hero.x + (walking?.x ?? 0) * step);
      heroY = clampArena(state.hero.y + (walking?.y ?? 0) * step);
      heroRoot.position.set(heroX, heroY);
      pickupRing.position.set(heroX, heroY + 0.3);
      pickupRing.scale.set(csPickupRange(state));
      const boosted = now < auraBoostUntil;
      aura.tint = boosted ? auraColor : 0x6fd3ff;
      const pulse = reduced ? 0.5 : 0.5 + Math.sin(now / 260) * 0.5;
      aura.width = (boosted ? 3 : 2.2) + pulse * 0.2;
      aura.height = aura.width / 2;
      aura.alpha = boosted ? 0.9 : 0.6 + pulse * 0.15;
      heroRing.tint = boosted ? auraColor : 0xffffff;
      heroRing.alpha = 0.6 + pulse * 0.4;
      const facing = CS_DIRECTIONS[state.hero.facing];
      if (facing) heroDirection = lpcFacing(facing.x, facing.y, heroDirection);
      // A hit shows over everything; walking shows over casts.
      const cued = now <= heroAnimationUntil;
      if (state.over && !state.won) heroAnimation = "hurt";
      else if (!(cued && heroAnimation === "hurt"))
        heroAnimation = walking && live ? "walk" : cued ? heroAnimation : "combat";
      hero?.render(
        reduced ? { ...frame, reducedMotion: true } : frame,
        heroAnimation,
        heroDirection,
        heroRestart,
      );
      heroRestart = false;
      if (hero) hero.sprite.tint = now < hurtUntil ? 0xff8080 : 0xffffff;

      // Camera follows the hero, stopping where the terrain ends.
      const halfWidth = game.renderer.width / 2 / viewScale,
        halfHeight = game.renderer.height / 2 / viewScale;
      const cameraX = clampTo(heroX, terrain.reach.x - halfWidth),
        cameraY = clampTo(heroY + 0.6, terrain.reach.y - halfHeight);

      // Raiders
      for (const enemy of state.enemies) {
        if (enemy.hp <= 0) continue;
        const record = enemies.get(enemy.id) ?? spawnEnemy(enemy, seconds, now);
        record.seenFrame = frameNumber;
        record.x += (enemy.x - record.x) * smoothing;
        record.y += (enemy.y - record.y) * smoothing;
        record.root.position.set(record.x, record.y);
        record.root.zIndex = depthOf(record.y);
        // New raiders fade in out of the dark.
        record.root.alpha = Math.min(1, (now - record.bornAt) / 350);
        drawEnemy(record, enemy, state, heroX, now, reduced);
      }
      for (const [id, record] of enemies)
        if (record.seenFrame !== frameNumber) {
          record.root.removeFromParent();
          enemies.delete(id);
          if (--record.art.users === 0) record.art.idleSince = now;
          record.art = NO_ROSTER_ART;
          record.body.texture = Texture.EMPTY;
          spareEnemies.push(record);
        }
      rosterArt.update(now);

      // Projectiles, carried along their flight between ticks
      const flying = new Set<number>();
      for (const projectile of state.projectiles) {
        flying.add(projectile.id);
        let sprite = projectileSprites.get(projectile.id);
        if (!sprite) {
          sprite = takeSprite();
          dressProjectile(sprite, projectile.kind, projectile.awakened);
          projectileSprites.set(projectile.id, sprite);
        }
        sprite.position.set(
          projectile.x + projectile.vx * ahead,
          projectile.y + projectile.vy * ahead,
        );
        if (projectile.kind === "shuriken") sprite.rotation = now / 50;
        if (!reduced && frameNumber % 2 === 0) {
          if (projectile.kind === "comet")
            fx.burst(sprite.x, sprite.y, {
              color: projectile.awakened ? 0xffd36b : 0xffb02e,
              count: projectile.awakened ? 2 : 1,
              speed: 0.6,
              size: projectile.awakened ? 0.7 : 0.4,
              life: 0.3,
            });
          else if (projectile.kind === "wisp")
            fx.burst(sprite.x, sprite.y, {
              color: CS_JUTSU_INFO.wisps.glow,
              count: 1,
              speed: 0.3,
              size: 0.25,
              life: 0.4,
            });
        }
      }
      for (const [id, sprite] of projectileSprites)
        if (!flying.has(id)) {
          sprite.removeFromParent();
          projectileSprites.delete(id);
          spareSprites.push(sprite);
        }

      // Gale Sickles circle the drawn hero, smoothly between orbit steps.
      const gale = state.jutsu.find((entry) => entry.id === "gale");
      const sickles = state.over ? [] : csSicklePositions(state);
      const nextSickles = live ? csSicklePositions(state, state.tick + 1) : sickles;
      while (sickleSprites.length < sickles.length) {
        const sprite = takeSprite();
        sprite.texture = shuriken;
        sickleSprites.push(sprite);
      }
      while (sickleSprites.length > sickles.length) {
        const sprite = sickleSprites.pop();
        if (!sprite) break;
        sprite.removeFromParent();
        spareSprites.push(sprite);
      }
      sickles.forEach((sickle, index) => {
        const sprite = sickleSprites[index];
        const next = nextSickles[index] ?? sickle;
        if (!sprite) return;
        sprite.tint = gale?.awakened ? 0x9ff5c0 : CS_JUTSU_INFO.gale.glow;
        sprite.width = sprite.height = gale?.awakened ? 1 : 0.75;
        sprite.position.set(
          heroX + (sickle.x - state.hero.x) + (next.x - sickle.x) * ahead,
          heroY + (sickle.y - state.hero.y) + (next.y - sickle.y) * ahead + 0.3,
        );
        sprite.rotation = -now / 40;
      });

      drawGround(state, now, reduced);
      parity++;
      drawPickups(state, now, reduced);

      // Lighting: the sun crosses the region's sky over the run, warm at its ends; a
      // region that runs past sunset fades into dusk.
      const sun = sunAt(stageInfo.sun, seconds, endless);
      // Terrain pixels run as arena units do, scaled and offset by its centre.
      lightView.minX = center.x + (cameraX - halfWidth - 2) * unitPx;
      lightView.maxX = center.x + (cameraX + halfWidth + 2) * unitPx;
      lightView.minY = center.y + (cameraY - halfHeight - 2) * unitPx;
      lightView.maxY = center.y + (cameraY + halfHeight + 2) * unitPx;
      // Scenery off camera skips the GPU batch, as on the travel map.
      scenery.setViewport(lightView, unitPx);
      lighting.update(sun, lightView);

      const shake = fx.update(frame, reduced);
      camera.position.set(
        game.renderer.width / 2 - (cameraX - shake.offsetX) * viewScale,
        game.renderer.height / 2 + (cameraY + shake.offsetY) * viewScale,
      );
      sky.blendMode = "multiply";
      sky.tint = sun.night > 0 ? 0x3a4a8a : stageInfo.dusk;
      sky.alpha = sun.night > 0 ? 0.12 + sun.night * 0.25 : sun.warmth * 0.22;
      screenFlash.tint = shake.overlay?.color ?? 0xffffff;
      screenFlash.alpha = shake.overlay?.alpha ?? 0;
      drawPointers(state, cameraX, cameraY, now);

      if (state.over) overSince ??= now;
      else overSince = null;
      game.setAnimating(overSince === null || now - overSince < GAME_OVER_SETTLE_MS);
    });

    const dressProjectile = (
      sprite: Sprite,
      kind: CsState["projectiles"][number]["kind"],
      awakened: boolean,
    ) => {
      if (kind === "shuriken") {
        sprite.texture = shuriken;
        sprite.width = sprite.height = awakened ? 0.7 : 0.55;
        sprite.tint = awakened ? 0xffe9a8 : 0xffffff;
        return;
      }
      sprite.texture = glow;
      // Comets blend normally so they read as fire on snow and sand alike; wisps and
      // thrown orbs glow, drawn in their own layer so blend modes never interleave.
      if (kind !== "comet") {
        sprite.blendMode = "add";
        projectileGlowLayer.addChild(sprite);
      }
      const size =
        kind === "comet" ? (awakened ? 1.6 : 1.2) : kind === "wisp" ? 0.8 : 0.7;
      sprite.width = sprite.height = size;
      sprite.alpha = kind === "comet" ? 0.85 : 1;
      sprite.tint =
        kind === "comet"
          ? awakened
            ? 0xffd36b
            : 0xff7a1a
          : kind === "wisp"
            ? CS_JUTSU_INFO.wisps.glow
            : 0xd04cff;
    };

    /** Stone and fire fields, tidal rings and captains' charge lines, redrawn each frame. */
    const drawGround = (state: CsState, now: number, reduced: boolean) => {
      groundFx.clear();
      for (const field of state.fields) {
        if (field.kind === "fire") {
          const flicker = reduced ? 0.5 : 0.5 + Math.sin(now / 70 + field.id) * 0.5;
          groundFx
            .ellipse(field.x, field.y, field.radius, field.radius * 0.8)
            .fill({ color: 0xff5a1a, alpha: 0.1 + flicker * 0.08 })
            .stroke({ color: 0xffb02e, alpha: 0.35 + flicker * 0.2, width: 0.05 });
          continue;
        }
        groundFx
          .ellipse(field.x, field.y, field.radius, field.radius * 0.8)
          .fill({ color: 0x5a3a1a, alpha: 0.35 })
          .stroke({
            color: field.pull ? 0xffb02e : CS_JUTSU_INFO.stonefang.glow,
            alpha: 0.7,
            width: field.pull ? 0.1 : 0.06,
          });
        // Mountain Maw's swirl shows the pull.
        if (field.pull && !reduced)
          for (let arm = 0; arm < 3; arm++) {
            const turn = now / 300 + (arm * Math.PI * 2) / 3;
            groundFx
              .moveTo(
                field.x + Math.cos(turn) * field.radius * 1.5,
                field.y + Math.sin(turn) * field.radius * 1.2,
              )
              .lineTo(
                field.x + Math.cos(turn + 0.9) * field.radius * 0.6,
                field.y + Math.sin(turn + 0.9) * field.radius * 0.5,
              )
              .stroke({ color: 0xffd36b, alpha: 0.4, width: 0.06 });
          }
        const spikes = field.pull ? 11 : 7;
        for (let i = 0; i < spikes; i++) {
          const direction = CS_DIRECTIONS[Math.floor((i * 16) / spikes)] ?? {
            x: 1,
            y: 0,
          };
          const reach = field.radius * (i % 2 === 0 ? 0.55 : 0.25);
          const x = field.x + direction.x * reach,
            y = field.y + direction.y * reach * 0.8;
          const rise = reduced ? 0.5 : 0.35 + 0.25 * Math.abs(Math.sin(now / 140 + i));
          groundFx
            .poly([x - 0.14, y, x + 0.14, y, x, y + rise])
            .fill({ color: 0xd9b27a, alpha: 0.95 });
        }
      }
      for (const pulse of state.pulses)
        groundFx
          .circle(pulse.x, pulse.y, Math.max(0.05, pulse.radius))
          .fill({
            color: pulse.mends ? 0x2a8aff : CS_JUTSU_INFO.tidal.glow,
            alpha: 0.12,
          })
          .stroke({
            color: pulse.mends ? 0x9fe8ff : CS_JUTSU_INFO.tidal.glow,
            alpha: 0.85,
            width: pulse.mends ? 0.28 : 0.18,
          });
      // A captain's charge: a red lane that fills as the wind-up runs out.
      const reach = CS_BOSS_DASH_SPEED * CS_BOSS_DASH_SECONDS;
      for (const [id, windup] of windups) {
        if (now > windup.until) {
          windups.delete(id);
          continue;
        }
        const filled =
          1 - Math.max(0, windup.until - now) / (CS_BOSS_WINDUP_SECONDS * 1000);
        const nx = -windup.dy * 0.6,
          ny = windup.dx * 0.6;
        const lane = (length: number) => [
          windup.x + nx,
          windup.y + ny,
          windup.x + nx + windup.dx * length,
          windup.y + ny + windup.dy * length,
          windup.x - nx + windup.dx * length,
          windup.y - ny + windup.dy * length,
          windup.x - nx,
          windup.y - ny,
        ];
        groundFx
          .poly(lane(reach))
          .fill({ color: 0xff2a2a, alpha: 0.12 })
          .stroke({ color: 0xff5a5a, alpha: 0.6, width: 0.06 });
        groundFx.poly(lane(reach * filled)).fill({ color: 0xff2a2a, alpha: 0.28 });
      }
    };

    /**
     * Chakra orbs, onigiri, scrolls and gust talismans: painted sprites over a pulsing
     * glow, bobbing on the ground, rarer ones twinkling and every one trailing light as it
     * flies to the hero.
     */
    const drawPickups = (state: CsState, now: number, reduced: boolean) => {
      pickups.clear();
      pickupFrame += 1;
      for (const orb of state.orbs) {
        const look = pickupLook(orb.kind, orb.value);
        const texture = pickupArt[look.art];
        if (!texture) {
          drawFallbackPickup(orb, look.glow, now, reduced);
          continue;
        }
        let view = pickupSprites.get(orb.id);
        if (!view) {
          view = sparePickups.pop() ?? createPickupView();
          view.bornAt = now;
          pickupGlowLayer.addChild(view.glow);
          pickupLayer.addChild(view.item);
          pickupSprites.set(orb.id, view);
        }
        view.frame = pickupFrame;
        const phase = now / 320 + orb.id * 0.7;
        const bob = reduced ? 0 : Math.sin(phase) * 0.07;
        const pop = Math.min(1, (now - view.bornAt) / 180);
        const size = look.size * (orb.flying ? 1.12 : 1) * (0.6 + pop * 0.4);
        const y = orb.y + size * 0.5 + 0.1 + bob;
        view.glow.position.set(orb.x, y);
        view.item.position.set(orb.x, y);
        view.item.texture = texture;
        view.item.scale.set(
          size / Math.max(1, texture.width),
          -size / Math.max(1, texture.height),
        );
        view.item.rotation = reduced || !look.sway ? 0 : Math.sin(phase * 0.8) * 0.12;
        const pulse = reduced ? 0.5 : 0.5 + Math.sin(phase * 1.6) * 0.5;
        view.glow.tint = look.glow;
        view.glow.width = view.glow.height = size * (2.1 + pulse * 0.5);
        view.glow.alpha = look.glowAlpha * (0.7 + pulse * 0.3);
        if (reduced) continue;
        if (orb.flying && frameParity(orb.id))
          fx.burst(orb.x, orb.y + size * 0.5, {
            color: look.glow,
            count: 1,
            speed: 0.3,
            size: size * 0.6,
            life: 0.25,
          });
        else if (look.twinkle && Math.random() < 0.015)
          fx.burst(
            orb.x + (Math.random() - 0.5) * size,
            orb.y + size * (0.4 + Math.random() * 0.5),
            { color: 0xffffff, count: 1, speed: 0.4, size: 0.18, life: 0.5 },
          );
      }
      for (const [id, view] of pickupSprites)
        if (view.frame !== pickupFrame) {
          view.glow.removeFromParent();
          view.item.removeFromParent();
          pickupSprites.delete(id);
          sparePickups.push(view);
        }
    };
    /** Stamps the views drawn this frame; the rest belong to collected orbs. */
    let pickupFrame = 0;
    let parity = 0;
    /** Flying orbs shed a trail particle on alternate frames, staggered by orb. */
    const frameParity = (id: number) => (parity + id) % 2 === 0;
    const createPickupView = (): PickupView => {
      const glowSprite = new Sprite(glow);
      glowSprite.anchor.set(0.5);
      glowSprite.blendMode = "add";
      const item = new Sprite(Texture.EMPTY);
      item.anchor.set(0.5);
      return { glow: glowSprite, item, bornAt: 0, frame: 0 };
    };
    /** The drawn shapes a pickup shows while its art is unavailable. */
    const drawFallbackPickup = (
      orb: CsState["orbs"][number],
      color: number,
      now: number,
      reduced: boolean,
    ) => {
      const size = orb.kind === "experience" ? 0.18 : 0.3;
      const y = orb.y + 0.15 + (reduced ? 0 : Math.sin(now / 220) * 0.06);
      pickups
        .circle(orb.x, y, size * 1.8)
        .fill({ color, alpha: 0.2 })
        .poly([
          orb.x,
          y + size,
          orb.x + size * 0.7,
          y,
          orb.x,
          y - size,
          orb.x - size * 0.7,
          y,
        ])
        .fill({ color, alpha: 0.95 });
    };

    /**
     * Arrows on the screen's edge toward captains, elites and dropped scrolls, onigiri
     * and talismans outside the view, so the player always knows where to look.
     */
    const drawPointers = (
      state: CsState,
      cameraX: number,
      cameraY: number,
      now: number,
    ) => {
      pointers.clear();
      const width = game.renderer.width,
        height = game.renderer.height;
      const point = (x: number, y: number, color: number, size: number) => {
        const sx = width / 2 + (x - cameraX) * viewScale,
          sy = height / 2 - (y - cameraY) * viewScale;
        if (sx >= 0 && sx <= width && sy >= 0 && sy <= height) return;
        const dx = sx - width / 2,
          dy = sy - height / 2;
        const scale = Math.min(
          (width / 2 - POINTER_INSET) / Math.max(1, Math.abs(dx)),
          (height / 2 - POINTER_INSET) / Math.max(1, Math.abs(dy)),
        );
        const px = width / 2 + dx * scale,
          py = height / 2 + dy * scale;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length,
          uy = dy / length;
        const throb = 1 + Math.sin(now / 160) * 0.12;
        const tip = size * throb;
        pointers
          .poly([
            px + ux * tip,
            py + uy * tip,
            px - uy * tip * 0.6 - ux * tip * 0.5,
            py + ux * tip * 0.6 - uy * tip * 0.5,
            px + uy * tip * 0.6 - ux * tip * 0.5,
            py - ux * tip * 0.6 - uy * tip * 0.5,
          ])
          .fill({ color, alpha: 0.9 })
          .stroke({ color: 0x000000, alpha: 0.6, width: 2 });
      };
      for (const enemy of state.enemies)
        if (enemy.kind === "boss") point(enemy.x, enemy.y + 0.8, 0xff3b3b, 16);
        else if (enemy.elite) point(enemy.x, enemy.y + 0.6, 0xffb02e, 11);
      for (const orb of state.orbs)
        if (orb.kind === "scroll") point(orb.x, orb.y, 0xffd36b, 11);
        else if (orb.kind === "onigiri") point(orb.x, orb.y, 0x7dff9a, 9);
        else if (orb.kind === "talisman") point(orb.x, orb.y, 0x8fd3ff, 9);
    };

    /** Put an optional part in a record's tree while it shows, below or above the body. */
    const attach = (
      record: EnemyRecord,
      part: Container,
      shown: boolean,
      place: "below" | "above",
    ) => {
      if (!shown) {
        if (part.parent) part.removeFromParent();
        return;
      }
      if (part.parent) return;
      if (place === "below")
        record.root.addChildAt(part, record.root.getChildIndex(record.body));
      else record.root.addChild(part);
    };

    /** A raider's animated body, hit flash, frost and slow tints and health bar. */
    const drawEnemy = (
      record: EnemyRecord,
      enemy: CsEnemy,
      state: CsState,
      heroAt: number,
      now: number,
      reduced: boolean,
    ) => {
      const frozen = state.tick < enemy.frozenUntil;
      const moving =
        !frozen && state.tick >= enemy.stunUntil && !state.draft && !state.over;
      const facing = enemy.x > heroAt ? -1 : 1;
      const clip =
        (moving ? record.art.move : record.art.idle) ??
        record.art.move ??
        record.art.idle;
      const texture = clip
        ? (clip.views[
            reduced || frozen
              ? 0
              : spriteAnimationFrame(clip.animation, now - record.bornAt, true)
          ] ?? Texture.EMPTY)
        : record.art.still;
      record.body.visible = !!texture;
      attach(record, record.fallback, !texture, "below");
      if (texture) {
        const size = clip ? 1.9 : 1.05;
        const flip = clip?.animation.facing === "left" ? -facing : facing;
        record.body.texture = texture;
        record.body.scale.set(
          (size / Math.max(1, texture.width)) * flip,
          -size / Math.max(1, texture.height),
        );
        const foot = clip?.foot ?? FRAME_FOOT;
        record.body.position.set(-foot.x * size * flip, -foot.lift * size);
      }
      let tint = 0xffffff;
      if (state.tick < enemy.slowUntil) tint = 0xd9b27a;
      if (state.tick < enemy.stunUntil) tint = 0xa8e4ff;
      if (frozen) tint = FROZEN_TINT;
      if (now < record.flashUntil) tint = 0xff6b6b;
      if (state.tick < enemy.windupUntil && Math.floor(now / 80) % 2 === 0)
        tint = 0xff3b3b;
      record.body.tint = record.fallback.tint = tint;
      attach(record, record.ice, frozen, "above");
      const fraction = Math.max(0, enemy.hp / enemy.maxHp);
      const shown = enemy.elite || enemy.kind === "boss" || fraction < 1;
      attach(record, record.barBack, shown, "above");
      attach(record, record.barFill, shown, "above");
      if (shown) {
        const width = enemy.kind === "boss" ? 1.4 : 0.8;
        record.barBack.position.set(-width / 2, 1.6);
        record.barFill.position.set(-width / 2, 1.6);
        record.barBack.width = width;
        record.barBack.height = record.barFill.height = 0.09;
        record.barFill.width = width * fraction;
        record.barFill.tint =
          enemy.kind === "boss" ? 0xff3b3b : enemy.elite ? 0xffb02e : 0x4cd964;
      }
    };

    return { dispose: game.dispose };
  } catch (error) {
    game.dispose();
    throw error;
  }
};

/** A radial fade from a clear middle to dark corners, stretched over the screen. */
const createVignetteTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 70, 128, 128, 181);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,0.5)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  return Texture.from(canvas);
};

/**
 * The sun at a point of the run: `path` gives its progress from sunrise (0) to sunset
 * (1) at the start and end of the run. Low suns are warm; past sunset the day fades.
 */
const sunAt = (path: [number, number], seconds: number, endless: boolean) => {
  // A scouting run follows the sun across one afternoon; Undercover's days come and go.
  const share = endless
    ? Math.abs(((seconds / ENDLESS_DAY_SECONDS) % 2) - 1)
    : Math.min(1, seconds / CS_RUN_SECONDS);
  const progress = path[0] + (path[1] - path[0]) * share;
  const angle = Math.PI * Math.max(0.04, Math.min(0.96, progress));
  const x = Math.cos(angle),
    y = -Math.sin(angle) * 0.65,
    z = 0.28 + Math.sin(angle) * 0.8;
  const length = Math.hypot(x, y, z);
  const night = Math.max(0, Math.min(1, (progress - 1) * 4));
  return {
    x: x / length,
    y: y / length,
    z: z / length,
    day: 1 - night * 0.6,
    night,
    warmth: Math.max(0, 1 - Math.min(progress, 1 - progress) / 0.18),
  };
};

const clampArena = (value: number) =>
  Math.max(-CS_ARENA_HALF, Math.min(CS_ARENA_HALF, value));

/** Clamp to ±limit, or to the centre when the view is wider than the room for it. */
const clampTo = (value: number, limit: number) =>
  limit <= 0 ? 0 : Math.max(-limit, Math.min(limit, value));

interface EnemyRecord {
  root: Container;
  body: Sprite;
  fallback: Graphics;
  halo: Graphics;
  ice: Graphics;
  barBack: Sprite;
  barFill: Sprite;
  art: RosterArt;
  x: number;
  y: number;
  bornAt: number;
  flashUntil: number;
  seenFrame: number;
}

type PickupArt = keyof typeof CS_PICKUP_URLS;

interface PickupView {
  glow: Sprite;
  item: Sprite;
  bornAt: number;
  /** The frame that last drew it. */
  frame: number;
}

/** How a pickup looks: its art, size in units, glow, and whether it sways or twinkles. */
const pickupLook = (
  kind: CsState["orbs"][number]["kind"],
  value: number,
): {
  art: PickupArt;
  size: number;
  glow: number;
  glowAlpha: number;
  sway: boolean;
  twinkle: boolean;
} => {
  if (kind === "onigiri")
    return {
      art: "onigiri",
      size: 0.7,
      glow: 0x9dffb0,
      glowAlpha: 0.45,
      sway: false,
      twinkle: false,
    };
  if (kind === "scroll")
    return {
      art: "scroll",
      size: 0.95,
      glow: 0xffd36b,
      glowAlpha: 0.9,
      sway: true,
      twinkle: true,
    };
  if (kind === "talisman")
    return {
      art: "talisman",
      size: 0.8,
      glow: 0x8fd3ff,
      glowAlpha: 0.75,
      sway: true,
      twinkle: true,
    };
  if (value >= 20)
    return {
      art: "chakraGold",
      size: 0.72,
      glow: 0xffd36b,
      glowAlpha: 0.85,
      sway: true,
      twinkle: true,
    };
  if (value >= 5)
    return {
      art: "chakraPurple",
      size: 0.6,
      glow: 0xc08cff,
      glowAlpha: 0.7,
      sway: true,
      twinkle: true,
    };
  if (value >= 2)
    return {
      art: "chakraGreen",
      size: 0.5,
      glow: 0x6dffa0,
      glowAlpha: 0.6,
      sway: true,
      twinkle: false,
    };
  return {
    art: "chakraBlue",
    size: 0.42,
    glow: 0x5fb8ff,
    glowAlpha: 0.55,
    sway: true,
    twinkle: false,
  };
};

/**
 * Each jutsu's cast: its cue, volume, and the shortest gap between two of them. The hero's
 * own throws sit above the crowd's hits, so the player always hears what they fire.
 */
const CAST_SOUNDS: Record<CsJutsu, [CsSfx, number, number]> = {
  shuriken: ["throw", 0.26, 80],
  ember: ["fire", 0.32, 140],
  // Sickles never cast; the scene whirls them once a turn instead.
  gale: ["wind", 0.2, 400],
  thunder: ["lightning", 0.38, 140],
  tidal: ["splash", 0.42, 220],
  stonefang: ["earth", 0.34, 160],
  frost: ["ice", 0.32, 180],
  wisps: ["release", 0.26, 220],
};

/** Each element's hit: thrown steel bites, flames lick, bolts zap, water slaps, wind cuts. */
const HIT_SOUNDS: Record<TdElement, [CsSfx, number, number]> = {
  physical: ["impact", 0.13, 55],
  fire: ["fire", 0.09, 170],
  lightning: ["zap", 0.12, 90],
  water: ["splash", 0.08, 140],
  wind: ["scrape", 0.1, 75],
  earth: ["earth", 0.09, 190],
};

/**
 * The sound an event makes, as [cue, volume, shortest gap in ms between two of its kind],
 * or null for none. Crits ring like a blade, every element hits with its own sound, small
 * raiders pop and heavy ones thud, crystals chime and everything big booms; the audio
 * layer varies the pitch of each.
 */
export const eventSound = (event: CsEvent): [CsSfx, number, number] | null => {
  switch (event.type) {
    case "hit":
      return event.crit ? ["slash", 0.26, 90] : HIT_SOUNDS[event.element];
    case "kill":
      if (event.kind === "boss") return ["explosion", 0.85, 0];
      if (event.elite) return ["explosion", 0.5, 0];
      if (
        event.kind === "brute" ||
        event.kind === "veteran" ||
        event.kind === "juggernaut"
      )
        return ["heavy", 0.3, 110];
      return ["puff", 0.16, 50];
    case "cast":
      return CAST_SOUNDS[event.jutsu];
    case "chain":
      // Awakened thunder forks through the crowd with a second crack.
      return event.awakened ? ["lightning", 0.2, 220] : null;
    case "burst":
      return ["explosion", event.awakened ? 0.4 : 0.24, 110];
    case "bloom":
      return ["shatter", 0.3, 160];
    case "hurt":
      return ["hurt", 0.4, 350];
    case "pickup":
      if (event.kind === "scroll") return ["chime", 0.6, 0];
      if (event.kind === "onigiri") return ["heal", 0.45, 0];
      if (event.kind === "talisman") return ["whoosh", 0.55, 0];
      // Rarer crystals ring a touch louder than common ones.
      return ["crystal", event.value >= 2 ? 0.16 : 0.1, 60];
    case "level":
      return ["sparkle", 0.5, 0];
    case "awaken":
      return ["seal", 0.75, 0];
    case "revive":
      return ["heal", 0.75, 0];
    case "boss":
      return ["roar", 0.75, 0];
    case "bossWindup":
      return ["charge", 0.55, 0];
    case "bossBurst":
      return ["pulse", 0.45, 0];
    case "elite":
      // Elites can arrive in a pack; one rising charge announces them.
      return ["charge", 0.35, 1500];
    case "swarm":
      return ["roar", 0.45, 0];
    case "over":
      return event.won ? ["chime", 0.8, 0] : ["hurt", 0.6, 0];
    default:
      return null;
  }
};
