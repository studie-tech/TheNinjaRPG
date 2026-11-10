import { Assets, Rectangle, type Sprite, Texture, type TextureSource } from "pixi.js";
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

const sourceFrames = new WeakMap<TextureSource, Map<string, Texture>>();

/**
 * One shared view per source rectangle. Every view listens to its source, and removing a
 * listener is linear in their number, so a sector of sprites each owning a view of one atlas
 * spent quadratic time being destroyed. Views live as long as their source, which destroys them.
 */
export const sharedFrameTexture = (
  source: TextureSource,
  frame: { x: number; y: number; width: number; height: number },
  orig?: { width: number; height: number },
  trim?: { x: number; y: number },
) => {
  let views = sourceFrames.get(source);
  if (!views) {
    const owned = new Map<string, Texture>();
    views = owned;
    sourceFrames.set(source, owned);
    source.once("destroy", () => {
      for (const texture of owned.values()) texture.destroy(false);
      owned.clear();
      sourceFrames.delete(source);
    });
  }
  const key = `${frame.x}:${frame.y}:${frame.width}:${frame.height}:${orig?.width ?? ""}:${orig?.height ?? ""}:${trim?.x ?? ""}:${trim?.y ?? ""}`;
  let texture = views.get(key);
  if (!texture) {
    texture = stabilizeNearestTexture(
      new Texture({
        source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        orig: orig && new Rectangle(0, 0, orig.width, orig.height),
        trim: trim && new Rectangle(trim.x, trim.y, frame.width, frame.height),
      }),
    );
    views.set(key, texture);
  }
  return texture;
};

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

const occupiedFrames = new WeakMap<Texture["source"], Map<string, OccupiedFrame>>();
const spriteContacts = new WeakMap<Sprite, { x: number; y: number }>();

/** Animated cells share one authored rest contact, so jumps keep their vertical motion. */
export const setSpriteGroundContact = (
  sprite: Sprite,
  contact?: { x: number; y: number },
) => {
  if (contact) spriteContacts.set(sprite, contact);
  else spriteContacts.delete(sprite);
};

export const spriteGroundContact = (sprite: Sprite) =>
  spriteContacts.get(sprite) ?? textureGroundContact(sprite.texture);

/** Read only the current cell; shadow preparation never decodes a full atlas per frame. */
export const readTextureFramePixels = (
  texture: Texture,
  maxSize = Number.POSITIVE_INFINITY,
) => {
  const { frame, source } = texture;
  const scale = Math.min(1, maxSize / Math.max(frame.width, frame.height));
  const width = Math.max(1, Math.round(frame.width * scale)),
    height = Math.max(1, Math.round(frame.height * scale));
  const resource: unknown = source.resource;
  if (resource instanceof Uint8Array) {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = frame.y + Math.floor(((y + 0.5) * frame.height) / height);
      for (let x = 0; x < width; x++) {
        const offset =
          (row * source.pixelWidth +
            frame.x +
            Math.floor(((x + 0.5) * frame.width) / width)) *
          4;
        pixels.set(resource.subarray(offset, offset + 4), (y * width + x) * 4);
      }
    }
    return pixels;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cannot read character frame data");
  context.imageSmoothingEnabled = false;
  context.drawImage(
    resource as CanvasImageSource,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    width,
    height,
  );
  return new Uint8Array(context.getImageData(0, 0, width, height).data);
};

/** Occupied source-pixel bounds are shared by atlas views; readPixels supplies full-source RGBA bytes. */
export const textureOpaqueFrame = (texture: Texture, readPixels?: () => Uint8Array) =>
  occupiedFrame(texture, readPixels).bounds;

/**
 * Returns the weighted center of the lowest solid row in untrimmed pixels, before sprite transforms.
 * Empty or unreadable art uses its frame's bottom center; readPixels supplies full-source RGBA bytes.
 */
export const textureGroundContact = (
  texture: Texture,
  readPixels?: () => Uint8Array,
) => {
  const { contact } = occupiedFrame(texture, readPixels);
  return {
    x: contact.x - texture.frame.x + (texture.trim?.x ?? 0),
    y: contact.y - texture.frame.y + (texture.trim?.y ?? 0),
  };
};

/** Cache bounds and solid-foot metadata by source/frame, without retaining decoded RGBA buffers. */
const occupiedFrame = (
  texture: Texture,
  readPixels?: () => Uint8Array,
): OccupiedFrame => {
  const frame = texture.frame;
  const key = `${frame.x}:${frame.y}:${frame.width}:${frame.height}`;
  let frames = occupiedFrames.get(texture.source);
  const cached = frames?.get(key);
  if (cached) return cached;
  let bounds = frame.clone();
  let contact = { x: frame.x + frame.width / 2, y: frame.bottom };
  try {
    const width = texture.source.pixelWidth,
      pixels =
        readPixels?.() ?? readTexturePixels(texture, width, texture.source.pixelHeight);
    let minX = frame.right,
      minY = frame.bottom,
      maxX = -1,
      maxY = -1;
    let footY = -1,
      footX = 0,
      footWeight = 0;
    // Atlas cuts can start between texels; sample integer pixels and clip the bounds to the view.
    for (let y = Math.floor(frame.y); y < Math.ceil(frame.bottom); y++)
      for (let x = Math.floor(frame.x); x < Math.ceil(frame.right); x++) {
        const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
        if (alpha > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        // Physical coverage uses the same half-alpha cutoff as the material/shadow passes.
        if (alpha >= 128) {
          if (y !== footY) {
            footY = y;
            footX = 0;
            footWeight = 0;
          }
          footX += (x + 0.5) * alpha;
          footWeight += alpha;
        }
      }
    if (maxX >= minX && maxY >= minY) {
      const x = Math.max(frame.x, minX),
        y = Math.max(frame.y, minY);
      bounds = new Rectangle(
        x,
        y,
        Math.min(frame.right, maxX + 1) - x,
        Math.min(frame.bottom, maxY + 1) - y,
      );
      contact = { x: bounds.x + bounds.width / 2, y: bounds.bottom };
    }
    if (footWeight > 0)
      contact = {
        x: Math.max(frame.x, Math.min(frame.right, footX / footWeight)),
        y: Math.min(frame.bottom, footY + 1),
      };
  } catch {
    // Unreadable artwork remains visible with its declared frame contact point.
  }
  const result = { bounds, contact };
  if (!frames) {
    frames = new Map();
    occupiedFrames.set(texture.source, frames);
  }
  frames.set(key, result);
  return result;
};

type OccupiedFrame = { bounds: Rectangle; contact: { x: number; y: number } };
