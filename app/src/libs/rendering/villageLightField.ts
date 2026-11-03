import { BufferImageSource, Texture } from "pixi.js";
import type { VillageLight } from "@/libs/rendering/bakedVillageLighting";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import type { WorldBounds } from "@/libs/rendering/visibility";

const fields = new Map<string, Texture>();
const cache = createLeaseCache<Texture>({
  load: async (key) => {
    const layout = JSON.parse(key) as LightLayout;
    const texture = await rasterize(layout);
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
  const lease = cache.acquire(JSON.stringify(layout));
  return {
    resource: lease.resource.then((texture) => ({ texture, bounds })),
    release: lease.release,
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
  const texture = new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: canvas.width,
      height: canvas.height,
      format: "rgba8unorm",
      alphaMode: "no-premultiply-alpha",
      scaleMode: "linear",
    }),
  });
  return texture;
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
