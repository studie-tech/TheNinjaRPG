import {
  Color,
  Container,
  Graphics,
  GraphicsContext,
  Matrix,
  Sprite,
  Texture,
} from "pixi.js";
import { TD_SHURIKEN_IMAGE_URL, type TdSfx } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { lpcFacing } from "@/libs/lpc/catalog";
import { assetAnimationClip, sampleAnimationClip } from "@/libs/rendering/animation";
import {
  acquireAnimationTexture,
  animationFrameViews,
} from "@/libs/rendering/animationTextures";
import { createClipTextures } from "@/libs/rendering/primitives/animation";
import {
  createLpcCharacter,
  type LpcCharacter,
} from "@/libs/rendering/primitives/character";
import { createSoftShadowTexture } from "@/libs/rendering/primitives/shadow";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { createTowerDefenseFx } from "@/libs/rendering/scenes/towerDefenseFx";
import { prepareTowerDefenseTerrain } from "@/libs/rendering/scenes/towerDefenseTerrain";
import { createRenderScope } from "@/libs/rendering/scope";
import {
  type CharacterAnimation,
  type CharacterAnimations,
  spriteAnimationFrame,
} from "@/libs/spriteAnimations";
import { TD_HERO_ZONE, TD_TICK_SECONDS } from "@/libs/towerDefense/balance";
import {
  TD_AFFIX_TINTS,
  TD_ENEMIES,
  TD_ENEMY_KINDS,
  TD_JUTSU_INFO,
  type TdElement,
  type TdEnemyKind,
  type TdSealArt,
  type TdSentry,
  type TdUltimate,
  tdStageForWave,
} from "@/libs/towerDefense/content";
import {
  type TdBossMove,
  type TdEnemy,
  type TdEvent,
  type TdState,
  tdIsPhased,
  tdSentryPosition,
  tdSentryRange,
} from "@/libs/towerDefense/sim";
import type { LpcAnimation, LpcDirection, SpriteAppearance } from "@/validators/lpc";

/** An AI character drawn as enemies; animations come from its sprite sheets. */
export interface TowerDefenseRosterEntry {
  userId: string;
  username: string;
  level: number;
  avatar: string | null;
  animations: CharacterAnimations;
}

export interface TowerDefenseSceneView {
  state: TdState | null;
  /** Real seconds simulated past `state.tick`, for smooth interpolation. */
  pending: number;
  reticle: { x: number; y: number } | null;
  mode: "aim" | "blink" | "trap";
}

const ELEMENT_COLORS: Record<TdElement, number> = {
  physical: 0xffffff,
  fire: 0xff7a1a,
  lightning: 0x9fd8ff,
  water: 0x4fc3ff,
  wind: 0xc8ffd4,
  earth: 0xc8945a,
};

const SENTRY_COLORS: Record<TdSentry, number> = {
  kunai: 0xd0d0d0,
  mortar: 0xff8a3d,
  rod: 0x8fd3ff,
  frost: 0x7fe7ff,
  sensor: 0xd38cff,
};

