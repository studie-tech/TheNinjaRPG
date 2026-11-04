/** Bunny pull zones that support the image optimizer query parameters. */
const BUNNY_CDN_HOSTS = ["uploadthing.b-cdn.net", "tnr-storage-cdn.b-cdn.net"];
const LEGACY_UPLOADTHING_HOSTS = ["utfs.io", "ui0arpl8sm.ufs.sh"];

export const isBunnyCdnUrl = (url: string) => {
  try {
    return BUNNY_CDN_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Routes legacy UploadThing hostnames through the Bunny pull zone. */
export const transformImageUrl = (src: string) => {
  try {
    const url = new URL(src);
    if (LEGACY_UPLOADTHING_HOSTS.includes(url.hostname)) {
      url.hostname = "uploadthing.b-cdn.net";
      return url.toString();
    }
  } catch {
    // Relative and otherwise non-URL sources are left unchanged.
  }
  return src;
};

/** Requests a Bunny rendition width, forcing detection for extensionless uploads. */
export const bunnyImageUrl = (src: string, width: number) => {
  const transformed = transformImageUrl(src);
  if (!isBunnyCdnUrl(transformed) || !Number.isFinite(width) || width <= 0) {
    return transformed;
  }

  const url = new URL(transformed);
  url.searchParams.set("width", String(Math.round(width)));
  if (!/\.[a-z0-9]+$/i.test(url.pathname)) {
    url.searchParams.set("optimizer", "image");
  }
  return url.toString();
};

/**
 * Game texture URL: host rewrite plus an optional Bunny width.
 * Zero skips rendition parameters; packed atlases use raw keys to bypass the optimizer.
 * Omit `optimizer=image`: forcing optimization of extensionless UploadThing keys
 * can cache renditions incompatible with travel-map portraits.
 */
export const textureImageUrl = (src: string, width = 50) => {
  const transformed = transformImageUrl(src);
  if (!isBunnyCdnUrl(transformed) || !Number.isFinite(width) || width <= 0) {
    return transformed;
  }
  const url = new URL(transformed);
  url.searchParams.set("width", String(Math.round(width)));
  return url.toString();
};

/**
 * Read original dimensions in the browser without recompressing uploads. Unreadable
 * files reject with user-facing feedback; both outcomes release the temporary object URL.
 */
export const getImageDimensions = (
  file: File,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read this image. Please choose another file."));
    };
    image.src = url;
  });
