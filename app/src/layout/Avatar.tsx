"use client";

import type React from "react";
import { useLightLayout } from "@/hooks/light-layout";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";

/**
 * CDN rendition width requested for avatars in the full layout. Avatars render
 * at up to 320px wide (`max-w-80`), so the full layout requests that maximum
 * directly. Sources smaller than the request (e.g. 64px thumbnails) are
 * served as-is, so they are unaffected.
 */
export const AVATAR_FULL_WIDTH = 320;

/**
 * CDN rendition width for an avatar displayed at `size` pixels: the requested
 * size in the light layout (performance mode), otherwise the shared
 * high-resolution rendition.
 */
export const avatarRenditionWidth = (size: number, lightLayout: boolean) =>
  lightLayout ? size : AVATAR_FULL_WIDTH;

/**
 * Reads the user's light layout preference and returns the avatar rendition
 * width. Server-rendered avatars hydrate with the full rendition; client-only
 * mounts read the saved preference immediately to avoid fetching both sizes.
 */
export const useAvatarRenditionWidth = (size: number) => {
  const lightLayout = useLightLayout();
  return avatarRenditionWidth(size, lightLayout);
};

interface AvatarImageProps {
  href?: string | null;
  alt?: string;
  size: number;
  /** Reserve preloading for a prominent portrait, rather than repeated list rows. */
  priority?: boolean;
  hover_effect?: boolean;
  className?: string;
}

/**
 * Sizing shared by the placeholder and the loaded avatar, so both resolve to the same box
 * and the image's arrival causes no layout shift.
 */
const AVATAR_BOX =
  "relative max-w-80 m-auto w-5/6 aspect-square rounded-2xl border-2 border-black";

const AvatarImage: React.FC<AvatarImageProps> = (props) => {
  const renditionWidth = useAvatarRenditionWidth(props.size);
  // If no href, show loader, otherwise show avatar
  if (!props.href) {
    return (
      <div
        className={cn(
          AVATAR_BOX,
          // An opacity pulse runs on the compositor; a moving gradient repaints the page every frame.
          "animate-placeholder-pulse bg-linear-to-r from-slate-500 to-slate-400 opacity-20",
          props.className,
        )}
      ></div>
    );
  } else {
    const hover = props.hover_effect ? "hover:border-amber-500 hover:opacity-80" : "";
    return (
      <Image
        className={cn(AVATAR_BOX, hover, props.className)}
        src={props.href}
        alt={`${props.alt || "unknown"} AvatarImage`}
        width={renditionWidth}
        height={renditionWidth}
        priority={props.priority}
        loading={props.priority ? "eager" : "lazy"}
        unoptimized={true}
      />
    );
  }
};

export default AvatarImage;
