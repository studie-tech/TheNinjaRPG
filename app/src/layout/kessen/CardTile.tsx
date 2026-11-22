"use client";

import "./kessen.css";
import type React from "react";
import Image from "@/layout/Image";
import { ROW_LABELS } from "@/libs/kessen/text";
import type { Row } from "@/libs/kessen/types";
import { cn } from "@/libs/shadui";
import { LanternGlyph, MeditateGlyph, UnyieldingGlyph, WaxSealGlyph } from "./glyphs";
import {
  isKessenToken,
  KESSEN_RARITY_LABELS,
  type KessenCardDisplay,
  kessenCardArt,
  kessenFocalPosition,
  kessenRarityTier,
  kessenRenditionWidth,
} from "./kessenArt";
import { RarityGem } from "./RarityGem";
import { useKessenMotion } from "./useKessenMotion";

/**
 * A unit on the board: a square art crop with the displayed power (green above the
 * printed power, red below), one corner status glyph (wax seal, Unyielding gem,
 * Resilient lantern or Meditate ring, in that priority) and the rarity as both border
 * shape and gem. Designed for 50 px and scales with its width.
 */
export const CardTile = ({
  card,
  power,
  status,
  terrain = false,
  carried = false,
  highlight,
  row,
  renderSize = 56,
  motion,
  className,
  ...rest
}: CardTileProps) => {
  const motionOn = useKessenMotion(motion);
  const tier = kessenRarityTier(card);
  const art = kessenCardArt(card);
  const shown = power ?? card.power;
  const delta = shown > card.power ? "up" : shown < card.power ? "down" : undefined;
  const glyph = statusGlyph(status);
  const renditionWidth = kessenRenditionWidth(renderSize);
  return (
    <div
      {...rest}
      role="img"
      aria-label={
        rest["aria-label"] ??
        kessenTileLabel(card, { power: shown, status, terrain, carried, row })
      }
      className={cn("kessen-tile", className)}
      data-tier={tier}
      data-token={isKessenToken(card) ? "" : undefined}
      data-delta={delta}
      data-sealed={status?.sealed ? "" : undefined}
      data-carried={carried ? "" : undefined}
      data-highlight={highlight}
      data-motion={motionOn ? "on" : "off"}
      data-button-sfx="off"
    >
      <div className="kt-frame">
        <div className="kt-inner">
          {art ? (
            <div className="kt-art">
              <Image
                src={art}
                alt=""
                width={renditionWidth}
                height={Math.round(renditionWidth * 1.5)}
                draggable={false}
                style={{ objectPosition: kessenFocalPosition(card) }}
              />
            </div>
          ) : null}
          <div className="kt-shade" />
          {terrain ? <div className="kt-terrain" /> : null}
        </div>
      </div>
      <span className="kt-power" aria-hidden>
        {shown}
      </span>
      {glyph ? (
        <span className="kt-status" aria-hidden>
          {glyph}
        </span>
      ) : null}
      {status?.meditate && !status.sealed ? (
        <span className="kt-meditate-text" aria-hidden>
          +{status.meditate.gained}/{status.meditate.cap}
        </span>
      ) : null}
      <span className="kt-gem" aria-hidden>
        <RarityGem tier={tier} decorative />
      </span>
    </div>
  );
};

/** Screen-reader label of a board unit, e.g. "Moonprowler, power 6 (printed 4), sealed". */
export const kessenTileLabel = (
  card: KessenCardDisplay,
  state: {
    power: number;
    status?: KessenTileStatus;
    terrain?: boolean;
    carried?: boolean;
    row?: Row;
  },
) => {
  const parts = [
    card.name,
    state.power === card.power
      ? `power ${state.power}`
      : `power ${state.power} (printed ${card.power})`,
  ];
  if (state.row) parts.push(ROW_LABELS[state.row]);
  if (state.status?.sealed) parts.push("sealed");
  if (state.status?.unyielding) parts.push("Unyielding");
  if (state.status?.resilient) parts.push("Resilient");
  if (state.status?.meditate && !state.status.sealed) {
    parts.push(
      `Meditate +${state.status.meditate.gained} of ${state.status.meditate.cap}`,
    );
  }
  if (state.terrain) parts.push("under Terrain");
  if (state.carried) parts.push("carried over");
  parts.push(KESSEN_RARITY_LABELS[kessenRarityTier(card)]);
  return parts.join(", ");
};

const statusGlyph = (status: KessenTileStatus | undefined) => {
  if (!status) return null;
  if (status.sealed) return <WaxSealGlyph />;
  if (status.unyielding) return <UnyieldingGlyph />;
  if (status.resilient) return <LanternGlyph />;
  if (status.meditate) {
    return <MeditateGlyph gained={status.meditate.gained} cap={status.meditate.cap} />;
  }
  return null;
};

/** Corner status of a board unit; the first set flag in this order is drawn. */
export type KessenTileStatus = {
  sealed?: boolean;
  unyielding?: boolean;
  resilient?: boolean;
  /** Meditate power gained so far and its cap. */
  meditate?: { gained: number; cap: number } | null;
};

type CardTileProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  card: KessenCardDisplay;
  /** Displayed power; defaults to the printed power. */
  power?: number;
  status?: KessenTileStatus;
  /** Row is afflicted by Terrain: frost overlay. */
  terrain?: boolean;
  /** Kept from the previous round: lantern halo. */
  carried?: boolean;
  /** Selection and targeting emphasis; target and danger pulse when motion is on. */
  highlight?: "selected" | "target" | "danger" | "dim";
  /** Row the unit stands in, for the accessible label. */
  row?: Row;
  /** Largest CSS width the tile is shown at; picks the Bunny art rendition. */
  renderSize?: number;
  motion?: boolean;
};
