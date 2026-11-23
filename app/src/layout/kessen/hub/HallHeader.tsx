"use client";

import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "../kessen.css";
import "./hub.css";
import { Check, Layers } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import {
  formatDaysHours,
  formatHoursMinutes,
  nextUtcDayAt,
  nextUtcWeekAt,
} from "@/utils/time";
import type { KessenHub } from "@/validators/kessen";
import { FactionSigil } from "../FactionSigil";
import { KESSEN_IMAGES } from "../kessenArt";
import type { KessenDeckSummary } from "./hubData";

/** The hall artwork, match rewards, selected deck and available ways back to the table. */
export const HallHeader = ({
  today,
  week,
  deck,
  onDeckClick,
  actions,
}: {
  today: KessenHub["today"] | null;
  week: KessenHub["week"] | null;
  /** The deck matches start with; null when the player has no saved deck. */
  deck: KessenDeckSummary | null;
  /** Without it the deck chip is left out (before any deck exists). */
  onDeckClick?: () => void;
  actions?: React.ReactNode;
}) => (
  <header className="kh-lobby bg-card flex flex-col gap-3 rounded-xl border-2 border-amber-500/70 p-3 @[34rem]:flex-row @[34rem]:items-center">
    <div
      className="h-24 w-full shrink-0 overflow-hidden rounded-lg @[34rem]:h-20 @[34rem]:w-32"
      aria-hidden
    >
      <Image
        src={KESSEN_IMAGES.hallHero}
        alt=""
        width={1024}
        height={683}
        priority
        draggable={false}
        className="h-full w-full object-cover"
      />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-muted-foreground text-sm font-semibold">
        The Card Hall of Wake Island
      </p>
      <h2 className="text-xl leading-tight font-black">The Ninja War Table</h2>
      {today ? (
        <ul className="kh-today mt-2" aria-label="Rewards today and this week">
          <li className="kh-today-item">
            <span className="kh-today-label">Rewarded</span>
            <span className="kh-today-value">
              {today.rewarded}/{today.rewardedCap}
            </span>
          </li>
          <li className="kh-today-item">
            <span className="kh-today-label">Drops</span>
            <span className="kh-today-value">
              {today.drops}/{today.dropsCap}
            </span>
          </li>
          <li
            className="kh-today-item"
            data-quiet=""
            title="Rewarded matches and drops reset at 00:00 UTC."
          >
            <span className="kh-today-label">
              <span className="kh-today-short">Day ends</span>
              <span className="kh-today-long">Day resets in</span>
            </span>
            <Countdown
              targetDate={nextUtcDayAt()}
              onEndShow="a moment"
              format={(msLeft) =>
                formatHoursMinutes(Math.max(0, Math.round(msLeft / 1000)))
              }
              className="kh-today-value kh-today-word"
            />
          </li>
          {week ? <WeeklyPackChip firstWinPack={week.firstWinPack} /> : null}
        </ul>
      ) : null}
      {onDeckClick || actions ? (
        <div className="kh-hall-row mt-2">
          {onDeckClick ? <DeckChip deck={deck} onClick={onDeckClick} /> : null}
          {actions ? <div className="kh-hall-actions">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  </header>
);

/**
 * The week's first-win Paper Bundle: "win 1 match" while it is open, then claimed with
 * the time until Monday's reset ("next in 1d 14h"). The condition is the value, so touch
 * players read it without a tooltip.
 */
const WeeklyPackChip = ({ firstWinPack }: { firstWinPack: boolean }) => (
  <li
    className="kh-today-item"
    data-done={firstWinPack ? undefined : ""}
    title={
      firstWinPack
        ? "Your first rewarded win this week grants a Paper Bundle. Weeks start Monday 00:00 UTC."
        : "This week's Paper Bundle is claimed. The next one opens Monday 00:00 UTC."
    }
  >
    <span className="kh-today-label">Paper Bundle</span>
    <span className="kh-today-value kh-today-word">
      {firstWinPack ? (
        <>
          <span className="kh-today-short">1 win</span>
          <span className="kh-today-long">win 1 match</span>
        </>
      ) : (
        <>
          <Check className="h-[14px] w-[14px]" aria-hidden />
          <span className="kh-today-wide">claimed ·</span>
          <span className="kh-today-short">next</span>
          <span className="kh-today-long">next in</span>
          <Countdown
            targetDate={nextUtcWeekAt()}
            onEndShow="a moment"
            format={(msLeft) => formatDaysHours(Math.max(0, Math.round(msLeft / 1000)))}
          />
        </>
      )}
    </span>
  </li>
);

/** The deck chip: the deck matches start with, or the borrowed-deck note. */
export const DeckChip = ({
  deck,
  onClick,
}: {
  deck: KessenDeckSummary | null;
  onClick?: () => void;
}) => {
  const content = deck ? (
    <>
      {deck.faction ? (
        <FactionSigil
          faction={deck.faction}
          renderSize={22}
          className="w-[22px] shrink-0"
          decorative
        />
      ) : (
        <Layers className="h-[18px] w-[18px] shrink-0" aria-hidden />
      )}
      <span className="kh-deckchip-name" data-deck-name title={deck.name}>
        {deck.name}
      </span>
      {/* The figures stay together; on a narrow hall they drop below a long name. */}
      <span className="kh-deckchip-tail">
        <span className="kh-deckchip-dot" aria-hidden>
          ·
        </span>
        <span
          className="kh-deckchip-prov"
          data-over={deck.provision > deck.budget ? "" : undefined}
        >
          <span className="kh-deckchip-prov-label">Provision </span>
          {deck.provision}/{deck.budget}
        </span>
        <span className="kh-deckchip-dot" aria-hidden>
          ·
        </span>
        <span className="kh-deckchip-state" data-ready={deck.ready ? "" : undefined}>
          {deck.ready ? "ready" : deck.fillable ? "fill with borrowed" : "needs work"}
        </span>
      </span>
    </>
  ) : (
    <>
      <Layers className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="kh-deckchip-name">No deck: you'll borrow one</span>
    </>
  );
  const label = deck
    ? `Deck ${deck.name}${deck.faction ? `, ${KESSEN_FACTION_NAMES[deck.faction]}` : ""}, provision ${deck.provision} of ${deck.budget}, ${deck.ready ? "ready" : (deck.problem ?? "not ready")}`
    : "No saved deck: matches lend you one. Build a deck";
  return onClick ? (
    <Button
      variant="outline"
      className="kh-deckchip"
      onClick={onClick}
      aria-label={label}
    >
      {content}
    </Button>
  ) : (
    <span className="kh-deckchip" role="note" aria-label={label}>
      {content}
    </span>
  );
};
