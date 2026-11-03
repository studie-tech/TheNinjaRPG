import { Container, Matrix, Sprite, Texture } from "pixi.js";
import {
  type BakedShadowAtlas,
  bakedShadowBounds,
  bakedShadowKey,
  bakedShadowTransform,
  hasBakedShadow,
  placeBakedShadowPair,
} from "@/libs/rendering/bakedShadowAtlas";
import {
  createCharacterShadowPoses,
  type ShadowPose,
} from "@/libs/rendering/characterShadowPose";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import {
  createVillageLightField,
  type VillageLightField,
} from "@/libs/rendering/villageLightField";
import { boundsOverlap, type WorldBounds } from "@/libs/rendering/visibility";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";
import type { worldSunlight } from "@/libs/rendering/worldSunlight";

/** Broad stationary sources share shadow strength instead of darkening every overlapping copy. */
export const strongestShadowLights = (
  lights: readonly VillageLight[],
  x: number,
  y: number,
) => {
  let first: WeightedLight | undefined, second: WeightedLight | undefined;
  for (const light of lights) {
    if (!Number.isFinite(light.reach) || light.reach <= 0) continue;
    const distance = Math.hypot(light.x - x, (light.y - y) * 2);
    if (!Number.isFinite(distance)) continue;
    const strength = Math.max(0, 1 - distance / light.reach) ** 2;
    if (strength <= 0.002) continue;
    const next = { light, strength, weight: 0 };
    if (!first || strength > first.strength) {
      second = first;
      first = next;
    } else if (!second || strength > second.strength) second = next;
  }
  const result = [first, second].filter((entry): entry is WeightedLight => !!entry);
  const total = result.reduce((sum, entry) => sum + entry.strength, 0);
  for (const entry of result) entry.weight = entry.strength / Math.max(total, 0.12);
  return result;
};

