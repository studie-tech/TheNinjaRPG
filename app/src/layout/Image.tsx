"use client";

import type { ImageProps } from "next/image";
import NextImage from "next/image";
import { bunnyImageUrl, transformImageUrl } from "@/utils/image";

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
 * - Extensionless UploadThing files receive Bunny's `optimizer=image` detection hint;
 *   without it, Bunny caches a distinct URL but returns the full-size original.
 */
const Image: React.FC<ImageProps> = ({ src, ...props }) => {
  const transformedSrc =
    typeof src === "string"
      ? props.width
        ? bunnyImageUrl(src, Number(props.width))
        : transformImageUrl(src)
      : src;
  return <NextImage src={transformedSrc} {...props} />;
};

export default Image;
