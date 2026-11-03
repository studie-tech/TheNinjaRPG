import { BufferImageSource, Texture } from "pixi.js";
import { createSceneAssets, readTexturePixels } from "@/libs/rendering/assets";
import published from "@/libs/rendering/bakedVillageLightFields.json";
import type { VillageLight } from "@/libs/rendering/bakedVillageLighting";
import bakedSources from "@/libs/rendering/bakedWorldSources.json";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import type { WorldBounds } from "@/libs/rendering/visibility";
import worldSources from "@/libs/rendering/worldAssetSources.json";

const fields = new Map<string, Texture>();
const fallbackLayouts = new Map<string, string>();
const cache = createLeaseCache<Texture>({
  load: async (key) => {
    let texture: Texture;
    if (key.startsWith("baked:")) {
      try {
        texture = await loadPublishedField(
          published.fields[key.slice(6) as keyof typeof published.fields],
        );
      } catch (error) {
        const layout = fallbackLayouts.get(key);
        if (!layout) throw error;
        console.warn(
          "Village light bake unavailable; using the layout rasterizer",
          error,
        );
        texture = await rasterize(JSON.parse(layout) as LightLayout);
      }
    } else texture = await rasterize(JSON.parse(key) as LightLayout);
    fields.set(key, texture);
    return texture;
  },
  unload: async (key) => {
    const texture = fields.get(key);
    if (texture && texture !== Texture.EMPTY) texture.destroy(true);
    fields.delete(key);
  },
  bytes: (texture) => texture.source.pixelWidth * texture.source.pixelHeight * 4,
  idleBudget: 4 * 1024 * 1024,
});

const digest = async (key: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join(
    "",
  );
};
let matchingCatalog: Promise<boolean> | null = null;
const hasPublishedCatalog = () =>
  (matchingCatalog ??= digest(JSON.stringify([bakedSources, worldSources])).then(
    (key) => key === published.catalog,
  ));

/** Published layouts use the same leases as their fully resolved runtime representation. */
const leaseField = (key: Promise<string | null>, bounds: WorldBounds) => {
  let lease: ReturnType<typeof cache.acquire> | null = null;
  let released = false;
  const resource = key.then(async (value) => {
    if (!value || released) return null;
    lease = cache.acquire(value);
    const texture = await lease.resource;
    return { texture, bounds };
  });
  return {
    resource,
    release: () => {
      released = true;
      lease?.release();
    },
  };
};

/** A static sector signature allows the complete pool to load before fixture artwork. */
export const acquirePrebakedVillageLightField = (
  sceneKey: string,
  origin: { x: number; y: number },
) => {
  let lease: ReturnType<typeof leaseField> | null = null;
  let released = false;
  const resource = Promise.all([digest(sceneKey), hasPublishedCatalog()]).then(
    async ([key, matches]) => {
      const scene = matches
        ? (
            published.scenes as Readonly<
              Record<string, { field: string; bounds: WorldBounds }>
            >
          )[key]
        : undefined;
      if (!scene || released) return null;
      const b = scene.bounds;
      lease = leaseField(Promise.resolve(`baked:${scene.field}`), {
        minX: b.minX + origin.x,
        maxX: b.maxX + origin.x,
        minY: b.minY + origin.y,
        maxY: b.maxY + origin.y,
      });
      return lease.resource;
    },
  );
  return {
    resource,
    release: () => {
      released = true;
      lease?.release();
    },
  };
};

const loadPublishedField = async (source: BakedField) => {
  const assets = createSceneAssets();
  try {
    const packed = await assets.texture(source.image, 0, "nearest");
    if (packed.width !== source.width * 2 || packed.height !== source.height)
      throw new Error("Village light bake dimensions do not match its layout");
    const pixels = readTexturePixels(packed, source.width * 2, source.height);
    return createFieldTexture(
      unpackVillageLightField(pixels, source.width, source.height),
      source.width,
      source.height,
    );
  } finally {
    assets.dispose();
  }
};

/** Opaque RGB tiles preserve both irradiance and eligibility through ordinary image decoding. */
export const unpackVillageLightField = (
  packed: Uint8Array,
  width: number,
  height: number,
) => {
  if (packed.length !== width * 2 * height * 4)
    throw new Error("Invalid village light bake data");
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      const color = (y * width * 2 + x) * 4;
      const eligibility = color + width * 4;
      pixels[target] = packed[color]!;
      pixels[target + 1] = packed[color + 1]!;
      pixels[target + 2] = packed[color + 2]!;
      pixels[target + 3] = packed[eligibility]!;
    }
  return pixels;
};

