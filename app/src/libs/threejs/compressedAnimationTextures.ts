import { RGBA_ETC2_EAC_Format, SRGBColorSpace, type WebGLRenderer } from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import variants from "./animationTextureVariants.json";

let loader: KTX2Loader | undefined;
const urls: Record<string, string> = variants;

/**
 * Load only published native ETC2 renditions keyed by exact source/grid/cell size.
 * Native KTX2 bypasses Basis transcoding and its workers. This entire module is
 * imported only for eligible animated actors; unknown sheets return to WebP.
 */
export const loadCompressedAnimationTexture = async (
  key: string,
  renderer: WebGLRenderer,
  width: number,
  height: number,
) => {
  const url = urls[key];
  if (!url) return undefined;
  loader ??= new KTX2Loader().detectSupport(renderer);
  const texture = await loader.loadAsync(url);
  if (
    texture.format !== RGBA_ETC2_EAC_Format ||
    texture.colorSpace !== SRGBColorSpace ||
    texture.image.width !== width ||
    texture.image.height !== height ||
    texture.mipmaps.length !== 1
  ) {
    texture.dispose();
    throw new Error("Invalid compressed animation rendition");
  }
  return texture;
};
