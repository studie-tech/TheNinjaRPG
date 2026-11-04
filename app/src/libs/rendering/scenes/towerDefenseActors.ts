import { Container, Sprite, Texture } from "pixi.js";
import { HEX_ASPECT_RATIO, TD_HEX_SIZE } from "@/drizzle/constants";
import {
  characterAnimationClip,
  sampleAnimationClip,
} from "@/libs/rendering/animation";
import { createClipTextures } from "@/libs/rendering/primitives/animation";
import { createSoftShadowTexture } from "@/libs/rendering/primitives/shadow";
import { createStatusMeter } from "@/libs/rendering/primitives/statusMeter";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import {
  type prepareTowerDefenseTerrain,
  towerDefenseEnemyPosition,
} from "@/libs/rendering/scenes/towerDefenseTerrain";
import {
  getEnemyAssetConfig,
  getPlayerAssetConfig,
} from "@/libs/rendering/towerDefenseCharacters";
import {
  calculateEnemyDirection,
  directionToSpriteDirection,
} from "@/libs/towerDefense/game";
import type {
  CharacterAnimationState,
  CharacterAssetConfig,
  EnemyDirection,
  HexPosition,
  SpriteDirection,
  TowerDefenseEnemy,
} from "@/validators/towerDefense";

/** Directional texture views are shared across the population, while actors own playback clocks. */
export const createTowerDefenseActors = (game: GameRenderer) => {
  const container = new Container(),
    records = new Map<string, Actor>();
  const clips = new WeakMap<CharacterAssetConfig, Map<string, Promise<Frames>>>();
  const shadowTexture = createSoftShadowTexture();
  game.own(() => shadowTexture.destroy(true));
  let playerDirection: EnemyDirection = "s",
    throwUntil = 0;
  const punches = new Map<string, number>();
  const load = (
    config: CharacterAssetConfig,
    state: CharacterAnimationState,
    direction: SpriteDirection,
  ) => {
    let cache = clips.get(config);
    if (!cache) {
      cache = new Map();
      clips.set(config, cache);
    }
    const key = `${state}:${direction}`;
    let promise = cache.get(key);
    if (!promise) {
      promise = createClipTextures(
        game,
        characterAnimationClip(config, state, direction),
        { size: TD_HEX_SIZE, rendition: 128, nearest: true },
      );
      cache.set(key, promise);
    }
    return promise;
  };
  // Actors without a registered config keep their shadow and health bar; the
  // config check below rebuilds them with artwork once it is registered.
  const actor = (
    id: string,
    config: CharacterAssetConfig | undefined,
    scale: number,
  ) => {
    let record = records.get(id);
    if (record && record.config !== config) {
      record.root.destroy({ children: true, texture: false, textureSource: false });
      records.delete(id);
      record = undefined;
    }
    if (record) return record;
    const root = new Container(),
      sprite = new Sprite(Texture.EMPTY),
      shadow = new Sprite(shadowTexture);
    shadow.anchor.set(0.5);
    shadow.width = TD_HEX_SIZE * scale * 0.25;
    shadow.height = TD_HEX_SIZE * HEX_ASPECT_RATIO * scale * 0.1;
    shadow.scale.y *= -1;
    shadow.y = -TD_HEX_SIZE * HEX_ASPECT_RATIO * 0.4;
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = TD_HEX_SIZE * HEX_ASPECT_RATIO * scale;
    sprite.scale.y *= -1;
    sprite.y = TD_HEX_SIZE * HEX_ASPECT_RATIO * 0.2;
    const hp = createStatusMeter({
      width: TD_HEX_SIZE / 2,
      height: (TD_HEX_SIZE * HEX_ASPECT_RATIO) / 10,
      color: 0xb22222,
      x: -TD_HEX_SIZE / 4,
      y: TD_HEX_SIZE * 0.7 - (TD_HEX_SIZE * HEX_ASPECT_RATIO) / 2,
    });
    hp.container.visible = false;
    root.addChild(shadow, sprite, hp.container);
    container.addChild(root);
    record = {
      root,
      sprite,
      hp,
      config,
      key: "",
      state: "idle",
      direction: "south",
      startedAt: 0,
      frames: null,
      token: 0,
    };
    records.set(id, record);
    return record;
  };
  const animate = (
    record: Actor,
    state: CharacterAnimationState,
    direction: SpriteDirection,
    frame: GameFrame,
  ) => {
    const key = `${state}:${direction}`;
    const { config } = record;
    if (config && record.key !== key) {
      if (record.state !== state) record.startedAt = frame.now;
      record.state = state;
      record.direction = direction;
      record.key = key;
      const token = ++record.token;
      void load(config, state, direction)
        .then((frames) => {
          if (!game.isDisposed() && !record.root.destroyed && record.token === token) {
            record.frames = frames;
            // Network readiness starts one-shot art at its first frame.
            if (!frames.clip.loop) record.startedAt = performance.now();
            game.invalidate();
          }
        })
        .catch((error: unknown) => {
          if (!game.isDisposed())
            console.warn("Tower defense character artwork unavailable", error);
        });
    }
    if (record.frames) {
      const sample = sampleAnimationClip(
        record.frames.clip,
        frame.now - record.startedAt,
        frame.reducedMotion,
      );
      record.sprite.texture = record.frames.views[sample.index] ?? Texture.EMPTY;
    }
  };
  return {
    container,
    throwAt: (origin: HexPosition, target: HexPosition, now: number) => {
      playerDirection = calculateEnemyDirection(
        origin.col,
        origin.row,
        target.col,
        target.row,
      );
      throwUntil = now + 420;
    },
    hitPlayer: (
      enemies: readonly TowerDefenseEnemy[],
      player: HexPosition,
      now: number,
    ) => {
      for (const enemy of enemies)
        if (
          enemy.health > 0 &&
          Math.abs(enemy.position.col - player.col) <= 1 &&
          Math.abs(enemy.position.row - player.row) <= 1 &&
          (enemy.position.col !== player.col || enemy.position.row !== player.row) &&
          enemy.lastAttackTime !== undefined
        )
          punches.set(enemy.id, now + 300);
    },
    animate: (
      enemies: readonly TowerDefenseEnemy[],
      player: HexPosition,
      grid: ReturnType<typeof prepareTowerDefenseTerrain>["grid"],
      frame: GameFrame,
    ) => {
      const wanted = new Set(["player"]);
      const playerTile = grid.getHex(player);
      if (playerTile) {
        if (frame.now >= throwUntil) {
          let nearest: TowerDefenseEnemy | undefined,
            distance = Infinity;
          for (const enemy of enemies) {
            const d =
              (enemy.position.col - player.col) ** 2 +
              (enemy.position.row - player.row) ** 2;
            if (enemy.health > 0 && d < distance) {
              nearest = enemy;
              distance = d;
            }
          }
          if (nearest)
            playerDirection = calculateEnemyDirection(
              player.col,
              player.row,
              nearest.position.col,
              nearest.position.row,
            );
        }
        const { config, scaleFactor } = getPlayerAssetConfig();
        const record = actor("player", config, scaleFactor);
        record.root.position.set(playerTile.x, playerTile.y);
        animate(
          record,
          frame.now < throwUntil ? "throw" : "idle",
          directionToSpriteDirection(playerDirection),
          frame,
        );
      }
      for (const enemy of enemies) {
        if (enemy.health <= 0) continue;
        const position = towerDefenseEnemyPosition(enemy, grid);
        if (!position) continue;
        wanted.add(enemy.id);
        const { config, scaleFactor } = getEnemyAssetConfig(enemy.enemyType);
        const record = actor(enemy.id, config, scaleFactor);
        record.root.position.set(position.x, position.y);
        const punchUntil = punches.get(enemy.id) ?? 0;
        if (frame.now >= punchUntil) punches.delete(enemy.id);
        animate(
          record,
          frame.now < punchUntil
            ? "punch"
            : enemy.movementProgress > 0
              ? "moving"
              : "idle",
          directionToSpriteDirection(enemy.direction),
          frame,
        );
        record.hp.container.visible = enemy.health < enemy.maxHealth;
        record.hp.set(enemy.health / enemy.maxHealth);
      }
      for (const [id, record] of records)
        if (!wanted.has(id)) {
          record.root.destroy({ children: true, texture: false, textureSource: false });
          records.delete(id);
          punches.delete(id);
        }
      // Actors cross at interpolated Y positions; every shadow/bar belongs to its actor.
      container.children.sort((a, b) => b.y - a.y);
    },
  };
};

type Frames = Awaited<ReturnType<typeof createClipTextures>>;
type Actor = {
  root: Container;
  sprite: Sprite;
  hp: ReturnType<typeof createStatusMeter>;
  config: CharacterAssetConfig | undefined;
  key: string;
  state: CharacterAnimationState;
  direction: SpriteDirection;
  startedAt: number;
  frames: Frames | null;
  token: number;
};
