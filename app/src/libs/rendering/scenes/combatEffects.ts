import type { Grid } from "honeycomb-grid";
import { Container } from "pixi.js";
import type { GameAsset } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/inBattle";
import { projectileTravelMs } from "@/libs/combat/projectiles";
import type { GroundEffect, ReturnedBattle, UserEffect } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";
import {
  assetAnimationClip,
  EFFECT_ANIMATION_HEX_RATIO,
  STILL_EFFECT_MARKER,
  stillEffectMarkerScale,
} from "@/libs/rendering/animation";
import { createSpriteClip } from "@/libs/rendering/primitives/animation";
import {
  createGroundDecal,
  groundDecalBoundaries,
} from "@/libs/rendering/primitives/groundDecal";
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
  /** Set by each animate: an arrival clip is still playing. */
  let playing = false;
  /** Fastest frame rate among the looping clips shown in the last animate. */
  let loopFrameRate = 0;
  const sound = (id: string | undefined, moving: boolean) => {
    if (!id || !snapshot?.sound) return;
    const asset = snapshot.assets.find((entry) => entry.id === id);
    if (!asset?.url) return;
    if (moving) queued.push({ url: asset.url, volume: snapshot.volume });
    else play(asset.url, snapshot.volume);
  };
  const sync = (next: CombatEffectSnapshot, initial = false) => {
    snapshot = next;
    // One cast can create many tiles whose artwork finishes loading on different frames.
    // Share its audio onset across those records without suppressing a later cast this round.
    const emittedSounds = new Set<string>();
    const castPhaseKey = (
      effect: GroundEffect | UserEffect,
      phase: "appear" | "disappear",
    ) =>
      JSON.stringify([
        effect.creatorId,
        effect.soundOrigin?.actionId ?? effect.actionId ?? effect.id,
        effect.soundOrigin?.createdRound ?? effect.createdRound,
        phase,
      ]);
    const primarySounds = new Map<string, string>();
    const selectPrimary = (
      effect: GroundEffect | UserEffect,
      phase: "appear" | "disappear",
      id: string | undefined,
      primary: boolean | undefined,
    ) => {
      if (!primary || !id) return;
      const key = castPhaseKey(effect, phase),
        selected = primarySounds.get(key);
      // Resolve inconsistent authored primaries before asynchronous texture loading.
      if (!selected || id < selected) primarySounds.set(key, id);
    };
    for (const effect of [...next.battle.groundEffects, ...next.battle.usersEffects]) {
      selectPrimary(
        effect,
        effect.soundOrigin?.phase ?? "appear",
        effect.appearSfx,
        effect.appearSfxPrimary,
      );
      selectPrimary(
        effect,
        "disappear",
        effect.disappearSfx,
        effect.disappearSfxPrimary,
      );
    }
    const soundEvent = (
      effect: GroundEffect | UserEffect,
      id: string,
      phase: "appear" | "disappear",
    ) => {
      const cast = castPhaseKey(effect, phase),
        primary = primarySounds.get(cast),
        selected = primary ?? id;
      return {
        id: selected,
        emitted: emittedSounds,
        key: primary
          ? JSON.stringify([cast, selected])
          : JSON.stringify([
              effect.creatorId,
              effect.actionId ?? effect.id,
              effect.createdRound,
              !effect.soundOrigin ? phase : "appear",
              id,
            ]),
      };
    };
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
    const boundaries = groundDecalBoundaries(
      displayed.flatMap(({ effect, tile }) =>
        effect.staticAssetPath &&
        !effect.projectileOnly &&
        (effect.power === undefined || effect.power > 0) &&
        (effect.groundStyle === "DECAL" || effect.groundStyle === "SURFACE")
          ? [
              {
                id: effect.id,
                tile,
                material: JSON.stringify([
                  effect.creatorId,
                  effect.actionId,
                  effect.createdRound,
                  effect.staticAssetPath,
                  effect.groundStyle,
                  effect.groundOpacity,
                  effect.groundFeather,
                ]),
              },
            ]
          : [],
      ),
    );
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
        !effect.projectileAnimation &&
        !effect.disappearAnimation &&
        !effect.appearSfx &&
        !effect.disappearSfx
      )
        continue;
      let record = records.get(effect.id);
      // The same cast identity crosses from travel into impact exactly once.
      if (record && record.isProjectileOnly !== !!effect.projectileOnly) {
        record.scope.dispose();
        records.delete(effect.id);
        record = undefined;
      }
      if (!record) {
        const onsetSfx = effect.projectileOnly ? undefined : effect.appearSfx;
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
          events:
            !initial && next.sound && onsetSfx
              ? [soundEvent(effect, onsetSfx, effect.soundOrigin?.phase ?? "appear")]
              : [],
          depleted: false,
          barrier: null,
          decal: null,
          outerEdges: boundaries.get(effect.id),
          projectile: null,
          isProjectileOnly: !!effect.projectileOnly,
        };
        records.set(effect.id, record);
        const current = record;
        const hasGroundDecal =
          effect.groundStyle === "SURFACE" || effect.groundStyle === "DECAL";
        if (hasGroundDecal && !effect.projectileOnly) {
          const surface = new Container({ label: effect.id });
          current.ground = surface;
          ground.addChild(surface);
          scope.own(() => {
            if (!surface.destroyed) surface.destroy({ children: true });
          });
        }
        const addClip = async (id: string | undefined, loop: boolean) => {
          const asset = next.assets.find((entry) => entry.id === id);
          if (!asset) return;
          const animationScope = createRenderScope(scope);
          const clip = await createSpriteClip(
            animationScope,
            assetAnimationClip(asset, loop),
            {
              size:
                tile.height * EFFECT_ANIMATION_HEX_RATIO * (effect.animationScale ?? 1),
              height:
                effect.groundStyle === "SURFACE"
                  ? tile.height *
                    EFFECT_ANIMATION_HEX_RATIO *
                    (effect.animationScale ?? 1) *
                    0.55
                  : undefined,
            },
          );
          if (scope.isDisposed()) return;
          clip.sprite.position.set(
            tile.width / 2,
            tile.height * (0.5 + (effect.animationOffsetY ?? 0)),
          );
          clip.sprite.zIndex = loop ? 2 : 1;
          if (effect.groundStyle === "SURFACE") {
            clip.sprite.alpha = effect.groundOpacity ?? 1;
          }
          (effect.groundStyle === "SURFACE" ? (current.ground ?? root) : root).addChild(
            clip.sprite,
          );
          current.clips.push({
            ...clip,
            dispose: animationScope.dispose,
            // Surface loops lie under fighters; only upright overlays need a still badge.
            badge: effect.groundStyle !== "SURFACE",
            base: {
              scaleX: clip.sprite.scale.x,
              scaleY: clip.sprite.scale.y,
              alpha: clip.sprite.alpha,
              x: clip.sprite.position.x,
              y: clip.sprite.position.y,
            },
          });
        };
        const staticAsset = next.assets.find(
          (entry) => entry.id === effect.staticAssetPath,
        );
        const loads: Promise<unknown>[] = [];
        if (effect.projectileOnly) {
          const caster = next.battle.usersState.find(
            (user) => user.userId === effect.creatorId,
          );
          const origin =
            caster && grid.getHex({ col: caster.longitude, row: caster.latitude });
          const asset = next.assets.find(
            (entry) => entry.id === effect.projectileAnimation,
          );
          if (caster && origin && asset)
            loads.push(
              (async () => {
                const clip = await createSpriteClip(
                  scope,
                  assetAnimationClip(asset, true),
                  {
                    size: tile.height * 0.65 * (effect.projectileScale ?? 1),
                    fitContent: true,
                  },
                );
                if (scope.isDisposed()) return;
                const to = { x: tile.width / 2, y: tile.height / 2 };
                const from = {
                  x: to.x + tile.center.x - origin.center.x,
                  y: to.y + tile.center.y - origin.center.y,
                };
                clip.sprite.rotation = Math.atan2(to.y - from.y, to.x - from.x);
                root.addChild(clip.sprite);
                current.projectile = {
                  clip,
                  from,
                  to,
                  duration: projectileTravelMs(caster, {
                    longitude: tile.col,
                    latitude: tile.row,
                  }),
                };
              })(),
            );
        }
        if (staticAsset && !effect.projectileOnly && hasGroundDecal)
          loads.push(
            createGroundDecal(
              scope,
              staticAsset.image,
              tile,
              effect.groundOpacity ?? 1,
              effect.groundFeather ?? 0,
              boundaries.get(effect.id),
            ).then((decal) => {
              if (!scope.isDisposed()) {
                current.decal = decal;
                if (current.outerEdges) decal.setOuterEdges(current.outerEdges);
                current.ground?.addChild(decal);
              }
            }),
          );
        else if (staticAsset && !effect.projectileOnly)
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
        if (!effect.projectileOnly) {
          if (!initial) loads.push(addClip(effect.appearAnimation, false));
          loads.push(addClip(effect.staticAnimation, true));
        }
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
      record.outerEdges = boundaries.get(effect.id);
      if (record.outerEdges) record.decal?.setOuterEdges(record.outerEdges);
      record.effect = effect;
      record.tile = tile;
      const depleted = effect.power !== undefined && effect.power <= 0;
      if (depleted && !record.depleted && !initial && next.sound && effect.disappearSfx)
        record.events.push(soundEvent(effect, effect.disappearSfx, "disappear"));
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
    playing = false;
    loopFrameRate = 0;
    if (flushAt !== null && now >= flushAt && !moving) {
      flushAt = null;
      const sounds = queued;
      queued = [];
      if (snapshot?.sound) for (const sound of sounds) play(sound.url, sound.volume);
    }
    for (const [id, record] of records) {
      if (!record.ready) continue;
      record.startedAt ??= now;
      if (record.projectile) {
        const { clip, from, to, duration } = record.projectile;
        const elapsed = now - record.startedAt;
        const progress = reducedMotion
          ? 1
          : Math.min(1, Math.max(0, elapsed / duration));
        clip.renderAt(elapsed, reducedMotion);
        clip.sprite.position.set(
          from.x + (to.x - from.x) * progress,
          from.y + (to.y - from.y) * progress,
        );
        clip.sprite.visible = progress < 1 && !reducedMotion;
      }
      for (const event of record.events) {
        if (event.emitted.has(event.key)) continue;
        event.emitted.add(event.key);
        sound(event.id, moving);
      }
      record.events.length = 0;
      record.root.visible = record.displayed && !record.depleted;
      if (record.ground) record.ground.visible = record.root.visible;
      record.clips = record.clips.filter((clip) => {
        // Without motion an arrival clip is skipped rather than held as a still frame.
        if (
          (reducedMotion && !clip.loop) ||
          clip.renderAt(now - (record.startedAt ?? now), reducedMotion).finished
        ) {
          clip.dispose();
          return false;
        }
        return true;
      });
      for (const clip of record.clips) {
        if (!clip.loop) playing = true;
        else if (record.root.visible && !reducedMotion)
          loopFrameRate = Math.max(loopFrameRate, clip.frameRate);
        if (clip.loop && clip.badge) stillBadge(clip, record, reducedMotion);
      }
      if (record.barrier) {
        record.barrier.container.visible = record.root.visible && hoveredId === id;
        const barrier = record.effect as BarrierTagType;
        record.barrier.set(barrier.curHealth / barrier.maxHealth);
      }
    }
  };
  /** A frozen loop would cover the fighter, so it rests as a faint corner badge instead. */
  const stillBadge = (clip: EffectClip, record: EffectRecord, still: boolean) => {
    const { base, sprite } = clip;
    const shrink = still ? stillEffectMarkerScale(record.effect.animationScale) : 1;
    sprite.scale.set(base.scaleX * shrink, base.scaleY * shrink);
    sprite.alpha = still ? base.alpha * STILL_EFFECT_MARKER.alpha : base.alpha;
    sprite.position.set(
      still ? record.tile.width * STILL_EFFECT_MARKER.x : base.x,
      still ? record.tile.height * STILL_EFFECT_MARKER.y : base.y,
    );
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
  return {
    container,
    ground,
    sync,
    animate,
    hit,
    /** Pending artwork holds travel; unavailable artwork releases it once loading settles. */
    projectilesArrived: (now: number) => {
      const flights = [...records.values()].filter(
        (record) => record.isProjectileOnly && record.displayed,
      );
      return (
        flights.length > 0 &&
        flights.every(
          (record) =>
            record.ready &&
            (!record.projectile ||
              (record.startedAt !== null &&
                now - record.startedAt >= record.projectile.duration)),
        )
      );
    },
    /** Arrival clips or held sounds were still playing in the last animate. */
    isPlaying: () => playing || flushAt !== null,
    /** Fastest looping clip frame rate in the last animate, 0 without loops. */
    clipFrameRate: () => loopFrameRate,
  };
};
export type CombatEffectSnapshot = {
  battle: ReturnedBattle;
  assets: GameAsset[];
  sound: boolean;
  volume: number;
};
type EffectClip = Awaited<ReturnType<typeof createSpriteClip>> & {
  /** Upright overlay that shrinks to a corner badge while motion is off. */
  badge: boolean;
  /** Authored transform, restored when motion returns. */
  base: { scaleX: number; scaleY: number; alpha: number; x: number; y: number };
};
type EffectRecord = {
  scope: GameRenderer;
  root: Container;
  ground: Container | null;
  decal: Awaited<ReturnType<typeof createGroundDecal>> | null;
  outerEdges: boolean[] | undefined;
  effect: GroundEffect | UserEffect;
  tile: TerrainHex;
  clips: EffectClip[];
  startedAt: number | null;
  ready: boolean;
  displayed: boolean;
  events: { id: string; key: string; emitted: Set<string> }[];
  depleted: boolean;
  barrier: ReturnType<typeof createStatusMeter> | null;
  isProjectileOnly: boolean;
  projectile: {
    clip: Awaited<ReturnType<typeof createSpriteClip>>;
    from: { x: number; y: number };
    to: { x: number; y: number };
    duration: number;
  } | null;
};
