"use client";

import Image from "@/layout/Image";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import { cn } from "@/libs/shadui";
import type { KessenFaction } from "@/validators/itemCard";
import { kessenEmblemUrl, kessenRenditionWidth } from "./kessenArt";

/**
 * Faction emblem: the gold roundel artwork of a faction. Size it with `className` (it
 * fills its box) and pass `renderSize`, the largest CSS width it is shown at, so Bunny
 * serves a matching rendition.
 */
export const FactionSigil = ({
  faction,
  renderSize = 32,
  className,
  decorative = false,
}: {
  faction: KessenFaction;
  renderSize?: number;
  className?: string;
  decorative?: boolean;
}) => {
  const width = kessenRenditionWidth(renderSize);
  const label = `${KESSEN_FACTION_NAMES[faction]} faction`;
  const image = (
    <Image
      src={kessenEmblemUrl(faction)}
      alt=""
      width={width}
      height={width}
      draggable={false}
      className="kessen-sigil-img"
    />
  );
  if (decorative) {
    return (
      <span
        className={cn("kessen-sigil", className)}
        data-faction={faction}
        aria-hidden
      >
        {image}
      </span>
    );
  }
  return (
    <span
      className={cn("kessen-sigil", className)}
      data-faction={faction}
      role="img"
      aria-label={label}
      title={label}
    >
      {image}
    </span>
  );
};
