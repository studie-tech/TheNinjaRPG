"use client";

import { useEffect, useState } from "react";
import type { CharacterAnimation } from "@/libs/spriteAnimations";

/**
 * Preview the unchanged row-major atlas without cropping or resizing its source cells.
 * Key by sheet identity or draft metadata to reset frame and load-error state on edits.
 */
export const SpriteAnimationPreview = ({
  animation,
  className = "rounded-md border bg-muted",
}: {
  animation: CharacterAnimation;
  className?: string;
}) => {
  const [frame, setFrame] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % animation.frameCount),
      1000 / animation.fps,
    );
    return () => window.clearInterval(timer);
  }, [animation.frameCount, animation.fps]);
  return (
    <div
      className={`relative aspect-square overflow-hidden ${className}`}
      role="img"
      aria-label={animation.name}
    >
      {error ? (
        <p role="alert" className="p-3 text-sm">
          Sprite sheet could not be loaded. Check the image URL.
        </p>
      ) : (
        // biome-ignore lint/performance/noImgElement: Atlas UV previews must load the full unchanged sheet.
        <img
          src={animation.url}
          alt=""
          onError={() => setError(true)}
          className="absolute max-w-none"
          style={{
            width: `${animation.columns * 100}%`,
            height: `${animation.rows * 100}%`,
            left: `${-(frame % animation.columns) * 100}%`,
            top: `${-Math.floor(frame / animation.columns) * 100}%`,
            imageRendering: "pixelated",
          }}
        />
      )}
    </div>
  );
};

/** First frame only, from the smaller atlas, so a page of sheets stays cheap to show. */
export const SpriteSheetFrame = ({
  animation,
}: {
  animation: Pick<CharacterAnimation, "url" | "smallUrl" | "columns" | "rows">;
}) => (
  <div className="relative aspect-square overflow-hidden">
    {/* biome-ignore lint/performance/noImgElement: Atlas cells cannot pass through the image optimizer. */}
    <img
      src={animation.smallUrl ?? animation.url}
      alt=""
      loading="lazy"
      className="absolute top-0 left-0 max-w-none"
      style={{
        width: `${animation.columns * 100}%`,
        height: `${animation.rows * 100}%`,
      }}
    />
  </div>
);
