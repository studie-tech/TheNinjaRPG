"use client";

import { useEffect, useRef, useState } from "react";
import { CardFace, kessenCardLabel } from "../CardFace";
import type { HandSort } from "./MatchBars";
import { plural } from "./matchText";
import { useLongPress } from "./useLongPress";
import type { MatchTable } from "./useMatchTable";

/**
 * The hand: on phones one row of 60 × 84 cards with horizontal scroll-snap and no
 * overlap, the card past the edge peeking under a fade (the dock's Hand button shows them
 * all); on wider tables the cards shrink until the whole hand fits and overlap only past
 * that size, with the hovered, focused or selected card lifted above its neighbours. The
 * grid layout is the 5 × 2 hand sheet. Cards too narrow for their name banner carry
 * their short name below, wrapped only between words. A card that can do nothing now (no
 * open row, no target) is dimmed with the reason. Tap selects, long-press or hover
 * inspects. The strip (or the sheet's grid) and each card carry lesson targets. A
 * spectator sees both hands' sizes in its place.
 */
export const HandStrip = ({
  table,
  sort,
  layout = "strip",
  onPicked,
}: {
  table: MatchTable;
  sort: HandSort;
  layout?: "strip" | "grid";
  onPicked?: () => void;
}) => {
  const hand = sortedHand(table, sort);
  const strip = layout === "strip";
  const listRef = useRef<HTMLUListElement>(null);
  const [hidden, setHidden] = useState({ start: 0, end: 0 });
  const count = hand.length;

  // Counts the cards that are not fully in view on either side of the strip.
  useEffect(() => {
    const list = listRef.current;
    if (!strip || !list) return;
    const measure = () => {
      const left = list.scrollLeft;
      const right = left + list.clientWidth;
      let start = 0;
      let end = 0;
      for (const child of list.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.offsetLeft < left - 2) start += 1;
        else if (child.offsetLeft + child.offsetWidth > right + 2) end += 1;
      }
      setHidden((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [strip, count]);

  if (hand.length === 0) {
    const { view, me, them } = table;
    return (
      <div className="km-hand" data-layout={layout} data-empty="">
        <p className="km-hand-empty">
          {table.spectating
            ? `${table.selfName} holds ${plural(view.seats[me].handCount, "card")}, ${table.opponentName} ${view.seats[them].handCount}.`
            : "No cards in hand."}
        </p>
      </div>
    );
  }
  const list = (
    <ul
      ref={listRef}
      className="km-hand"
      data-layout={layout}
      aria-label="Your hand"
      data-lesson-target={strip ? undefined : "hand"}
      style={{ "--hand-count": count } as React.CSSProperties}
    >
      {hand.map((instance, index) => (
        <HandCard
          key={instance}
          table={table}
          instance={instance}
          index={index}
          onPicked={onPicked}
        />
      ))}
    </ul>
  );
  if (!strip) return list;
  return (
    <div
      className="km-hand-scroll"
      data-lesson-target="hand"
      data-more-start={hidden.start > 0 ? "" : undefined}
      data-more-end={hidden.end > 0 ? "" : undefined}
    >
      {list}
    </div>
  );
};

/** One card in hand: a tap selects it, or picks it when a hand target is asked for. */
const HandCard = ({
  table,
  instance,
  index,
  onPicked,
}: {
  table: MatchTable;
  instance: string;
  /** Position in the shown order, for lessons that point at "the second card". */
  index: number;
  onPicked?: () => void;
}) => {
  const card = table.instanceCard(instance);
  const { consumeLongPress, ...press } = useLongPress({
    onLongPress: () => table.inspect(instance),
    onHover: () => table.setInspected(instance),
  });
  if (!card) return null;
  const selected = table.draft.card === instance;
  const handTarget =
    table.request?.kind === "hand"
      ? table.options.find((option) => option.target === instance)
      : undefined;
  const pending = table.pending && selected;
  const blocked = handTarget ? null : (table.handNotes.get(instance) ?? null);
  return (
    <li className="km-hand-slot">
      <button
        type="button"
        className="km-hand-card"
        data-lesson-target="hand-card"
        data-lesson-key={instance}
        data-lesson-card={card.id}
        data-lesson-index={index}
        data-selected={selected ? "" : undefined}
        data-target={handTarget?.ok ? "" : undefined}
        data-pending={pending ? "" : undefined}
        data-blocked={blocked ? "" : undefined}
        aria-pressed={selected}
        aria-label={`${kessenCardLabel(card)}${selected ? ", selected" : ""}${blocked ? `. ${blocked}` : ""}`}
        title={blocked ?? undefined}
        onClick={() => {
          if (consumeLongPress()) return;
          if (handTarget) table.chooseTarget(instance);
          else table.selectCard(instance);
          onPicked?.();
        }}
        data-button-sfx="off"
        {...press}
      >
        <CardFace
          card={card}
          renderSize={120}
          selected={selected}
          showProvision={false}
          className="km-hand-face"
        />
        <span className="km-card-name" aria-hidden>
          {shortCardName(card.name)}
        </span>
        {blocked ? (
          <span className="km-hand-block" aria-hidden>
            {blockStamp(blocked)}
          </span>
        ) : null}
        {handTarget?.ok ? (
          <span className="km-outcome">{handTarget.outcome}</span>
        ) : null}
      </button>
    </li>
  );
};

/**
 * The name under a small card: an epithet after a comma gives way ("Lemu, Academy
 * Instructor" reads "Lemu"), so the words that tell two cards apart stay in view.
 */
export const shortCardName = (name: string) => {
  const comma = name.indexOf(", ");
  return comma > 0 ? name.slice(0, comma) : name;
};

/** The stamp on a dimmed hand card: the gist of its reason. */
const blockStamp = (reason: string) =>
  /room|row/i.test(reason)
    ? "No room"
    : /target|effect/i.test(reason)
      ? "No target"
      : "Blocked";

/** Hand order: by row (Taijutsu, Bukijutsu, Ninjutsu, Any, tactics), by power, or as drawn. */
const sortedHand = (table: MatchTable, sort: HandSort) => {
  const hand = [...(table.view.seats[table.me].hand ?? [])];
  if (sort === "order") return hand;
  const key = (instance: string) => {
    const card = table.instanceCard(instance);
    if (!card) return [9, 0];
    const rowRank = card.kind === "TACTIC" ? 4 : card.row ? ROW_RANK[card.row] : 5;
    return sort === "row" ? [rowRank, -card.power] : [-card.power, rowRank];
  };
  return hand.sort((a, b) => {
    const [a1, a2] = key(a) as [number, number];
    const [b1, b2] = key(b) as [number, number];
    return a1 - b1 || a2 - b2;
  });
};

const ROW_RANK = { CLOSE: 0, RANGED: 1, JUTSU: 2, ANY: 3 } as const;
