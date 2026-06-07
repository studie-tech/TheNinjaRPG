"use client";

import { useState } from "react";
import Image from "@/layout/Image";
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
      <Image
        className="fixed z-[-1] select-none object-contain md:top-0 md:left-0 md:h-full md:w-full md:object-cover"
        src={imageset.wallpaper}
        width={1600}
        height={800}
        alt="wallpaper"
        loading="eager"
        priority
        unoptimized
      />
    );
  }

  return (
    <>
      <Image
        className={cn(
          "fixed top-0 left-0 z-[-1] h-full w-full select-none object-cover brightness-[0.82] saturate-125 transition-opacity duration-700 ease-out",
          isAnonymousLayout && "brightness-[0.68]",
          userData && isUserWallpaperLoaded ? "opacity-0" : "opacity-100",
        )}
        src={PIXEL_FALLBACK_WALLPAPER}
        width={1600}
        height={800}
        alt=""
        loading="eager"
        priority
        unoptimized
        aria-hidden="true"
      />
      {userData && (
        <Image
          className={cn(
            "fixed top-0 left-0 z-[-1] h-full w-full select-none object-cover brightness-[0.82] saturate-125 transition-opacity duration-700 ease-out",
            isUserWallpaperLoaded ? "opacity-100" : "opacity-0",
          )}
          src={pixelWallpaper}
          width={1600}
          height={800}
          alt="wallpaper"
          loading="eager"
          unoptimized
          onLoad={() => setLoadedWallpaper(pixelWallpaper)}
        />
      )}
    </>
  );
};
