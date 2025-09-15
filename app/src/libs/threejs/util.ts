import { TextureLoader, Texture, SRGBColorSpace } from "three";

// Simple in-memory cache for textures to avoid re-fetching
let textureLoaderInstance: TextureLoader | null = null;

/**
 * Lazily get a module-scoped TextureLoader instance.
 * Throws on SSR to avoid accessing window during server rendering.
 */
export const getTextureLoader = (): TextureLoader => {
  if (typeof window === "undefined") {
    throw new Error("TextureLoader is only available in the browser runtime");
  }
  if (textureLoaderInstance) return textureLoaderInstance;
  textureLoaderInstance = new TextureLoader();
  return textureLoaderInstance;
};
const textureCache = new Map<string, Texture>();
const pendingLoads = new Map<string, Promise<Texture>>();

/**
 * Load texture from file
 */
export const loadTexture = (path: string) => {
  // Return cached texture if available
  const cached = textureCache.get(path);
  if (cached) return cached;

  // Start load immediately and cache the Texture instance
  const texture = getTextureLoader().load(path);
  texture.colorSpace = SRGBColorSpace;
  textureCache.set(path, texture);
  return texture;
};

/**
 * Preload a set of texture URLs into memory so they are instantly available.
 */
export const preloadTextures = async (paths: string[]) => {
  const uniquePaths = [...new Set(paths.filter((p) => Boolean(p)))];
  const results = await Promise.allSettled(
    uniquePaths.map((path) => {
      // Already cached → nothing to do
      if (textureCache.has(path)) return Promise.resolve(textureCache.get(path)!);
      // Already loading → reuse promise
      const existing = pendingLoads.get(path);
      if (existing) return existing;
      // Begin loading and cache both the Texture and the pending Promise
      const promise = new Promise<Texture>((resolve, reject) => {
        try {
          const tex = getTextureLoader().load(
            path,
            () => resolve(tex),
            undefined,
            () => reject(new Error(`Failed to load texture: ${path}`)),
          );
          tex.colorSpace = SRGBColorSpace;
          textureCache.set(path, tex);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })
        .catch((err) => {
          // Normalize to Error type to satisfy linters and callers
          throw err instanceof Error ? err : new Error(String(err));
        })
        .finally(() => pendingLoads.delete(path));

      pendingLoads.set(path, promise);
      return promise;
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    // Non-blocking: surface in logs for diagnostics
    // eslint-disable-next-line no-console
    console.warn(`preloadTextures: ${failed.length} texture(s) failed`);
  }
};

/**
 * Create texture from canvas
 */
export const createTexture = (canvas: HTMLCanvasElement) => {
  const texture = new Texture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};
