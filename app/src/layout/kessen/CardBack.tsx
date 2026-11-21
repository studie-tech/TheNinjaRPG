"use client";

import "./kessen.css";
import type React from "react";
import { IMG_KESSEN_CARD_BACK } from "@/drizzle/constants";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";
import { type KessenRarityTier, kessenRenditionWidth } from "./kessenArt";
import { useKessenMotion } from "./useKessenMotion";

/**
 * The card back (5:7): black lacquer, gold fret and the torii crest. `telegraph` adds the
 * pack-opening edge glow that hints at the rarity before the flip (none for Common).
 */
export const CardBack = ({
  telegraph,
  renderSize = 120,
  motion,
  className,
  ...rest
}: Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  telegraph?: KessenRarityTier | null;
  /** Largest CSS width the back is shown at; picks the Bunny rendition. */
  renderSize?: number;
  motion?: boolean;
}) => {
  const motionOn = useKessenMotion(motion);
  const width = kessenRenditionWidth(renderSize);
  return (
    <div
      {...rest}
      role="img"
      aria-label={rest["aria-label"] ?? "Face-down card"}
      className={cn("kessen-back", className)}
      data-telegraph={telegraph && telegraph !== "COMMON" ? telegraph : undefined}
      data-motion={motionOn ? "on" : "off"}
    >
      <span className="kessen-back-glow" aria-hidden />
      <span className="kessen-back-img">
        <Image
          src={IMG_KESSEN_CARD_BACK}
          alt=""
          width={width}
          height={Math.round(width * 1.5)}
          draggable={false}
        />
      </span>
    </div>
  );
};
