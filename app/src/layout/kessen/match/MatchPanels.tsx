"use client";

import { Flag, ScrollText } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Confirm } from "@/layout/Confirm";
import { findUnit, type UnitRef } from "@/libs/kessen/board";
import type { KessenHouseRule } from "@/libs/kessen/npcs";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import {
  abilitySegments,
  cardKeywords,
  KESSEN_KEYWORDS,
  type KessenKeyword,
  keywordGlossary,
  ROW_LABELS,
  type TerrainReach,
  terrainReach,
} from "@/libs/kessen/text";
import type { Seat } from "@/libs/kessen/types";
import { CardFace } from "../CardFace";
import { KeywordText } from "../KeywordText";
import {
  isKessenToken,
  KESSEN_RARITY_LABELS,
  type KessenCardDisplay,
  kessenRarityTier,
} from "../kessenArt";
import { LeaderPlate } from "../LeaderPlate";
import { leaderSeatOf } from "./MatchBars";
import { tileStatus } from "./MatchBoard";
import { signed } from "./matchText";
import type { MatchTable } from "./useMatchTable";

/**
 * The inspected card at reading size with its keyword glossary and, for a unit on the
 * board, its current state. Without a card it shows both leaders.
 */
export const InspectPanel = ({ table }: { table: MatchTable }) => {
  const { view, inspected, draft } = table;
  const key = inspected ?? draft.card;
  const leaderSeat = leaderSeatOf(key);
  if (leaderSeat !== null || key === null) {
    const seats: Seat[] = leaderSeat !== null ? [leaderSeat] : [table.me, table.them];
    return (
      <div className="km-inspect">
        {seats.map((seat) => {
          const leaderId = view.seats[seat].leader;
          const leader = leaderId ? table.cardDisplay(leaderId) : null;
          if (!leader) return null;
          return (
            <section key={seat} className="km-inspect-leader">
              <h3 className="km-panel-title">
                {seat === table.me
                  ? `${table.spectating ? `${table.selfName}'s` : "Your"} leader`
                  : `${table.opponentName}'s leader`}
              </h3>
              <LeaderPlate
                leader={leader}
                used={view.seats[seat].leaderUsed}
                interactiveKeywords
              />
            </section>
          );
        })}
        {key === null ? (
          <p className="km-panel-hint">
            Long-press or right-click a card to read it here.
          </p>
        ) : null}
      </div>
    );
  }
  const catalogId = catalogKeyOf(key);
  const card = catalogId ? table.cardDisplay(catalogId) : table.instanceCard(key);
  if (!card) return <p className="km-panel-hint">That card is hidden.</p>;
  const found = catalogId ? null : findUnit(view, key);
  return (
    <div className="km-inspect">
      <CardFace
        card={card}
        renderSize={240}
        interactiveKeywords
        showProvision={false}
        priority
        className="km-inspect-face"
      />
      <CardFacts
        table={table}
        card={card}
        seat={catalogId ? null : (found?.unit.owner ?? instanceSeat(table, key))}
        found={found}
        power={found ? (table.powers.get(key) ?? found.unit.stored) : null}
        // The sheet's face is too small to print its rules.
        rules
      />
    </div>
  );
};

/**
 * What the face of a card leaves out: rarity, faction, row and provision; for a unit on
 * the board its side, current and printed power with where the difference comes from,
 * and its states; the rules text with each keyword's X, and each keyword's glossary line.
 */
