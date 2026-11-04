import { ring } from "honeycomb-grid";
import { Container, Graphics } from "pixi.js";
import {
  HEX_ASPECT_RATIO,
  TD_HEX_SIZE,
  TD_RANGE_VISUAL_FACTOR,
} from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { getAudioPreference } from "@/libs/audioPreferences";
import { calculateWidth2Height } from "@/libs/rendering/hexGeometry";
import { createMapControls } from "@/libs/rendering/mapControls";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import { createGameRenderer } from "@/libs/rendering/runtime";
import { createTowerDefenseActors } from "@/libs/rendering/scenes/towerDefenseActors";
import { createTowerDefenseEffects } from "@/libs/rendering/scenes/towerDefenseEffects";
import { prepareTowerDefenseTerrain } from "@/libs/rendering/scenes/towerDefenseTerrain";
import { createRenderScope } from "@/libs/rendering/scope";
import { hexTerrainAt } from "@/libs/rendering/terrainData";
import { playPreloadedAudio, preloadAudioBuffers } from "@/utils/audio";
import type {
  EntityStore,
  HexPosition,
  HitEvent,
  RuntimeState,
} from "@/validators/towerDefense";

/**
 * Owns a canvas, awaiting initial terrain before reading authoritative entity refs.
 * Grid/range changes reconcile from snapshots; refresh wakes a paused scene.
 * Gameplay and rewards remain in the caller's hook, with onFrame running before each snapshot read.
 */
