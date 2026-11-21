"use client";

import { useId } from "react";
import { cn } from "@/libs/shadui";
import { KESSEN_RARITY_LABELS, type KessenRarityTier } from "./kessenArt";

/**
 * Rarity gem: every tier has its own shape as well as its own colour, so rarity reads
 * without colour vision. Common is a round iron stud, Rare a cobalt diamond, Epic a
 * violet hexagon, Legendary a gold eight-point star and Forbidden a crimson ink seal.
 */
export const RarityGem = ({
  tier,
  size,
  className,
  decorative = false,
}: {
  tier: KessenRarityTier;
  /** CSS size of the square box; defaults to 1em. */
  size?: number | string;
  className?: string;
  /** Hide from assistive technology when the label is already spoken nearby. */
  decorative?: boolean;
}) => {
  const id = useId().replace(/:/g, "");
  const palette = GEM_PALETTES[tier];
  const fill = `url(#kg-fill-${id})`;
  const label = `${KESSEN_RARITY_LABELS[tier]} rarity`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={cn("kessen-gem shrink-0", className)}
      data-tier={tier}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      {decorative ? null : <title>{label}</title>}
      <defs>
        <linearGradient id={`kg-fill-${id}`} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" stopColor={palette.light} />
          <stop offset="0.5" stopColor={palette.mid} />
          <stop offset="1" stopColor={palette.dark} />
        </linearGradient>
        <radialGradient id={`kg-core-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff4a3a" />
          <stop offset="0.55" stopColor="#7a0c0a" />
          <stop offset="1" stopColor="#0b0406" />
        </radialGradient>
      </defs>
      <GemShape tier={tier} fill={fill} rim={palette.rim} coreId={`kg-core-${id}`} />
    </svg>
  );
};

const GemShape = ({
  tier,
  fill,
  rim,
  coreId,
}: {
  tier: KessenRarityTier;
  fill: string;
  rim: string;
  coreId: string;
}) => {
  const outline = {
    stroke: "#140a06",
    strokeWidth: 1.6,
    strokeLinejoin: "round" as const,
  };
  const shine = { fill: "#ffffff", opacity: 0.38 };
  switch (tier) {
    case "COMMON":
      return (
        <>
          <circle cx="12" cy="12" r="9" fill={fill} {...outline} />
          <circle cx="12" cy="12" r="6.2" fill="none" stroke={rim} strokeWidth="1.1" />
          <ellipse cx="9.6" cy="9" rx="3" ry="1.9" {...shine} />
        </>
      );
    case "RARE":
      return (
        <>
          <polygon points="12,1.8 21.5,12 12,22.2 2.5,12" fill={fill} {...outline} />
          <polyline
            points="2.5,12 12,8.6 21.5,12"
            fill="none"
            stroke={rim}
            strokeWidth="0.9"
          />
          <line x1="12" y1="1.8" x2="12" y2="8.6" stroke={rim} strokeWidth="0.9" />
          <polygon points="12,3.8 6.4,10.6 12,8.6" {...shine} />
        </>
      );
    case "EPIC":
      return (
        <>
          <polygon
            points="12,1.8 20.8,6.9 20.8,17.1 12,22.2 3.2,17.1 3.2,6.9"
            fill={fill}
            {...outline}
          />
          <polygon
            points="12,6.6 16.6,9.3 16.6,14.7 12,17.4 7.4,14.7 7.4,9.3"
            fill="none"
            stroke={rim}
            strokeWidth="0.9"
          />
          <polygon points="12,3.6 5,7.7 7.4,9.3 12,6.6" {...shine} />
        </>
      );
    case "LEGENDARY":
      return (
        <>
          <polygon points={STAR_POINTS} fill={fill} {...outline} />
          <circle cx="12" cy="12" r="3.4" fill="none" stroke={rim} strokeWidth="1" />
          <polygon points="12,1.6 13.9,7.4 12,9 10.1,7.4" {...shine} />
        </>
      );
    case "FORBIDDEN":
      return (
        <>
          <rect
            x="2.6"
            y="2.6"
            width="18.8"
            height="18.8"
            rx="3.2"
            fill={fill}
            transform="rotate(-6 12 12)"
            {...outline}
          />
          <rect
            x="5.6"
            y="5.6"
            width="12.8"
            height="12.8"
            rx="1.6"
            fill="none"
            stroke={rim}
            strokeWidth="1"
            transform="rotate(-6 12 12)"
          />
          <circle cx="12" cy="12" r="3.6" fill={`url(#${coreId})`} />
        </>
      );
  }
};

/** Eight-point star: outer radius 10.6, inner radius 5.2, centred at 12,12. */
const STAR_POINTS = Array.from({ length: 16 }, (_, index) => {
  const radius = index % 2 === 0 ? 10.6 : 5.2;
  const angle = (index * Math.PI) / 8 - Math.PI / 2;
  return `${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(" ");

const GEM_PALETTES: Record<
  KessenRarityTier,
  { light: string; mid: string; dark: string; rim: string }
> = {
  COMMON: { light: "#c9ccd2", mid: "#6e727b", dark: "#2c2e33", rim: "#e3e5ea" },
  RARE: { light: "#9fc0ff", mid: "#2f5bd3", dark: "#0d1b52", rim: "#d6e3ff" },
  EPIC: { light: "#d9c4ff", mid: "#7b4fe0", dark: "#261454", rim: "#efe4ff" },
  LEGENDARY: { light: "#fff2b8", mid: "#e0a823", dark: "#6b4a0c", rim: "#fff6d6" },
  FORBIDDEN: { light: "#ff7a66", mid: "#c3201a", dark: "#3a0606", rim: "#f1e6d2" },
};
