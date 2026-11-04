import { Assets, Rectangle, type Texture } from "pixi.js";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import { worldAssetSource } from "@/libs/rendering/worldAssetSources";
import { textureImageUrl } from "@/utils/image";

const IDLE_TEXTURE_BUDGET = 16 * 1024 * 1024;
const textures = createLeaseCache<Texture>({
  load: (url) =>
    Assets.load<Texture>({
      src: url,
      // SVG textures need rasterization; createImageBitmap only decodes raster images.
      parser:
        /\.svg(?:[?#]|$)/i.test(url) || url.startsWith("data:image/svg+xml")
          ? "loadSVG"
          : "loadTextures",
      data: { scaleMode: url.endsWith("#tnr-nearest") ? "nearest" : "linear" },
    }).then(stabilizeNearestTexture),
  unload: (url) => Assets.unload(url),
  bytes: (texture) => texture.source.pixelWidth * texture.source.pixelHeight * 4,
  idleBudget: IDLE_TEXTURE_BUDGET,
});

/** A sub-texel UV bias resolves Float32 interpolation ties; below 0.016 source pixels at 16K. */
export const NEAREST_TEXTURE_UV_BIAS = 2 ** -20;

/**
 * Keep nearest-sampled artwork free of internal pixel bands at fractional positions/zoom.
 * Bias only UVs: canonical frame/orig/trim metadata must still identify authored materials and bakes.
 * Recomputing first makes this idempotent; linear textures retain their original sampling.
 */
export const stabilizeNearestTexture = (texture: Texture) => {
  if (texture.source.style.scaleMode !== "nearest") return texture;
  texture.updateUvs();
  for (const corner of [0, 1, 2, 3] as const) {
    texture.uvs[`x${corner}`] += NEAREST_TEXTURE_UV_BIAS;
    texture.uvs[`y${corner}`] += NEAREST_TEXTURE_UV_BIAS;
  }
  return texture;
};

/**
 * Scene leases share decoded images; callers must not destroy returned textures/sources.
 * Dispose releases leases, including pending loads, while the shared cache retains bounded idle art.
 */
export const createSceneAssets = () => {
  const owned = new Map<string, ReturnType<typeof textures.acquire>>();
  const leases = new Set<() => void>();
  const textureKey = (path: string, width: number, sampling: "linear" | "nearest") => {
    const published = worldAssetSource(path);
    const source = textureImageUrl(published?.image ?? path, published ? 0 : width);
    return sampling === "nearest" ? `${source.split("#")[0]}#tnr-nearest` : source;
  };
  let disposed = false;
  return {
    /** Positive widths request a CDN rendition; zero preserves the exact native source URL. */
    texture: (path: string, width = 50, sampling: "linear" | "nearest" = "linear") => {
      if (disposed) return Promise.reject(new Error("Scene assets are disposed"));
      // Sampling is immutable for a shared source; nearest art owns a separate decoded source.
      const url = textureKey(path, width, sampling);
      const existing = owned.get(url);
      if (existing) return existing.resource;
      const entry = textures.acquire(url);
      owned.set(url, entry);
      return entry.resource;
    },
    /** Derived atlas views hold independent leases even when several frames share one image page. */
    acquireTexture: (
      path: string,
      width = 50,
      sampling: "linear" | "nearest" = "linear",
    ) => {
      if (disposed)
        return {
          resource: Promise.reject<Texture>(new Error("Scene assets are disposed")),
          release: () => {},
        };
      const lease = textures.acquire(textureKey(path, width, sampling));
      const release = () => {
        lease.release();
        leases.delete(release);
      };
      leases.add(release);
      return { resource: lease.resource, release };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of owned.values()) entry.release();
      owned.clear();
      for (const release of leases) release();
    },
  };
};

export type SceneAssets = ReturnType<typeof createSceneAssets>;

/** Reads decoded RGBA data for material sampling and sprite contact bounds. */
export const readTexturePixels = (texture: Texture, width: number, height: number) => {
  const resource = texture.source.resource;
  if (resource instanceof Uint8Array && resource.length === width * height * 4)
    return resource.slice();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cannot read world texture data");
  context.drawImage(resource as CanvasImageSource, 0, 0, width, height);
  return new Uint8Array(context.getImageData(0, 0, width, height).data);
};

const opaqueFrames = new WeakMap<Texture, Rectangle>();

/** Character cutouts use their visible bounds as ground, without retaining a second pixel buffer. */
export const textureOpaqueFrame = (texture: Texture) => {
  const cached = opaqueFrames.get(texture);
  if (cached) return cached;
  const frame = texture.frame;
  let result = frame;
  try {
    const width = texture.source.pixelWidth,
      pixels = readTexturePixels(texture, width, texture.source.pixelHeight);
    let minX = frame.right,
      minY = frame.bottom,
      maxX = -1,
      maxY = -1;
    for (let y = frame.y; y < frame.bottom; y++)
      for (let x = frame.x; x < frame.right; x++)
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
    if (maxX >= minX && maxY >= minY)
      result = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
  } catch {
    // Unreadable artwork remains visible with its full-frame contact point.
  }
  opaqueFrames.set(texture, result);
  return result;
};