export const CardFacts = ({
  table,
  card,
  seat,
  found = null,
  power = null,
  rules = true,
}: {
  table: MatchTable;
  card: KessenCardDisplay;
  /** The seat whose Terrain reach the text follows; null for a card off the table. */
  seat: Seat | null;
  found?: UnitRef | null;
  power?: number | null;
  rules?: boolean;
}) => {
  const { view } = table;
  const keywords = cardKeywords(card.abilities);
  const reach = seat === null ? "both" : seatReach(table, seat);
  const meta = isKessenToken(card)
    ? ["Token", kindLabel(card)]
    : [
        KESSEN_RARITY_LABELS[kessenRarityTier(card)],
        KESSEN_FACTION_NAMES[card.faction],
        kindLabel(card),
        card.kind === "LEADER" ? null : `Provision ${card.provision}`,
      ].filter(Boolean);
  const status = found ? tileStatus(card, found.unit, view.knobs.meditateCap) : null;
  const terrain =
    found !== null && view.terrain[found.side][found.row] && !status?.unyielding;
  const chips: { label: string; text: string }[] = [];
  if (found && status) {
    if (found.unit.owner !== found.side) {
      chips.push({ label: "Planted", text: "Played here by the other side." });
    }
    if (status.sealed) {
      chips.push({ label: "Sealed", text: "No Rally, Bond, Meditate or Resilient." });
    }
    if (status.resilient) {
      chips.push({ label: "Resilient", text: "Stays into the next round." });
    }
    if (status.meditate) {
      chips.push({
        label: `Meditate ${status.meditate.gained}/${status.meditate.cap}`,
        text: "Power gained so far this match.",
      });
    }
    if (found.unit.seq <= view.roundSeq) {
      chips.push({ label: "Carried over", text: "Stayed from the last round." });
    }
    if (terrain) chips.push({ label: "Terrain", text: "−2 power, minimum 1." });
  }
  return (
    <div className="km-facts">
      {/* Each part stays whole, so a wrap never strands a number on its own line. */}
      <p className="km-facts-meta">
        {meta.map((part, index) => (
          <span key={part}>
            {index > 0 ? " · " : ""}
            <span className="km-facts-part">{part}</span>
          </span>
        ))}
      </p>
      {found && power !== null ? (
        <p className="km-facts-place">
          {found.side === table.me
            ? table.spectating
              ? `${table.selfName}'s`
              : "Your"
            : `${table.opponentName}'s`}{" "}
          {ROW_LABELS[found.row]} row
        </p>
      ) : null}
      <PowerLine card={card} found={found} power={power} terrain={terrain} />
      {chips.length > 0 ? (
        <ul className="km-facts-chips" aria-label="States">
          {chips.map((chip) => (
            <li key={chip.label}>
              <Badge variant="secondary" className="km-chip shrink-0 text-[12px]">
                {chip.label}
              </Badge>
              <span className="km-chip-text">{chip.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rules ? (
        <p className="km-facts-rules">
          <KeywordText
            segments={abilitySegments(card.abilities, reach)}
            empty="No ability."
          />
        </p>
      ) : null}
      {keywords.length > 0 ? (
        <ul className="km-glossary-list">
          {keywords.map((keyword) => (
            <li key={keyword}>
              <ReachGlossary keyword={keyword} reach={reach} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

/** Current power against the printed number, with the sources of the difference. */
const PowerLine = ({
  card,
  found,
  power,
  terrain,
}: {
  card: KessenCardDisplay;
  found: UnitRef | null;
  power: number | null;
  terrain: boolean;
}) => {
  if (card.kind === "LEADER") {
    return <p className="km-facts-power">Leader bonus +{card.leaderBonus}</p>;
  }
  if (card.kind === "TACTIC") return null;
  if (!found || power === null) {
    return (
      <p className="km-facts-power">
        Power <span className="kessen-num">{card.power}</span>
      </p>
    );
  }
  const unit = found.unit;
  const meditated = unit.med;
  const hits = unit.stored - card.power - meditated;
  const aura = power - unit.stored;
  const sources = [
    hits < 0 ? `damage ${signed(hits)}` : hits > 0 ? `boosts ${signed(hits)}` : null,
    meditated > 0 ? `Meditate ${signed(meditated)}` : null,
    aura < 0 && terrain
      ? `Terrain ${signed(aura)}`
      : aura !== 0
        ? `row effects ${signed(aura)}`
        : null,
  ].filter(Boolean);
  return (
    <p className="km-facts-power">
      Power <span className="kessen-num km-facts-now">{power}</span>
      {power !== card.power || sources.length > 0 ? (
        <span className="km-facts-base">
          {" "}
          · printed {card.power}
          {sources.length > 0 ? ` · ${sources.join(" · ")}` : ""}
        </span>
      ) : null}
    </p>
  );
};

/**
 * Every line of this visit's play, newest last, kept scrolled to the end, under the
 * results of the rounds already played. Lines come from the events the table played
 * back, so plays made before it opened are summed up by those round results.
 */
export const PlayLog = ({ table }: { table: MatchTable }) => {
  const end = useRef<HTMLLIElement>(null);
  const count = table.log.length;
  useEffect(() => {
    if (count > 0) end.current?.scrollIntoView({ block: "nearest" });
  }, [count]);
  const history = table.confirmed.view.history;
  return (
    <div className="km-log">
      {history.length > 0 ? (
        <ul className="km-log-rounds" aria-label="Round results">
          {history.map((entry) => {
            const mine = entry.totals[table.me];
            const theirs = entry.totals[table.them];
            const outcome =
              entry.winner === null
                ? "tie"
                : entry.winner === table.me
                  ? "won"
                  : "lost";
            return (
              <li key={entry.round} data-outcome={outcome}>
                Round {entry.round}: {mine} – {theirs}{" "}
                {outcome === "tie" ? "tie" : outcome === "won" ? "won" : "lost"}
              </li>
            );
          })}
        </ul>
      ) : null}
      {count === 0 ? (
        <p className="km-log-empty">
          <ScrollText aria-hidden />
          <span>
            {history.length > 0 || table.view.seats.some((zone) => zone.played > 0)
              ? "New plays appear here."
              : "Plays appear here."}
          </span>
        </p>
      ) : (
        <ol className="km-log-lines" aria-label="Play log">
          {table.log.map((line, index) => (
            <li key={index} ref={index === count - 1 ? end : undefined}>
              {line}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/** Both discards, public and in discard order. */
export const Discards = ({ table }: { table: MatchTable }) => {
  const { view } = table;
  const mine = table.spectating ? `${table.selfName}'s` : "Your";
  return (
    <div className="km-discards">
      {[table.me, table.them].map((seat) => {
        const pile = view.seats[seat].discard;
        return (
          <section
            key={seat}
            aria-label={seat === table.me ? `${mine} discard` : "Their discard"}
          >
            <h3 className="km-panel-title">
              {seat === table.me
                ? `${mine} discard`
                : `${table.opponentName}'s discard`}{" "}
              · <span className="kessen-num">{pile.length}</span>
            </h3>
            {pile.length === 0 ? (
              <p className="km-panel-hint">Empty.</p>
            ) : (
              <ul className="km-card-grid">
                {pile.map((instance) => {
                  const card = table.instanceCard(instance);
                  if (!card) return null;
                  return (
                    <li key={instance}>
                      <button
                        type="button"
                        className="km-grid-card"
                        onClick={() => table.inspectDiscard(instance)}
                        aria-label={`Inspect ${card.name}`}
                      >
                        <CardFace card={card} renderSize={96} showProvision={false} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
};

/** Choice of a discard card (Revive, Fence, Recall) with each option's outcome. */
export const TargetPicker = ({ table }: { table: MatchTable }) => {
  const { request, options } = table;
  if (!request) return null;
  return (
    <div className="km-picker" role="dialog" aria-label="Choose a card">
      <ul className="km-card-grid">
        {options.map((option) => {
          const card = table.instanceCard(option.target);
          if (!card) return null;
          return (
            <li key={option.target}>
              <button
                type="button"
                className="km-grid-card"
                disabled={!option.ok}
                onClick={() => table.chooseTarget(option.target)}
                aria-label={`${card.name}: ${option.ok ? option.outcome : option.reason}`}
                data-button-sfx="off"
              >
                <CardFace card={card} renderSize={120} showProvision={false} />
                <span className="km-outcome" data-danger={option.ok ? undefined : ""}>
                  {option.ok ? option.outcome : option.reason}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** Quick play (not in the lesson, which walks every play) and concede, unless spectating. */
export const MatchOptions = ({ table }: { table: MatchTable }) => {
  const { lesson, duel } = table;
  const quickPlayId = useId();
  return (
    <div className="km-options">
      {lesson ? null : (
        <div className="flex items-center gap-[4px]">
          <Switch
            id={quickPlayId}
            checked={table.quickPlay}
            onCheckedChange={table.setQuickPlay}
            touchTarget
            className="-ml-[8px] shrink-0"
          />
          <Label htmlFor={quickPlayId} className="cursor-pointer text-[13px] font-bold">
            Quick play
            <span className="text-muted-foreground block text-[12px] font-normal">
              Play on the first row tap when the card needs no other choice.
            </span>
          </Label>
        </div>
      )}
      {table.over || table.spectating ? null : (
        <Confirm
          title={duel ? "Concede the duel?" : "Concede the match?"}
          className="kessen-scene km-dialog"
          tone="destructive"
          proceed_label="Concede"
          disabled={table.pending}
          button={
            <Button
              type="button"
              variant="outline"
              className="km-concede w-full gap-[5px] text-[13px]"
            >
              <Flag className="h-4 w-4" aria-hidden />
              <span>{duel ? "Concede duel" : "Concede match"}</span>
            </Button>
          }
          onAccept={() => void table.concede()}
        >
          {duel?.kind === "RANKED"
            ? `${table.opponentName} wins the duel, and your rating moves as for a loss.`
            : `${table.opponentName} wins the ${duel ? "duel" : "match"}, and it counts as a loss.`}
        </Confirm>
      )}
    </div>
  );
};

/**
 * The match's house rule, if any, then the fifteen keywords and their one-line rules.
 * Terrain reads as the player casts it, with a second line when the opponent's reaches
 * differently (Permafrost).
 */
export const RulesGlossary = ({ table }: { table: MatchTable }) => {
  const mine = seatReach(table, table.me);
  const theirs = seatReach(table, table.them);
  return (
    <>
      {table.houseRule ? <HouseRuleNote rule={table.houseRule} /> : null}
      <ul className="km-glossary-list">
        {KESSEN_KEYWORDS.map((keyword) => (
          <li key={keyword}>
            <ReachGlossary keyword={keyword} reach={mine} />
            {keyword === "Terrain" && theirs !== mine ? (
              <span className="km-glossary-aside">
                {theirs === "enemy"
                  ? `${table.opponentName}'s Terrain afflicts only your row (Permafrost).`
                  : `${table.opponentName}'s Terrain afflicts both sides.`}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
};

/**
 * A keyword's glossary line as one seat casts it: Terrain names the one-sided case under
 * Permafrost. Same markup as the shared `KeywordGlossary`.
 */
export const ReachGlossary = ({
  keyword,
  reach,
}: {
  keyword: KessenKeyword;
  reach: TerrainReach;
}) => (
  <span className="kessen-glossary-line">
    <span className="kessen-kw" data-kw={keyword}>
      {keyword}
    </span>
    <span>: {keywordGlossary(keyword, reach)}</span>
  </span>
);

/** Terrain reach of a seat this round. */
export const seatReach = (table: MatchTable, seat: Seat) =>
  terrainReach(table.view.seats[seat].faction, table.view);

/** A house rule in force for the whole match: its name and what it changes. */
export const HouseRuleNote = ({ rule }: { rule: KessenHouseRule }) => (
  <p className="km-house-line">
    <span className="km-house-name">House rule · {rule.name}</span> {rule.text}
  </p>
);

/** Inspect key of a catalog card that is not on the table (a reward, a pick). */
export const catalogInspectKey = (cardId: string) => `card:${cardId}`;

const catalogKeyOf = (key: string) => (key.startsWith("card:") ? key.slice(5) : null);

/** Owner of a card instance off the board: the opponent's discard is theirs, else the player's. */
const instanceSeat = (table: MatchTable, instance: string): Seat =>
  table.view.seats[table.them].discard.includes(instance) ? table.them : table.me;

/** The type line of a card: Tactic, Leader or its row. */
const kindLabel = (card: KessenCardDisplay) => {
  if (card.kind === "TACTIC") return "Tactic";
  if (card.kind === "LEADER") return "Leader";
  return !card.row || card.row === "ANY" ? "Any row" : ROW_LABELS[card.row];
};
