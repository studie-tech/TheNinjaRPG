"use client";

import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "./kessen.css";
import type React from "react";
import Image from "@/layout/Image";
import type { KessenKeyword } from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import { FactionSigil } from "./FactionSigil";
import { WaxSealGlyph } from "./glyphs";
import { KeywordText } from "./KeywordText";
import {
  KESSEN_MEDALLION_ZOOM,
  type KessenCardDisplay,
  kessenCardArt,
  kessenMedallionCrop,
  kessenRenditionWidth,
} from "./kessenArt";
import { useKessenMotion } from "./useKessenMotion";

/**
 * Leader plate: the medallion with the leader's name, faction, provision bonus and the
 * once-per-match ability written out. Used in deck builders, pre-match sheets and the
 * inspect panel; `used` greys the ability out.
 */
export const LeaderPlate = ({
  leader,
  used = false,
  interactiveKeywords = false,
  onKeyword,
  className,
  ...rest
}: Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  leader: KessenCardDisplay;
  used?: boolean;
  interactiveKeywords?: boolean;
  onKeyword?: (keyword: KessenKeyword) => void;
}) => (
  <div
    {...rest}
    className={cn("kessen-plate", className)}
    data-used={used ? "" : undefined}
    data-button-sfx="off"
  >
    <LeaderMedallion leader={leader} used={used} renderSize={56} />
    <div className="min-w-0 flex-1">
      <span className="kessen-plate-name">{leader.name}</span>
      <span className="kessen-plate-meta">
        <FactionSigil
          faction={leader.faction}
          renderSize={16}
          className="w-[16px]"
          decorative
        />
        <span>{KESSEN_FACTION_NAMES[leader.faction]} leader</span>
        <span className="kessen-plate-bonus" title="Provision bonus">
          +{leader.leaderBonus} provision
        </span>
      </span>
      <div className="kessen-plate-ability">
        <span className="kessen-plate-ability-name">
          {leader.abilityName
            ? `${leader.abilityName} · ${used ? "used" : "once per match"}`
            : used
              ? "Ability used"
              : "Once per match"}
        </span>
        <KeywordText
          abilities={leader.abilities}
          interactive={interactiveKeywords}
          onKeyword={onKeyword}
        />
      </div>
    </div>
  </div>
);

/**
 * Round leader medallion for the match bars: the portrait zoomed onto the leader's face
 * inside a gold ring (a lantern glow pulses when `ready`); once used, a muted portrait
 * with a wax seal pressed on its lower-right rim. Size with `className`.
 */
export const LeaderMedallion = ({
  leader,
  used = false,
  ready = false,
  renderSize = 40,
  motion,
  className,
  ...rest
}: Omit<React.ComponentPropsWithoutRef<"span">, "children"> & {
  leader: KessenCardDisplay;
  used?: boolean;
  /** The ability can be used now: soft lantern pulse. */
  ready?: boolean;
  /** Largest CSS width it is shown at; picks the Bunny rendition. */
  renderSize?: number;
  motion?: boolean;
}) => {
  const motionOn = useKessenMotion(motion);
  const art = kessenCardArt(leader);
  const width = kessenRenditionWidth(renderSize * KESSEN_MEDALLION_ZOOM);
  const state = used ? "used" : "ready";
  return (
    <span
      {...rest}
      role="img"
      aria-label={rest["aria-label"] ?? `${leader.name}, leader ability ${state}`}
      className={cn("kessen-medallion", className)}
      data-used={used ? "" : undefined}
      data-ready={ready && !used ? "" : undefined}
      data-motion={motionOn ? "on" : "off"}
    >
      <span className="kessen-medallion-art">
        {art ? (
          <Image
            src={art}
            alt=""
            width={width}
            height={Math.round(width * 1.5)}
            draggable={false}
            style={kessenMedallionCrop(leader)}
          />
        ) : null}
      </span>
      {used ? (
        <span className="kessen-medallion-spent" aria-hidden>
          <WaxSealGlyph />
        </span>
      ) : null}
    </span>
  );
};
