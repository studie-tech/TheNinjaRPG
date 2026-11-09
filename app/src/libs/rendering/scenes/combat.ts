import alea from "alea";
import {
  Container,
  Graphics,
  getMaxFragmentPrecision,
  RenderLayer,
  Text,
} from "pixi.js";
import { ID_SFX_MOVE, WORLD_DAY_BRIGHTNESS } from "@/drizzle/constants";
import type { GameAsset, UserData } from "@/drizzle/schema";
import { actionPointsAfterAction, calcActiveUser } from "@/libs/combat/actions";
import type { AggroDisplay } from "@/libs/combat/aggroDisplay";
import { type CombatHit, combatHits } from "@/libs/combat/playback";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { getWorldCycleBrightness } from "@/libs/dayNight";
import { hexGridHeightRatio, type TerrainHex } from "@/libs/hexgrid";
import type { LpcCatalog } from "@/libs/lpc/catalog";
import { getBackgroundColor } from "@/libs/rendering/biomes";
import {
  combatHighlightEdges,
  combatHighlightPlan,
} from "@/libs/rendering/combatHighlights";
import {
  type CombatHoverCursor,
  getHighlightTilesCacheKey,
  nextCombatHoverCursor,
} from "@/libs/rendering/combatHover";
import { createMapControls } from "@/libs/rendering/mapControls";
import {
  createWorldSprites,
  fadeSceneryNearPositions,
} from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createGameRenderer, type GameFrame } from "@/libs/rendering/runtime";
import { createCombatActors } from "@/libs/rendering/scenes/combatActors";
import {
  COMBAT_GROUND_EFFECT_Z_INDEX,
  createCombatEffects,
} from "@/libs/rendering/scenes/combatEffects";
import { createCombatFeedback } from "@/libs/rendering/scenes/combatFeedback";
import { createCombatPlayback } from "@/libs/rendering/scenes/combatPlayback";
import { prepareCombatTerrain } from "@/libs/rendering/scenes/combatTerrain";
import {
  createCombatTransformation,
  findTransformation,
} from "@/libs/rendering/scenes/combatTransformation";
import { createRenderScope } from "@/libs/rendering/scope";
import { hexTerrainAt } from "@/libs/rendering/terrainData";
import { createWorldShadows } from "@/libs/rendering/worldShadows";
import { worldSunlight } from "@/libs/rendering/worldSunlight";
import {
  createWorldWeather,
  getWorldWeather,
  type WorldWeather,
} from "@/libs/rendering/worldWeather";
import { sampleShadowWind, sampleWorldWind } from "@/libs/rendering/worldWind";
import { clamp } from "@/utils/math";

const NO_HITS: CombatHit[] = [];

/** Without a frame for this long the page is not rendering, so nothing is replaying. */
const PRESENTATION_STALL_MS = 500;

/**
 * Owns a battle canvas and awaits its initial actors and first effect synchronization,
 * which follows the battle's asset names. The field draws
 * from its first frame, with tinted terrain and fighter markers filling in as artwork arrives.
 * Reads live snapshots; refresh invalidates a paused scene after external changes.
 * Construction inputs (battle geometry, seed, viewport) require a new scene.
 */
