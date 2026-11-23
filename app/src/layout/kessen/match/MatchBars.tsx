"use client";

import { ArrowDownWideNarrow, Layers } from "lucide-react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AvatarImage from "@/layout/Avatar";
import Image from "@/layout/Image";
import { LANTERNS } from "@/libs/kessen/rules";
import type { Seat } from "@/libs/kessen/types";
import { cn } from "@/libs/shadui";
import { CardBack } from "../CardBack";
import { LanternGlyph } from "../glyphs";
import { LeaderMedallion } from "../LeaderPlate";
import { plural } from "./matchText";
import type { MatchTable } from "./useMatchTable";
import { useTweenedNumber } from "./useTweenedNumber";

/**
 * Opponent bar: portrait, name (with the match's house rule under it), lanterns, hand,
 * deck, leader and total (stamped once they pass).
 */
export const OpponentBar = ({
  table,
  onOpenDiscards,
  onOpenRules,
}: {
  table: MatchTable;
  onOpenDiscards: () => void;
  /** Opens the rules, where the house rule is spelled out. */
  onOpenRules: () => void;
}) => {
  const { view, them, npc, opponentName } = table;
  const zone = view.seats[them];
  const leader = zone.leader ? table.cardDisplay(zone.leader) : null;
  const total = table.sideTotals[them];
  return (
    <section
      className="km-bar km-bar-them"
      aria-label={`${opponentName}'s side`}
      data-lesson-target="opponent"
    >
      <span className="km-portrait" aria-hidden>
        {table.opponent ? (
          <AvatarImage href={table.opponent.avatar} alt="" size={56} className="m-0" />
        ) : npc?.image ? (
          <Image src={npc.image} alt="" width={96} height={96} draggable={false} />
        ) : null}
      </span>
      <span className="km-bar-name">
        <span className="km-bar-title">{opponentName}</span>
        {table.houseRule ? (
          <button
            type="button"
            className={cn(
              badgeVariants({ variant: "secondary" }),
              "km-house-chip km-hit cursor-pointer px-[5px] py-0 text-[11px]",
            )}
            onClick={onOpenRules}
            title={`${table.houseRule.name}: ${table.houseRule.text}`}
            aria-label={`House rule ${table.houseRule.name}: ${table.houseRule.text} Open the rules`}
          >
            <span>{table.houseRule.name}</span>
          </button>
        ) : null}
      </span>
      <Lanterns count={zone.lanterns} label={`${opponentName}'s lanterns`} />
      <HandCount count={zone.handCount} holder={opponentName} />
      <DeckButton
        count={zone.deckCount}
        discard={zone.discard.length}
        onClick={onOpenDiscards}
        label={`${opponentName}: ${plural(zone.deckCount, "card")} in deck, ${zone.discard.length} in discard. Open discards`}
      />
      {leader ? (
        <LeaderMedallion
          leader={leader}
          used={zone.leaderUsed}
          renderSize={32}
          className="km-bar-medallion"
          onPointerEnter={() => table.setInspected(`leader:${them}`)}
          onClick={() => table.inspect(`leader:${them}`)}
        />
      ) : null}
      <SideTotal
        value={total}
        side="them"
        label={`${opponentName}'s total`}
        passed={zone.passed}
        motion={table.motion}
      />
    </section>
  );
};

/**
 * The player's bar: lanterns, total, leader, banked mulligans, deck and hand sorting (for
 * a spectator, the hand's size).
 */
