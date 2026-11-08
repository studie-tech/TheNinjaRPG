import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import {
  TD_DAMAGE_NUMBER_LIFETIME,
  TD_DAMAGE_NUMBER_POOL_SIZE,
  TD_DAMAGE_NUMBER_RISE_SPEED_FACTOR,
  TD_HEX_SIZE,
  TD_SHURIKEN_IMAGE_URL,
} from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { assetAnimationClip, sampleAnimationClip } from "@/libs/rendering/animation";
import { createClipTextures } from "@/libs/rendering/primitives/animation";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import {
  type prepareTowerDefenseTerrain,
  towerDefenseEnemyPosition,
  towerDefenseProjectileProgress,
} from "@/libs/rendering/scenes/towerDefenseTerrain";
import { calculateProjectileDamage } from "@/libs/towerDefense/game";
import type {
  TowerDefenseAbility,
  TowerDefenseEnemy,
  TowerDefenseProjectile,
} from "@/validators/towerDefense";

/** Scene-owned pools retain no per-hit textures, timers or independently scheduled frames. */
export const createTowerDefenseEffects = async (game: GameRenderer) => {
  const container = new Container(),
    projectiles = new Container(),
    impacts = new Container(),
    numbers = new Container();
  container.addChild(projectiles, impacts, numbers);
  const shuriken = await game.assets
    .texture(TD_SHURIKEN_IMAGE_URL, 50)
    .catch((error: unknown) => {
      if (
        game.signal.aborted ||
        game.isDisposed() ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw error;
      // A plain projectile preserves targeting and hit feedback when its art is missing.
      console.warn("Tower defense projectile artwork unavailable", error);
      return Texture.WHITE;
    });
  if (game.isDisposed()) throw new DOMException("Effects cancelled", "AbortError");
  const projectileRecords = new Map<
    string,
    { sprite: Sprite; projectile: TowerDefenseProjectile }
  >();
  const impactFrames = new Map<string, Promise<Frames>>();
  const impactPool: {
    sprite: Sprite;
    frames: Frames | null;
    startedAt: number;
    pending: boolean;
    token: number;
  }[] = [];
  const atlas = createDamageAtlas();
  game.own(atlas.dispose);
  const damagePool = Array.from({ length: TD_DAMAGE_NUMBER_POOL_SIZE }, () => {
    const root = new Container();
    root.visible = false;
    const glyphs = Array.from({ length: 12 }, () => {
      const glyph = new Sprite(atlas.views[0]);
      glyph.anchor.set(0.5);
      root.addChild(glyph);
      return glyph;
    });
    numbers.addChild(root);
    return { root, glyphs, age: TD_DAMAGE_NUMBER_LIFETIME };
  });
  const impact = (x: number, y: number, asset: GameAsset | undefined, now: number) => {
    if (!asset?.image || game.isDisposed()) return;
    let record = impactPool.find((entry) => !entry.pending && !entry.sprite.visible);
    if (!record && impactPool.length < 32) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5);
      sprite.width = sprite.height = TD_HEX_SIZE * 0.8;
      sprite.scale.y *= -1;
      sprite.visible = false;
      impacts.addChild(sprite);
      record = { sprite, frames: null, startedAt: now, pending: false, token: 0 };
      impactPool.push(record);
    }
    if (!record) return;
    record.sprite.position.set(x, y);
    record.pending = true;
    const token = ++record.token,
      current = record;
    const key = `${asset.image}:${asset.frames}:${asset.speed}`;
    let frames = impactFrames.get(key);
    if (!frames) {
      frames = createClipTextures(game, assetAnimationClip(asset), {
        size: TD_HEX_SIZE * 0.8,
      });
      impactFrames.set(key, frames);
    }
    void frames
      .then((loaded) => {
        if (game.isDisposed() || current.token !== token) return;
        current.frames = loaded;
        current.startedAt = performance.now();
        current.pending = false;
        current.sprite.visible = true;
        game.invalidate();
      })
      .catch((error: unknown) => {
        current.pending = false;
        if (!game.isDisposed())
          console.warn("Tower defense impact artwork unavailable", error);
      });
  };
  const damage = (x: number, y: number, value: number, critical: boolean) => {
    const record = damagePool.find((entry) => !entry.root.visible);
    if (!record) return;
    const text = `${Math.round(value)}${critical ? "!" : ""}`.slice(
      0,
      record.glyphs.length,
    );
    const scale = ((TD_HEX_SIZE * 0.3) / 64) * (critical ? 1 : 29 / 38);
    record.root.position.set(
      x + (Math.random() - 0.5) * TD_HEX_SIZE * 0.3,
      y + (Math.random() - 0.5) * TD_HEX_SIZE * 0.3,
    );
    record.root.scale.set(scale, -scale);
    record.root.alpha = 1;
    record.root.visible = true;
    record.age = 0;
    record.glyphs.forEach((glyph, index) => {
      glyph.visible = index < text.length;
      glyph.texture =
        atlas.views[atlas.characters.indexOf(text[index] ?? "0")] ?? Texture.EMPTY;
      glyph.tint = critical ? 0xff4444 : 0xffffff;
      glyph.position.set((index - (text.length - 1) / 2) * 26, 0);
    });
  };
  return {
    container,
    impact,
    update: (
      current: readonly TowerDefenseProjectile[],
      enemies: readonly TowerDefenseEnemy[],
      grid: ReturnType<typeof prepareTowerDefenseTerrain>["grid"],
      ability: TowerDefenseAbility | undefined,
      frame: GameFrame,
      asset: GameAsset | undefined,
      onSpawn: (projectile: TowerDefenseProjectile) => void,
      onImpact: () => void,
    ) => {
      const enemyPositions = new Map<string, { x: number; y: number }>();
      for (const enemy of enemies) {
        const position = towerDefenseEnemyPosition(enemy, grid);
        if (position)
          enemyPositions.set(`${enemy.position.col},${enemy.position.row}`, position);
      }
      const wanted = new Set<string>();
      const targetPosition = (projectile: TowerDefenseProjectile) =>
        enemyPositions.get(`${projectile.target.col},${projectile.target.row}`) ??
        grid.getHex(projectile.target);
      for (const projectile of current) {
        wanted.add(projectile.id);
        let record = projectileRecords.get(projectile.id);
        if (!record) {
          const sprite = new Sprite(shuriken);
          sprite.anchor.set(0.5);
          sprite.width = sprite.height = TD_HEX_SIZE * 0.2;
          sprite.scale.y *= -1;
          projectiles.addChild(sprite);
          record = { sprite, projectile };
          projectileRecords.set(projectile.id, record);
          onSpawn(projectile);
        }
        record.projectile = projectile;
        const origin = grid.getHex(projectile.origin),
          target = targetPosition(projectile);
        record.sprite.visible = !!origin && !!target;
        if (origin && target) {
          const progress = towerDefenseProjectileProgress(projectile, Date.now());
          record.sprite.position.set(
            origin.x + (target.x - origin.x) * progress,
            origin.y + (target.y - origin.y) * progress,
          );
          if (!frame.reducedMotion) record.sprite.rotation += frame.delta * 10;
        }
      }
      for (const [id, record] of projectileRecords)
        if (!wanted.has(id)) {
          const target = targetPosition(record.projectile);
          if (target) {
            impact(target.x, target.y, asset, frame.now);
            onImpact();
            const hit = calculateProjectileDamage(record.projectile, ability);
            damage(target.x, target.y, hit.value, hit.critical);
          }
          record.sprite.destroy({ texture: false, textureSource: false });
          projectileRecords.delete(id);
        }
      for (const record of impactPool)
        if (record.sprite.visible && record.frames) {
          const sample = sampleAnimationClip(
            record.frames.clip,
            frame.now - record.startedAt,
            frame.reducedMotion,
          );
          record.sprite.texture = record.frames.views[sample.index] ?? Texture.EMPTY;
          record.sprite.visible = !sample.finished;
        }
      for (const record of damagePool)
        if (record.root.visible) {
          record.age += frame.delta;
          record.root.visible = record.age < TD_DAMAGE_NUMBER_LIFETIME;
          if (!frame.reducedMotion)
            record.root.y +=
              TD_HEX_SIZE * TD_DAMAGE_NUMBER_RISE_SPEED_FACTOR * frame.delta;
          record.root.alpha = 1 - (record.age / TD_DAMAGE_NUMBER_LIFETIME) ** 2;
        }
    },
  };
};

const createDamageAtlas = () => {
  const characters = "0123456789!-",
    canvas = document.createElement("canvas");
  canvas.width = characters.length * 32;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Damage atlas requires a 2D canvas");
  context.font = "bold 38px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  [...characters].forEach((character, index) => {
    context.fillStyle = "rgba(0,0,0,0.5)";
    context.fillText(character, index * 32 + 18, 34);
    context.fillStyle = "white";
    context.fillText(character, index * 32 + 16, 32);
  });
  const source = Texture.from(canvas),
    views = [...characters].map(
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
type Frames = Awaited<ReturnType<typeof createClipTextures>>;
