import { Texture } from "pixi.js";
import type { VillageLight } from "@/libs/rendering/bakedVillageLighting";
import type { WorldBounds } from "@/libs/rendering/visibility";

/** Stationary village radiance is rasterized once; camera movement only changes its UV transform. */
export const createVillageLightField = (lights: readonly VillageLight[]) => {
  lights = lights.filter(
    (l) =>
      Number.isFinite(l.x) &&
      Number.isFinite(l.y) &&
      Number.isFinite(l.reach) &&
      l.reach > 0,
  );
  const bounds: WorldBounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const light of lights) {
    bounds.minX = Math.min(bounds.minX, light.x - light.reach);
    bounds.maxX = Math.max(bounds.maxX, light.x + light.reach);
    bounds.minY = Math.min(bounds.minY, light.y - light.reach / 2);
    bounds.maxY = Math.max(bounds.maxY, light.y + light.reach / 2);
  }
  if (!lights.length) return null;
  const width = bounds.maxX - bounds.minX,
    height = bounds.maxY - bounds.minY;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((768 * width) / Math.max(width, height)));
  canvas.height = Math.max(1, Math.round((768 * height) / Math.max(width, height)));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.globalCompositeOperation = "lighter";
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.2, "rgba(255,255,255,0.78)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.28)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  for (const light of lights) {
    const reach = light.reach * 0.78;
    context.setTransform(
      (reach * canvas.width) / width,
      0,
      0,
      (reach * canvas.height) / (2 * height),
      ((light.x - bounds.minX) * canvas.width) / width,
      ((light.y - bounds.minY) * canvas.height) / height,
    );
    context.fillRect(-1, -1, 2, 2);
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "linear";
  return { texture, bounds };
};

export type VillageLightField = NonNullable<ReturnType<typeof createVillageLightField>>;
