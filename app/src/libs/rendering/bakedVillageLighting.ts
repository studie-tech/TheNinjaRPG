import { Container, Matrix, Sprite, Texture } from "pixi.js";
import {
  type BakedShadowAtlas,
  bakedShadowKey,
  hasBakedShadow,
  loadBakedShadowAtlas,
  shadowDirectionBlend,
} from "@/libs/rendering/bakedShadowAtlas";
import { createPixelLightTexture } from "@/libs/rendering/primitives/shadow";
import { createProjectedWorldLighting } from "@/libs/rendering/projectedWorldLighting";
import type { GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
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
  const glow = new Container({ label: "baked-village-glow", isRenderGroup: true });
  base.container.addChildAt(ground, 1);
  base.container.addChildAt(glow, 2);
  const lightTexture = createPixelLightTexture({ smooth: true });
  const characterTexture = characterShadowTexture();
  const buildings = new Set<Building>();
  const characters = new Map<Container, Character>();
  const fixtures = new Set<Fixture>();
  const atlases = new Map<string, Promise<BakedShadowAtlas>>();
  const owned = new Set<BakedShadowAtlas>();
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
  const pair = () =>
    Array.from({ length: 2 }, () => {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.tint = 0x14202a;
      sprite.visible = false;
      ground.addChild(sprite);
      return sprite;
    });
  const place = (
    building: Building,
    sprites: Sprite[],
    x: number,
    y: number,
    opacity: number,
    length = 1,
  ) => {
    const atlas = building.atlas;
    if (!atlas) return;
    const sample = shadowDirectionBlend(x, y);
    for (const [i, sprite] of sprites.entries()) {
      const weight = i === 0 ? 1 - sample.mix : sample.mix;
      sprite.visible = opacity * weight > 0.0001;
      if (!sprite.visible) continue;
      const direction = i === 0 ? sample.first : sample.second;
      const texture = atlas.views[direction];
      if (!texture) {
        sprite.visible = false;
        continue;
      }
      sprite.texture = texture;
      const source = building.source,
        m = building.transform,
        height = building.height;
      const angle = Math.atan2(y, x),
        delta = angle - (direction * Math.PI) / 4;
      const c = Math.cos(delta),
        s = Math.sin(delta),
        ux = Math.cos(angle),
        uy = Math.sin(angle);
      const ratio = Math.max(0.25, Math.min(1.8, length)) - 1;
      const a = 1 + ratio * ux * ux,
        b = (ratio * ux * uy) / 2,
        cc = ratio * ux * uy * 2,
        d = 1 + ratio * uy * uy;
      const aa = a * c + (cc * s) / 2,
        bb = b * c + (d * s) / 2,
        ac = -a * s * 2 + cc * c,
        bd = -b * s * 2 + d * c;
      const sx = (atlas.width * height) / sprite.texture.width,
        sy = (-atlas.height * height) / sprite.texture.height;
      const foot = m.apply({
        x: 0,
        y: source.texture.orig.height * (1 - source.anchor.y),
      });
      const tx =
        m.tx -
        m.a * source.texture.orig.width * source.anchor.x +
        atlas.minX * height -
        foot.x;
      const ty =
        m.ty -
        m.d * source.texture.orig.height * source.anchor.y -
        atlas.minY * height -
        foot.y;
      sprite.setFromMatrix(
        new Matrix(
          aa * sx,
          bb * sx,
          ac * sy,
          bd * sy,
          foot.x + aa * tx + ac * ty,
          foot.y + bb * tx + bd * ty,
        ),
      );
      sprite.alpha = opacity * weight;
    }
  };
  const register: typeof base.register = (
    source,
    description,
    textures = [],
    character,
    owner,
  ) => {
    if (character) {
      let record = characters.get(character);
      if (!record) {
        // A sun silhouette and two lamp silhouettes overlap through twilight.
        const shadows = Array.from({ length: 3 }, () => {
          const sprite = new Sprite(characterTexture);
          sprite.anchor.set(0.025, 0.5);
          sprite.tint = 0x0d1520;
          ground.addChild(sprite);
          return sprite;
        });
        record = { root: character, shadows, references: 0, selected: [], key: "" };
        characters.set(character, record);
      }
      record.references++;
      const current = record;
      return Object.assign(
        () => {
          if (--current.references === 0) {
            for (const shadow of current.shadows) shadow.destroy();
            characters.delete(character);
          }
        },
        { ready: Promise.resolve() },
      );
    }
    const fallback = base.register(source, description, textures, character, owner);
    if (description.light && description.shadowCaster !== "character") {
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
      lamps: [pair(), pair()],
      glow: null,
      emission: null,
      selected: [],
      active: true,
      fallback,
    };
    buildings.add(building);
    const key = bakedShadowKey(source.texture, description);
    let resource = atlases.get(key);
    if (!resource) {
      resource = loadBakedShadowAtlas(game, key).then((atlas) => {
        owned.add(atlas);
        return atlas;
      });
      atlases.set(key, resource);
    }
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
        const pool = new Sprite(lightTexture);
        pool.anchor.set(0.5);
        pool.tint = 0xffa24d;
        pool.blendMode = "add";
        glow.addChild(pool);
        building.glow = pool;
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
        for (const sprite of [...building.sun, ...building.lamps.flat()])
          sprite.destroy();
        building.emission?.destroy();
        building.glow?.destroy();
        dirty = true;
        for (const fixture of fixtures)
          if (fixture.source === source) fixtures.delete(fixture);
      },
      { ready: Promise.resolve() },
    );
  };
  game.own(() => {
    disposed = true;
    for (const atlas of owned) atlas.destroy();
    owned.clear();
    lightTexture.destroy(true);
    characterTexture.destroy(true);
    buildings.clear();
    characters.clear();
    fixtures.clear();
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
      const order = [terrain, groundArt, projected, ground, glow].filter(
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
          const point = m.apply({
            x:
              (average.x - fixture.source.anchor.x) * fixture.source.texture.orig.width,
            y:
              (average.y - fixture.source.anchor.y) *
              fixture.source.texture.orig.height,
          });
          fixture.light = {
            x: point.x,
            y: point.y - average.height * height,
            height: average.height * height,
            reach: height * (d.shadowCaster === "building" ? 2.5 : 1.8),
            owner: fixture.source,
          };
          lights.push(fixture.light);
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
      }
      const night = game.visualEffects.localLights ? 1 - light.day : 0;
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
      if (changed || staticKey !== nextStaticKey)
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
            Math.hypot(sun.x, sun.y) / Math.max(0.35, sun.z) / 1.25,
          );
          const foot = building.transform.apply({
            x: 0,
            y: building.source.texture.orig.height * (1 - building.source.anchor.y),
          });
          for (const [i, lamps] of building.lamps.entries()) {
            const selected = building.selected[i];
            place(
              building,
              lamps,
              (selected?.light.x ?? foot.x) - foot.x,
              ((selected?.light.y ?? foot.y) - foot.y) * 2,
              alpha * night * (selected?.weight ?? 0),
              selected
                ? Math.hypot(
                    selected.light.x - foot.x,
                    (selected.light.y - foot.y) * 2,
                  ) /
                    Math.max(h * 0.3, selected.light.height) /
                    1.25
                : 1,
            );
          }
          if (building.emission) {
            building.emission.visible = visible && night > 0;
            building.emission.alpha = night;
          }
          if (building.glow) {
            building.glow.visible = visible && night > 0;
            building.glow.position.set(foot.x, foot.y);
            building.glow.width = h * 2.6;
            building.glow.height = h * 1.3;
            building.glow.alpha = night * 0.48;
          }
        }
      staticKey = nextStaticKey;
      for (const record of characters.values()) {
        if (record.root.destroyed || !record.root.parent) continue;
        const m = origin(record.root, matrices),
          height = Math.hypot(m.c, m.d);
        const foot = m.apply({ x: 0, y: 28 / 64 });
        const characterKey = [
          foot.x,
          foot.y,
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
          sprite.position.copyFrom(foot);
          sprite.rotation = Math.atan2(dy, dx);
          sprite.width = length;
          sprite.height = height * 0.24;
          sprite.alpha = strength * 0.3;
        }
      }
    },
  };
};

const characterShadowTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return createPixelLightTexture({ smooth: true });
  const fade = context.createLinearGradient(0, 0, 128, 0);
  fade.addColorStop(0, "white");
  fade.addColorStop(1, "rgba(255,255,255,0.55)");
  context.fillStyle = fade;
  context.beginPath();
  context.moveTo(2, 24);
  context.lineTo(54, 15);
  context.lineTo(96, 19);
  context.lineTo(96, 29);
  context.lineTo(54, 33);
  context.closePath();
  context.fill();
  context.beginPath();
  context.ellipse(108, 24, 12, 8, 0, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = fade;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(65, 17);
  context.lineTo(84, 8);
  context.moveTo(65, 31);
  context.lineTo(84, 40);
  context.stroke();
  return Texture.from(canvas);
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
  glow: Sprite | null;
  selected: WeightedLight[];
  active: boolean;
  fallback: () => void;
};
type Character = {
  key: string;
  root: Container;
  shadows: Sprite[];
  references: number;
  selected: WeightedLight[];
};

export type BakedVillageLighting = ReturnType<typeof createBakedVillageLighting>;
