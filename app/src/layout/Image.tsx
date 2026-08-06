"use client";

import type { ImageProps } from "next/image";
import NextImage from "next/image";

/**
 * Bunny pull zones that front our images. Only these understand the optimizer query
 * parameters below — appending them to anything else (local /public assets, GitHub
 * avatars, S3 objects) has no effect and simply splits the browser and CDN caches
 * across URLs that resolve to identical bytes.
 */
const BUNNY_CDN_HOSTS = ["uploadthing.b-cdn.net", "tnr-storage-cdn.b-cdn.net"];

const isBunnyCdnUrl = (url: string) => {
  try {
    // Matched on the parsed hostname rather than a substring: "uploadthing.b-cdn.net"
    // also appears inside URLs such as https://example.org/?ref=uploadthing.b-cdn.net.
    return BUNNY_CDN_HOSTS.includes(new URL(url).hostname);
  } catch {
    // Relative paths (local /public assets) are never Bunny-hosted.
    return false;
  }
};

/**
 * bunnyImageUrl
 * - Requests a specific rendition width from Bunny's optimizer
 *
 * Returns the URL untouched when it is not Bunny-hosted or already carries its own
 * parameters, so it is safe to call on any source.
 * @param src - Image URL
 * @param width - Desired rendition width in pixels
 */
export const bunnyImageUrl = (src: string, width: number) => {
  const transformed = transformImageUrl(src);
  if (typeof transformed !== "string") return src;
  if (!isBunnyCdnUrl(transformed) || transformed.includes("?")) return transformed;
  return `${transformed}?width=${width}`;
};

/**
 * Transforms image URLs to use the CDN endpoint.
 * Replaces "utfs.io" or "ui0arpl8sm.ufs.sh" with "uploadthing.b-cdn.net"
 */
export const transformImageUrl = (src: ImageProps["src"]): ImageProps["src"] => {
  if (typeof src === "string") {
    return src
      .replace(/utfs\.io/g, "uploadthing.b-cdn.net")
      .replace(/ui0arpl8sm\.ufs\.sh/g, "uploadthing.b-cdn.net");
  }
  return src;
};

/**
 * Custom Image component that extends Next.js Image.
 *
 * Routes UploadThing URLs through the CDN and asks Bunny's optimizer for an
 * appropriately sized rendition. Notes on the parameters:
 * - Only `width` is sent. Bunny preserves the aspect ratio, so adding `height` returns
 *   byte-identical responses while doubling the number of distinct URLs the cache holds.
 * - `quality` is deliberately omitted: Bunny's own default measured smaller than any
 *   explicit value we tried (200px wide: default 7.8KB, quality=85 9.2KB, quality=75 8.0KB).
 * - Requiring only `width` rather than width *and* height widens how many images get a
 *   resized rendition at all.
 */
const Image: React.FC<ImageProps> = ({ src, ...props }) => {
  // Transform for CDN optimization & caching
  let transformedSrc = transformImageUrl(src);
  if (
    typeof transformedSrc === "string" &&
    props.width &&
    isBunnyCdnUrl(transformedSrc) &&
    // Some constants already carry their own optimizer parameters.
    !transformedSrc.includes("?")
  ) {
    transformedSrc = `${transformedSrc}?width=${props.width}`;
  }
  return <NextImage src={transformedSrc} {...props} />;
};

export default Image;
