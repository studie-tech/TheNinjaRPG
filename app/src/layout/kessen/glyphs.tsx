"use client";

import { Crown, HandFist, ScrollText } from "lucide-react";
import { ROW_LABELS } from "@/libs/kessen/text";
import type { Row } from "@/libs/kessen/types";
import { cn } from "@/libs/shadui";

/**
 * Row glyphs: a fist for Taijutsu, a kunai for Bukijutsu, a seal circle for Ninjutsu
 * and three stacked bars for Any row. They draw in `currentColor` at 1em.
 */
export const RowGlyph = ({
  row,
  className,
  decorative = false,
}: {
  row: Row | "ANY";
  className?: string;
  decorative?: boolean;
}) => {
  const label = row === "ANY" ? "Any row" : ROW_LABELS[row];
  const classes = cn("kessen-glyph", className);
  if (row === "CLOSE") {
    return decorative ? (
      <HandFist className={classes} aria-hidden />
    ) : (
      <HandFist className={classes} role="img" aria-label={label} />
    );
  }
  const paths = <RowGlyphPaths row={row} />;
  return decorative ? (
    <svg {...ROW_SVG} className={classes} aria-hidden>
      {paths}
    </svg>
  ) : (
    <svg {...ROW_SVG} className={classes} role="img" aria-label={label}>
      <title>{label}</title>
      {paths}
    </svg>
  );
};

/** Leader crest shown where a unit prints its row. */
export const LeaderGlyph = ({ className }: { className?: string }) => (
  <Crown className={cn("kessen-glyph", className)} role="img" aria-label="Leader" />
);

/** Tactic mark shown where a unit prints its power. */
export const TacticGlyph = ({ className }: { className?: string }) => (
  <ScrollText
    className={cn("kessen-glyph", className)}
    role="img"
    aria-label="Tactic"
  />
);

/**
 * Pressed red wax seal with an irregular rim. `mark="seal"` stamps the kanji for "seal"
 * (the unit is Sealed, a spent leader ability, an empty niche); `mark="won"` stamps a
 * check (a beaten opponent). Pale relief on dark wax, so it holds at 14 px.
 */
export const WaxSealGlyph = ({
  className,
  mark = "seal",
}: {
  className?: string;
  mark?: "seal" | "won";
}) => (
  <svg
    viewBox="0 0 24 24"
    className={cn("kessen-glyph", className)}
    data-mark={mark}
    aria-hidden
  >
    <path d={WAX_SEAL_PATH} fill="#7d0d10" stroke="#2a0405" strokeWidth="1" />
    <path d={WAX_SEAL_SHINE_PATH} fill="#b5231f" opacity="0.9" />
    <circle cx="12" cy="12" r="6.6" fill="#5c080b" stroke="#c9483b" strokeWidth="0.8" />
    <path
      d={mark === "won" ? WON_MARK_PATH : SEAL_MARK_PATH}
      fill="none"
      stroke="#ffe2cf"
      strokeWidth={mark === "won" ? 2.1 : 1.15}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Pale diamond: the unit is Unyielding. */
export const UnyieldingGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={cn("kessen-glyph", className)} aria-hidden>
    <polygon
      points="12,1.8 21,9 12,22.2 3,9"
      fill="#dbe8f2"
      stroke="#1d2a33"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <polyline points="3,9 12,11.4 21,9" fill="none" stroke="#6f8ea3" strokeWidth="1" />
    <polyline
      points="7.6,5.4 12,11.4 16.4,5.4"
      fill="none"
      stroke="#6f8ea3"
      strokeWidth="1"
    />
  </svg>
);

