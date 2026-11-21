"use client";

import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "./kessen.css";
import type React from "react";
import { Fragment } from "react";
import Image from "@/layout/Image";
import {
  abilitySegments,
  cardTextPlain,
  type KessenKeyword,
  ROW_LABELS,
} from "@/libs/kessen/text";
import type { Row } from "@/libs/kessen/types";
import { cn } from "@/libs/shadui";
import { FactionSigil } from "./FactionSigil";
import { LeaderGlyph, RowGlyph, TacticGlyph } from "./glyphs";
import { KeywordText } from "./KeywordText";
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
 * A full Kessen card (5:7). Size it with `className` (it fills its width); container
 * queries pick what it shows: below 90 px the art, power, row and gem; then the name
 * banner, faction sigil, provision and copy pips; from 110 px a keyword strip that wraps
 * whole keywords; from 220 px the full text in its place, and from 250 px the flavor
 * line. `renderSize` is the largest CSS width it is shown at, which picks the art
 * rendition.
 */
export const CardFace = ({
  card,
  renderSize = 240,
  selected = false,
  disabled = false,
  loan = false,
  isNew = false,
  copies,
  showCopyPips = true,
  showProvision = true,
  interactiveKeywords = false,
  onKeyword,
  motion,
  priority = false,
  className,
  ...rest
}: CardFaceProps) => {
  const motionOn = useKessenMotion(motion);
  const tier = kessenRarityTier(card);
  const token = isKessenToken(card);
  const art = kessenCardArt(card);
  const renditionWidth = kessenRenditionWidth(renderSize);
  const plain = cardTextPlain(card);
  const isLeader = card.kind === "LEADER";
  const isTactic = card.kind === "TACTIC";
  const vanilla = card.abilities.length === 0;
  const powerText = isLeader ? `+${card.leaderBonus}` : String(card.power);
  const strip = keywordStrip(card);
  return (
    <article
      {...rest}
      aria-label={rest["aria-label"] ?? kessenCardLabel(card, { loan, isNew, copies })}
      className={cn("kessen-card", className)}
      data-tier={tier}
      data-kind={card.kind}
      data-token={token ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      data-density={plain.length > 110 ? "long" : undefined}
      data-motion={motionOn ? "on" : "off"}
      data-interactive={interactiveKeywords ? "" : undefined}
      data-button-sfx="off"
    >
      <div className="kc-frame">
        <div className="kc-inner">
          <div className="kc-art">
            {art ? (
              <Image
                src={art}
                alt=""
                width={renditionWidth}
                height={Math.round(renditionWidth * 1.5)}
                draggable={false}
                priority={priority}
                style={{ objectPosition: kessenFocalPosition(card) }}
              />
            ) : (
              <div className="kc-art-empty">
                <FactionSigil
                  faction={card.faction}
                  renderSize={renderSize / 2}
                  decorative
                />
              </div>
            )}
          </div>
          <div className="kc-vignette" />
          <div className="kc-panel" data-kessen-glossary-anchor="">
            {token ? (
              <span className="kc-token-tag" aria-hidden>
                Token
              </span>
            ) : (
              <span className="kc-gem-slot" aria-hidden>
                <RarityGem tier={tier} decorative />
              </span>
            )}
            {showCopyPips && copies && copies.max > 0 ? (
              <span className="kc-pips" aria-hidden>
                {Array.from({ length: copies.max }, (_, index) => (
                  <span
                    key={index}
                    className="kc-pip"
                    data-on={index < copies.owned ? "" : undefined}
                  />
                ))}
              </span>
            ) : null}
            <div className="kc-name">{card.name}</div>
            {strip.length > 0 ? (
              <div className="kc-kw-strip" aria-hidden>
                {strip.map((item, index) => (
                  <Fragment key={item.key}>
                    {index > 0 ? " " : null}
                    <span className="kc-kw-item">
                      {item.label}
                      {item.row ? (
                        <RowGlyph row={item.row} className="kc-kw-row" decorative />
                      ) : null}
                      {item.count > 1 ? ` ×${item.count}` : null}
                      {index < strip.length - 1 ? " ·" : null}
                    </span>
                  </Fragment>
                ))}
              </div>
            ) : null}
            <div className="kc-body">
              {isLeader && card.abilityName ? (
                <span className="kc-ability-name">{card.abilityName}</span>
              ) : null}
              {vanilla && !token && card.flavor ? null : (
                <KeywordText
                  className="kc-text"
                  abilities={card.abilities}
                  interactive={interactiveKeywords}
                  onKeyword={onKeyword}
                  empty={
                    token ? "Created by a rule; banished at the end of the round." : "—"
                  }
                />
              )}
              {card.flavor ? (
                <p className="kc-flavor" data-main={vanilla && !token ? "" : undefined}>
                  {card.flavor}
                </p>
              ) : null}
            </div>
          </div>
          {token ? null : (
            <span className="kc-gem-mini" aria-hidden>
              <RarityGem tier={tier} decorative />
            </span>
          )}
          <div className="kc-sheen" />
        </div>
        {tier === "FORBIDDEN" ? (
          <>
            <span className="kc-ofuda" data-corner="tr" />
            <span className="kc-ofuda" data-corner="tl" />
          </>
        ) : null}
      </div>
      <div className="kc-deco" />

      <div
        className="kc-power"
        data-len={powerText.length >= 3 ? 3 : undefined}
        aria-hidden
      >
        {isTactic ? <TacticGlyph /> : powerText}
      </div>
      {isTactic ? null : (
        <div className="kc-row" aria-hidden>
          {isLeader ? (
            <LeaderGlyph />
          ) : card.row ? (
            <RowGlyph row={card.row} decorative />
          ) : null}
        </div>
      )}
      <div className="kc-sigil" aria-hidden>
        <FactionSigil
          faction={card.faction}
          renderSize={renderSize * 0.17}
          decorative
        />
      </div>
      {showProvision && !isLeader && !token && card.provision > 0 ? (
        <div className="kc-prov" title={`Provision ${card.provision}`} aria-hidden>
          <span>{card.provision}</span>
        </div>
      ) : null}

      {isNew ? (
        <span className="kc-new" aria-hidden>
          NEW
        </span>
      ) : null}
      {loan ? (
        <span className="kc-stamp" aria-hidden>
          LOAN
        </span>
      ) : null}
    </article>
  );
};

/**
 * Screen-reader label of a card, e.g. "Moonprowler, power 4, Taijutsu, Bond (Moon Pack),
 * Common". Leaders read their provision bonus and ability title instead of a power.
 */
export const kessenCardLabel = (
  card: KessenCardDisplay,
  extras: {
    loan?: boolean;
    isNew?: boolean;
    copies?: { owned: number; max: number };
  } = {},
) => {
  const parts: string[] = [card.name];
  const text = card.abilities.length > 0 ? cardTextPlain(card) : null;
  if (card.kind === "LEADER") {
    parts.push(`leader of ${KESSEN_FACTION_NAMES[card.faction]}`);
    parts.push(`provision bonus ${card.leaderBonus}`);
    if (card.abilityName) parts.push(`ability ${card.abilityName}`);
    if (text) parts.push(text);
  } else {
    if (card.kind === "TACTIC") parts.push("tactic");
    else parts.push(`power ${card.power}`);
    if (card.row) parts.push(card.row === "ANY" ? "any row" : ROW_LABELS[card.row]);
    if (text) parts.push(text);
    if (isKessenToken(card)) parts.push("token");
  }
  parts.push(KESSEN_RARITY_LABELS[kessenRarityTier(card)]);
  if (extras.loan) parts.push("on loan");
  if (extras.isNew) parts.push("new");
  if (extras.copies)
    parts.push(`${extras.copies.owned} of ${extras.copies.max} copies`);
  return parts.join(", ");
};

/**
 * Keywords with their values for the compact strip of a mid-size card ("Meditate 1 ·
 * Rally 1", a repeat as "Strike 2 ×2"). Bond and Summon groups are dropped and a Terrain
 * row becomes its glyph, so each keyword stays short enough to print whole; the full
 * wording is in the card's label and its inspect text. A leader without keywords shows
 * its ability title.
 */
const keywordStrip = (card: KessenCardDisplay): KeywordStripItem[] => {
  const items = new Map<string, KeywordStripItem>();
  for (const segment of abilitySegments(card.abilities)) {
    if (segment.t !== "kw") continue;
    const { label, row } = compactKeyword(segment.s);
    const key = row ? `${label}:${row}` : label;
    const item = items.get(key);
    if (item) item.count += 1;
    else items.set(key, { key, label, row, count: 1 });
  }
  if (items.size === 0 && card.kind === "LEADER" && card.abilityName) {
    return [{ key: "ability", label: card.abilityName, count: 1 }];
  }
  return [...items.values()];
};

/** "Terrain (Bukijutsu)" → Terrain with the Bukijutsu glyph; "Bond (Moon Pack)" → Bond. */
const compactKeyword = (text: string): { label: string; row?: Row } => {
  const match = /^(.+?) \((.+)\)$/.exec(text);
  if (!match?.[1]) return { label: text };
  const row = ROW_ENTRIES.find(([, name]) => name === match[2])?.[0];
  return { label: match[1], row };
};

const ROW_ENTRIES = Object.entries(ROW_LABELS) as [Row, string][];

type KeywordStripItem = { key: string; label: string; row?: Row; count: number };

type CardFaceProps = Omit<React.ComponentPropsWithoutRef<"article">, "children"> & {
  card: KessenCardDisplay;
  /** Largest CSS width the card is shown at; picks the Bunny art rendition. */
  renderSize?: number;
  /** Lifted with a gold glow (the selected hand card). */
  selected?: boolean;
  /** Greyed out: unplayable, unowned or over the copy limit. */
  disabled?: boolean;
  /** Borrowed for this match or deck: shows a LOAN stamp. */
  loan?: boolean;
  /** Freshly obtained: shows a NEW ribbon. */
  isNew?: boolean;
  /** Copies owned of the copy limit, e.g. 2 of 3: read in the label, drawn as pips. */
  copies?: { owned: number; max: number };
  /** Draw the copy pips; off where the count is printed beside the card. */
  showCopyPips?: boolean;
  /** Provision is a deck-building cost; hide it on the board. */
  showProvision?: boolean;
  /** Keywords open their glossary line on tap or click (inspect sizes). */
  interactiveKeywords?: boolean;
  onKeyword?: (keyword: KessenKeyword) => void;
  /** Overrides the motion setting (still off under reduced motion). */
  motion?: boolean;
  /** Load the art eagerly (above-the-fold inspect cards). */
  priority?: boolean;
};
