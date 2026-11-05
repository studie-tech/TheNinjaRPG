import type React from "react";
import { useEffect, useRef } from "react";
import {
  IMG_RARITY_COMMON,
  IMG_RARITY_EPIC,
  IMG_RARITY_LEGENDARY,
  IMG_RARITY_RARE,
  ItemRarities,
} from "@/drizzle/constants";
import type { ItemRarity } from "@/drizzle/schema";
import NextImage from "@/layout/Image";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";

interface ContentImageProps {
  image?: string | null;
  alt: string;
  rarity?: ItemRarity;
  frames?: number;
  /** Duration of each sprite-sheet frame in milliseconds. */
  speed?: number;
  className: string;
  roundFull?: boolean;
  hideBorder?: boolean;
  /**
   * Load this tile immediately instead of when it scrolls into view. Only for grids that are
   * above the fold on arrival — everything else is a catalog the player may never scroll, and
   * eager tiles there compete with the images they can actually see.
   *
   * `loading` rather than `preload`: next/image's own guidance is to preload only a single LCP
   * candidate, and every consumer of this is a grid of many equal images.
   */
  eager?: boolean;
  onClick?: () => void;
  /** Draw the first frame without starting playback. */
  paused?: boolean;
  /** Report sprite-sheet load failure so callers can render recovery feedback. */
  onError?: () => void;
}

/** Render static artwork or a vertical sprite sheet, respecting explicit playback state. */
const ContentImage: React.FC<ContentImageProps> = (props) => {
  // The image to show
  const imgRef = useRef<HTMLCanvasElement>(null);
  const pixels = 112;
  const tailwindSize = "max-w-40 max-h-40 w-full h-full";

  useEffect(() => {
    if (props.image && props.speed && props.frames) {
      let timerId = 0;
      let startedAt: number | undefined;
      const spritesheet = new Image();
      const ctx = imgRef.current?.getContext("2d");
      const frames = props.frames;
      const speed = props.speed;
      const drawFrame = (frame: number) => {
        if (!ctx) return;
        const height = spritesheet.height / frames;
        ctx.clearRect(0, 0, pixels, pixels);
        ctx.drawImage(
          spritesheet,
          0,
          frame * height,
          spritesheet.width,
          height,
          0,
          0,
          pixels,
          pixels,
        );
      };
      const step = (timestamp: number) => {
        if (startedAt === undefined) startedAt = timestamp;
        // Elapsed time preserves frame duration across different display refresh rates.
        drawFrame(Math.floor((timestamp - startedAt) / speed) % frames);
        timerId = window.requestAnimationFrame(step);
      };
      spritesheet.onload = () => {
        drawFrame(0);
        if (!props.paused) timerId = window.requestAnimationFrame(step);
      };
      spritesheet.onerror = () => props.onError?.();
      spritesheet.src = props.image;
      return () => {
        window.cancelAnimationFrame(timerId);
        spritesheet.onload = null;
        spritesheet.onerror = null;
      };
    }
  }, [props.image, props.speed, props.frames, props.paused, props.onError]);

  // Image is either an animation or static image
  let img: null | React.ReactNode = null;
  if (props.image) {
    if (props.speed && props.frames) {
      img = (
        /* biome-ignore lint/a11y/useKeyWithClickEvents: Animation container - keyboard handled by parent component */
        /* biome-ignore lint/a11y/noStaticElementInteractions: Click handler for animation selection */
        <div
          className="flex h-full flex-row items-center justify-center"
          onClick={props.onClick}
        >
          <canvas
            ref={imgRef}
            id={`img-${props.alt}`}
            width={pixels}
            height={pixels}
            className={cn(tailwindSize)}
          ></canvas>
        </div>
      );
    } else {
      img = (
        <NextImage
          className={cn(
            "aspect-square",
            props.roundFull ? "rounded-full" : "rounded-xl",
            props.className,
            // The bordered box below takes the caller's size; the art fills the space inside
            // its border instead of spilling over it.
            "h-full w-full",
          )}
          src={props.image}
          alt={props.alt}
          width={125}
          height={125}
          loading={props.eager ? "eager" : "lazy"}
          onClick={props.onClick}
        />
      );
    }
  }

  // Derived properties
  const drawBackground =
    props.rarity && Object.values(ItemRarities).includes(props.rarity);

  // Return
  return (
    <>
      {drawBackground && props.rarity && (
        <div className={cn(tailwindSize)}>
          <NextImage
            className={cn(
              "relative top-0 right-0 bottom-0 left-0",
              props.roundFull ? "rounded-full" : "rounded-xl",
              props.hideBorder ? "" : "border-2",
              props.className,
            )}
            src={getRarityBackground(props.rarity)}
            alt={props.alt}
            width={125}
            height={125}
            loading={props.eager ? "eager" : "lazy"}
            onClick={props.onClick}
          />
        </div>
      )}
      {!props.image && (
        <div className={`absolute top-0 right-0 bottom-0 left-1/2 -translate-x-1/2`}>
          <Loader explanation="Creating..." />
        </div>
      )}
      {props.image && (
        <div
          className={cn(
            drawBackground ? "absolute left-1/2 -translate-x-1/2" : "relative left-0",
            "top-0 right-0 bottom-0",
            props.roundFull ? "rounded-full" : "rounded-xl",
            props.hideBorder ? "" : "border-2",
            "aspect-square w-full",
            tailwindSize,
            props.className,
          )}
        >
          {img}
        </div>
      )}
    </>
  );
};

export default ContentImage;

export const getRarityBackground = (rarity: ItemRarity) => {
  switch (rarity) {
    case "COMMON":
      return IMG_RARITY_COMMON;
    case "EPIC":
      return IMG_RARITY_EPIC;
    case "LEGENDARY":
      return IMG_RARITY_LEGENDARY;
    case "RARE":
      return IMG_RARITY_RARE;
    default:
      return "";
  }
};
