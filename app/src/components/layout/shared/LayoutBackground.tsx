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
 * Wallpapers are authored at 1600x800 but cover the whole viewport, so a phone was
 * downloading roughly four times the pixels it can show — and this is the largest
 * contentful paint on most pages. next/image cannot emit a srcSet while
 * images.unoptimized is set, so the renditions are selected here with <picture> media
 * queries and produced by Bunny's optimizer.
 */
const WALLPAPER_WIDTHS = { mobile: 828, tablet: 1280, full: 1600 } as const;

/**
 * The same three renditions the <picture> below selects between, as preload hints.
 *
 * The wallpaper is the largest contentful paint on most pages, and marking it eager and
 * high priority only reorders it against other work the browser has already found -- the
 * browser cannot start it until the parser reaches the body. Search Console reported
 * every LCP group at 4.0s, so the fetch is moved into <head>.
 *
 * The media queries have to be mutually exclusive, unlike the <source> ones, which rely
 * on first-match: a preload keyed to `(max-width: 1279px)` would also match a phone and
 * pull down a second copy of an image the page never shows. They also have to leave no
 * gap, or a viewport that lands in one preloads nothing. Hence the .02px lower bounds
 * rather than the +1px that reads more naturally -- viewport widths are fractional under
 * browser zoom and on some devices, and `(min-width: 769px)` skips 768.5 while the
 * <source> above still resolves it to the tablet rendition.
 */
const WALLPAPER_PRELOADS = [
  { media: "(max-width: 768px)", width: WALLPAPER_WIDTHS.mobile },
  {
    media: "(min-width: 768.02px) and (max-width: 1279px)",
    width: WALLPAPER_WIDTHS.tablet,
  },
  { media: "(min-width: 1279.02px)", width: WALLPAPER_WIDTHS.full },
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
        media="(max-width: 768px)"
        srcSet={bunnyImageUrl(src, WALLPAPER_WIDTHS.mobile)}
      />
      <source
        media="(max-width: 1279px)"
        srcSet={bunnyImageUrl(src, WALLPAPER_WIDTHS.tablet)}
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
