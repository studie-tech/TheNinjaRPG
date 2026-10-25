import { NearestFilter, SRGBColorSpace, Texture, type WebGLRenderer } from "three";
import { SPRITE_ANIMATION_LIMITS } from "@/drizzle/constants";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import { getTextureLoader } from "@/libs/threejs/util";
import { isBunnyCdnUrl, textureImageUrl } from "@/utils/image";

// Include pinned atlases in the budget; crowded battles fall back to static art.
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_SHEETS = 16;
const atlases = new Map<string, AnimationAtlas>();

/** Static-only mode releases decoded sheets while preserving the HTTP disk cache. */
export const clearUnusedAnimationTextures = () => {
  for (const [key, atlas] of atlases) {
    if (atlas.users) continue;
    disposeAtlas(atlas);
    atlases.delete(key);
  }
};

/** Request an exact cell width, rather than the CDN's default whole-image width. */
export const animationTextureUrl = (
  animation: CharacterAnimation,
  cellSize: number,
) => {
  const path = textureImageUrl(animation.url, animation.columns * cellSize);
  if (!isBunnyCdnUrl(path)) return path;
  const url = new URL(path);
  url.searchParams.set("height", String(animation.rows * cellSize));
  url.searchParams.set("format", "webp");
  url.searchParams.set("quality", "90");
  return url.toString();
};

/** External URLs can share an HTTP response with different grids and decode budgets. */
export const animationTextureKey = (
  animation: CharacterAnimation,
  cellSize: number,
  renderer?: WebGLRenderer,
) =>
  `${animation.columns}x${animation.rows}:${cellSize}:${animationTextureUrl(animation, cellSize)}${canUseEtc2(animation, cellSize, renderer) ? ":etc2" : ""}`;

/**
 * Share a pending/decoded atlas across actors. Pending and active sheets stay
 * pinned; unused sheets are evicted oldest-first before admitting another load.
 * Stable URLs leave compressed files in the browser's HTTP cache after eviction.
 */
export const acquireAnimationTexture = (
  animation: CharacterAnimation,
  cellSize: number,
  renderer?: WebGLRenderer,
) => {
  // Old battle snapshots may predate the editor's short-loop limits.
  if (
    animation.frameCount > SPRITE_ANIMATION_LIMITS.frames ||
    animation.columns * animation.rows > SPRITE_ANIMATION_LIMITS.cells ||
    animation.frameCount / animation.fps > SPRITE_ANIMATION_LIMITS.seconds
  )
    return undefined;
  const url = animationTextureUrl(animation, cellSize);
  const key = animationTextureKey(animation, cellSize, renderer);
  let entry = atlases.get(key);
  if (!entry) {
    const bytes = animation.columns * animation.rows * cellSize ** 2 * 4;
    if (bytes > MAX_BYTES) return undefined;
    let used = [...atlases.values()].reduce((total, atlas) => total + atlas.bytes, 0);
    for (const [key, atlas] of atlases) {
      if (used + bytes <= MAX_BYTES && atlases.size < MAX_SHEETS) break;
      if (atlas.users) continue;
      disposeAtlas(atlas);
      atlases.delete(key);
      used -= atlas.bytes;
    }
    if (used + bytes > MAX_BYTES || atlases.size >= MAX_SHEETS) return undefined;
    const owned: AnimationAtlas = { texture: new Texture(), bytes, users: 0 };
    entry = owned;
    atlases.set(key, owned);
    const loadWebp = () => {
      if (atlases.get(key) !== owned) return;
      owned.texture.dispose();
      owned.texture = getTextureLoader().load(
        url,
        (loaded) => {
          if (atlases.get(key) !== owned) {
            loaded.dispose();
            return;
          }
          // External URLs may ignore resizing. Never upload an oversized atlas to WebGL.
          const { width, height } = loaded.image;
          if (
            width * height * 4 > bytes ||
            width % animation.columns !== 0 ||
            height % animation.rows !== 0 ||
            width / animation.columns !== height / animation.rows
          ) {
            loaded.userData.failed = true;
            loaded.image = document.createElement("img");
            loaded.dispose();
          }
        },
        undefined,
        () => {
          owned.texture.userData.failed = true;
        },
      );
      configureAtlas(owned.texture);
    };
    if (renderer && canUseEtc2(animation, cellSize, renderer)) {
      // Keep the RGBA reservation so simultaneous WebP fallbacks fit the same budget.
      // Static art stays visible during decoding; a stalled decoder cannot hold an action forever.
      let settled = false;
      const fallback = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        loadWebp();
      };
      const timer = setTimeout(fallback, 8000);
      owned.cancel = () => {
        settled = true;
        clearTimeout(timer);
      };
      void import("./compressedAnimationTextures")
        .then((module) =>
          module.loadCompressedAnimationTexture(
            animationTextureKey(animation, cellSize),
            renderer,
            animation.columns * cellSize,
            animation.rows * cellSize,
          ),
        )
        .then((texture) => {
          if (!texture) {
            fallback();
            return;
          }
          if (settled || atlases.get(key) !== owned) {
            texture.dispose();
            return;
          }
          settled = true;
          clearTimeout(timer);
          configureAtlas(texture);
          owned.texture.dispose();
          owned.texture = texture;
        })
        .catch(fallback);
    } else loadWebp();
  }
  entry.users++;
  const owned = entry;
  return {
    // The ready compressed texture or ordinary WebP replaces an image-less pending texture.
    get texture() {
      return owned.texture;
    },
    release: () => {
      owned.users--;
      // Map insertion order is the eviction order, refreshed when a sheet becomes unused.
      atlases.delete(key);
      atlases.set(key, owned);
    },
  };
};

/**
 * Desktop Linux drivers may emulate ETC2; unsupported/unlisted devices keep WebP.
 * Compressed mipmaps cannot be resized to fit the renderer's texture limit.
 */
const canUseEtc2 = (
  animation: CharacterAnimation,
  cellSize: number,
  renderer: WebGLRenderer | undefined,
) =>
  (cellSize === 128 || cellSize === 256) &&
  typeof WebAssembly !== "undefined" &&
  !!renderer?.extensions.has("WEBGL_compressed_texture_etc") &&
  animation.columns * cellSize <= renderer.capabilities.maxTextureSize &&
  animation.rows * cellSize <= renderer.capabilities.maxTextureSize &&
  !(
    typeof navigator !== "undefined" &&
    /Linux/.test(navigator.platform) &&
    !/Android/.test(navigator.userAgent)
  );

/** Atlas sampling is identical for compressed and ordinary images, with actor-owned UVs. */
const configureAtlas = (texture: Texture) => {
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = NearestFilter;
};

/** Cancel a pending fallback and dispose late completions without reviving an evicted entry. */
const disposeAtlas = (atlas: AnimationAtlas) => {
  atlas.cancel?.();
  atlas.texture.dispose();
};

/** Reserve fallback RGBA storage even when the ready texture uses GPU compression. */
type AnimationAtlas = {
  texture: Texture;
  bytes: number;
  users: number;
  cancel?: () => void;
};