const createFieldTexture = (
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
) =>
  new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width,
      height,
      format: "rgba8unorm",
      alphaMode: "no-premultiply-alpha",
      scaleMode: "linear",
    }),
  });

/** Translation-independent layout leases share colored, occluded pools without camera-triggered rasterization. */
export const acquireVillageLightField = (
  sources: readonly VillageLight[],
  blockers: readonly VillageLightBlocker[] = [],
) => {
  const lights = sources.filter(
    (l) =>
      Number.isFinite(l.x) &&
      Number.isFinite(l.y) &&
      Number.isFinite(l.reach) &&
      l.reach > 0,
  );
  if (!lights.length) return null;
  const spread = 1.25;
  const bounds: WorldBounds = {
    minX: Math.min(...lights.map((l) => l.x - l.reach * spread)),
    maxX: Math.max(...lights.map((l) => l.x + l.reach * spread)),
    minY: Math.min(...lights.map((l) => l.y - (l.reach * spread) / 2)),
    maxY: Math.max(...lights.map((l) => l.y + (l.reach * spread) / 2)),
  };
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  const layout: LightLayout = {
    width: round(bounds.maxX - bounds.minX),
    height: round(bounds.maxY - bounds.minY),
    lights: lights
      .map((l) => ({
        x: round(l.x - bounds.minX),
        y: round(l.y - bounds.minY),
        height: round(Math.max(0, l.height)),
        reach: round(l.reach * spread),
        color: l.color ?? [0.8, 0.48, 0.15],
        intensity: l.intensity ?? 1,
        direction: l.direction,
        emission: l.emission
          ? {
              x: round(l.emission.x - bounds.minX),
              y: round(l.emission.y - bounds.minY),
              radius: round(l.emission.radius),
            }
          : undefined,
        owner: l.owner?.label || null,
      }))
      .sort((a, b) => a.x - b.x || a.y - b.y || a.reach - b.reach),
    blockers: blockers
      .filter(
        (b) =>
          b.points.length >= 3 &&
          b.height > 0 &&
          b.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      )
      .map((b) => ({
        points: b.points.map((p) => ({
          x: round(p.x - bounds.minX),
          y: round(p.y - bounds.minY),
        })),
        height: round(b.height),
        owner: b.owner?.label || null,
      }))
      .sort(
        (a, b) =>
          (a.owner ?? "").localeCompare(b.owner ?? "") ||
          a.points[0]!.x - b.points[0]!.x ||
          a.points[0]!.y - b.points[0]!.y,
      ),
  };
  const key = JSON.stringify(layout);
  const lease = leaseField(
    Promise.all([digest(key), hasPublishedCatalog()]).then(([fingerprint, matches]) => {
      if (!matches || !Object.hasOwn(published.fields, fingerprint)) return key;
      const bakedKey = `baked:${fingerprint}`;
      fallbackLayouts.set(bakedKey, key);
      return bakedKey;
    }),
    bounds,
  );
  return {
    ...lease,
    resource: lease.resource.then((field) => {
      if (!field) throw new DOMException("Village field cancelled", "AbortError");
      return field;
    }),
  };
};

/** Project a solid footprint away from a fixture; low walls cast finite ground shadows. */
export const lightOcclusionPolygon = (
  light: { x: number; y: number; height: number; reach: number },
  blocker: { points: readonly Point[]; height: number },
) => {
  const points = [...blocker.points];
  for (const p of blocker.points) {
    const dx = p.x - light.x,
      dy = (p.y - light.y) * 2,
      distance = Math.hypot(dx, dy);
    const factor =
      light.height > blocker.height + 0.001
        ? light.height / (light.height - blocker.height)
        : distance > 0.001
          ? (light.reach * 2) / distance
          : 1;
    const reach = Math.max(
      1,
      Math.min(factor, distance > 0.001 ? (light.reach * 2) / distance : 1),
    );
    points.push({ x: light.x + dx * reach, y: light.y + (dy * reach) / 2 });
  }
  return convexHull(points);
};

