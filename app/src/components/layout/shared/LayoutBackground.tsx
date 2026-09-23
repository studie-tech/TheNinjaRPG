"use client";

import { useState } from "react";
import ReactDOM from "react-dom";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
import { bunnyImageUrl } from "@/utils/image";
import {
  getImageSet,
  getPixelWallpaper,
  type LayoutVariant,
  PIXEL_FALLBACK_WALLPAPER,
} from "./layoutVariants";

interface LayoutBackgroundProps {
  variant: LayoutVariant;
  userData?: UserWithRelations | null;
  isAnonymousLayout?: boolean;
}

/**
 * Wallpapers cover the whole viewport, so a phone was downloading several times the
 * pixels it can show — and this is the largest contentful paint on most pages.
 * next/image cannot emit a srcSet while images.unoptimized is set, so the renditions are
 * selected here with <picture> media queries and produced by Bunny's optimizer.
 *
 * Two renditions, not three: Bunny re-encodes at quality 85, above what these files were
 * authored at, so a rendition narrower than the source is larger than the source itself
 * (fall: 137,670 B at width=1280, worst at 143,442 B at width=1342, against 94,994 B
 * untouched). Bunny passes the original through once the requested width reaches the
 * source width, so `full` has to stay at or above the widest source — currently 1343px,
 * except summer at 1594px. An intermediate tablet width sits below that cliff by
 * definition and costs bytes and resolution at once.
 */
const WALLPAPER_WIDTHS = { mobile: 828, full: 1600 } as const;

/**
 * The same two renditions the <picture> below selects between, as preload hints.
 *
 * The wallpaper is the largest contentful paint on most pages, and marking it eager and
 * high priority only reorders it against other work the browser has already found -- the
 * browser cannot start it until the parser reaches the body. Search Console reported
 * every LCP group at 4.0s, so the fetch is moved into <head>.
 *
 * Both queries are written from one breakpoint, the second as the exact complement of the
 * first, so they cannot overlap (which would preload an image the page never shows) and
 * cannot leave a gap (which would leave a viewport with no preload at all). Spelling the
 * second bound out as a number instead would do both at fractional viewport widths, which
 * occur under browser zoom and on some devices.
 */
const WALLPAPER_MOBILE_MEDIA = "(max-width: 768px)";

const WALLPAPER_PRELOADS = [
  { media: WALLPAPER_MOBILE_MEDIA, width: WALLPAPER_WIDTHS.mobile },
  { media: `not all and ${WALLPAPER_MOBILE_MEDIA}`, width: WALLPAPER_WIDTHS.full },
] as const;

interface WallpaperProps {
  src: string;
  className: string;
  alt: string;
  priority?: boolean;
  ariaHidden?: boolean;
  onLoad?: () => void;
}

const Wallpaper: React.FC<WallpaperProps> = ({
  src,
  className,
  alt,
  priority,
  ariaHidden,
  onLoad,
}) => {
  // Only the priority layer is the LCP candidate. The user's own wallpaper fades in over
  // it and must not compete with it for bandwidth.
  if (priority) {
    for (const { media, width } of WALLPAPER_PRELOADS) {
      ReactDOM.preload(bunnyImageUrl(src, width), {
        as: "image",
        media,
        fetchPriority: "high",
      });
    }
  }
  return (
    <picture>
      <source
        media={WALLPAPER_MOBILE_MEDIA}
        srcSet={bunnyImageUrl(src, WALLPAPER_WIDTHS.mobile)}
      />
      <img
        className={className}
        src={bunnyImageUrl(src, WALLPAPER_WIDTHS.full)}
        width={1600}
        height={800}
        alt={alt}
        loading="eager"
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        aria-hidden={ariaHidden}
        onLoad={onLoad}
      />
    </picture>
  );
};

export const LayoutBackground: React.FC<LayoutBackgroundProps> = ({
  variant,
  userData,
  isAnonymousLayout = false,
}) => {
  const [loadedWallpaper, setLoadedWallpaper] = useState<string | null>(null);
  const imageset = getImageSet(userData);
  const pixelWallpaper = getPixelWallpaper(userData);
  const isUserWallpaperLoaded = loadedWallpaper === pixelWallpaper;

  // All three layers are decorative backdrops rather than content, so they carry an
  // empty alt and are hidden from assistive technology.
  if (variant === "beta") {
    return (
      <Wallpaper
        className="fixed z-[-1] select-none object-contain md:top-0 md:left-0 md:h-full md:w-full md:object-cover"
        src={imageset.wallpaper}
        alt=""
        priority
        ariaHidden
      />
    );
  }

  return (
    <>
      <Wallpaper
        className={cn(
          "fixed top-0 left-0 z-[-1] h-full w-full select-none object-cover brightness-[0.82] saturate-125 transition-opacity duration-700 ease-out",
          isAnonymousLayout && "brightness-[0.68]",
          userData && isUserWallpaperLoaded ? "opacity-0" : "opacity-100",
        )}
        src={PIXEL_FALLBACK_WALLPAPER}
        alt=""
        priority
        ariaHidden
      />
      {userData && (
        <Wallpaper
          className={cn(
            "fixed top-0 left-0 z-[-1] h-full w-full select-none object-cover brightness-[0.82] saturate-125 transition-opacity duration-700 ease-out",
            isUserWallpaperLoaded ? "opacity-100" : "opacity-0",
          )}
          src={pixelWallpaper}
          alt=""
          ariaHidden
          onLoad={() => setLoadedWallpaper(pixelWallpaper)}
        />
      )}
    </>
  );
};
