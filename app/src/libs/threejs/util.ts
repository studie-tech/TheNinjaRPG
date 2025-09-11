import { TextureLoader, Texture, SRGBColorSpace } from "three";

// Simple in-memory cache for textures to avoid re-fetching
const textureLoader = new TextureLoader();
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
  const texture = textureLoader.load(path);
  texture.colorSpace = SRGBColorSpace;
  textureCache.set(path, texture);
  return texture;
};

/**
 * Preload a set of texture URLs into memory so they are instantly available.
 */
export const preloadTextures = async (paths: string[]) => {
  const uniquePaths = [...new Set(paths.filter((p) => Boolean(p)))];
  await Promise.all(
    uniquePaths.map((path) => {
      // Already cached → nothing to do
      if (textureCache.has(path)) return Promise.resolve(textureCache.get(path)!);
      // Already loading → reuse promise
      const existing = pendingLoads.get(path);
      if (existing) return existing;

      // Begin loading and cache both the Texture and the pending Promise
      const promise = new Promise<Texture>((resolve, reject) => {
        try {
          const tex = textureLoader.load(
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
};

/**
 * Create texture from canvas
 */
export const createTexture = (canvas: HTMLCanvasElement) => {
  const texture = new Texture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};
