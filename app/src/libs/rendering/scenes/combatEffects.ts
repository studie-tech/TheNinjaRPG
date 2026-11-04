import type { Grid } from "honeycomb-grid";
import { Container } from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import type { GroundEffect, ReturnedBattle, UserEffect } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";
import {
  assetAnimationClip,
  EFFECT_ANIMATION_HEX_RATIO,
} from "@/libs/rendering/animation";
import { createSpriteClip } from "@/libs/rendering/primitives/animation";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createStatusMeter } from "@/libs/rendering/primitives/statusMeter";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import { isObjectChainVisible } from "@/libs/rendering/visibility";
import type { BarrierTagType } from "@/validators/combat";

/**
 * Terrain mesh order for static ground artwork: above flat faces (4) and their edges (5),
 * below the combat grid outlines (5.5), so it draws on the ground plane under fighters.
 */
export const COMBAT_GROUND_EFFECT_Z_INDEX = 5.25;

/**
 * Static artwork stays below targeting and fighters; clips and meters stay above.
 * Effects keep identity through hidden/depleted states and retire their leases on expiry.
 */
export const createCombatEffects = (
  game: GameRenderer,
  grid: Grid<TerrainHex>,
  play: (url: string, volume: number) => void,
) => {
  const container = new Container(),
    ground = new Container(),
    records = new Map<string, EffectRecord>();
  let snapshot: CombatEffectSnapshot | null = null;
  let queued: { url: string; volume: number }[] = [],
    flushAt: number | null = null;
  let wasMoving = false;
  const sound = (id: string | undefined, moving: boolean) => {
    if (!id || !snapshot?.sound) return;
    const asset = snapshot.assets.find((entry) => entry.id === id);
    if (!asset?.url) return;
    if (moving) queued.push({ url: asset.url, volume: snapshot.volume });
    else play(asset.url, snapshot.volume);
  };
  const sync = (next: CombatEffectSnapshot, initial = false) => {
    snapshot = next;
    const live = new Set(
      [...next.battle.groundEffects, ...next.battle.usersEffects].map(
        (effect) => effect.id,
      ),
    );
    for (const [id, record] of records)
      if (!live.has(id)) {
        record.scope.dispose();
        records.delete(id);
      }
    const displayed: { effect: GroundEffect | UserEffect; tile: TerrainHex }[] = [];
    for (const effect of next.battle.groundEffects) {
      const tile = grid.getHex({ col: effect.longitude, row: effect.latitude });
      if (tile) displayed.push({ effect, tile });
    }
    for (const effect of next.battle.usersEffects) {
      const user = next.battle.usersState.find(
        (user) => user.userId === effect.targetId,
      );
      if (!user || !stillInBattle(user)) continue;
      const tile = grid.getHex({ col: user.longitude, row: user.latitude });
      if (tile) displayed.push({ effect, tile });
    }
    const visible = new Set(displayed.map((entry) => entry.effect.id));
    for (const [id, record] of records)
      if (!visible.has(id)) {
        record.displayed = false;
        record.root.visible = false;
        if (record.ground) record.ground.visible = false;
      }
    const pending: Promise<unknown>[] = [];
    for (const { effect, tile } of displayed) {
      if (
        !effect.staticAssetPath &&
        !effect.staticAnimation &&
        !effect.appearAnimation &&
        !effect.disappearAnimation &&
        !effect.appearSfx &&
        !effect.disappearSfx
      )
        continue;
      let record = records.get(effect.id);
      if (!record) {
        const scope = createRenderScope(game),
          root = new Container();
        root.sortableChildren = true;
        root.label = effect.id;
        container.addChild(root);
        scope.own(() => {
          if (!root.destroyed)
            root.destroy({ children: true, texture: false, textureSource: false });
        });
        record = {
          scope,
          root,
          ground: null,
          effect,
          tile,
          clips: [],
          startedAt: null,
          ready: false,
          displayed: true,
          events: !initial && next.sound && effect.appearSfx ? [effect.appearSfx] : [],
          depleted: false,
          barrier: null,
        };
        records.set(effect.id, record);
        const current = record;
        const addClip = async (id: string | undefined, loop: boolean) => {
          const asset = next.assets.find((entry) => entry.id === id);
          if (!asset) return;
          const animationScope = createRenderScope(scope);
          const clip = await createSpriteClip(
            animationScope,
            assetAnimationClip(asset, loop),
            {
              size: tile.height * EFFECT_ANIMATION_HEX_RATIO,
            },
          );
          if (scope.isDisposed()) return;
          clip.sprite.position.set(tile.width / 2, tile.height / 2);
          clip.sprite.zIndex = loop ? 2 : 1;
          root.addChild(clip.sprite);
          current.clips.push({ ...clip, dispose: animationScope.dispose });
        };
        const staticAsset = next.assets.find(
          (entry) => entry.id === effect.staticAssetPath,
        );
        const loads: Promise<unknown>[] = [];
        if (staticAsset)
          loads.push(
            createWorldSprites(scope, [
              {
                id: "static",
                kind: effect.type,
                image: staticAsset.image,
                size: tile.height,
                width: tile.width,
                x: tile.width / 2,
                y: tile.height / 2,
                groundY: 0,
              },
            ]).then((art) => {
              if (scope.isDisposed()) return;
              current.ground = art.container;
              art.container.label = effect.id;
              art.container.position.copyFrom(root.position);
              art.container.visible = root.visible;
              ground.addChild(art.container);
            }),
          );
        if (!initial) loads.push(addClip(effect.appearAnimation, false));
        loads.push(addClip(effect.staticAnimation, true));
        pending.push(
          Promise.allSettled(loads).then((results) => {
            if (scope.isDisposed()) return;
            for (const result of results)
              if (result.status === "rejected")
                console.warn("Combat effect unavailable", result.reason);
            current.ready = true;
            game.invalidate();
          }),
        );
        if (effect.type === "barrier") {
          const meter = createStatusMeter({
            width: tile.width / 2,
            height: tile.height / 10,
            y: tile.height + tile.width / 3,
            color: 0xb22222,
          });
          meter.container.zIndex = 3;
          meter.container.visible = false;
          root.addChild(meter.container);
          record.barrier = meter;
        }
      }
      record.displayed = true;
      record.effect = effect;
      record.tile = tile;
      const depleted = effect.power !== undefined && effect.power <= 0;
      if (depleted && !record.depleted && !initial && next.sound && effect.disappearSfx)
        record.events.push(effect.disappearSfx);
      record.depleted = depleted;
      record.root.visible = record.ready && !depleted;
      record.root.position.set(-tile.center.x, -tile.center.y);
      if (record.ground) {
        record.ground.visible = record.root.visible;
        record.ground.position.copyFrom(record.root.position);
      }
    }
    return Promise.all(pending);
  };
  const animate = (
    now: number,
    reducedMotion: boolean,
    moving: boolean,
    hoveredId: string | null,
  ) => {
    if (wasMoving && !moving && queued.length) flushAt = now + 50;
    wasMoving = moving;
    if (flushAt !== null && now >= flushAt && !moving) {
      flushAt = null;
      const sounds = queued;
      queued = [];
      if (snapshot?.sound) for (const sound of sounds) play(sound.url, sound.volume);
    }
    for (const [id, record] of records) {
      if (!record.ready) continue;
      record.startedAt ??= now;
      for (const event of record.events) sound(event, moving);
      record.events.length = 0;
      record.root.visible = record.displayed && !record.depleted;
      if (record.ground) record.ground.visible = record.root.visible;
      record.clips = record.clips.filter((clip) => {
        if (!clip.renderAt(now - (record.startedAt ?? now), reducedMotion).finished)
          return true;
        clip.dispose();
        return false;
      });
      if (record.barrier) {
        record.barrier.container.visible = record.root.visible && hoveredId === id;
        const barrier = record.effect as BarrierTagType;
        record.barrier.set(barrier.curHealth / barrier.maxHealth);
      }
    }
  };
  const hit = (x: number, y: number) => {
    for (const layer of [container, ground])
      for (let index = layer.children.length - 1; index >= 0; index--) {
        const root = layer.children[index],
          record = root && records.get(root.label);
        if (!root || !record || !isObjectChainVisible(root)) continue;
        if (root.getBounds().containsPoint(x, y))
          return { id: record.effect.id, tile: record.tile };
      }
    return null;
  };
  game.own(() => {
    queued = [];
    flushAt = null;
  });
  return { container, ground, sync, animate, hit };
};
export type CombatEffectSnapshot = {
  battle: ReturnedBattle;
  assets: GameAsset[];
  sound: boolean;
  volume: number;
};
type EffectRecord = {
  scope: GameRenderer;
  root: Container;
  ground: Container | null;
  effect: GroundEffect | UserEffect;
  tile: TerrainHex;
  clips: Awaited<ReturnType<typeof createSpriteClip>>[];
  startedAt: number | null;
  ready: boolean;
  displayed: boolean;
  events: string[];
  depleted: boolean;
  barrier: ReturnType<typeof createStatusMeter> | null;
};