export const createCombatScene = async (options: {
  lpcCatalog?: LpcCatalog;
  mount: HTMLElement;
  signal: AbortSignal;
  onError: (error: unknown) => void;
  getSnapshot: () => CombatSceneSnapshot;
  onTap: (tile: TerrainHex, character?: CombatHover) => void;
  onHover: (hover: CombatHover | null) => void;
  onZoom: (zoom: number) => void;
  /** The field reached another step of a replay, or caught up with the live battle. */
  onPresent?: (presented: CombatPresented) => void;
  play: (url: string, volume: number) => void;
  initialZoom: number;
  interactive?: boolean;
  lightLayout: boolean;
  seed?: string;
  viewport?: { width: number; magnify?: number };
  focus?: { x: number; y: number };
  showInitialAppearance?: boolean;
  staticActors?: boolean;
  /** Preview clock: consumes delta milliseconds and returns absolute scene milliseconds. */
  advance?: (deltaMs: number) => number;
}) => {
  const initial = options.getSnapshot(),
    ratio = hexGridHeightRatio(initial.battle.width, initial.battle.height);
  const game = await createGameRenderer({
    ...options,
    surface: options.interactive === false ? "battlefield-preview" : "combat",
    touchAction: options.interactive === false ? "auto" : "none",
    width: options.viewport
      ? options.viewport.width * (options.viewport.magnify ?? 1)
      : undefined,
    height: (width) => width * ratio,
    background: getBackgroundColor(initial.battle.background).color,
    backgroundAlpha: 0.5,
  });
  game.setAnimating(false);
  try {
    const width = options.viewport?.width ?? game.renderer.width;
    const data = prepareCombatTerrain(
      width,
      initial.battle,
      alea(options.seed ?? initial.battle.id),
      options.lightLayout,
    );
    const world = new Container();
    // Packed geometry decoding needs highp; mediump devices use the primitives' ambient lighting.
    const shadows =
      getMaxFragmentPrecision() === "highp"
        ? createWorldShadows(game, world)
        : undefined;
    const lightingLayer = shadows?.container ?? new Container();
    const weather = createWorldWeather(game, options.lightLayout);
    const terrainLayer = new RenderLayer(),
      groundLayer = new RenderLayer(),
      depthLayer = new RenderLayer({ sortableChildren: true }),
      uiLayer = new RenderLayer();
    const [terrain, emptyArt] = await Promise.all([
      createHexTerrain(game, data.terrain, false, { deferTextures: true }),
      createWorldSprites(game, [], shadows),
    ]);
    let art = emptyArt;
    if (game.isDisposed()) throw new DOMException("Combat cancelled", "AbortError");
    if (shadows) game.own(shadows.registerTerrain(terrain.container, data.terrain));
    const labels = new Container();
    const outlineLayers = new Map(
      // Highlight strokes sit on recessed water faces (-0.5) or on level arena ground (0).
      [-0.5, 0].map((layer) => {
        const graphics = new Graphics({
          label: "combat-grid-outlines",
          zIndex: layer < 0 ? 3.5 : 5.5,
        });
        // Higher opaque faces cover recessed strokes, just as they cover water and dirt.
        terrain.container.addChild(graphics);
        return [layer, graphics] as const;
      }),
    );
    terrain.container.sortableChildren = true;
    // Tile markings share the ground plane, beneath physical fighters and scenery.
    const fighterBackdrop = new Container();
    lightingLayer.addChild(
      terrainLayer,
      groundLayer,
      labels,
      fighterBackdrop,
      depthLayer,
    );
    const actors = createCombatActors(
      game,
      data.grid,
      () => {
        const snapshot = options.getSnapshot();
        const move = snapshot.assets.find((asset) => asset.id === ID_SFX_MOVE);
        if (snapshot.active && snapshot.sound && move?.url)
          options.play(move.url, snapshot.volume * 0.75);
      },
      shadows,
      { ground: groundLayer, world: depthLayer, ui: uiLayer },
    );
    const effects = createCombatEffects(game, data.grid, options.play);
    const firstTile = data.grid.toArray()[0];
    const feedback = createCombatFeedback(firstTile?.height ?? width / 20);
    game.own(feedback.dispose);
    const transformation = createCombatTransformation(
      firstTile ?? { width: width / 20, height: width / 20 },
      actors,
      (id, gain) => {
        const snapshot = options.getSnapshot();
        const sound = snapshot.assets.find((asset) => asset.id === id);
        if (snapshot.active && snapshot.sound && sound?.url)
          options.play(sound.url, snapshot.volume * gain);
      },
    );
    game.own(transformation.dispose);
    // Static ground artwork lies on the hex surface: above flat faces, below grid outlines,
    // and (via the lit ground layer) beneath fighters and upright scenery.
    effects.ground.zIndex = COMBAT_GROUND_EFFECT_Z_INDEX;
    terrain.container.addChild(effects.ground);
    for (const tile of data.grid) {
      if (!tile.name) continue;
      const text = new Text({
        text: tile.name,
        style: { fontFamily: "Arial Narrow, Arial", fontSize: 18, fill: "white" },
      });
      text.anchor.set(0.5);
      text.alpha = 0.3;
      const factor = (Math.max(tile.height, tile.width) * 0.2) / 18;
      text.scale.set(factor, -factor);
      text.position.set(tile.x, tile.y - 28 / 3);
      labels.addChild(text);
    }
    // Physical fighters and scenery share painter ordering; meters and controls remain unlit.
    // Ambient terrain draws from its earlier owner so fallback contacts remain above its opaque faces.
    // Terrain's face z-indices are local to its stack; ground props sort only against other ground art.
    if (shadows) terrainLayer.attach(...terrain.container.children);
    terrainLayer.sortRenderLayerChildren();
    art.attachLayers({ ground: groundLayer, world: depthLayer, ui: uiLayer });
    world.addChild(
      terrain.container,
      art.container,
      lightingLayer,
      weather.container,
      uiLayer,
      actors.container,
      effects.container,
      feedback.container,
      transformation.container,
    );
    fighterBackdrop.addChild(transformation.behind);
    game.stage.addChild(world);
    let zoom = Math.max(1, Math.min(3, options.initialZoom));
    let camera = options.focus ?? { x: width / 2, y: (width * ratio) / 2 };
    let hasManualCamera = false,
      followedPosition = "";
    let clock = 0,
      dirty = true,
      fightersSettled = false,
      effectsKnown = false,
      effectsShown = false,
      effectArtPreloaded = false;
    let effectsReady: Promise<unknown> = Promise.resolve();
    /** Settles with the first effect synchronization, which needs the battle's asset names. */
    let settleFirstEffects: (ready: Promise<unknown>) => void = () => {};
    const firstEffectsReady = new Promise<unknown>((resolve) => {
      settleFirstEffects = resolve;
    });
    // A scene closed before its asset names arrive still settles.
    game.own(() => settleFirstEffects(Promise.resolve()));
    let wasMoving = false;
    let previous: CombatSceneSnapshot | null = null,
      highlightKey = "",
      hoverKey = "";
    let desiredCursor: CombatHoverCursor = "default";
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const scale = () => (game.renderer.width / width) * zoom;
    const transform = () => {
      const s = scale();
      // Keep the viewport on the battlefield when dragging, zooming or resizing.
      if (!options.focus) {
        const halfWidth = game.renderer.width / (2 * s),
          halfHeight = game.renderer.height / (2 * s);
        camera.x = clamp(camera.x, halfWidth, width - halfWidth);
        camera.y = clamp(camera.y, halfHeight, width * ratio - halfHeight);
      }
      world.scale.set(s, -s);
      world.position.set(
        game.renderer.width / 2 -
          (camera.x + feedback.shake.x + transformation.shake.x) * s,
        game.renderer.height / 2 +
          (camera.y + feedback.shake.y + transformation.shake.y) * s,
      );
    };
    const tileAt = (x: number, y: number) =>
      hexTerrainAt(
        data.grid,
        data.terrain.faceOffsets,
        camera.x + (x - game.renderer.width / 2) / scale(),
        camera.y + (game.renderer.height / 2 - y) / scale(),
      );
    const controls = createMapControls(game, {
      enabled: () => options.interactive !== false,
      tap: (x, y) => {
        const tile = tileAt(x, y);
        if (!tile) return;
        const actor = actors.hit(x, y);
        const bounds = game.canvas.getBoundingClientRect();
        options.onTap(
          tile,
          actor
            ? {
                tileKey: `${actor.tile.col},${actor.tile.row}`,
                userId: actor.userId,
                position: {
                  x: bounds.left + (x * bounds.width) / game.renderer.width,
                  y: bounds.top + (y * bounds.height) / game.renderer.height,
                },
              }
            : undefined,
        );
      },
      pan: (dx, dy) => {
        if (zoom <= 1 || options.focus) return;
        hasManualCamera = true;
        camera = { x: camera.x - dx / scale(), y: camera.y + dy / scale() };
        transform();
      },
      zoom: (factor) => {
        zoom = Math.max(1, Math.min(3, zoom * factor));
        if (zoom === 1) hasManualCamera = false;
        transform();
        highlightKey = "";
        if (zoomTimer !== null) clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => options.onZoom(zoom), 300);
      },
    });
    game.setResize(() => {
      transform();
      highlightKey = "";
    });
    const playback = createCombatPlayback(initial.battle);
    let lastFrameAt = 0;
    let lastPresented: CombatPresented = { battle: initial.battle };
    /** Future effect art downloads behind the fighters and effects already on the field. */
    const preloadEffectArt = () => {
      const snapshot = previous;
      if (effectArtPreloaded || !fightersSettled || !effectsKnown || !snapshot) return;
      effectArtPreloaded = true;
      const preloads = createRenderScope(game);
      const textureIds = new Set(snapshot.battle.extraState.textureAssets ?? []);
      void Promise.allSettled(
        snapshot.assets
          .filter((asset) => textureIds.has(asset.id) && asset.image)
          .map((asset) => preloads.assets.texture(asset.image)),
      ).then(() => preloads.dispose());
    };
    const sync = (snapshot: CombatSceneSnapshot) => {
      actors.sync({
        battle: snapshot.battle,
        viewer: snapshot.viewer,
        aggro: snapshot.aggro,
      });
      fadeSceneryNearPositions(
        art.entries,
        data.grid,
        snapshot.battle.usersState
          .filter((user) => user.curHealth > 0 && !user.fledBattle)
          .map((user) => ({ col: user.longitude, row: user.latitude })),
      );
      const known = [
        ...(snapshot.battle.extraState.textureAssets ?? []),
        ...(snapshot.battle.extraState.sfxAssets ?? []),
      ].every((id) => snapshot.requestedIds.has(id));
      // Effects present before their first painted frame appear without replaying their arrival,
      // including those whose asset list reaches the scene after it has started drawing.
      if (known) {
        effectsReady = effects.sync(
          { ...snapshot, sound: snapshot.active && snapshot.sound },
          !effectsShown && !options.showInitialAppearance,
        );
        if (!effectsKnown) settleFirstEffects(effectsReady);
        effectsKnown = true;
      }
      dirty = false;
      previous = snapshot;
      highlightKey = "";
      preloadEffectArt();
    };
    sync(initial);
    const fightersReady = Promise.all([actors.ready(), firstEffectsReady]);
    void fightersReady.then(
      () => {
        fightersSettled = true;
        preloadEffectArt();
      },
      () => undefined,
    );
    // Optional border scenery downloads after the fighters and active effects it would delay.
    const sceneryReady = fightersReady
      .then(() => createWorldSprites(game, data.scenery, shadows))
      .then((next) => {
        if (game.isDisposed()) return;
        const position = world.getChildIndex(art.container);
        art.dispose();
        art = next;
        world.addChildAt(art.container, position);
        art.attachLayers({ ground: groundLayer, world: depthLayer, ui: uiLayer });
        // The frame owns initial-appearance suppression, including effects arriving before first paint.
        dirty = true;
        game.invalidate();
      })
      .catch((error: unknown) => {
        if (!game.isDisposed())
          console.warn("Combat scenery unavailable; fighters remain usable", error);
      });

    game.own(() => {
      if (zoomTimer !== null) clearTimeout(zoomTimer);
    });
    const drawHighlights = (
      snapshot: CombatSceneSnapshot,
      hovered: TerrainHex | null,
    ) => {
      const user = snapshot.battle.usersState.find(
        (user) => user.userId === snapshot.userId,
      );
      const action = snapshot.action;
      const active =
        user &&
        calcActiveUser(snapshot.battle, user.userId, snapshot.timeDiff, {
          precomputedUserId: user.userId,
          precomputedActions: snapshot.actions,
        }).actor;
      const canUse =
        !!user &&
        active?.userId === user.userId &&
        actionPointsAfterAction(user, snapshot.battle, action).canAct;
      const key =
        getHighlightTilesCacheKey({
          actionId: action?.id,
          battleVersion: snapshot.battle.version,
          userId: snapshot.userId,
          longitude: user?.longitude ?? 0,
          latitude: user?.latitude ?? 0,
          canUseTile: canUse,
          hoverTileName: hovered?.name ?? "",
        }) + JSON.stringify([snapshot.revision ?? 0, scale()]);
      if (key === highlightKey) return;
      highlightKey = key;
      for (const graphics of outlineLayers.values()) graphics.clear();
      const plan = combatHighlightPlan({
        grid: data.grid,
        battle: snapshot.battle,
        user,
        action,
        actions: snapshot.actions,
        hovered,
        canUse,
        timeDiff: snapshot.timeDiff,
        targetTiles: snapshot.targetTiles,
      });
      for (const { layer, color, points } of combatHighlightEdges(
        plan.edges,
        data.terrain.faceOffsets,
      )) {
        const graphics = outlineLayers.get(layer);
        if (!graphics) continue;
        for (let index = 0; index < points.length; index += 4)
          graphics
            .moveTo(points[index] ?? 0, points[index + 1] ?? 0)
            .lineTo(points[index + 2] ?? 0, points[index + 3] ?? 0);
        graphics.stroke({ color, width: 1 / scale() });
      }
      terrain.setTints(plan.tints);
      desiredCursor = plan.valid ? "pointer" : "default";
    };
    const updateFrame = (sourceFrame: GameFrame, capture = false) => {
      const frame = game.visualEffects.spriteAnimations
        ? sourceFrame
        : { ...sourceFrame, reducedMotion: true };
      const snapshot = options.getSnapshot();
      clock =
        !capture && options.advance
          ? options.advance(frame.delta * 1000)
          : clock + frame.delta * 1000;
      if (options.advance || capture) {
        game.animation.uniforms.uTime = frame.reducedMotion ? 0 : clock / 1000;
        game.animation.update();
      }
      lastFrameAt = performance.now();
      playback.receive(snapshot.battle);
      const instant =
        frame.reducedMotion ||
        !snapshot.active ||
        capture ||
        !!options.staticActors ||
        !!options.advance;
      // A transformation holds the field: replays queue behind it, input stays live.
      const presented =
        transformation.isPlaying() && !instant
          ? playback.presented()
          : playback.tick({
              now: clock,
              instant,
              moving: wasMoving,
              cue: actors.cue,
            });
      const logVersion = playback.logVersion();
      let hits: CombatHit[] = NO_HITS;
      const arrival = instant
        ? undefined
        : findTransformation(lastPresented.battle, presented);
      if (
        presented !== lastPresented.battle ||
        logVersion !== lastPresented.logVersion
      ) {
        // Previews and catch-up reads redraw a result without anything landing.
        if (snapshot.active && !capture && !options.staticActors && !options.advance)
          hits = combatHits(lastPresented.battle, presented);
        lastPresented = { battle: presented, logVersion };
        options.onPresent?.(lastPresented);
      }
      const view = { ...snapshot, battle: presented };
      if (
        dirty ||
        !previous ||
        view.battle !== previous.battle ||
        view.battle.version !== previous.battle.version ||
        snapshot.revision !== previous.revision ||
        snapshot.assets !== previous.assets ||
        snapshot.aggro !== previous.aggro ||
        snapshot.viewer !== previous.viewer ||
        snapshot.active !== previous.active ||
        snapshot.sound !== previous.sound ||
        snapshot.volume !== previous.volume
      )
        sync(view);
      if (arrival) transformation.start(arrival);
      for (const { userId, amount, severity } of hits) {
        const head = actors.headPosition(userId);
        if (!head) continue;
        const direction = actors.hitDirection(userId, playback.actorId());
        feedback.show({
          userId,
          amount,
          severity,
          x: head.x,
          y: head.y,
          dirX: direction.x,
        });
        if (amount < 0) actors.react(userId, direction, severity);
      }
      labels.visible = snapshot.showGridNumbers;
      const pointer = controls.dragging() ? null : controls.pointer();
      const tile = pointer ? tileAt(pointer.x, pointer.y) : null;
      const actor = pointer ? actors.hit(pointer.x, pointer.y) : null;
      const effect = pointer ? effects.hit(pointer.x, pointer.y) : null;
      const hoverUser =
        actor?.userId ??
        view.battle.usersState.find(
          (user) =>
            user.longitude === tile?.col &&
            user.latitude === tile.row &&
            user.curHealth > 0 &&
            !user.fledBattle,
        )?.userId;
      if (options.staticActors) actors.snap();
      const moving = actors.animate(frame, snapshot.userId, hoverUser, scale());
      wasMoving = moving;
      effects.animate(clock, frame.reducedMotion, moving, effect?.id ?? null);
      feedback.animate(clock, frame.reducedMotion, scale());
      transformation.animate(clock, scale(), {
        x: camera.x,
        y: camera.y,
        halfWidth: game.renderer.width / (2 * scale()),
        halfHeight: game.renderer.height / (2 * scale()),
      });
      const user = snapshot.battle.usersState.find(
        (user) => user.userId === snapshot.userId,
      );
      const position = `${snapshot.userId}:${user?.longitude}:${user?.latitude}`;
      if (position !== followedPosition) {
        followedPosition = position;
        if (!controls.dragging()) hasManualCamera = false;
      }
      if (zoom > 1.5 && !options.focus && !hasManualCamera) {
        const tile =
          user && data.grid.getHex({ col: user.longitude, row: user.latitude });
        const actor = actors.container.getChildByLabel(snapshot.userId);
        if (tile && actor) {
          // Follow the rendered position so a long move cannot leave its walk cycle offscreen.
          const target = {
            x: actor.x + tile.width / 2,
            y: actor.y + tile.height / 2,
          };
          const amount = frame.reducedMotion ? 1 : 1 - 0.9 ** (frame.delta * 60);
          camera = {
            x: camera.x + (target.x - camera.x) * amount,
            y: camera.y + (target.y - camera.y) * amount,
          };
        }
      }
      transform();
      const breeze = sampleWorldWind(sourceFrame, scale(), game.visualEffects.wind);
      art.animate(frame, scale(), null, breeze);
      const lightDate =
        snapshot.lightDate ??
        (snapshot.cycleEnabled ? new Date(Date.now() - snapshot.timeDiff) : null);
      weather.update(
        sourceFrame,
        snapshot.weather ??
          getWorldWeather(
            snapshot.battle.background,
            snapshot.weatherTime ?? Number.NaN,
          ),
        world.position,
        lightDate ? getWorldCycleBrightness(lightDate) : WORLD_DAY_BRIGHTNESS,
        scale(),
      );
      if (shadows)
        shadows.update(
          worldSunlight(lightDate, 60_000),
          {
            minX: camera.x - game.renderer.width / (2 * scale()),
            maxX: camera.x + game.renderer.width / (2 * scale()),
            minY: camera.y - game.renderer.height / (2 * scale()),
            maxY: camera.y + game.renderer.height / (2 * scale()),
          },
          sampleShadowWind(sourceFrame, scale(), game.visualEffects.wind),
        );
      else {
        const brightness =
          game.visualEffects.dayNight && lightDate
            ? getWorldCycleBrightness(lightDate)
            : WORLD_DAY_BRIGHTNESS;
        terrain.setLighting(brightness);
        art.setLighting(brightness);
        actors.setLighting(brightness);
      }
      drawHighlights(snapshot, tile);
      let cursor = nextCombatHoverCursor(desiredCursor, document.body.style.cursor);
      if (
        options.interactive !== false &&
        !options.focus &&
        zoom > 1 &&
        document.body.style.cursor !== "wait"
      ) {
        if (controls.dragging()) cursor = "grabbing";
        else if (desiredCursor === "default") cursor = "grab";
      }
      // Each write invalidates style and fires attribute observers; publish changes only.
      if (game.canvas.style.cursor !== cursor) game.canvas.style.cursor = cursor;
      const hoverTile = actor?.tile ?? tile;
      const hasGround =
        hoverTile &&
        view.battle.groundEffects.some(
          (effect) =>
            effect.longitude === hoverTile.col && effect.latitude === hoverTile.row,
        );
      const hover =
        pointer && hoverTile && snapshot.inspect && (actor || hoverUser || hasGround)
          ? {
              tileKey: `${hoverTile.col},${hoverTile.row}`,
              userId: actor?.userId ?? hoverUser,
              position: { x: pointer.clientX, y: pointer.clientY },
            }
          : null;
      const nextHover = hover
        ? `${hover.tileKey}:${hover.userId}:${hover.position.x},${hover.position.y}`
        : "";
      if (nextHover !== hoverKey) {
        hoverKey = nextHover;
        options.onHover(hover);
      }
      if (effectsKnown) effectsShown = true;
      game.setAnimating(snapshot.active);
    };
    game.setUpdate(updateFrame);
    game.setAnimating(initial.active);
    game.invalidate();
    // Autonomous turns wait for the scene, so it resolves once its fighters and active effects
    // can be seen; a turn landing earlier would lose its effects' arrival.
    await fightersReady;
    return {
      dispose: game.dispose,
      grid: data.grid,
      canvas: game.canvas,
      /** Samples scene milliseconds after pending actor/effect art settles; does not advance gameplay. */
      renderAt: async (timeMs: number) => {
        if (game.isDisposed()) return;
        clock = Math.max(0, timeMs);
        sync(options.getSnapshot());
        await Promise.all([actors.ready(), effectsReady, sceneryReady]);
        if (game.isDisposed()) return;
        updateFrame({ now: clock, delta: 0, reducedMotion: false }, true);
        game.renderer.render({ container: game.stage });
      },
      refresh: () => {
        dirty = true;
        game.invalidate();
      },
      /** Actions are still replaying; a stalled render loop must not hold up the battle. */
      isPresenting: () =>
        (playback.isPlaying() || transformation.isPlaying()) &&
        performance.now() - lastFrameAt < PRESENTATION_STALL_MS,
    };
  } catch (error) {
    game.dispose();
    throw error;
  }
};
/** The battle on the field and the newest log version it has reached while replaying. */
export type CombatPresented = { battle: ReturnedBattle; logVersion?: number };
export type CombatHover = {
  tileKey: string;
  userId?: string;
  /** Client pixels for positioning DOM tooltips. */
  position: { x: number; y: number };
};
export type CombatSceneSnapshot = {
  battle: ReturnedBattle;
  userId: string;
  viewer?: Pick<UserData, "userId" | "avatar" | "avatarLight" | "username">;
  action?: CombatAction;
  actions: CombatAction[];
  timeDiff: number;
  /** Public/static previews stay at noon unless the world cycle is explicitly enabled. */
  cycleEnabled?: boolean;
  /** Authorized local previews affect scenery without advancing battle time. */
  lightDate?: Date | null;
  weather?: WorldWeather | null;
  /** Live weather is independent of the day/night preference; static previews omit this clock. */
  weatherTime?: number;
  assets: GameAsset[];
  requestedIds: ReadonlySet<string>;
  aggro?: AggroDisplay;
  active: boolean;
  sound: boolean;
  volume: number;
  showGridNumbers: boolean;
  inspect: boolean;
  /** Change for in-place preview edits that preserve battle identity/version. */
  revision?: number;
  targetTiles?: TerrainHex[];
};