/** Authored building masks are shared across instances; camera motion never rebakes them. */
export const createBakedVillageLighting = (game: GameRenderer, world: Container) => {
  const base = createProjectedWorldLighting(game, world, {
    restoreWarmWindows: true,
    groundOrder: 2,
  });
  const ground = new Container({ label: "baked-village-ground", isRenderGroup: true });
  const localGround = new Container({
    label: "baked-village-local-ground",
    isRenderGroup: true,
  });
  base.container.addChildAt(ground, 1);
  base.container.addChildAt(localGround, 1);
  const poses = createCharacterShadowPoses();
  let lightField: VillageLightField | null = null;
  const buildings = new Set<Building>();
  const scenery = new Set<{
    source: Sprite;
    shadows: Sprite[];
    selected: WeightedLight[];
    atlas: BakedShadowAtlas | null;
    pose: Matrix;
    foot: { x: number; y: number };
    height: number;
    bounds: WorldBounds | null;
    visible: boolean;
    poseDirty: boolean;
  }>();
  const characters = new Map<Container, Character>();
  const fixtures = new Set<Fixture>();
  let smoothSun: ReturnType<typeof worldSunlight> | null = null;
  let dirty = true,
    disposed = false;
  let lights: VillageLight[] = [];
  let staticKey = "";
  const origin = (node: Container | null, cache: Map<Container, Matrix>): Matrix => {
    if (!node || node === world) return new Matrix();
    const cached = cache.get(node);
    if (cached) return cached;
    node.updateLocalTransform();
    const matrix = origin(node.parent, cache).clone().append(node.localTransform);
    cache.set(node, matrix);
    return matrix;
  };
  const pair = (target = ground) =>
    Array.from({ length: 2 }, () => {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.tint = 0x14202a;
      sprite.visible = false;
      target.addChild(sprite);
      return sprite;
    });
  const place = (
    building: Building,
    sprites: Sprite[],
    x: number,
    y: number,
    opacity: number,
  ) => {
    const atlas = building.atlas;
    if (!atlas) return;
    placeBakedShadowPair(
      sprites,
      atlas,
      bakedShadowTransform(atlas, building.source, building.transform),
      x,
      y,
      opacity,
    );
  };
  const register: typeof base.register = (
    source,
    description,
    textures = [],
    character,
    owner,
  ) => {
    if (character || description.shadowCaster === "character") {
      const root = character ?? source;
      let record = characters.get(root);
      if (!record) {
        // A sun silhouette and two lamp silhouettes overlap through twilight.
        const shadows = Array.from({ length: 3 }, () => {
          const sprite = new Sprite(Texture.EMPTY);
          sprite.label = "baked-character-shadow";
          sprite.tint = 0x0d1520;
          ground.addChild(sprite);
          return sprite;
        });
        record = {
          root,
          shadows,
          parts: new Set(),
          pose: null,
          nextPoseAt: 0,
          selected: [],
          key: "",
          foot: {
            x: 0,
            y: character ? 28 / 64 : source.texture.orig.height * (1 - source.anchor.y),
          },
        };
        characters.set(root, record);
      }
      record.parts.add(source);
      const current = record;
      return Object.assign(
        () => {
          current.parts.delete(source);
          current.nextPoseAt = 0;
          if (!current.parts.size) {
            for (const shadow of current.shadows) shadow.destroy();
            if (current.pose) current.pose.users--;
            characters.delete(root);
          }
        },
        { ready: Promise.resolve() },
      );
    }
    let fallback = base.register(source, description, textures, character, owner);
    if (
      owner &&
      description.shadowCaster &&
      !description.small &&
      (!hasBakedShadow(source.texture, description) ||
        description.shadowCaster !== "building")
    ) {
      const record = {
        source,
        shadows: [] as Sprite[],
        selected: [] as WeightedLight[],
        atlas: null as BakedShadowAtlas | null,
        pose: new Matrix(),
        foot: { x: 0, y: 0 },
        height: 0,
        bounds: null as WorldBounds | null,
        visible: false,
        poseDirty: true,
      };
      scenery.add(record);
      dirty = true;
      const sceneryAtlas = hasBakedShadow(source.texture, description)
        ? base.acquireAtlas(bakedShadowKey(source.texture, description))
        : null;
      if (sceneryAtlas)
        void sceneryAtlas.resource
          .then((atlas) => {
            if (!scenery.has(record)) return;
            record.atlas = atlas;
            dirty = true;
            game.invalidate();
          })
          .catch(() => {});
      const baseRelease = fallback;
      const release = () => {
        scenery.delete(record);
        for (const shadow of record.shadows) shadow.destroy();
        dirty = true;
        baseRelease();
        sceneryAtlas?.release();
      };
      fallback = Object.assign(release, { ready: fallback.ready });
    }
    if (description.light) {
      const fixture = { source, description, light: null } as Fixture;
      fixtures.add(fixture);
      dirty = true;
      const release = fallback;
      const remove = () => {
        fixtures.delete(fixture);
        dirty = true;
        release();
      };
      if (
        description.shadowCaster !== "building" ||
        !(description.worldMaterial || worldAssetSource(description.image))
      )
        return Object.assign(remove, { ready: fallback.ready });
    }
    if (
      description.shadowCaster !== "building" ||
      !(description.worldMaterial || worldAssetSource(description.image))
    )
      return fallback;
    if (!hasBakedShadow(source.texture, description))
      return Object.assign(
        () => {
          for (const fixture of fixtures)
            if (fixture.source === source) fixtures.delete(fixture);
          dirty = true;
          fallback();
        },
        { ready: fallback.ready },
      );
    const building: Building = {
      source,
      description,
      transform: new Matrix(),
      height: 0,
      atlas: null,
      sun: pair(),
      lamps: [pair(localGround), pair(localGround)],
      emission: null,
      selected: [],
      active: true,
      fallback,
    };
    buildings.add(building);
    const key = bakedShadowKey(source.texture, description);
    const atlasLease = base.acquireAtlas(key);
    const resource = atlasLease.resource;
    void resource
      .then((atlas) => {
        if (!building.active || disposed) return;
        building.atlas = atlas;
        fallback();
        const emission = new Sprite(atlas.emission);
        emission.anchor.copyFrom(source.anchor);
        emission.width = source.texture.orig.width;
        emission.height = source.texture.orig.height;
        emission.tint = 0xffffff;
        emission.blendMode = "normal";
        emission.visible = false;
        emission.alpha = 0;
        source.addChild(emission);
        building.emission = emission;
        dirty = true;
        game.invalidate();
      })
      .catch((error) => {
        if (!disposed && error?.name !== "AbortError")
          console.warn(
            "Baked building lighting unavailable; retaining projected shadows",
            error,
          );
      });
    return Object.assign(
      () => {
        building.active = false;
        buildings.delete(building);
        fallback();
        atlasLease.release();
        for (const sprite of [...building.sun, ...building.lamps.flat()])
          sprite.destroy();
        building.emission?.destroy();
        dirty = true;
        for (const fixture of fixtures)
          if (fixture.source === source) fixtures.delete(fixture);
      },
      { ready: Promise.resolve() },
    );
  };
  game.own(() => {
    disposed = true;
    poses.destroy();
    lightField?.texture.destroy(true);
    buildings.clear();
    characters.clear();
    fixtures.clear();
    scenery.clear();
  });
  return {
    ...base,
    kind: "baked" as const,
    register,
    invalidate: () => {
      dirty = true;
      base.invalidate();
    },
    blendSun: (sun: ReturnType<typeof worldSunlight>) => {
      smoothSun = sun;
    },
    update: (
      light: ReturnType<typeof worldSunlight>,
      view: WorldBounds,
      breeze?: Parameters<typeof base.update>[2],
    ) => {
      base.update(light, view, breeze);
      // Ground effects remain behind upright art and after terrain in the lit render layer.
      const terrain = base.container.children.find(
        (child) => child.label === "travel-terrain",
      );
      const projected = base.container.children.find(
        (child) => child.label === "projected-shadows",
      );
      const groundArt = base.container.children.find(
        (child) => child.label === "travel-ground-art",
      );
      const order = [terrain, groundArt, projected, localGround, ground].filter(
        (child): child is Container => !!child,
      );
      for (const [index, child] of order.entries())
        if (base.container.children[index] !== child)
          base.container.setChildIndex(child, index);
      const matrices = new Map<Container, Matrix>();
      const changed = dirty;
      if (dirty) {
        dirty = false;
        lights = [];
        const radiance: VillageLight[] = [];
        for (const fixture of fixtures) {
          if (fixture.source.destroyed || !fixture.source.parent) continue;
          const m = origin(fixture.source, matrices),
            d = fixture.description;
          const height = Math.hypot(m.c, m.d) * fixture.source.texture.orig.height;
          const building = [...buildings].find((b) => b.source === fixture.source);
          const emitters = building?.atlas?.frame.emitters;
          const average = emitters?.length
            ? emitters.reduce(
                (v, e) => ({
                  x: v.x + e.x / emitters.length,
                  y: v.y + e.y / emitters.length,
                  height: v.height + e.height / emitters.length,
                }),
                { x: 0, y: 0, height: 0 },
              )
            : { x: 0.5, y: 0.65, height: 0.3 };
          const groundLight = (
            emitter: typeof average,
            reach: number,
          ): VillageLight => {
            const point = m.apply({
              x:
                (emitter.x - fixture.source.anchor.x) *
                fixture.source.texture.orig.width,
              y:
                (emitter.y - fixture.source.anchor.y) *
                fixture.source.texture.orig.height,
            });
            return {
              x: point.x,
              y: point.y - emitter.height * height,
              height: emitter.height * height,
              reach,
              owner: fixture.source,
            };
          };
          fixture.light = groundLight(
            average,
            height * (d.shadowCaster === "building" ? 2.5 : 1.8),
          );
          lights.push(fixture.light);
          radiance.push(fixture.light);
          // Authored windows add entrance pools to the cached map without adding live shadow sources.
          for (const emitter of emitters ?? [])
            radiance.push(groundLight(emitter, height * 1.3));
        }
        for (const building of buildings) {
          building.transform.copyFrom(origin(building.source, matrices));
          building.height =
            Math.hypot(building.transform.c, building.transform.d) *
            building.source.texture.orig.height;
          const foot = building.transform.apply({
            x: 0,
            y: building.source.texture.orig.height * (1 - building.source.anchor.y),
          });
          building.selected = strongestShadowLights(
            lights.filter((l) => l.owner !== building.source),
            foot.x,
            foot.y,
          );
        }
        for (const record of scenery) {
          const m = origin(record.source, matrices);
          const foot = m.apply({
            x: 0,
            y: record.source.texture.orig.height * (1 - record.source.anchor.y),
          });
          record.selected = strongestShadowLights(
            lights.filter((l) => l.owner !== record.source),
            foot.x,
            foot.y,
          );
          record.pose.copyFrom(m);
          record.foot = foot;
          record.height = Math.hypot(m.c, m.d) * record.source.texture.orig.height;
          record.bounds = record.atlas
            ? bakedShadowBounds(
                record.atlas,
                bakedShadowTransform(record.atlas, record.source, m),
              )
            : {
                minX: foot.x - record.height * 3,
                maxX: foot.x + record.height * 3,
                minY: foot.y - record.height * 3,
                maxY: foot.y + record.height * 3,
              };
          record.poseDirty = true;
        }
        const previousField = lightField;
        lightField = createVillageLightField(radiance);
        base.setWarmField(lightField);
        previousField?.texture.destroy(true);
      }
      const night = game.visualEffects.localLights ? 1 - light.day : 0;
      localGround.visible = game.visualEffects.shadows && night > 0;
      localGround.alpha = night;
      const sun = smoothSun ?? light;
      const nextStaticKey = [
        Math.round(sun.x * 512),
        Math.round(sun.y * 512),
        Math.round(sun.z * 512),
        Math.round(light.day * 256),
        game.visualEffects.shadows,
        game.visualEffects.sunlight,
        game.visualEffects.localLights,
        Math.floor(view.minX / 32),
        Math.floor(view.minY / 32),
        Math.ceil(view.maxX / 32),
        Math.ceil(view.maxY / 32),
      ].join(":");
      if (changed || staticKey !== nextStaticKey) {
        for (const building of buildings) {
          if (!building.atlas || building.source.destroyed) continue;
          const h = building.height,
            m = building.transform;
          const visible = boundsOverlap(
            {
              minX: m.tx - h * 3,
              maxX: m.tx + h * 3,
              minY: m.ty - h * 3,
              maxY: m.ty + h * 3,
            },
            view,
          );
          const alpha = visible && game.visualEffects.shadows ? 0.3 : 0;
          place(
            building,
            building.sun,
            sun.x,
            sun.y,
            alpha * (game.visualEffects.sunlight ? light.day : 0),
          );
          const foot = building.transform.apply({
            x: 0,
            y: building.source.texture.orig.height * (1 - building.source.anchor.y),
          });
          const localVisible = visible && localGround.visible;
          if (changed || building.localVisible !== localVisible)
            for (const [i, lamps] of building.lamps.entries()) {
              const selected = building.selected[i];
              place(
                building,
                lamps,
                (selected?.light.x ?? foot.x) - foot.x,
                ((selected?.light.y ?? foot.y) - foot.y) * 2,
                localVisible ? 0.3 * (selected?.weight ?? 0) : 0,
              );
            }
          building.localVisible = localVisible;
          if (building.emission) {
            building.emission.visible = visible && night > 0;
            building.emission.alpha = night;
          }
        }
        if (localGround.visible)
          for (const record of scenery) {
            if (record.source.destroyed || !record.source.parent) continue;
            const visible = !!record.bounds && boundsOverlap(record.bounds, view, 32);
            if (!record.poseDirty && record.visible === visible) continue;
            record.visible = visible;
            record.poseDirty = false;
            if (!visible) {
              for (const shadow of record.shadows) shadow.visible = false;
              continue;
            }
            const m = record.pose,
              texture = record.source.texture,
              height = record.height,
              foot = record.foot;
            if (
              record.shadows.length !== (record.atlas ? 4 : 2) &&
              record.selected.length
            ) {
              for (const shadow of record.shadows) shadow.destroy();
              record.shadows = record.atlas
                ? [...pair(localGround), ...pair(localGround)]
                : pair(localGround);
              for (const shadow of record.shadows) {
                shadow.texture = texture;
                shadow.anchor.set(record.source.anchor.x, 1);
                shadow.label = "baked-scenery-local-shadow";
              }
            }
            if (record.atlas) {
              const pose = bakedShadowTransform(record.atlas, record.source, m);
              for (let i = 0; i < 2; i++) {
                const selected = record.selected[i];
                placeBakedShadowPair(
                  record.shadows.slice(i * 2, i * 2 + 2),
                  record.atlas,
                  pose,
                  (selected?.light.x ?? foot.x) - foot.x,
                  ((selected?.light.y ?? foot.y) - foot.y) * 2,
                  (selected?.weight ?? 0) * 0.24,
                );
              }
              continue;
            }
            for (const [i, shadow] of record.shadows.entries()) {
              const selected = record.selected[i];
              shadow.visible = !!selected;
              if (!shadow.visible || !selected) continue;
              const dx = foot.x - selected.light.x,
                dy = (foot.y - selected.light.y) * 2,
                distance = Math.hypot(dx, dy) || 1;
              const reach = Math.min(
                1.6,
                distance / Math.max(height * 0.5, selected.light.height),
              );
              shadow.setFromMatrix(
                new Matrix(
                  (-dy / distance) * m.a,
                  ((dx / distance) * m.a) / 2,
                  ((-dx / distance) * reach * height) / texture.orig.height,
                  ((-dy / distance) * reach * height) / (2 * texture.orig.height),
                  foot.x,
                  foot.y,
                ),
              );
              shadow.alpha = selected.weight * 0.24;
            }
          }
      }
      staticKey = nextStaticKey;
      const now = performance.now();
      for (const record of characters.values()) {
        if (record.root.destroyed || !record.root.parent) continue;
        const m = origin(record.root, matrices),
          height = Math.hypot(m.c, m.d);
        const foot = m.apply(record.foot);
        if (
          !boundsOverlap(
            {
              minX: foot.x - height * 3,
              maxX: foot.x + height * 3,
              minY: foot.y - height * 3,
              maxY: foot.y + height * 3,
            },
            view,
          )
        ) {
          for (const shadow of record.shadows) shadow.visible = false;
          record.key = "";
          continue;
        }
        if (now >= record.nextPoseAt) {
          record.nextPoseAt = now + 150;
          const pose = poses.capture(record.root, [...record.parts]);
          if (pose !== record.pose) {
            if (record.pose) record.pose.users--;
            record.pose = pose;
            if (pose) pose.users++;
          }
        }
        const pose = record.pose;
        if (!pose) {
          for (const shadow of record.shadows) shadow.visible = false;
          continue;
        }
        const characterKey = [
          foot.x,
          foot.y,
          pose.texture.uid,
          night,
          game.visualEffects.shadows,
          game.visualEffects.sunlight,
          Math.round(sun.x * 512),
          Math.round(sun.y * 512),
          Math.round(sun.z * 512),
        ].join(":");
        if (!changed && record.key === characterKey) continue;
        record.key = characterKey;
        record.selected =
          night > 0 && game.visualEffects.shadows
            ? strongestShadowLights(lights, foot.x, foot.y)
            : [];
        for (const [i, sprite] of record.shadows.entries()) {
          const selected = i === 0 ? undefined : record.selected[i - 1];
          let dx = -sun.x,
            dy = -sun.y / 2;
          let strength = i === 0 && game.visualEffects.sunlight ? light.day : 0;
          let length =
            height * Math.min(1.6, Math.hypot(dx, dy * 2) / Math.max(0.35, sun.z));
          if (i > 0) {
            dx = foot.x - (selected?.light.x ?? foot.x);
            dy = foot.y - (selected?.light.y ?? foot.y);
            length = Math.min(
              height * 2.2,
              Math.max(
                height * 0.3,
                (height * Math.hypot(dx, dy * 2)) /
                  Math.max(height * 0.4, selected?.light.height ?? height),
              ),
            );
            strength = night * (selected?.weight ?? 0);
          }
          sprite.visible = game.visualEffects.shadows && strength > 0.001;
          if (!sprite.visible) continue;
          const directionLength = Math.hypot(dx, dy * 2) || 1;
          const ux = dx / directionLength,
            uy = (dy * 2) / directionLength;
          const pixelX = pose.width / pose.texture.orig.width,
            pixelY = pose.height / pose.texture.orig.height;
          sprite.texture = pose.texture;
          sprite.anchor.set(
            (record.foot.x - pose.minX) / pose.width,
            (record.foot.y - pose.minY) / pose.height,
          );
          sprite.setFromMatrix(
            new Matrix(
              -uy * height * pixelX,
              (ux * height * pixelX) / 2,
              -ux * length * pixelY,
              (-uy * length * pixelY) / 2,
              foot.x,
              foot.y,
            ),
          );
          sprite.alpha = strength * 0.3;
        }
      }
    },
  };
};

export type VillageLight = {
  x: number;
  y: number;
  height: number;
  reach: number;
  owner?: Container;
};
type WeightedLight = { light: VillageLight; strength: number; weight: number };
type Fixture = {
  source: Sprite;
  description: WorldSpriteDescription;
  light: VillageLight | null;
};
type Building = {
  source: Sprite;
  description: WorldSpriteDescription;
  transform: Matrix;
  height: number;
  atlas: BakedShadowAtlas | null;
  sun: Sprite[];
  lamps: Sprite[][];
  emission: Sprite | null;
  selected: WeightedLight[];
  active: boolean;
  fallback: () => void;
  localVisible?: boolean;
};
type Character = {
  key: string;
  root: Container;
  shadows: Sprite[];
  parts: Set<Sprite>;
  pose: ShadowPose | null;
  nextPoseAt: number;
  foot: { x: number; y: number };
  selected: WeightedLight[];
};

export type BakedVillageLighting = ReturnType<typeof createBakedVillageLighting>;
