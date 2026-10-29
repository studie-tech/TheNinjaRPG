import alea from "alea";
import { ring } from "honeycomb-grid";
import { Container, Graphics, Text } from "pixi.js";
import { ID_SFX_MOVE } from "@/drizzle/constants";
import type { GameAsset, UserData } from "@/drizzle/schema";
import { actionPointsAfterAction, calcActiveUser } from "@/libs/combat/actions";
import type { AggroDisplay } from "@/libs/combat/aggroDisplay";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { getBattlefieldHeightRatio } from "@/libs/combat/util";
import type { TerrainHex } from "@/libs/hexgrid";
import { getBackgroundColor } from "@/libs/rendering/biomes";
import { combatHighlightPlan } from "@/libs/rendering/combatHighlights";
import {
  type CombatHoverCursor,
  getHighlightTilesCacheKey,
  nextCombatHoverCursor,
} from "@/libs/rendering/combatHover";
import { createMapControls } from "@/libs/rendering/mapControls";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createGameRenderer, type GameFrame } from "@/libs/rendering/runtime";
import { createCombatActors } from "@/libs/rendering/scenes/combatActors";
import { createCombatEffects } from "@/libs/rendering/scenes/combatEffects";
import { prepareCombatTerrain } from "@/libs/rendering/scenes/combatTerrain";
import { createRenderScope } from "@/libs/rendering/scope";
import { hexTerrainAt } from "@/libs/rendering/terrainData";

/**
 * Owns a battle canvas and awaits its initial terrain, actors and known effects.
 * Reads live snapshots; refresh invalidates a paused scene after external changes.
 * Construction inputs (battle geometry, seed, viewport) require a new scene.
 */