/** Lit paper lantern: the unit is Resilient (or carried a round). */
export const LanternGlyph = ({
  className,
  lit = true,
}: {
  className?: string;
  lit?: boolean;
}) => (
  <svg viewBox="0 0 24 24" className={cn("kessen-glyph", className)} aria-hidden>
    <path
      d="M9 2.5h6M12 2.5v1.6"
      stroke="#2b1a0c"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <rect x="8" y="4" width="8" height="2.2" rx="0.8" fill="#2b1a0c" />
    <path
      d="M7.2 6.2h9.6c1.6 2.2 2.4 4.4 2.4 6.4s-.8 4.2-2.4 6.4H7.2c-1.6-2.2-2.4-4.4-2.4-6.4s.8-4.2 2.4-6.4Z"
      fill={lit ? "#ffb347" : "#5b4a3a"}
      stroke="#2b1a0c"
      strokeWidth="1.3"
    />
    <path
      d="M5.2 10.6h13.6M5.2 14.6h13.6"
      stroke={lit ? "#c2410c" : "#3a2e24"}
      strokeWidth="0.9"
    />
    {lit ? (
      <ellipse cx="12" cy="12.6" rx="2.4" ry="3.2" fill="#fff1c2" opacity="0.85" />
    ) : null}
    <rect x="8" y="19" width="8" height="2.2" rx="0.8" fill="#2b1a0c" />
  </svg>
);

/** Meditate progress ring: `gained` of `cap` power so far. */
export const MeditateGlyph = ({
  gained,
  cap,
  className,
}: {
  gained: number;
  cap: number;
  className?: string;
}) => {
  const fraction = cap > 0 ? Math.min(1, Math.max(0, gained / cap)) : 0;
  const circumference = 2 * Math.PI * 8;
  return (
    <svg viewBox="0 0 24 24" className={cn("kessen-glyph", className)} aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="10.4"
        fill="#1d1430"
        stroke="#0b0710"
        strokeWidth="1.2"
      />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#4b3b6e" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke="#c8b6ff"
        strokeWidth="3"
        strokeDasharray={`${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
        transform="rotate(-90 12 12)"
        strokeLinecap="butt"
      />
      <circle cx="12" cy="12" r="2.4" fill="#efe6ff" />
    </svg>
  );
};

const RowGlyphPaths = ({ row }: { row: Exclude<Row, "CLOSE"> | "ANY" }) =>
  row === "RANGED" ? (
    <g transform="rotate(45 12 12)">
      <path d="M12 1.5 15.2 9 12 11.8 8.8 9Z" fill="currentColor" />
      <path d="M12 11.8V17.6M10.3 13.8h3.4M10.3 15.8h3.4" />
      <circle cx="12" cy="20.3" r="2.2" />
    </g>
  ) : row === "JUTSU" ? (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.5v5.1M20.2 16.75l-4.4-2.55M3.8 16.75l4.4-2.55" />
    </>
  ) : (
    <path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15" />
  );

/** Wax blob outline: a radius-9.6 circle with an uneven, poured rim. */
const WAX_SEAL_PATH = waxOutline(12, 12, 9.6, 0.75);

/** Hand-drawn 封 ("seal") in the 24-unit box, within the pressed disc. */
const SEAL_MARK_PATH =
  "M8.4 8.6H10.8M9.6 7.6V10.6M8 10.6H11.2M8.4 12.6H10.8M9.6 11.6V15.6M7.9 15.8L11.3 15" +
  "M12.2 10H16.2M14.9 7.6V15.8Q14.9 16.6 14 16.2M12.9 12L13.6 13.2";

/** Check mark stamped on a beaten opponent's seal. */
const WON_MARK_PATH = "M8.7 12.3l2.3 2.4 4.4-5.1";

/** Upper-left sheen of the wax, inside the rim. */
const WAX_SEAL_SHINE_PATH = waxOutline(11.2, 11.2, 7.9, 0.5);

function waxOutline(cx: number, cy: number, base: number, wobble: number) {
  const points: string[] = [];
  const steps = 40;
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * Math.PI * 2;
    const radius =
      base +
      wobble *
        (Math.sin(angle * 3 + 0.4) * 0.9 +
          Math.cos(angle * 5 + 1.1) * 0.6 +
          Math.sin(angle * 7 + 2.3) * 0.4);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(`${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${points.join(" ")}Z`;
}

const ROW_SVG = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
