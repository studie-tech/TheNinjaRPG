"use client";

import { useState } from "react";
import { bunnyImageUrl } from "@/layout/Image";
import { cn } from "@/libs/shadui";
import type { UserWithRelations } from "@/routers/profile";
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
}) => (
  <picture>
    <source
      media="(max-width: 768px)"
      srcSet={bunnyImageUrl(src, WALLPAPER_WIDTHS.mobile)}
    />
    <source
      media="(max-width: 1279px)"
      srcSet={bunnyImageUrl(src, WALLPAPER_WIDTHS.tablet)}
    />
    {/* biome-ignore lint/performance/noImgElement: <picture> art direction is what selects the Bunny rendition here */}
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

export const LayoutBackground: React.FC<LayoutBackgroundProps> = ({
  variant,
  userData,
  isAnonymousLayout = false,
}) => {
  const [loadedWallpaper, setLoadedWallpaper] = useState<string | null>(null);
  const imageset = getImageSet(userData);
  const pixelWallpaper = getPixelWallpaper(userData);
  const isUserWallpaperLoaded = loadedWallpaper === pixelWallpaper;

  if (variant === "beta") {
    return (
      <Wallpaper
        className="fixed z-[-1] select-none object-contain md:top-0 md:left-0 md:h-full md:w-full md:object-cover"
        src={imageset.wallpaper}
        alt="wallpaper"
        priority
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
          alt="wallpaper"
          onLoad={() => setLoadedWallpaper(pixelWallpaper)}
        />
      )}
    </>
  );
};