export const createCombatScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  onError: (error: unknown) => void;
  getSnapshot: () => CombatSceneSnapshot;
  onTap: (tile: TerrainHex) => void;
  onHover: (hover: CombatHover | null) => void;
  onZoom: (zoom: number) => void;
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
    ratio = getBattlefieldHeightRatio(initial.battle.width, initial.battle.height);
  const game = await createGameRenderer({
    ...options,
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
    const preloads = createRenderScope(game);
    const textureIds = new Set(initial.battle.extraState.textureAssets ?? []);
    void Promise.allSettled(
      initial.assets
        .filter((asset) => textureIds.has(asset.id) && asset.image)
        .map((asset) => preloads.assets.texture(asset.image)),
    ).then(() => preloads.dispose());
    const width = options.viewport?.width ?? game.renderer.width;
    const data = prepareCombatTerrain(
      width,
      initial.battle,
      alea(options.seed ?? initial.battle.id),
      options.lightLayout,
    );
    const [terrain, art] = await Promise.all([
      createHexTerrain(game, data.terrain, false),
      createWorldSprites(game, data.scenery),
    ]);
    if (game.isDisposed()) throw new DOMException("Combat cancelled", "AbortError");
    const world = new Container(),
      outlines = new Graphics(),
      labels = new Container();
    const actors = createCombatActors(game, data.grid, () => {
      const snapshot = options.getSnapshot();
      const move = snapshot.assets.find((asset) => asset.id === ID_SFX_MOVE);
      if (snapshot.active && snapshot.sound && move?.url)
        options.play(move.url, snapshot.volume * 0.75);
    });
    const effects = createCombatEffects(game, data.grid, options.play);
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
    world.addChild(
      terrain.container,
      effects.ground,
      outlines,
      labels,
      art.container,
      actors.container,
      effects.container,
    );
    game.stage.addChild(world);
    let zoom = Math.max(1, Math.min(3, options.initialZoom));
    let camera = options.focus ?? { x: width / 2, y: (width * ratio) / 2 };
    let clock = 0,
      dirty = true,
      initialized = false,
      rendered = false;
    let effectsReady: Promise<unknown> = Promise.resolve();
    let previous: CombatSceneSnapshot | null = null,
      highlightKey = "",
      hoverKey = "";
    let desiredCursor: CombatHoverCursor = "default";
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    const scale = () => (game.renderer.width / width) * zoom;
    const transform = () => {
      const s = scale();
      world.scale.set(s, -s);
      world.position.set(
        game.renderer.width / 2 - camera.x * s,
        game.renderer.height / 2 + camera.y * s,
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
        if (tile) options.onTap(tile);
      },
      zoom: (factor) => {
        zoom = Math.max(1, Math.min(3, zoom * factor));
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
    const sync = (snapshot: CombatSceneSnapshot, isInitial: boolean) => {
      actors.sync({
        battle: snapshot.battle,
        viewer: snapshot.viewer,
        aggro: snapshot.aggro,
      });
      const affected = new Set<string>();
      for (const user of snapshot.battle.usersState)
        if (user.curHealth > 0 && !user.fledBattle) {
          const tile = data.grid.getHex({ col: user.longitude, row: user.latitude });
          if (tile) {
            affected.add(`${tile.col},${tile.row}`);
            for (const neighbor of data.grid.traverse(
              ring({ radius: 1, center: tile }),
            ))
              affected.add(`${neighbor.col},${neighbor.row}`);
          }
        }
      for (const entry of art.entries)
        if (!entry.description.small)
          entry.sprite.alpha = affected.has(
            entry.description.id.replace("scenery:", ""),
          )
            ? 0.5
            : 1;
      const known = [
        ...(snapshot.battle.extraState.textureAssets ?? []),
        ...(snapshot.battle.extraState.sfxAssets ?? []),
      ].every((id) => snapshot.requestedIds.has(id));
      if (known)
        effectsReady = effects.sync(
          { ...snapshot, sound: snapshot.active && snapshot.sound },
          isInitial && !options.showInitialAppearance,
        );
      dirty = false;
      previous = snapshot;
      highlightKey = "";
    };
    sync(initial, true);
    await Promise.all([actors.ready(), effectsReady]);
    initialized = true;
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
      game.canvas.style.cursor = nextCombatHoverCursor(
        desiredCursor,
        document.body.style.cursor,
      );
      if (key === highlightKey) return;
      highlightKey = key;
      outlines.clear();
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
      for (const { tile, color } of plan.edges) {
        const offset = data.terrain.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
        outlines
          .poly(tile.corners.flatMap((corner) => [corner.x, corner.y + offset]))
          .stroke({ color, width: 1 / scale() });
      }
      terrain.setTints(plan.tints);
      desiredCursor = plan.valid ? "pointer" : "default";
      game.canvas.style.cursor = nextCombatHoverCursor(
        desiredCursor,
        document.body.style.cursor,
      );
    };
    const updateFrame = (frame: GameFrame, capture = false) => {
      if (!initialized) return;
      const snapshot = options.getSnapshot();
      clock =
        !capture && options.advance
          ? options.advance(frame.delta * 1000)
          : clock + frame.delta * 1000;
      if (options.advance || capture) {
        game.animation.uniforms.uTime = frame.reducedMotion ? 0 : clock / 1000;
        game.animation.update();
      }
      if (
        dirty ||
        !previous ||
        snapshot.battle !== previous.battle ||
        snapshot.battle.version !== previous.battle.version ||
        snapshot.revision !== previous.revision ||
        snapshot.assets !== previous.assets ||
        snapshot.aggro !== previous.aggro ||
        snapshot.viewer !== previous.viewer ||
        snapshot.active !== previous.active ||
        snapshot.sound !== previous.sound ||
        snapshot.volume !== previous.volume
      )
        sync(snapshot, !rendered);
      labels.visible = snapshot.showGridNumbers;
      const pointer = controls.pointer();
      const tile = pointer ? tileAt(pointer.x, pointer.y) : null;
      const actor = pointer ? actors.hit(pointer.x, pointer.y) : null;
      const effect = pointer ? effects.hit(pointer.x, pointer.y) : null;
      const hoverUser =
        actor?.userId ??
        snapshot.battle.usersState.find(
          (user) =>
            user.longitude === tile?.col &&
            user.latitude === tile.row &&
            user.curHealth > 0 &&
            !user.fledBattle,
        )?.userId;
      if (options.staticActors) actors.snap();
      const moving = actors.animate(frame, snapshot.userId, hoverUser);
      effects.animate(clock, frame.reducedMotion, moving, effect?.id ?? null);
      if (zoom > 1.5 && !options.focus) {
        const user = snapshot.battle.usersState.find(
          (user) => user.userId === snapshot.userId,
        );
        const tile =
          user && data.grid.getHex({ col: user.longitude, row: user.latitude });
        if (tile) {
          const target = {
            x: -tile.center.x + tile.width / 2,
            y: -tile.center.y + tile.height / 2,
          };
          const amount = frame.reducedMotion ? 1 : 1 - 0.9 ** (frame.delta * 60);
          camera = {
            x: camera.x + (target.x - camera.x) * amount,
            y: camera.y + (target.y - camera.y) * amount,
          };
        }
      }
      transform();
      art.animate(frame, scale());
      drawHighlights(snapshot, tile);
      const hoverTile = actor?.tile ?? tile;
      const hasGround =
        hoverTile &&
        snapshot.battle.groundEffects.some(
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
      rendered = true;
      game.setAnimating(snapshot.active);
    };
    game.setUpdate(updateFrame);
    game.setAnimating(initial.active);
    game.invalidate();
    return {
      dispose: game.dispose,
      grid: data.grid,
      canvas: game.canvas,
      /** Samples scene milliseconds after pending actor/effect art settles; does not advance gameplay. */
      renderAt: async (timeMs: number) => {
        if (game.isDisposed()) return;
        clock = Math.max(0, timeMs);
        sync(options.getSnapshot(), !rendered);
        await Promise.all([actors.ready(), effectsReady]);
        if (game.isDisposed()) return;
        updateFrame({ now: clock, delta: 0, reducedMotion: false }, true);
        game.renderer.render({ container: game.stage });
      },
      refresh: () => {
        dirty = true;
        game.invalidate();
      },
    };
  } catch (error) {
    game.dispose();
    throw error;
  }
};
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