export const createTowerDefenseScene = async (options: {
  mount: HTMLElement;
  signal: AbortSignal;
  onError: (error: unknown) => void;
  seed: string;
  initialGridSize: number;
  initialPlayerPosition: HexPosition;
  /** Elapsed seconds, capped/reset by GameFrame; the caller decides how simulation advances. */
  onFrame: (delta: number) => void;
  getSnapshot: () => {
    active: boolean;
    entities: EntityStore;
    runtime: RuntimeState;
    hits: HitEvent[];
    impactAsset?: GameAsset;
    sfxUrl?: string;
    sfxEnabled?: boolean;
  };
  onTileClick: (position: HexPosition) => void;
}) => {
  let requestedSize = options.initialGridSize,
    currentSize = options.initialGridSize;
  const game = await createGameRenderer({
    ...options,
    background: 0x1a1a2e,
    height: (width) => width * calculateWidth2Height(currentSize, currentSize + 2),
  });
  game.setAnimating(false);
  try {
    const world = new Container(),
      terrainLayer = new Container(),
      range = new Graphics(),
      sceneryLayer = new Container();
    const actors = createTowerDefenseActors(game),
      effects = await createTowerDefenseEffects(game);
    world.addChild(
      terrainLayer,
      range,
      sceneryLayer,
      actors.container,
      effects.container,
    );
    game.stage.addChild(world);
    let data = prepareTowerDefenseTerrain(
      options.seed,
      currentSize,
      options.initialPlayerPosition,
    );
    let scope = createRenderScope(game),
      art: Awaited<ReturnType<typeof createWorldSprites>> | null = null;
    let pendingScope: ReturnType<typeof createRenderScope> | null = null;
    let scale = 1,
      centerX = 0,
      centerY = 0,
      rangeKey = "",
      occupancy = "",
      audioUrl = "";
    const transform = () => {
      const bounds = data.bounds;
      scale = Math.min(
        game.renderer.width / (bounds.right - bounds.left),
        game.renderer.height / (bounds.top - bounds.bottom),
      );
      centerX = (bounds.left + bounds.right) / 2;
      centerY = (bounds.bottom + bounds.top) / 2;
      world.scale.set(scale, -scale);
      world.position.set(
        game.renderer.width / 2 - centerX * scale,
        game.renderer.height / 2 + centerY * scale,
      );
    };
    game.setResize(transform);
    const build = async (size: number, player: HexPosition) => {
      pendingScope?.dispose();
      const nextScope = createRenderScope(game);
      pendingScope = nextScope;
      const next = prepareTowerDefenseTerrain(options.seed, size, player);
      try {
        const [terrain, scenery] = await Promise.all([
          createHexTerrain(nextScope, next.terrain),
          createWorldSprites(nextScope, next.scenery),
        ]);
        if (nextScope.isDisposed()) return;
        scope.dispose();
        scope = nextScope;
        pendingScope = null;
        data = next;
        art = scenery;
        currentSize = size;
        terrainLayer.addChild(terrain.container);
        sceneryLayer.addChild(scenery.container);
        const width = game.renderer.width,
          height = width * calculateWidth2Height(size, size + 2);
        game.renderer.resize(width, height);
        occupancy = "";
        rangeKey = "";
        transform();
        game.invalidate();
      } catch (error) {
        const cancelled = nextScope.isDisposed();
        nextScope.dispose();
        if (
          !cancelled &&
          !game.isDisposed() &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          throw error;
      }
    };
    await build(currentSize, options.initialPlayerPosition);
    if (game.isDisposed())
      throw new DOMException("Tower defense cancelled", "AbortError");
    createMapControls(game, {
      enabled: () => true,
      tap: (x, y) => {
        const tile = hexTerrainAt(
          data.grid,
          data.terrain.faceOffsets,
          centerX + (x - game.renderer.width / 2) / scale,
          centerY + (game.renderer.height / 2 - y) / scale,
        );
        if (tile) options.onTileClick({ col: tile.col, row: tile.row });
      },
    });
    const requestGrid = (size: number) => {
      if (requestedSize === size || game.isDisposed()) return;
      requestedSize = size;
      void build(
        size,
        options.getSnapshot().runtime.state?.playerPosition ??
          options.initialPlayerPosition,
      ).catch((error: unknown) => {
        game.dispose();
        options.onError(error);
      });
    };
    let seenHits = new Set<string>();
    game.setUpdate((frame) => {
      const spriteFrame = game.visualEffects.spriteAnimations
        ? frame
        : { ...frame, reducedMotion: true };
      // Decorative motion can stop without pausing simulation time or independent scenery wind.
      options.onFrame(frame.delta);
      const snapshot = options.getSnapshot(),
        { enemiesArray: enemies, projectilesArray: projectiles } = snapshot.entities;
      const player =
        snapshot.runtime.state?.playerPosition ?? options.initialPlayerPosition;
      const size = snapshot.runtime.state?.gridSize ?? requestedSize;
      if (size !== requestedSize) requestGrid(size);
      const ability = snapshot.runtime.abilities[0],
        currentRange = ability?.range ?? 1;
      const playerTile = data.grid.getHex(player),
        nextRangeKey = `${currentRange}:${player.col},${player.row}`;
      if (nextRangeKey !== rangeKey && playerTile) {
        rangeKey = nextRangeKey;
        const radius = (currentRange + 0.5) * TD_HEX_SIZE * TD_RANGE_VISUAL_FACTOR;
        range
          .clear()
          .ellipse(playerTile.x, playerTile.y, radius, radius * HEX_ASPECT_RATIO)
          .fill({ color: 0x9ca3af, alpha: 0.35 })
          .stroke({ color: 0x4b5563, alpha: 0.8, width: 1 / scale });
      }
      const nextOccupancy = enemies
        .filter((enemy) => enemy.health > 0)
        .map((enemy) => `${enemy.position.col},${enemy.position.row}`)
        .join("|");
      if (art && nextOccupancy !== occupancy) {
        occupancy = nextOccupancy;
        const affected = new Set<string>();
        for (const enemy of enemies)
          if (enemy.health > 0) {
            const tile = data.grid.getHex(enemy.position);
            if (!tile) continue;
            affected.add(`${tile.col},${tile.row}`);
            for (const neighbor of data.grid.traverse(
              ring({ radius: 1, center: tile }),
            ))
              affected.add(`${neighbor.col},${neighbor.row}`);
          }
        for (const entry of art.entries)
          if (!entry.description.small)
            entry.sprite.alpha = affected.has(
              entry.description.id.replace("scenery:", ""),
            )
              ? 0.5
              : 1;
      }
      if (snapshot.sfxUrl && audioUrl !== snapshot.sfxUrl) {
        audioUrl = snapshot.sfxUrl;
        void preloadAudioBuffers([audioUrl]);
      }
      const playImpact = () => {
        if (snapshot.sfxUrl && getAudioPreference("sfxOn", snapshot.sfxEnabled))
          void playPreloadedAudio(snapshot.sfxUrl, 0.8);
      };
      effects.update(
        projectiles,
        enemies,
        data.grid,
        ability,
        spriteFrame,
        snapshot.impactAsset,
        (projectile) => actors.throwAt(projectile.origin, projectile.target, frame.now),
        playImpact,
      );
      const currentHits = new Set<string>();
      for (const hit of snapshot.hits) {
        currentHits.add(hit.id);
        if (!seenHits.has(hit.id) && playerTile) {
          effects.impact(playerTile.x, playerTile.y, snapshot.impactAsset, frame.now);
          playImpact();
          actors.hitPlayer(enemies, player, frame.now);
        }
      }
      seenHits = currentHits;
      actors.animate(enemies, player, data.grid, spriteFrame);
      art?.animate(frame, scale);
      game.setAnimating(snapshot.active);
    });
    game.setAnimating(true);
    return {
      dispose: game.dispose,
      refresh: game.invalidate,
    };
  } catch (error) {
    game.dispose();
    throw error;
  }
};