export const PlayerBar = ({
  table,
  sort,
  onSort,
  onOpenDiscards,
}: {
  table: MatchTable;
  sort: HandSort;
  onSort: () => void;
  onOpenDiscards: () => void;
}) => {
  const { view, me } = table;
  const zone = view.seats[me];
  const leader = zone.leader ? table.cardDisplay(zone.leader) : null;
  return (
    <section className="km-bar km-bar-me" aria-label={`${table.selfPossessive} side`}>
      <Lanterns count={zone.lanterns} label={`${table.selfPossessive} lanterns`} />
      <span className="km-bar-name">
        <span className="km-bar-title">{table.selfName}</span>
        {zone.banked > 0 ? (
          <Badge
            variant="outline"
            className="km-banked px-[4px] py-0 text-[11px] text-inherit"
            title="Banked mulligans for the next round"
          >
            +{zone.banked} mull.
          </Badge>
        ) : null}
      </span>
      {/* A spectator sees the hand's size where a player sorts it. */}
      {table.spectating ? (
        <HandCount count={zone.handCount} holder={table.selfName} />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="km-hit h-6 gap-[3px] rounded-full px-[7px] text-[11px]"
          onClick={onSort}
          aria-label={`Sort hand by ${sort === "row" ? "power" : sort === "power" ? "play order" : "row"}`}
          title="Sort hand"
        >
          <ArrowDownWideNarrow className="h-3 w-3" aria-hidden />
          <span>{SORT_LABEL[sort]}</span>
        </Button>
      )}
      <DeckButton
        count={zone.deckCount}
        discard={zone.discard.length}
        onClick={onOpenDiscards}
        label={`${table.selfPossessive} deck ${zone.deckCount}, discard ${zone.discard.length}. Open discards`}
      />
      {leader ? (
        <LeaderMedallion
          leader={leader}
          used={zone.leaderUsed}
          ready={table.canAct && !zone.leaderUsed}
          renderSize={32}
          className="km-bar-medallion"
          onPointerEnter={() => table.setInspected(`leader:${me}`)}
          onClick={() => table.inspect(`leader:${me}`)}
        />
      ) : null}
      <SideTotal
        value={table.sideTotals[me]}
        side="me"
        label={`${table.selfPossessive} total`}
        passed={zone.passed}
        motion={table.motion}
      />
    </section>
  );
};

/** A side's hand size, behind a card back. */
const HandCount = ({ count, holder }: { count: number; holder: string }) => (
  <Badge
    variant="secondary"
    className="km-count gap-[3px] px-[5px] py-0 text-[12px]"
    title="Cards in hand"
  >
    <CardBack className="km-count-back" renderSize={24} aria-hidden />
    <span className="sr-only">{holder} holds</span>
    {count}
    <span className="sr-only"> cards</span>
  </Badge>
);

/** A side's deck count; it opens the discards. */
const DeckButton = ({
  count,
  discard,
  label,
  onClick,
}: {
  count: number;
  discard: number;
  label: string;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="km-count km-hit h-6 gap-[3px] px-[4px] text-[12px] text-inherit hover:bg-black/30 hover:text-inherit"
    onClick={onClick}
    title={`Deck ${count} · discard ${discard}`}
    aria-label={label}
  >
    <Layers aria-hidden />
    {count}
  </Button>
);

/** Lit and spent lanterns of one side (`LANTERNS` per match). */
export const Lanterns = ({ count, label }: { count: number; label: string }) => (
  <span
    className="km-lanterns"
    role="img"
    aria-label={`${label}: ${count} of ${LANTERNS}`}
  >
    {Array.from({ length: LANTERNS }, (_, index) => (
      <span
        key={index}
        className="km-lantern"
        data-lit={index < count ? "" : undefined}
      >
        <LanternGlyph lit={index < count} />
      </span>
    ))}
  </span>
);

/**
 * A side's total; once that side has passed, a Passed stamp hangs from it, clear of the
 * name and the house rule beside it.
 */
const SideTotal = ({
  value,
  side,
  label,
  passed,
  motion,
}: {
  value: number;
  side: "me" | "them";
  label: string;
  passed: boolean;
  motion: boolean;
}) => {
  const shown = useTweenedNumber(value, motion);
  return (
    <span
      className="km-side-total"
      data-lesson-target="side-total"
      data-lesson-key={side}
      role="img"
      aria-label={`${label} ${value}${passed ? ", passed" : ""}`}
    >
      <span className="km-side-total-value">{shown}</span>
      {passed ? (
        <span className="km-passed" aria-hidden>
          Passed
        </span>
      ) : null}
    </span>
  );
};

/** Seat a leader inspect key (`leader:<seat>`) points at, or null. */
export const leaderSeatOf = (key: string | null): Seat | null =>
  key === "leader:0" ? 0 : key === "leader:1" ? 1 : null;

const SORT_LABEL: Record<HandSort, string> = {
  row: "Row",
  power: "Power",
  order: "Drawn",
};

/** The hand's order: by row, by power, or as drawn. */
export type HandSort = "row" | "power" | "order";