/** How far the camera shows: enemies walk in from just beyond the edge. */
const VIEW_HALF_WIDTH = 9.5;
const VIEW_HALF_HEIGHT = 7.5;
const TERRAIN_SIZE = 29;
/** How long a character's sheets outlast its last enemy, so a wave gap keeps them. */
const ENEMY_ART_GRACE_MS = 20_000;
/** How often characters on the field ask again for sheets the atlas budget refused. */
const ENEMY_ART_RETRY_MS = 1_000;
/** How long the field keeps animating after the run ends, for its closing effects. */
const GAME_OVER_SETTLE_MS = 2_000;
/** The art of a pooled record, which draws nothing. */
const NO_ENEMY_ART: EnemyArt = {
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
 * Renders a tower-defense run from the deterministic simulation. The scene only drains
 * the run's event queue: `onFrame` advances the run, `getView` exposes its state, and
 * taps come back as arena coordinates.
 */
export const createTowerDefenseScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  onError: (error: unknown) => void;
  seed: string;
  lpcCatalog?: LpcCatalog;
  appearance?: SpriteAppearance;
  roster: TowerDefenseRosterEntry[];
  hitAsset?: GameAsset;
  smokeAsset?: GameAsset;
  onFrame: (delta: number) => void;
  /** Play a game sound effect; the caller applies the player's sound settings. */
  playSound?: (cue: TdSfx, volume: number) => void;
  getView: () => TowerDefenseSceneView;
  onTap: (
    point: { x: number; y: number },
    hit: { enemyId?: number; lootId?: number },
  ) => void;
}) => {
  const game = await createGameRenderer({
    lpcCatalog: options.lpcCatalog,
    surface: "tower-defense",
    mount: options.mount,
    signal: options.signal,
    onError: options.onError,
    background: 0x101018,
    height: (width) => Math.max(320, Math.min(width * 0.8, window.innerHeight * 0.7)),
  });
  try {
    const scope = createRenderScope(game);
    const camera = new Container();
    const world = new Container();
    const terrainLayer = new Container();
    // Ground and post layers in draw order. Fixed shapes are drawn once and follow the
    // hero by position; sentry geometry redraws only when the sentry layout changes.
    const arenaGround = new Graphics()
      .circle(0, 0, TD_HERO_ZONE)
      .stroke({ color: 0xffffff, alpha: 0.12, width: 0.05 });
    const heroRange = new Graphics();
    let heroRangeRadius = Number.NaN;
    const chakraAura = new Graphics().circle(0, 0, 1).fill(0xffffff);
    const substitutionRing = new Graphics()
      .circle(0, 0.6, 0.95)
      .stroke({ color: 0xffffff, alpha: 0.8, width: 0.08 });
    const rageGlow = new Graphics().circle(0, 0, 1.2).fill(0xff3b3b);
    const sentryGround = new Graphics();
    const sentryLayout = createSentryLayout();
    const groundFx = new Graphics();
    const actorLayer = new Container();
    actorLayer.sortableChildren = true;
    const earthDome = new Graphics()
      .ellipse(0, 0.5, 1.5, 1.7)
      .fill({ color: 0xc8945a, alpha: 0.18 })
      .stroke({ color: 0xc8945a, alpha: 0.6, width: 0.08 });
    for (const shape of [chakraAura, substitutionRing, rageGlow, earthDome])
      shape.visible = false;
    const sentryPosts = new Graphics();
    const dynamic = new Graphics();
    const auraLayer = new Container();
    const projectileLayer = new Container();
    const fx = createTowerDefenseFx();
    game.own(fx.dispose);
    world.addChild(
      terrainLayer,
      arenaGround,
      heroRange,
      chakraAura,
      substitutionRing,
      rageGlow,
      sentryGround,
      groundFx,
      auraLayer,
      earthDome,
      sentryPosts,
      dynamic,
      actorLayer,
      projectileLayer,
      fx.container,
    );
    camera.addChild(world);
    const sky = new Graphics();
    const screenFlash = new Graphics();
    game.stage.addChild(camera, sky, screenFlash);

    // Terrain: one hex per arena unit, centred on the hero. Scenery casts projected sun
    // silhouettes as on the sector map; actors cast matching ones of their own below.
    const terrain = prepareTowerDefenseTerrain(options.seed, TERRAIN_SIZE);
    const lighting = createProjectedWorldLighting(game, terrainLayer);
    const [hexes, scenery] = await Promise.all([
      createHexTerrain(scope, terrain.terrain),
      createWorldSprites(scope, terrain.scenery, lighting),
    ]);
    if (game.isDisposed())
      throw new DOMException("Tower defense cancelled", "AbortError");
    const { unitPx, center } = terrain;
    lighting.container.addChild(hexes.container, scenery.container);
    game.own(lighting.registerTerrain(hexes.container, terrain.terrain));
    terrainLayer.addChild(lighting.container);
    terrainLayer.scale.set(1 / unitPx);
    terrainLayer.position.set(-center.x / unitPx, -center.y / unitPx);
    /** The visible arena in terrain pixels, for the lighting pass. */
    const terrainView = {
      minX: center.x - (VIEW_HALF_WIDTH + 2) * unitPx,
      maxX: center.x + (VIEW_HALF_WIDTH + 2) * unitPx,
      minY: center.y - (VIEW_HALF_HEIGHT + 2) * unitPx,
      maxY: center.y + (VIEW_HALF_HEIGHT + 2) * unitPx,
    };
    const contactTexture = createSoftShadowTexture();
    game.own(() => contactTexture.destroy(true));
    const castMatrix = new Matrix();
    const showCasts = () => game.visualEffects.sunlight && game.visualEffects.shadows;
    const contact = (width: number) => {
      const sprite = new Sprite(contactTexture);
      sprite.anchor.set(0.5);
      sprite.width = width;
      sprite.height = width * 0.36;
      return sprite;
    };

    // Shared art
    const [shuriken, hitFrames, smokeFrames] = await Promise.all([
      game.assets.texture(TD_SHURIKEN_IMAGE_URL, 64).catch((error: unknown) => {
        if (
          game.signal.aborted ||
          game.isDisposed() ||
          (error instanceof Error && error.name === "AbortError")
        )
          throw error;
        // A plain projectile keeps targeting and hit feedback when its art is missing.
        console.warn("Tower defense projectile artwork unavailable", error);
        return Texture.WHITE;
      }),
      options.hitAsset
        ? createClipTextures(game, assetAnimationClip(options.hitAsset), {
            size: 96,
          }).catch(() => null)
        : Promise.resolve(null),
      options.smokeAsset
        ? createClipTextures(game, assetAnimationClip(options.smokeAsset), {
            size: 128,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (game.isDisposed())
      throw new DOMException("Tower defense cancelled", "AbortError");

    // The hero, and a darkened twin sheared away from the sun like the enemies' silhouettes.
    const heroRoot = new Container();
    actorLayer.addChild(heroRoot);
    const heroCastRoot = new Container();
    const clones: LpcCharacter[] = [];
    const appearance = options.appearance;
    const buildHero = (look: SpriteAppearance) =>
      createLpcCharacter(game, look, "all").catch(() => null);
    const [hero, heroCast] =
      appearance && game.lpcCatalog
        ? await Promise.all([buildHero(appearance), buildHero(appearance)])
        : [null, null];
    if (hero) {
      hero.sprite.scale.set(1.6, -1.6);
      hero.sprite.position.set(0, HERO_CENTER_Y);
      heroRoot.addChild(hero.sprite);
    } else
      heroRoot.addChild(
        new Graphics()
          .circle(0, 0.45, 0.4)
          .fill(0x2b2f4a)
          .stroke({ color: 0xffffff, width: 0.06 }),
      );
    if (hero && heroCast) {
      heroCast.sprite.position.set(0, -LPC_FOOT);
      heroCast.sprite.tint = CAST_SHADOW_TINT;
      heroCastRoot.alpha = CAST_SHADOW_ALPHA;
      heroCastRoot.addChild(heroCast.sprite);
      castMatrix.set(1.6, 0, SUN_SLOPE_X * 1.6, SUN_SLOPE_Y * 1.6, 0, 0);
      heroCastRoot.setFromMatrix(castMatrix);
    }
    heroRoot.addChildAt(contact(1.1), 0);
    heroRoot.addChildAt(heroCastRoot, 0);
    let heroAnimation: LpcAnimation = "combat",
      heroAnimationUntil = 0,
      heroDirection: LpcDirection = 2,
      heroRestart = false;
    const cueHero = (animation: LpcAnimation, now: number) => {
      const duration = hero?.durations[animation] ?? 400;
      heroAnimation = animation;
      heroAnimationUntil = now + duration;
      heroRestart = true;
    };
    /** The one clone build, started by the first cast; every later call shares it. */
    let cloneBuild: Promise<void> | null = null;
    const ensureClones = () => {
      const appearance = options.appearance;
      if (cloneBuild || !appearance || !game.lpcCatalog) return;
      cloneBuild = (async () => {
        for (let i = 0; i < 6; i++) {
          // Each character owns its cleanup, so a build outliving the scene leaks nothing.
          const clone = await createLpcCharacter(game, appearance, "travel").catch(
            () => null,
          );
          if (!clone || game.isDisposed()) return;
          clone.sprite.scale.set(1.4, -1.4);
          clone.sprite.alpha = 0.75;
          clone.sprite.visible = false;
          actorLayer.addChild(clone.sprite);
          clones.push(clone);
        }
      })();
    };

    // Enemy art: one sheet set per roster character, shared by every enemy drawn with it.
    // Sheets come from the shared atlas budget, so a character nobody has drawn for a
    // while gives its sheets back and the rotating bands of a long run keep finding room.
    const appearances = new Map<string, EnemyArt>();
    const maxTexture = game.renderer.gl.getParameter(
      game.renderer.gl.MAX_TEXTURE_SIZE,
    ) as number;
    const artFor = (entry: TowerDefenseRosterEntry | undefined): EnemyArt => {
      const key = entry?.userId ?? "none";
      const existing = appearances.get(key);
      if (existing) return existing;
      const leases: (() => void)[] = [];
      /** Sheets the atlas budget had no room for yet. */
      let missing: { animation: CharacterAnimation; slot: "move" | "idle" }[] = [];
      const art: EnemyArt = {
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
            if (!art.disposed)
              art[slot] = { animation, views: animationFrameViews(atlas, animation) };
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
    let artRetriedAt = 0;
    /**
     * Give back the sheets of characters no enemy has used for a while, and let the
     * characters on the field claim the room for sheets they were refused.
     */
    const updateArtLeases = (now: number) => {
      for (const [key, art] of appearances)
        if (art.users === 0 && now - art.idleSince > ENEMY_ART_GRACE_MS) {
          art.dispose();
          appearances.delete(key);
        }
      if (now - artRetriedAt < ENEMY_ART_RETRY_MS) return;
      artRetriedAt = now;
      for (const art of appearances.values()) if (art.users > 0) art.retry();
    };
    const roster = [...options.roster].sort(
      (a, b) => a.level - b.level || a.userId.localeCompare(b.userId),
    );
    const rosterFor = (enemy: TdEnemy, wave: number) => {
      if (roster.length === 0) return undefined;
      const band = Math.min(
        roster.length - 1,
        Math.floor(Math.min(1, wave / 450) * (roster.length - 1)),
      );
      if (enemy.boss)
        return roster[
          Math.max(
            0,
            roster.length - 1 - (Math.floor(wave / 10) % Math.min(8, roster.length)),
          )
        ];
      const kind = TD_ENEMY_KINDS.indexOf(enemy.kind);
      // A handful of characters per stretch of waves keeps the sheet budget small.
      const window = Math.min(6, roster.length);
      return roster[
        (Math.max(0, band - window + 1) + ((kind * 5) % window)) % roster.length
      ];
    };

    // Enemies share their outline geometry and recycle their display objects: a death
    // detaches its record and the next spawn resets it.
    const enemies = new Map<number, EnemyRecord>();
    const enemyShapes = createEnemyShapes();
    // A record is built only when none is spare, so spares never outnumber the largest crowd.
    const spareEnemies: EnemyRecord[] = [];
    game.own(() => {
      for (const record of spareEnemies.splice(0))
        record.root.destroy({ children: true });
      enemyShapes.dispose();
    });
    const createEnemyRecord = (): EnemyRecord => {
      const root = new Container();
      const shadow = contact(1);
      const cast = new Sprite(Texture.EMPTY);
      cast.tint = CAST_SHADOW_TINT;
      cast.alpha = CAST_SHADOW_ALPHA;
      cast.anchor.set(0.5, 1);
      cast.visible = false;
      const halo = {
        root: new Container(),
        ring: new Graphics(enemyShapes.ring),
        bossRing: new Graphics(enemyShapes.bossRing),
        ward: new Graphics(enemyShapes.ward),
        shield: new Graphics(enemyShapes.shield),
        stun: Array.from({ length: 3 }, () => new Graphics(enemyShapes.stun)),
        focus: new Graphics(enemyShapes.focus),
      };
      halo.bossRing.position.set(0, 0.05);
      halo.bossRing.alpha = 0.3;
      halo.focus.position.set(0, 0.6);
      halo.root.addChild(
        halo.ring,
        halo.bossRing,
        halo.ward,
        halo.shield,
        ...halo.stun,
        halo.focus,
      );
      const body = new Sprite(Texture.EMPTY);
      body.anchor.set(0.5, 1);
      const fallback = new Graphics(enemyShapes.fallback(TD_ENEMY_KINDS[0]));
      const bar = {
        root: new Container(),
        back: meterSprite(0x000000, 1.55, 0.09),
        fill: meterSprite(0xffffff, 1.55, 0.09),
        shield: meterSprite(0x6fb8ff, 1.66, 0.05),
      };
      bar.back.alpha = 0.6;
      bar.root.addChild(bar.back, bar.fill, bar.shield);
      root.addChild(cast, shadow, halo.root, fallback, body, bar.root);
      return {
        root,
        body,
        cast,
        fallback,
        halo,
        bar,
        art: NO_ENEMY_ART,
        x: 0,
        y: 0,
        bornAt: 0,
        flashUntil: 0,
        seenFrame: 0,
      };
    };
    /** Resets a pooled record for a new enemy; `drawEnemyBody` sets the rest each frame. */
    const spawnEnemy = (enemy: TdEnemy, wave: number) => {
      const record = spareEnemies.pop() ?? createEnemyRecord();
      record.art = artFor(rosterFor(enemy, wave));
      record.art.users++;
      record.x = enemy.x;
      record.y = enemy.y;
      record.bornAt = performance.now();
      record.flashUntil = 0;
      record.fallback.context = enemyShapes.fallback(enemy.kind);
      record.root.scale.set(enemy.size * (enemy.boss ? 1.25 : 1));
      actorLayer.addChild(record.root);
      enemies.set(enemy.id, record);
      return record;
    };

    // Projectiles in flight, from throw events
    const flights: Flight[] = [];
    const flightPool: Sprite[] = [];
    const hitClips: {
      sprite: Sprite;
      startedAt: number;
      frames: NonNullable<typeof hitFrames>;
    }[] = [];
    const playClip = (
      frames: typeof hitFrames,
      x: number,
      y: number,
      size: number,
      now: number,
    ) => {
      if (!frames || hitClips.length > 30) return;
      const sprite = new Sprite(frames.views[0] ?? Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.position.set(x, y);
      sprite.width = sprite.height = size;
      sprite.scale.y *= -1;
      projectileLayer.addChild(sprite);
      hitClips.push({ sprite, startedAt: now, frames });
    };

    // Taps → arena coordinates
    let viewScale = 1;
    const toArena = (clientX: number, clientY: number) => {
      const rect = game.canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * game.renderer.width;
      const y = ((clientY - rect.top) / rect.height) * game.renderer.height;
      return {
        x: (x - game.renderer.width / 2) / viewScale,
        y: -(y - game.renderer.height / 2) / viewScale,
      };
    };
    const onPointer = (event: PointerEvent) => {
      const view = options.getView();
      const state = view.state;
      if (!state) return;
      const point = toArena(event.clientX, event.clientY);
      let lootId: number | undefined;
      for (const item of state.loot)
        if (Math.hypot(item.x - point.x, item.y - point.y) < 0.9) lootId = item.id;
      let enemyId: number | undefined,
        best = 1.2;
      for (const enemy of state.enemies) {
        const record = enemies.get(enemy.id);
        const ex = record?.x ?? enemy.x,
          ey = (record?.y ?? enemy.y) + 0.5 * enemy.size;
        const dist = Math.hypot(ex - point.x, ey - point.y) / Math.max(0.8, enemy.size);
        if (dist < best) {
          best = dist;
          enemyId = enemy.id;
        }
      }
      options.onTap(point, { enemyId, lootId });
    };
    game.listen("pointerdown", onPointer);

    const resize = (width: number, height: number) => {
      viewScale = Math.min(
        width / (2 * VIEW_HALF_WIDTH),
        height / (2 * VIEW_HALF_HEIGHT),
      );
      camera.position.set(width / 2, height / 2);
      world.scale.set(viewScale, -viewScale);
      sky.clear().rect(0, 0, width, height).fill(0xffffff);
      screenFlash.clear().rect(0, 0, width, height).fill(0xffffff);
      screenFlash.alpha = 0;
    };
    game.setResize(resize);

    let frameNumber = 0;
    /** When this scene first drew the run as over. */
    let overSince: number | null = null;
    let heroX = 0,
      heroY = 0;
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
      const renderTick = state.tick + Math.min(1, view.pending / TD_TICK_SECONDS);
      const stage = tdStageForWave(state.wave);
      const smoothing = 1 - Math.exp(-Math.min(0.1, frame.delta) * 18);

      // Events from the simulation, each handled once.
      for (const event of state.events) handleEvent(event, state, now);
      state.events.length = 0;

      // Hero
      heroX += (state.hero.x - heroX) * smoothing;
      heroY += (state.hero.y - heroY) * smoothing;
      heroRoot.position.set(heroX, heroY);
      heroRoot.zIndex = -heroY;
      const nearest = nearestEnemy(state, heroX, heroY);
      if (nearest)
        heroDirection = lpcFacing(
          nearest.x - heroX,
          -(nearest.y - heroY),
          heroDirection,
        );
      if (now > heroAnimationUntil && heroAnimation !== "combat")
        heroAnimation = "combat";
      if (state.over) heroAnimation = "hurt";
      const heroFrame = reduced ? { ...frame, reducedMotion: true } : frame;
      hero?.render(heroFrame, heroAnimation, heroDirection, heroRestart);
      heroCastRoot.visible = showCasts();
      if (heroCastRoot.visible)
        heroCast?.render(heroFrame, heroAnimation, heroDirection, heroRestart);
      heroRestart = false;
      const cloning = state.tick < state.clonesUntil;
      if (cloning) ensureClones();
      clones.forEach((clone, index) => {
        clone.sprite.visible = cloning;
        if (!cloning) return;
        const angle = (index / clones.length) * Math.PI * 2 + now / 1600;
        clone.sprite.position.set(
          heroX + Math.cos(angle) * 1.4,
          heroY + Math.sin(angle) * 1.1 + 0.5,
        );
        clone.sprite.zIndex = -clone.sprite.y;
        clone.render(
          frame,
          "walk",
          lpcFacing(Math.cos(angle + Math.PI / 2), -Math.sin(angle + Math.PI / 2)),
        );
      });

      // Enemies
      frameNumber++;
      for (const enemy of state.enemies) {
        const record = enemies.get(enemy.id) ?? spawnEnemy(enemy, state.wave);
        record.seenFrame = frameNumber;
        const jump = Math.hypot(enemy.x - record.x, enemy.y - record.y) > 3;
        record.x = jump ? enemy.x : record.x + (enemy.x - record.x) * smoothing;
        record.y = jump ? enemy.y : record.y + (enemy.y - record.y) * smoothing;
        record.root.position.set(record.x, record.y);
        record.root.zIndex = -record.y;
        drawEnemyBody(record, enemy, state, now, reduced);
      }
      for (const [id, record] of enemies)
        if (record.seenFrame !== frameNumber) {
          record.root.removeFromParent();
          enemies.delete(id);
          if (--record.art.users === 0) record.art.idleSince = now;
          record.art = NO_ENEMY_ART;
          // Pooled bodies hold no frame of art that may be released before they return.
          record.body.texture = record.cast.texture = Texture.EMPTY;
          spareEnemies.push(record);
        }
      updateArtLeases(now);

      // Projectiles
      for (let i = flights.length - 1; i >= 0; i--) {
        const flight = flights[i];
        if (!flight) continue;
        const target = enemies.get(flight.targetId);
        if (target) {
          flight.tx = target.x;
          flight.ty = target.y + 0.5;
        }
        const t = Math.min(
          1,
          (renderTick - flight.start) / Math.max(0.5, flight.due - flight.start),
        );
        const arc = flight.element === "fire" ? Math.sin(t * Math.PI) * 1.2 : 0;
        flight.sprite.position.set(
          flight.fx + (flight.tx - flight.fx) * t,
          flight.fy + (flight.ty - flight.fy) * t + arc,
        );
        if (!reduced) flight.sprite.rotation += frame.delta * 14;
        if (t >= 1) {
          projectileLayer.removeChild(flight.sprite);
          flightPool.push(flight.sprite);
          flights.splice(i, 1);
        }
      }
      for (let i = hitClips.length - 1; i >= 0; i--) {
        const clip = hitClips[i];
        if (!clip) continue;
        const sample = sampleAnimationClip(
          clip.frames.clip,
          now - clip.startedAt,
          reduced,
        );
        clip.sprite.texture = clip.frames.views[sample.index] ?? Texture.EMPTY;
        if (sample.finished) {
          clip.sprite.destroy();
          hitClips.splice(i, 1);
        }
      }

      drawArena(state, view, now);
      lighting.update(SUN, terrainView);

      // Ambient life that grows wilder with the waves
      ambient(state, now, reduced);

      const shake = fx.update(frame, reduced);
      camera.position.set(
        game.renderer.width / 2 + shake.offsetX * viewScale,
        game.renderer.height / 2 + shake.offsetY * viewScale,
      );
      sky.tint = stage.sky;
      sky.alpha = skyAlpha(state);
      sky.blendMode = "multiply";
      if (state.tick < state.tsukuyomiUntil) {
        sky.tint = 0xb3001b;
        sky.alpha = 0.45;
      }
      screenFlash.tint = shake.overlay?.color ?? 0xffffff;
      screenFlash.alpha = shake.overlay?.alpha ?? 0;
      // A finished run never changes, so the field rests under the results once its
      // closing effects have played; a resize or tap still redraws it.
      if (state.over) overSince ??= now;
      game.setAnimating(overSince === null || now - overSince < GAME_OVER_SETTLE_MS);
    });

    const lastSound = new Map<TdSfx, number>();
    const handleEvent = (event: TdEvent, state: TdState, now: number) => {
      const cue = eventSound(event);
      if (cue && options.playSound) {
        const [name, volume, gapMs] = cue;
        if (now - (lastSound.get(name) ?? Number.NEGATIVE_INFINITY) >= gapMs) {
          lastSound.set(name, now);
          options.playSound(name, volume);
        }
      }
      switch (event.type) {
        case "throw": {
          if (flights.length > 160) return;
          const sprite =
            flightPool.pop() ?? new Sprite({ texture: shuriken, anchor: 0.5 });
          projectileLayer.addChild(sprite);
          const size = event.from === "sentry" ? 0.28 : event.crit ? 0.42 : 0.34;
          sprite.width = sprite.height = size;
          sprite.tint =
            event.element === "fire" ? 0xffa060 : event.crit ? 0xfff07a : 0xffffff;
          const fromHero = event.from === "hero";
          if (fromHero && now > heroAnimationUntil - 120) cueHero("slash", now);
          flights.push({
            sprite,
            fx: event.x,
            fy: event.y + 0.6,
            tx: event.x,
            ty: event.y,
            targetId: event.targetId,
            start: state.tick,
            due: event.due,
            element: event.element,
          });
          return;
        }
        case "hit": {
          const record = enemies.get(event.targetId);
          const x = record?.x ?? event.x,
            y = (record?.y ?? event.y) + 0.7;
          if (record) record.flashUntil = now + 90;
          if (event.shield) {
            fx.ring(x, y - 0.2, { to: 0.7, color: 0x6fb8ff, life: 0.25, width: 0.06 });
            return;
          }
          const color = event.crit ? 0xffe14d : ELEMENT_COLORS[event.element];
          if (event.amount > 0)
            fx.number(x, y, event.amount, { color, crit: event.crit });
          fx.burst(x, y - 0.2, {
            color,
            count: event.crit ? 7 : 3,
            speed: event.crit ? 4 : 2.2,
            size: 0.18,
            life: 0.3,
          });
          if (event.crit) playClip(hitFrames, x, y - 0.2, 1.1, now);
          return;
        }
        case "kill": {
          const record = enemies.get(event.id);
          const x = record?.x ?? event.x,
            y = (record?.y ?? event.y) + 0.5;
          const color = TD_ENEMIES[event.kind].tint;
          fx.burst(x, y, {
            color,
            count: event.boss ? 60 : event.elite ? 22 : 10,
            speed: event.boss ? 7 : 3.5,
            size: event.boss ? 0.5 : 0.28,
            life: event.boss ? 1.1 : 0.55,
            gravity: 3,
          });
          fx.ring(x, y - 0.4, {
            to: event.boss ? 4 : 1.2,
            color: event.boss ? 0xffd36b : 0xffffff,
            life: 0.45,
            width: 0.08,
          });
          if (event.boss) {
            fx.shake(0.45, 0.6);
            fx.flash(0xfff3c4, 0.5, 0.5);
            playClip(smokeFrames, x, y, 4, now);
          }
          return;
        }
        case "jutsu": {
          cueHero("spellcast", now);
          const color = ELEMENT_COLORS[TD_JUTSU_INFO[event.jutsu].element];
          switch (event.jutsu) {
            case "fire":
              for (const point of event.points) {
                fx.ring(point.x, point.y + 0.3, {
                  to: event.radius,
                  color,
                  life: 0.6,
                  width: 0.18,
                  fill: 0.45,
                });
                fx.burst(point.x, point.y + 0.3, {
                  color,
                  count: 26,
                  speed: 5,
                  size: 0.45,
                  life: 0.7,
                  grow: 0.4,
                  gravity: -1.5,
                });
                fx.burst(point.x, point.y + 0.3, {
                  color: 0xffe08a,
                  count: 10,
                  speed: 2,
                  size: 0.6,
                  life: 0.4,
                });
              }
              if (event.evolved) fx.shake(0.15, 0.25);
              return;
            case "lightning":
              fx.bolt(
                event.points.map((point, index) => ({
                  x: point.x,
                  y: point.y + (index === 0 ? 0.9 : 0.6),
                })),
                { color, life: 0.32, width: 0.09, jitter: 0.45 },
              );
              for (const point of event.points.slice(1))
                fx.burst(point.x, point.y + 0.6, {
                  color,
                  count: 6,
                  speed: 3.5,
                  size: 0.2,
                  life: 0.25,
                });
              if (event.evolved) {
                fx.flash(0xcfe9ff, 0.35, 0.25);
                for (const enemy of state.enemies.slice(0, 40))
                  fx.bolt(
                    [
                      { x: enemy.x + (Math.random() - 0.5), y: enemy.y + 9 },
                      { x: enemy.x, y: enemy.y + 0.5 },
                    ],
                    { color: 0xbfe8ff, life: 0.35, width: 0.12, jitter: 0.7 },
                  );
              }
              return;
            case "water":
              fx.ring(event.x, event.y + 0.2, {
                from: 0.5,
                to: event.radius,
                color,
                life: 0.8,
                width: 0.35,
                fill: 0.25,
              });
              fx.burst(event.x, event.y + 0.2, {
                color,
                count: 40,
                speed: 6,
                size: 0.3,
                life: 0.8,
                drag: 1.5,
              });
              if (event.evolved)
                fx.ring(event.x, event.y + 0.2, {
                  from: event.radius,
                  to: event.radius + 0.4,
                  color: 0xe6fbff,
                  life: 1.4,
                  width: 0.6,
                  fill: 0.15,
                });
              return;
            case "wind":
              for (const point of event.points) {
                fx.streak(event.x, event.y + 0.6, point.x, point.y + 0.6, {
                  color,
                  life: 0.35,
                  width: 0.35,
                });
                fx.streak(event.x, event.y + 0.5, point.x, point.y + 0.4, {
                  color: 0xffffff,
                  life: 0.25,
                  width: 0.1,
                });
              }
              return;
            case "earth":
              for (let ring = 0; ring < (event.evolved ? 3 : 1); ring++)
                fx.ring(event.x, event.y, {
                  from: 0.4 + ring * 2,
                  to: event.radius + ring * 2,
                  color,
                  life: 0.6 + ring * 0.2,
                  width: 0.45,
                  fill: 0.2,
                });
              fx.burst(event.x, event.y, {
                color,
                count: 34,
                speed: 5,
                size: 0.35,
                life: 0.6,
                gravity: 6,
                angle: Math.PI / 2,
                arc: Math.PI,
              });
              fx.shake(event.evolved ? 0.3 : 0.15, 0.3);
              return;
          }
          return;
        }
        case "art": {
          cueHero("spellcast", now);
          switch (event.art) {
            case "fizzle":
              fx.burst(heroX, heroY + 1, {
                color: 0x888888,
                count: 12,
                speed: 1.5,
                size: 0.3,
                life: 0.6,
                gravity: -1,
              });
              return;
            case "dragon_flame":
              fx.streak(heroX, heroY + 1, event.x, event.y + 0.5, {
                color: 0xff6a00,
                life: 0.5,
                width: 0.6,
              });
              fx.ring(event.x, event.y + 0.3, {
                to: event.radius + 0.5,
                color: 0xff7a1a,
                life: 1.2,
                width: 0.3,
                fill: 0.5,
              });
              fx.burst(event.x, event.y + 0.3, {
                color: 0xff7a1a,
                count: 70,
                speed: 6,
                size: 0.6,
                life: 1.1,
                grow: 0.6,
                gravity: -2,
                spread: event.radius,
              });
              fx.shake(0.2, 0.4);
              return;
            case "thunder_strike":
              fx.bolt(
                [
                  { x: event.x + 0.3, y: event.y + 12 },
                  { x: event.x - 0.2, y: event.y + 5 },
                  { x: event.x, y: event.y + 0.5 },
                ],
                { color: 0xbfe8ff, life: 0.5, width: 0.3, jitter: 0.9 },
              );
              fx.flash(0xe8f6ff, 0.6, 0.3);
              fx.ring(event.x, event.y, {
                to: 3,
                color: 0xbfe8ff,
                life: 0.5,
                width: 0.2,
              });
              fx.shake(0.35, 0.35);
              return;
            case "water_prison":
              fx.ring(event.x, event.y + 0.4, {
                from: event.radius,
                to: event.radius,
                color: 0x4fc3ff,
                life: 3,
                width: 0.12,
                fill: 0.35,
              });
              fx.burst(event.x, event.y + 0.4, {
                color: 0xa8e8ff,
                count: 40,
                speed: 1,
                size: 0.25,
                life: 2.5,
                spread: event.radius * 1.6,
                gravity: -0.5,
              });
              return;
            case "cyclone":
              fx.burst(event.x, event.y + 0.5, {
                color: 0xd9ffe4,
                count: 50,
                speed: 7,
                size: 0.3,
                life: 0.6,
              });
              return;
            case "mystic_palm":
              fx.ring(heroX, heroY + 0.6, {
                to: 1.6,
                color: 0x7dff9c,
                life: 0.9,
                width: 0.2,
                fill: 0.4,
              });
              fx.burst(heroX, heroY + 0.6, {
                color: 0x7dff9c,
                count: 40,
                speed: 2,
                size: 0.3,
                life: 1.2,
                gravity: -2.5,
                spread: 1.2,
              });
              return;
            case "earth_dome":
              fx.ring(heroX, heroY + 0.4, {
                from: 1.4,
                to: 1.5,
                color: 0xc8945a,
                life: 5,
                width: 0.18,
                fill: 0.18,
              });
              fx.burst(heroX, heroY, {
                color: 0xc8945a,
                count: 30,
                speed: 3,
                size: 0.35,
                life: 0.6,
                gravity: 5,
                angle: Math.PI / 2,
                arc: Math.PI,
              });
              return;
          }
          return;
        }
        case "seal":
          fx.burst(heroX, heroY + 1.3, {
            color:
              [0xff9f43, 0x7bed9f, 0x70a1ff, 0xeccc68][event.count - 1] ?? 0xffffff,
            count: 8,
            speed: 1.2,
            size: 0.25,
            life: 0.5,
            gravity: -1,
          });
          return;
        case "ultimate": {
          cueHero("spellcast", now);
          fx.flash(0xffffff, 0.35, 0.4);
          switch (event.ultimate) {
            case "clones":
              ensureClones();
              for (let i = 0; i < 6; i++)
                playClip(
                  smokeFrames,
                  heroX + Math.cos((i / 6) * Math.PI * 2) * 1.4,
                  heroY + Math.sin((i / 6) * Math.PI * 2) * 1.1 + 0.6,
                  1.6,
                  now,
                );
              return;
            case "tempest":
              fx.shake(0.25, 0.6);
              return;
            case "amaterasu":
              fx.flash(0x2a0033, 0.55, 0.9);
              for (const enemy of state.enemies.slice(0, 80))
                fx.burst(enemy.x, enemy.y + 0.5, {
                  color: 0x6b00b3,
                  count: 6,
                  speed: 1,
                  size: 0.45,
                  life: 1.2,
                  gravity: -2,
                });
              return;
            case "tsukuyomi":
              fx.flash(0xb3001b, 0.6, 0.8);
              fx.ring(heroX, heroY, { to: 20, color: 0xff2a4d, life: 1.2, width: 0.4 });
              return;
            case "cataclysm":
              fx.burst(event.x, event.y + 0.5, {
                color: 0x9b5cff,
                count: 60,
                speed: -4,
                size: 0.4,
                life: 0.9,
                spread: 8,
              });
              return;
          }
          return;
        }
        case "heroHit":
          fx.shake(0.06, 0.12);
          fx.burst(heroX, heroY + 0.8, {
            color: 0xff3b3b,
            count: 4,
            speed: 2,
            size: 0.2,
            life: 0.3,
          });
          if (now > heroAnimationUntil) cueHero("hurt", now);
          return;
        case "substitution":
          playClip(smokeFrames, heroX, heroY + 0.6, 2, now);
          fx.burst(heroX, heroY + 0.6, {
            color: 0xd9c7a3,
            count: 20,
            speed: 3,
            size: 0.35,
            life: 0.6,
          });
          if (event.perfect) {
            fx.flash(0xffffff, 0.45, 0.25);
            const target = enemies.get(event.counterId);
            if (target)
              fx.streak(heroX, heroY + 0.7, target.x, target.y + 0.6, {
                color: 0xffffff,
                life: 0.3,
                width: 0.25,
              });
          }
          return;
        case "blink":
          fx.burst(event.fromX, event.fromY + 0.6, {
            color: 0x9fd8ff,
            count: 16,
            speed: 3,
            size: 0.3,
            life: 0.4,
          });
          fx.streak(event.fromX, event.fromY + 0.6, event.x, event.y + 0.6, {
            color: 0xd8f1ff,
            life: 0.2,
            width: 0.3,
          });
          fx.ring(event.x, event.y + 0.1, {
            to: 1,
            color: 0x9fd8ff,
            life: 0.35,
            width: 0.1,
          });
          return;
        case "bossMove":
          if (event.move === "roar") {
            const record = enemies.get(event.id);
            if (record)
              fx.ring(record.x, record.y + 0.8, {
                to: 6,
                color: 0xff4d4d,
                life: 0.7,
                width: 0.25,
              });
            fx.shake(0.2, 0.5);
          } else if (event.move === "summon") {
            const record = enemies.get(event.id);
            if (record) playClip(smokeFrames, record.x, record.y + 0.6, 3, now);
          } else if (event.move === "heal") {
            const record = enemies.get(event.id);
            if (record)
              fx.burst(record.x, record.y + 0.8, {
                color: 0x7dff9c,
                count: 24,
                speed: 1.6,
                size: 0.3,
                life: 1,
                gravity: -2,
              });
          }
          return;
        case "explosion":
          fx.ring(event.x, event.y + 0.2, {
            to: event.radius,
            color: ELEMENT_COLORS[event.element],
            life: 0.45,
            width: 0.15,
            fill: 0.3,
          });
          fx.burst(event.x, event.y + 0.2, {
            color: ELEMENT_COLORS[event.element],
            count: Math.min(40, 8 + event.radius * 6),
            speed: 2 + event.radius * 2,
            size: 0.32,
            life: 0.5,
            gravity: -1,
          });
          if (event.radius >= 3.5) {
            fx.shake(0.5, 0.7);
            fx.flash(0xf3e8ff, 0.8, 0.6);
            fx.ring(event.x, event.y, {
              to: 22,
              color: 0xc4a3ff,
              life: 1.1,
              width: 0.6,
            });
          }
          return;
        case "wave":
          fx.ring(heroX, heroY, {
            from: 12,
            to: 0.5,
            color: event.boss ? 0xff4d4d : 0xffffff,
            life: 0.8,
            width: 0.1,
          });
          if (event.titan) fx.shake(0.3, 0.9);
          return;
        case "loot":
          if (event.collected)
            fx.burst(heroX, heroY + 1, {
              color: LOOT_COLORS[event.kind],
              count: 16,
              speed: 2.5,
              size: 0.3,
              life: 0.5,
              gravity: -1,
            });
          return;
        case "secondWind":
          fx.flash(0xfff6c4, 0.8, 0.8);
          fx.ring(heroX, heroY + 0.5, {
            to: 6,
            color: 0xffd36b,
            life: 1,
            width: 0.3,
            fill: 0.2,
          });
          return;
        case "gameOver":
          fx.flash(0x000000, 0.6, 1.5);
          return;
      }
    };

    const drawEnemyBody = (
      record: EnemyRecord,
      enemy: TdEnemy,
      state: TdState,
      now: number,
      reduced: boolean,
    ) => {
      const { x, y } = state.hero;
      const moving = Math.hypot(enemy.x - x, enemy.y - y) > enemy.stop + 0.05;
      const facing = enemy.x > x ? -1 : 1;
      // A sheet animates at full height; a lone avatar bobs at a smaller size.
      const clip =
        (moving ? record.art.move : record.art.idle) ??
        record.art.move ??
        record.art.idle;
      const texture = clip
        ? (clip.views[
            reduced
              ? 0
              : spriteAnimationFrame(clip.animation, now - record.bornAt, true)
          ] ?? Texture.EMPTY)
        : record.art.still;
      record.body.visible = !!texture;
      record.fallback.visible = !texture;
      if (texture) {
        const size = clip ? 1.9 : 1.05;
        const flip = clip?.animation.facing === "left" ? -facing : facing;
        const bob =
          clip || reduced
            ? 0
            : Math.abs(Math.sin((now - record.bornAt) / 160)) * (moving ? 0.12 : 0.03);
        record.body.texture = texture;
        record.body.scale.set(
          (size / Math.max(1, texture.width)) * flip,
          -size / Math.max(1, texture.height),
        );
        record.body.position.set(0, bob);
      }
      // Sun silhouette: the current frame sheared away from the sun from the feet.
      record.cast.visible = record.body.visible && showCasts();
      if (record.cast.visible) {
        const body = record.body;
        const rise = Math.abs(body.scale.y);
        record.cast.texture = body.texture;
        castMatrix.set(
          body.scale.x,
          0,
          SUN_SLOPE_X * rise,
          SUN_SLOPE_Y * rise,
          body.x,
          body.y,
        );
        record.cast.setFromMatrix(castMatrix);
      }
      const tick = state.tick;
      let tint = 0xffffff;
      if (tick < enemy.chillUntil) tint = 0xa8e4ff;
      if (tick < enemy.frozenUntil || tick < state.tsukuyomiUntil) tint = 0x7fb8ff;
      if (tick < enemy.flameUntil) tint = 0x9a66ff;
      else if (tick < enemy.burnUntil && Math.floor(now / 90) % 2 === 0)
        tint = 0xffb27a;
      if (now < record.flashUntil) tint = 0xff6b6b;
      record.body.tint = tint;
      record.fallback.tint = tint;
      record.root.alpha = tdIsPhased(state, enemy)
        ? 0.25
        : enemy.camo && enemy.id !== state.focusId
          ? 0.45
          : 1;
      // Halo: elites glow in their first affix's colour, wards show their element. Each
      // part is shared white geometry, coloured by tint and animated by its transform.
      const halo = record.halo;
      const pulse = reduced ? 0.5 : 0.5 + Math.sin(now / 200 + enemy.id) * 0.5;
      const ringed = enemy.boss || enemy.elite;
      halo.ring.visible = ringed;
      halo.bossRing.visible = enemy.boss;
      if (ringed) {
        const color = enemy.boss
          ? enemy.enraged
            ? 0xff2a2a
            : 0xffd36b
          : TD_AFFIX_TINTS[enemy.affixes[0] ?? "armored"];
        halo.ring.tint = color;
        halo.ring.alpha = 0.5 + pulse * 0.4;
        if (enemy.boss) {
          halo.bossRing.tint = color;
          halo.bossRing.scale.set(
            (0.8 + pulse * 0.15) / BOSS_RING_RADIUS_X,
            (0.34 + pulse * 0.06) / BOSS_RING_RADIUS_Y,
          );
        }
      }
      halo.ward.visible = enemy.ward !== null;
      if (enemy.ward) halo.ward.tint = ELEMENT_COLORS[enemy.ward];
      halo.shield.visible = enemy.shield > 0;
      if (enemy.shield > 0)
        halo.shield.alpha = 0.35 + 0.4 * (enemy.shield / Math.max(1, enemy.maxShield));
      const stunned = tick < enemy.stunUntil;
      for (let i = 0; i < halo.stun.length; i++) {
        const dot = halo.stun[i];
        if (!dot) continue;
        dot.visible = stunned;
        if (!stunned) continue;
        const angle = now / 180 + (i * Math.PI * 2) / 3;
        dot.position.set(Math.cos(angle) * 0.3, 1.45 + Math.sin(angle) * 0.08);
      }
      halo.focus.visible = enemy.id === state.focusId;
      if (halo.focus.visible) halo.focus.rotation = now / 300;
      // Health bar: one-texel sprites stretched to the bar's size
      const bar = record.bar;
      const fraction = Math.max(0, enemy.hp / enemy.maxHp);
      bar.root.visible = fraction < 1 || enemy.boss || enemy.elite;
      if (bar.root.visible) {
        const width = enemy.boss ? 1.4 : 0.8;
        bar.back.x = bar.fill.x = bar.shield.x = -width / 2;
        bar.back.width = width;
        bar.fill.width = width * fraction;
        bar.fill.visible = fraction > 0;
        bar.fill.tint = enemy.boss ? 0xff3b3b : enemy.elite ? 0xffb02e : 0x4cd964;
        bar.shield.visible = enemy.maxShield > 0 && enemy.shield > 0;
        if (bar.shield.visible)
          bar.shield.width = (width * enemy.shield) / enemy.maxShield;
      }
    };

    const drawArena = (state: TdState, view: TowerDefenseSceneView, now: number) => {
      groundFx.clear();
      dynamic.clear();
      // Hero range, redrawn only when the range stat changes
      if (state.stats.range !== heroRangeRadius) {
        heroRangeRadius = state.stats.range;
        heroRange
          .clear()
          .circle(0, 0, heroRangeRadius)
          .fill({ color: 0x8ab4ff, alpha: 0.06 })
          .stroke({ color: 0x8ab4ff, alpha: 0.35, width: 0.05 });
      }
      heroRange.position.set(heroX, heroY);
      // Chakra aura grows with the run: a unit disc stretched, tinted and faded
      const aura = auraColor(state.wave, now);
      chakraAura.visible = aura !== null;
      if (aura) {
        const pulse = 0.5 + Math.sin(now / 260) * 0.5;
        chakraAura.position.set(heroX, heroY + 0.1);
        chakraAura.scale.set(
          0.9 + pulse * 0.2 + Math.min(1.2, state.wave / 400),
          0.38 + pulse * 0.08,
        );
        chakraAura.tint = aura;
        chakraAura.alpha = 0.18 + pulse * 0.12;
        if (Math.random() < 0.5)
          fx.burst(heroX + (Math.random() - 0.5) * 0.9, heroY + 0.2, {
            color: aura,
            count: 1,
            speed: 0.4,
            size: 0.28,
            life: 0.9,
            gravity: -2.2,
          });
      }
      substitutionRing.visible = state.tick < state.hero.subUntil;
      substitutionRing.position.set(heroX, heroY);
      earthDome.visible = state.tick < state.hero.domeUntil;
      earthDome.position.set(heroX, heroY);
      rageGlow.visible = state.tick < state.hero.rageUntil;
      rageGlow.position.set(heroX, heroY);
      rageGlow.alpha = 0.15 + Math.sin(now / 80) * 0.05;
      // Sentry slots, bases and posts; only their glows animate
      if (sentryLayout.update(state)) {
        sentryGround.clear();
        sentryPosts.clear();
        for (let slot = 0; slot < state.stats.sentrySlots; slot++) {
          const at = tdSentryPosition(slot);
          const sentry = state.sentries[slot];
          if (!sentry) {
            sentryGround
              .circle(at.x, at.y, 0.35)
              .stroke({ color: 0xffffff, alpha: 0.25, width: 0.04 });
            continue;
          }
          const color = SENTRY_COLORS[sentry.type];
          if (sentry.type === "frost" || sentry.type === "sensor")
            sentryGround
              .circle(at.x, at.y, tdSentryRange(sentry))
              .fill({ color, alpha: 0.05 });
          sentryGround
            .ellipse(at.x, at.y, 0.4, 0.17)
            .fill({ color: 0x000000, alpha: 0.35 });
          sentryPosts
            .roundRect(
              at.x - 0.2,
              at.y,
              0.4,
              0.7 + Math.min(0.6, sentry.level * 0.03),
              0.08,
            )
            .fill(0x3a3f55)
            .stroke({ color, width: 0.05 });
        }
      }
      for (let slot = 0; slot < state.stats.sentrySlots; slot++) {
        const sentry = state.sentries[slot];
        if (!sentry) continue;
        const at = tdSentryPosition(slot);
        const color = SENTRY_COLORS[sentry.type];
        const glowSize =
          0.18 +
          Math.min(0.25, sentry.level * 0.01) +
          Math.sin(now / 200 + slot) * 0.03;
        dynamic
          .circle(at.x, at.y + 0.8 + Math.min(0.6, sentry.level * 0.03), glowSize)
          .fill({ color, alpha: 0.9 });
      }
      // Traps
      for (const trap of state.traps) {
        dynamic
          .rect(trap.x - 0.18, trap.y - 0.1, 0.36, 0.22)
          .fill(0xf5e6c8)
          .stroke({ color: 0x8b0000, width: 0.03 });
        if (Math.floor(now / 300) % 2 === 0)
          dynamic.circle(trap.x, trap.y + 0.01, 0.05).fill(0xff2a2a);
      }
      // Loot orbs
      for (const item of state.loot) {
        const bob = Math.sin(now / 180 + item.id) * 0.1;
        const fade = Math.min(1, (item.expires - state.tick) / 15);
        const color = LOOT_COLORS[item.kind];
        dynamic
          .circle(item.x, item.y + 0.5 + bob, 0.32)
          .fill({ color, alpha: 0.35 * fade });
        dynamic
          .circle(item.x, item.y + 0.5 + bob, 0.18)
          .fill({ color: 0xffffff, alpha: 0.9 * fade })
          .stroke({ color, width: 0.06, alpha: fade });
      }
      // Telegraphs fill up until they land
      for (const telegraph of state.telegraphs) {
        const progress = Math.min(
          1,
          (state.tick - telegraph.start) / Math.max(1, telegraph.due - telegraph.start),
        );
        const color = telegraph.kind === "cataclysm" ? 0xb57cff : 0xff2a2a;
        groundFx
          .circle(telegraph.x, telegraph.y, telegraph.radius)
          .fill({ color, alpha: 0.12 })
          .stroke({ color, alpha: 0.8, width: 0.07 });
        groundFx
          .circle(telegraph.x, telegraph.y, Math.max(0.01, telegraph.radius * progress))
          .fill({ color, alpha: 0.28 });
        if (telegraph.kind === "meteor") {
          const height = (1 - progress) * 10;
          dynamic
            .circle(telegraph.x + height * 0.4, telegraph.y + height + 0.4, 0.45)
            .fill(0xff7a1a);
          if (Math.random() < 0.6)
            fx.burst(telegraph.x + height * 0.4, telegraph.y + height + 0.4, {
              color: 0xffb347,
              count: 1,
              speed: 0.5,
              size: 0.4,
              life: 0.4,
            });
        }
        if (telegraph.kind === "cataclysm") {
          const radius = 0.4 + progress * 1.8;
          dynamic
            .circle(telegraph.x, telegraph.y + 1.5, radius)
            .fill({ color: 0x2a0050, alpha: 0.85 })
            .stroke({ color: 0xc4a3ff, width: 0.12 });
        }
      }
      // Vortices spin
      for (const vortex of state.vortices) {
        const turns = vortex.kind === "tempest" ? 4 : 3;
        const color = vortex.kind === "tempest" ? 0x9fffd0 : 0xe2ffe9;
        for (let arm = 0; arm < turns; arm++) {
          const base =
            now / (vortex.kind === "tempest" ? 90 : 140) + (arm * Math.PI * 2) / turns;
          dynamic.moveTo(vortex.x, vortex.y + 0.3);
          for (let step = 1; step <= 14; step++) {
            const f = step / 14;
            dynamic.lineTo(
              vortex.x + Math.cos(base + f * 4) * vortex.radius * f,
              vortex.y + 0.3 + Math.sin(base + f * 4) * vortex.radius * f * 0.6,
            );
          }
          dynamic.stroke({ color, alpha: 0.65, width: 0.12 });
        }
        if (Math.random() < 0.8)
          fx.burst(vortex.x, vortex.y + 0.4, {
            color,
            count: 2,
            speed: vortex.radius * 1.5,
            size: 0.25,
            life: 0.4,
          });
      }
      // Reticle and input mode
      if (view.reticle) {
        const { x, y } = view.reticle;
        const spin = now / 500;
        const color =
          view.mode === "trap" ? 0xffb02e : view.mode === "blink" ? 0x9fd8ff : 0xffffff;
        groundFx.circle(x, y, 0.45).stroke({ color, alpha: 0.9, width: 0.05 });
        for (let i = 0; i < 4; i++) {
          const angle = spin + (i * Math.PI) / 2;
          groundFx
            .moveTo(x + Math.cos(angle) * 0.55, y + Math.sin(angle) * 0.55)
            .lineTo(x + Math.cos(angle) * 0.8, y + Math.sin(angle) * 0.8)
            .stroke({ color, width: 0.05 });
        }
      }
      if (view.mode === "blink")
        groundFx
          .circle(0, 0, TD_HERO_ZONE)
          .fill({ color: 0x9fd8ff, alpha: 0.08 })
          .stroke({ color: 0x9fd8ff, alpha: 0.6, width: 0.06 });
    };

    const ambient = (state: TdState, now: number, reduced: boolean) => {
      if (reduced) return;
      const wave = state.wave;
      const intensity = Math.min(1, wave / 500);
      const embers = wave >= 100 ? 1 + Math.floor(intensity * 4) : wave >= 50 ? 1 : 0;
      for (let i = 0; i < embers; i++) {
        if (Math.random() > 0.35) continue;
        const color =
          wave >= 500
            ? hueColor((now / 20 + Math.random() * 120) % 360)
            : wave >= 400
              ? 0x7fdfff
              : wave >= 300
                ? 0x9e8cff
                : wave >= 200
                  ? 0xc9a3ff
                  : wave >= 100
                    ? 0xff4d6d
                    : 0xffb37a;
        fx.burst((Math.random() - 0.5) * 26, -10 + Math.random() * 4, {
          color,
          count: 1,
          speed: 0.6,
          size: 0.2 + intensity * 0.25,
          life: 3,
          gravity: -1.2 - intensity,
          drag: 0.2,
        });
      }
      if (wave >= 300 && Math.random() < 0.02 + intensity * 0.04) {
        const x = (Math.random() - 0.5) * 24;
        fx.bolt(
          [
            { x, y: 11 },
            { x: x + (Math.random() - 0.5) * 3, y: 6 },
            { x: x + (Math.random() - 0.5) * 5, y: 3 },
          ],
          {
            color: wave >= 500 ? hueColor((now / 10) % 360) : 0xb79cff,
            life: 0.25,
            width: 0.06,
            jitter: 0.8,
          },
        );
      }
    };

    return { dispose: game.dispose };
  } catch (error) {
    game.dispose();
    throw error;
  }
};

/**
 * The sound for a simulation event: cue, relative volume and minimum gap in ms. Sound
 * marks what the player did and what demands attention; the steady stream of automatic
 * hits, kills, jutsu casts and small blasts stays silent so a crowded wave stays calm.
 */
export const eventSound = (event: TdEvent): [TdSfx, number, number] | null => {
  switch (event.type) {
    case "throw":
      return event.from === "hero" ? ["throw", 0.1, 1000] : null;
    case "kill":
      return event.boss ? ["explosion", 0.9, 0] : null;
    case "art":
      return event.art === "fizzle"
        ? ["smoke", 0.4, 0]
        : [ART_SOUNDS[event.art], 0.75, 0];
    case "seal":
      return ["seal", 0.35, 0];
    case "ultimate":
      return [ULTIMATE_SOUNDS[event.ultimate], 0.85, 0];
    case "explosion":
      return event.radius >= 3.5 ? ["explosion", 0.9, 0] : null;
    case "heroHit":
      return ["hurt", 0.3, 900];
    case "substitution":
      return event.perfect ? ["clash", 0.8, 0] : ["smoke", 0.5, 0];
    case "blink":
      return ["pulse", 0.5, 0];
    case "bossMove":
      return [BOSS_MOVE_SOUNDS[event.move], 0.65, 1500];
    case "wave":
      return event.boss ? ["roar", 0.6, 0] : null;
    case "loot":
      return event.collected
        ? [event.kind === "ryo" || event.kind === "scroll" ? "coin" : "chime", 0.6, 0]
        : null;
    case "secondWind":
      return ["pulse", 0.9, 0];
    default:
      return null;
  }
};

const BOSS_MOVE_SOUNDS: Record<TdBossMove, TdSfx> = {
  slam: "charge",
  summon: "smoke",
  roar: "roar",
  charge: "whoosh",
  barrage: "clash",
  heal: "heal",
};

const ART_SOUNDS: Record<TdSealArt, TdSfx> = {
  dragon_flame: "fire",
  thunder_strike: "lightning",
  water_prison: "ice",
  cyclone: "whoosh",
  mystic_palm: "heal",
  earth_dome: "earth",
};

const ULTIMATE_SOUNDS: Record<TdUltimate, TdSfx> = {
  clones: "smoke",
  tempest: "whoosh",
  amaterasu: "fire",
  tsukuyomi: "shimmer",
  cataclysm: "charge",
};

/** A fixed afternoon sun; tree and actor silhouettes share it so the arena reads as one light. */
const SUN = (() => {
  const angle = Math.PI * 0.32;
  const x = Math.cos(angle),
    y = -Math.sin(angle) * 0.65,
    z = 0.28 + Math.sin(angle) * 0.8;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length, day: 1 };
})();
/** Shear of actor silhouettes, clamped as projected scenery clamps grazing light. */
const SUN_SLOPE_X = Math.max(-1.4, Math.min(1.4, SUN.x / Math.max(0.3, SUN.z)));
const SUN_SLOPE_Y = Math.min(-0.12, SUN.y / (2 * Math.max(0.3, SUN.z)));
/** Matches the sector map's NPC silhouettes. */
const CAST_SHADOW_TINT = 0x202932;
const CAST_SHADOW_ALPHA = 0.22;
/** LPC feet sit near row 60 of the 64px frame, in the unit-square actor's space. */
const LPC_FOOT = 60 / 64 - 0.5;
/** Raise the hero so its feet meet its contact shadow at the root. */
const HERO_CENTER_Y = LPC_FOOT * 1.6;

const LOOT_COLORS = {
  ryo: 0xffd34d,
  chakra: 0x4fc3ff,
  scroll: 0xc78cff,
  rage: 0xff4d4d,
} as const;

const nearestEnemy = (state: TdState, x: number, y: number) => {
  let best: TdEnemy | undefined,
    bestDist = Number.POSITIVE_INFINITY;
  for (const enemy of state.enemies) {
    const dist = (enemy.x - x) ** 2 + (enemy.y - y) ** 2;
    if (dist < bestDist) {
      best = enemy;
      bestDist = dist;
    }
  }
  return best;
};

/** The sky darkens and recolours as the stage advances; bosses deepen it. */
const skyAlpha = (state: TdState) => {
  const wave = state.wave;
  const base =
    wave >= 400
      ? 0.5
      : wave >= 300
        ? 0.45
        : wave >= 200
          ? 0.4
          : wave >= 100
            ? 0.32
            : wave >= 50
              ? 0.22
              : wave >= 25
                ? 0.08
                : 0.12;
  return Math.min(0.6, base + (state.wave % 10 === 0 ? 0.08 : 0));
};

/** Chakra aura colour by stage: blue chakra, sage orange, six-paths purple, then everything. */
const auraColor = (wave: number, now: number) =>
  wave >= 500
    ? hueColor((now / 8) % 360)
    : wave >= 300
      ? 0xb07cff
      : wave >= 150
        ? 0xffa53d
        : wave >= 50
          ? 0x5ab0ff
          : null;

const hueColor = (hue: number) =>
  Color.shared.setValue({ h: hue, s: 100, v: 100 }).toNumber();

/** The boss's outer ring is drawn at its mid-pulse size and scaled through the pulse. */
const BOSS_RING_RADIUS_X = 0.875;
const BOSS_RING_RADIUS_Y = 0.37;

/**
 * Outline geometry every enemy shares, tessellated once per scene. Shapes drawn in
 * white take their colour from the tint of the graphics that shows them.
 */
const createEnemyShapes = () => {
  const ring = new GraphicsContext()
    .ellipse(0, 0.05, 0.62, 0.26)
    .stroke({ color: 0xffffff, width: 0.08 });
  const bossRing = new GraphicsContext()
    .ellipse(0, 0, BOSS_RING_RADIUS_X, BOSS_RING_RADIUS_Y)
    .stroke({ color: 0xffffff, width: 0.05 });
  const ward = new GraphicsContext().circle(0, 0.9, 0.12).fill(0xffffff);
  const shield = new GraphicsContext()
    .ellipse(0, 0.6, 0.55, 0.75)
    .stroke({ color: 0x6fb8ff, width: 0.06 });
  const stun = new GraphicsContext().circle(0, 0, 0.06).fill(0xfff176);
  // Focus marks around their own origin; the graphics turns them.
  const focus = new GraphicsContext();
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    focus
      .moveTo(Math.cos(angle) * 0.75, Math.sin(angle) * 0.75)
      .lineTo(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5)
      .stroke({ color: 0xff3355, width: 0.07 });
  }
  const fallbacks = new Map<TdEnemyKind, GraphicsContext>();
  return {
    ring,
    bossRing,
    ward,
    shield,
    stun,
    focus,
    /** The plain disc drawn for an enemy whose art has not loaded. */
    fallback: (kind: TdEnemyKind) => {
      let context = fallbacks.get(kind);
      if (!context) {
        context = new GraphicsContext()
          .circle(0, 0.5, 0.38)
          .fill(TD_ENEMIES[kind].tint)
          .stroke({ color: 0x111111, width: 0.05 });
        fallbacks.set(kind, context);
      }
      return context;
    },
    dispose: () => {
      for (const context of [ring, bossRing, ward, shield, stun, focus])
        context.destroy();
      for (const context of fallbacks.values()) context.destroy();
      fallbacks.clear();
    },
  };
};

/** A health-bar segment: the one-texel white texture stretched and tinted. */
const meterSprite = (color: number, y: number, height: number) => {
  const sprite = new Sprite(Texture.WHITE);
  sprite.tint = color;
  sprite.y = y;
  sprite.height = height;
  return sprite;
};

/** Reports whether the sentry slots, their occupants or levels changed since the last call. */
const createSentryLayout = () => {
  let slots = -1;
  const types: (string | null)[] = [];
  const levels: number[] = [];
  return {
    update: (state: TdState) => {
      let changed = slots !== state.stats.sentrySlots;
      slots = state.stats.sentrySlots;
      for (let slot = 0; slot < slots; slot++) {
        const sentry = state.sentries[slot];
        const type = sentry?.type ?? null;
        const level = sentry?.level ?? 0;
        if (types[slot] === type && levels[slot] === level) continue;
        types[slot] = type;
        levels[slot] = level;
        changed = true;
      }
      return changed;
    },
  };
};

interface EnemyArt {
  still: Texture | null;
  move: { animation: CharacterAnimation; views: Texture[] } | null;
  idle: { animation: CharacterAnimation; views: Texture[] } | null;
  /** Live enemies drawn with this art. */
  users: number;
  /** When the last of them left the field. */
  idleSince: number;
  /** Ask again for the sheets the atlas budget refused. */
  retry: () => void;
  /** Destroy the frame views and release the sheets. */
  dispose: () => void;
  disposed: boolean;
}

interface EnemyRecord {
  root: Container;
  body: Sprite;
  cast: Sprite;
  fallback: Graphics;
  halo: {
    root: Container;
    ring: Graphics;
    bossRing: Graphics;
    ward: Graphics;
    shield: Graphics;
    stun: Graphics[];
    focus: Graphics;
  };
  bar: { root: Container; back: Sprite; fill: Sprite; shield: Sprite };
  art: EnemyArt;
  x: number;
  y: number;
  bornAt: number;
  flashUntil: number;
  /** The frame that last found this enemy alive; older records are released. */
  seenFrame: number;
}

interface Flight {
  sprite: Sprite;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  targetId: number;
  start: number;
  due: number;
  element: TdElement;
}