const rasterize = async (layout: LightLayout) => {
  const canvas = document.createElement("canvas"),
    pool = document.createElement("canvas");
  canvas.width = Math.max(
    1,
    Math.round((768 * layout.width) / Math.max(layout.width, layout.height)),
  );
  canvas.height = Math.max(
    1,
    Math.round((768 * layout.height) / Math.max(layout.width, layout.height)),
  );
  const context = canvas.getContext("2d"),
    stamp = pool.getContext("2d");
  if (!context || !stamp) return Texture.EMPTY;
  const sx = canvas.width / layout.width,
    sy = canvas.height / layout.height;
  context.fillStyle = "black";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "lighten";
  let slice = performance.now();
  const yieldWork = async () => {
    if (performance.now() - slice > 2) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      slice = performance.now();
    }
  };
  for (const light of layout.lights) {
    const x0 = Math.floor((light.x - light.reach) * sx),
      y0 = Math.floor((light.y - light.reach / 2) * sy);
    pool.width = Math.max(1, Math.ceil(light.reach * 2 * sx) + 2);
    pool.height = Math.max(1, Math.ceil(light.reach * sy) + 2);
    stamp.setTransform(
      light.reach * sx,
      0,
      0,
      (light.reach * sy) / 2,
      light.x * sx - x0,
      light.y * sy - y0,
    );
    const gradient = stamp.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [position, weight] of [
      [0, 0.98],
      [0.1, 0.86],
      [0.25, 0.45],
      [0.5, 0.1],
      [0.75, 0.025],
      [1, 0],
    ]) {
      const rgb = light.color.map((c) =>
        Math.round(Math.max(0, Math.min(1, c * weight! * light.intensity)) * 255),
      );
      gradient.addColorStop(position!, `rgb(${rgb.join(",")})`);
    }
    stamp.fillStyle = gradient;
    stamp.globalCompositeOperation = "source-over";
    stamp.fillRect(-1, -1, 2, 2);
    stamp.setTransform(sx, 0, 0, sy, -x0, -y0);
    if (light.direction && Math.hypot(light.direction.x, light.direction.y * 2) > 0.1) {
      const n = Math.hypot(light.direction.x, light.direction.y * 2),
        dx = (light.direction.x / n) * light.reach,
        dy = (light.direction.y / n) * light.reach;
      const gate = stamp.createLinearGradient(
        light.x - dx,
        light.y - dy,
        light.x + dx,
        light.y + dy,
      );
      gate.addColorStop(0, "rgba(255,255,255,0.04)");
      gate.addColorStop(0.42, "rgba(255,255,255,0.2)");
      gate.addColorStop(0.57, "white");
      gate.addColorStop(1, "white");
      stamp.globalCompositeOperation = "destination-in";
      stamp.fillStyle = gate;
      stamp.fillRect(
        light.x - light.reach,
        light.y - light.reach / 2,
        light.reach * 2,
        light.reach,
      );
    }
    stamp.globalCompositeOperation = "destination-out";
    stamp.fillStyle = "black";
    for (const blocker of layout.blockers) {
      if (light.owner && light.owner === blocker.owner) continue;
      if (
        blocker.points.every((p) => p.x < light.x - light.reach) ||
        blocker.points.every((p) => p.x > light.x + light.reach) ||
        blocker.points.every((p) => p.y < light.y - light.reach / 2) ||
        blocker.points.every((p) => p.y > light.y + light.reach / 2)
      )
        continue;
      const polygon = lightOcclusionPolygon(light, blocker);
      stamp.beginPath();
      for (const [i, p] of polygon.entries())
        if (i) stamp.lineTo(p.x, p.y);
        else stamp.moveTo(p.x, p.y);
      stamp.closePath();
      stamp.fill();
      await yieldWork();
    }
    context.drawImage(pool, x0, y0);
    await yieldWork();
  }
  // The existing RGBA sample carries fixture eligibility separately from colored ground irradiance.
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const maskContext = mask.getContext("2d");
  if (!maskContext) return Texture.EMPTY;
  for (const light of layout.lights) {
    const e = light.emission;
    if (!e || !(e.radius > 0)) continue;
    maskContext.setTransform(e.radius * sx, 0, 0, e.radius * sy, e.x * sx, e.y * sy);
    const gradient = maskContext.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, "white");
    gradient.addColorStop(0.5, "white");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    maskContext.fillStyle = gradient;
    maskContext.fillRect(-1, -1, 2, 2);
    await yieldWork();
  }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const eligibility = maskContext.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = eligibility[i] ?? 0;
  return createFieldTexture(pixels, canvas.width, canvas.height);
};

const convexHull = (points: readonly Point[]) => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y),
    cross = (a: Point, b: Point, c: Point) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

type Point = { x: number; y: number };
type BakedField = { image: string; width: number; height: number };
export type VillageLightBlocker = {
  points: readonly Point[];
  height: number;
  owner?: VillageLight["owner"];
};
export type VillageLightField = { texture: Texture; bounds: WorldBounds };
type LightLayout = {
  width: number;
  height: number;
  lights: {
    x: number;
    y: number;
    height: number;
    reach: number;
    color: readonly number[];
    intensity: number;
    direction?: Point;
    emission?: { x: number; y: number; radius: number };
    owner: string | null;
  }[];
  blockers: { points: Point[]; height: number; owner: string | null }[];
};
