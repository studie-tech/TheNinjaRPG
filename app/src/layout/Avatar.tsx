"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
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
 * width. Until mounted it reports the full rendition so the server render and
 * the first client render agree; the preference lives in localStorage.
 */
export const useAvatarRenditionWidth = (size: number) => {
  const [lightLayout] = useLocalStorage<boolean>("lightLayout", false);
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  return avatarRenditionWidth(size, isMounted && lightLayout);
};

interface AvatarImageProps {
  href?: string | null;
  userId?: string;
  alt?: string;
  size: number;
  priority?: boolean;
  hover_effect?: boolean;
  refetchUserData?: boolean;
  className?: string;
}

/**
 * Sizing shared by the placeholder and the loaded avatar. The two states must resolve to
 * the same box: the placeholder used to omit `max-w-80`, so in any container wider than
 * 384px it rendered wider (and, being square, taller) than the image that replaced it,
 * shifting everything below it once the avatar arrived.
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
          "background-animate bg-linear-to-r from-slate-500 to-slate-400 opacity-20",
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
