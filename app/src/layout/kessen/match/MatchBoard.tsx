"use client";

import { Button } from "@/components/ui/button";
import { academyRowKey } from "@/libs/kessen/academy";
import { ROWS } from "@/libs/kessen/rules";
import { ROW_LABELS } from "@/libs/kessen/text";
import type { Row, Seat, Unit } from "@/libs/kessen/types";
import { CardBack } from "../CardBack";
import { CardTile } from "../CardTile";
import { RowGlyph } from "../glyphs";
import type { KessenCardDisplay } from "../kessenArt";
import { signed } from "./matchText";
import { useLongPress } from "./useLongPress";
import {
  isRowKind,
  isUnitKind,
  type MatchTable,
  placementSide,
  rowAfterOf,
  rowEffectKey,
  rowRequestAccepts,
  rowTotalOf,
} from "./useMatchTable";
import { useTweenedNumber } from "./useTweenedNumber";

/**
 * The war table: the opponent's Ninjutsu, Bukijutsu and Taijutsu rows, the centre band,
 * then the player's Taijutsu, Bukijutsu and Ninjutsu rows (centre line outward). Rows,
 * their totals, unit tiles, the centre band and the hand-size badge carry lesson targets.
 */
export const MatchBoard = ({
  table,
  pulseBadge,
  lesson = false,
}: {
  table: MatchTable;
  pulseBadge: boolean;
  /** Names each row beside its glyph. */
  lesson?: boolean;
}) => {
  const { view, me, them } = table;
  return (
    <div
      className="km-board-inner"
      data-picking={rowPicking(table) ? "" : undefined}
      data-lesson={lesson ? "" : undefined}
    >
      {OPPONENT_ROWS.map((row) => (
        <BoardRow key={`t-${row}`} table={table} side={them} row={row} named={lesson} />
      ))}
      <CenterBand table={table} pulseBadge={pulseBadge} />
      {ROWS.map((row) => (
        <BoardRow key={`m-${row}`} table={table} side={me} row={row} named={lesson} />
      ))}
      {view.phase === "mulligan" && !table.mulliganOpen && !table.playing ? (
        <p className="km-board-note">Waiting for the mulligan…</p>
      ) : null}
    </div>
  );
};

/** One row of one side: glyph rail, up to five tiles, ghost slot and the row total. */
const BoardRow = ({
  table,
  side,
  row,
  named,
}: {
  table: MatchTable;
  side: Seat;
  row: Row;
  named: boolean;
}) => {
  const { view, me, powers, draft, rowChoices, request, options, step } = table;
  const units = view.board[side][row];
  const terrain = view.terrain[side][row];
  const total = rowTotalOf(view, powers, side, row);
  const mine = side === me;

  const choice = rowChoices.find((entry) => entry.row === row && entry.side === side);
  const sending =
    table.sent && table.sent.side === side && table.sent.row === row
      ? table.sent
      : null;
  const chosen =
    !table.pending &&
    draft.action?.t === "play" &&
    draft.action.row === row &&
    draft.card !== null &&
    placementSide(view, draft.card, me) === side
      ? draft.action
      : null;
  // Once a row is chosen, the other open rows stay quiet; closed rows stay dimmed.
  const placing = draft.action?.t === "play" && draft.action.row !== undefined;
  const rowTarget =
    request &&
    isRowKind(request.kind) &&
    rowRequestAccepts(request, view, me, side, row)
      ? options.find((option) => option.target === row)
      : undefined;

  // A closed row on the placing side names its reason; the other side only dims.
  const closedReason =
    choice &&
    !choice.legal &&
    draft.card &&
    choice.side === placementSide(view, draft.card, me)
      ? choice.reason
      : null;
  // A row the play changes without being placed or aimed at (an automatic Terrain)
  // shows its total after the play and what happens to it.
  const effect =
    !sending && !chosen && !rowTarget && !choice?.legal && !closedReason
      ? table.rowEffects.get(rowEffectKey(side, row))
      : undefined;

  const state = sending
    ? "sending"
    : chosen
      ? "chosen"
      : rowTarget
        ? rowTarget.ok
          ? "target"
          : "illegal"
        : effect
          ? "effect"
          : choice
            ? choice.legal
              ? placing
                ? undefined
                : "legal"
              : "illegal"
            : undefined;
  const reason = rowTarget && !rowTarget.ok ? rowTarget.reason : closedReason;
  const fxRow =
    step?.fx?.kind === "terrain" &&
    step.fx.row?.side === side &&
    step.fx.row.row === row;

  // The new unit's power in the chosen row comes from the draft preview.
  const chosenAfter = chosen ? previewPowerOf(table, chosen.card) : null;
  const ghostTotal = sending
    ? sending.rowAfter
    : state === "legal" && choice?.ghost
      ? choice.rowAfter
      : state === "chosen"
        ? rowAfterOf(table.draftUnits, side, row)
        : effect
          ? effect.after
          : null;
  const shownTotal = useTweenedNumber(ghostTotal ?? total, table.motion);
  // Summoned units join the player's own rows; their power is unknown until played.
  const ghostPartial =
    mine &&
    (state === "legal"
      ? choice?.ghost?.partial === true
      : state === "chosen" && table.draftGhost?.partial === true);

  const label = `${mine ? "Your" : `${table.opponentName}'s`} ${ROW_LABELS[row]}, total ${total}${terrain ? ", under Terrain" : ""}${effect ? `. This play: ${effect.label}, total ${effect.after}` : ""}`;
  const selectable = state === "legal" || state === "chosen" || state === "target";
  return (
    <div
      className="km-row"
      data-lesson-target="row"
      data-lesson-key={academyRowKey(mine ? "me" : "them", row)}
      data-side={mine ? "me" : "them"}
      data-row={row}
      data-state={state}
      data-terrain={terrain ? "" : undefined}
      data-fx={fxRow ? "terrain" : undefined}
    >
      <button
        type="button"
        className="km-row-hit"
        aria-label={
          selectable
            ? `${label}. ${state === "chosen" ? "Tap again to play here" : "Choose this row"}`
            : label
        }
        aria-disabled={!selectable}
        onClick={() => table.tapRow(side, row)}
        data-button-sfx="off"
      />
      <span className="km-rail" aria-hidden>
        <RowGlyph row={row} decorative />
      </span>
      {named ? (
        <span className="km-row-name" aria-hidden>
          {ROW_LABELS[row]}
        </span>
      ) : null}
      <div className="km-units">
        {units.map((unit) => (
          <BoardUnit key={unit.id} table={table} unit={unit} side={side} row={row} />
        ))}
        {state === "legal" && choice?.ghost ? (
          <span
            className="km-ghost-slot"
            data-them={choice.ghost.them ? "" : undefined}
            data-fizzle={choice.ghost.fizzles.length > 0 ? "" : undefined}
            aria-hidden
          >
            <span className="km-ghost-main">{choice.ghost.main}</span>
            {/* A fizzle takes two short lines, ability then reason, so it fits a tile. */}
            {!choice.needsTarget && choice.ghost.fizzleTile ? (
              choice.ghost.fizzleTile.map((line) => (
                <span key={line} className="km-ghost-sub">
                  {line}
                </span>
              ))
            ) : (
              <span className="km-ghost-sub">
                {choice.needsTarget
                  ? "then aim"
                  : choice.ghost.kills.length > 0
                    ? `kills ${choice.ghost.kills.length}`
                    : choice.ghost.them
                      ? "for them"
                      : choice.ghost.totals}
              </span>
            )}
          </span>
        ) : null}
        {chosen && draft.card ? (
          <ChosenGhost table={table} instance={draft.card} power={chosenAfter} />
        ) : null}
        {sending ? (
          <ChosenGhost
            table={table}
            instance={sending.card}
            power={sending.power}
            sending
          />
        ) : null}
      </div>
      <span
        className="km-total"
        data-lesson-target="row-total"
        data-lesson-key={academyRowKey(mine ? "me" : "them", row)}
        aria-hidden
        data-ghost={ghostTotal === null ? undefined : ghostTotal < total ? "down" : ""}
      >
        <span className="km-total-value">
          {shownTotal}
          {ghostTotal !== null && ghostPartial ? "+?" : null}
        </span>
      </span>
      {state === "illegal" && reason ? (
        <span className="km-row-reason">{reason}</span>
      ) : null}
      {state === "target" && rowTarget?.outcome ? (
        <span className="km-row-outcome">{rowTarget.outcome}</span>
      ) : null}
      {effect ? (
        <span className="km-row-outcome" data-effect="">
          {effect.label}
        </span>
      ) : null}
      {state === "chosen" && table.ready ? (
        <Button
          type="button"
          size="sm"
          className="km-row-confirm"
          onClick={() => table.confirm()}
          data-button-sfx="off"
        >
          Confirm
        </Button>
      ) : null}
    </div>
  );
};

/**
 * A unit tile: tap to target, to choose its row while placing a card, or to inspect;
 * long-press or hover always inspects.
 */
const BoardUnit = ({
  table,
  unit,
  side,
  row,
}: {
  table: MatchTable;
  unit: Unit;
  side: Seat;
  row: Row;
}) => {
  const { view, request, options, step, powers } = table;
  const card = table.instanceCard(unit.id);
  const { consumeLongPress, ...press } = useLongPress({
    onLongPress: () => table.inspect(unit.id),
    onHover: () => table.setInspected(unit.id),
  });
  if (!card) return null;
  const power = powers.get(unit.id) ?? unit.stored;
  const option =
    request && isUnitKind(request.kind)
      ? options.find((entry) => entry.target === unit.id)
      : undefined;
  const delta = draftDelta(table, unit.id);
  const killed = table.draftKills.includes(unit.id);
  const fx = step?.fx?.ids.includes(unit.id) ? step.fx : null;
  const kept = step?.fx?.kind === "sweep" && step.fx.kept?.includes(unit.id);
  // The player's own card keeps its ghost's glow while it settles and the totals count.
  const settling = fx?.kind === "settle";
  const highlight = option
    ? option.ok
      ? option.danger
        ? "danger"
        : "target"
      : "dim"
    : killed
      ? "danger"
      : request && isUnitKind(request.kind)
        ? "dim"
        : table.inspected === unit.id || settling
          ? "selected"
          : undefined;
  const status = tileStatus(card, unit, view.knobs.meditateCap);
  const terrain = view.terrain[side][row] && !status.unyielding;
  const carried = unit.seq <= view.roundSeq;
  return (
    <button
      type="button"
      className="km-unit"
      data-lesson-target="unit"
      data-lesson-key={unit.id}
      data-fx={fx ? fx.kind : kept ? "kept" : undefined}
      data-frost={terrain ? "" : undefined}
      aria-label={`${card.name}, power ${power}${option?.ok ? `, choose: ${option.outcome}` : ""}`}
      onClick={() => {
        if (consumeLongPress()) return;
        table.tapUnit(unit.id, side, row);
      }}
      data-button-sfx="off"
      {...press}
    >
      <CardTile
        card={card}
        power={power}
        status={status}
        terrain={terrain}
        carried={carried}
        highlight={highlight}
        row={row}
        renderSize={96}
        aria-label={undefined}
        aria-hidden
      />
      {option?.ok && option.outcome ? (
        <span className="km-outcome" data-danger={option.danger ? "" : undefined}>
          {option.outcome}
        </span>
      ) : delta !== null ? (
        <span className="km-delta" data-sign={delta > 0 ? "up" : "down"}>
          {signed(delta)}
        </span>
      ) : null}
      {fx && (fx.kind === "damage" || fx.kind === "boost") && fx.amount ? (
        <span className="km-float" data-kind={fx.kind}>
          {fx.kind === "damage" ? `−${fx.amount}` : `+${fx.amount}`}
        </span>
      ) : null}
    </button>
  );
};

/** The selected card standing in its chosen row before Confirm, and while it is sent. */
const ChosenGhost = ({
  table,
  instance,
  power,
  sending = false,
}: {
  table: MatchTable;
  instance: string;
  power: number | null;
  sending?: boolean;
}) => {
  const card = table.instanceCard(instance);
  if (!card) return null;
  return (
    <span className="km-chosen" data-sending={sending ? "" : undefined} aria-hidden>
      <CardTile
        card={card}
        power={power ?? card.power}
        renderSize={96}
        highlight="selected"
      />
    </span>
  );
};

/** Round dots, pass states, the card-edge badge (hand sizes) and what each side needs. */
const CenterBand = ({
  table,
  pulseBadge,
}: {
  table: MatchTable;
  pulseBadge: boolean;
}) => {
  const { view, me, them, opponentName } = table;
  const badgeLabel = `Cards in hand: ${table.spectating ? table.selfName : "you"} ${view.seats[me].handCount}, ${opponentName} ${view.seats[them].handCount}`;
  return (
    <section
      className="km-center"
      aria-label="Round status"
      data-lesson-target="center"
    >
      <span className="km-rounds" role="img" aria-label={roundsLabel(table)}>
        {[1, 2, 3].map((round) => {
          const result = view.history.find((entry) => entry.round === round);
          const state = result
            ? result.winner === null
              ? "tie"
              : result.winner === me
                ? "won"
                : "lost"
            : round === view.round
              ? "now"
              : "later";
          return <span key={round} className="km-round-dot" data-state={state} />;
        })}
      </span>
      <span
        className="km-edge-badge"
        data-lesson-target="badge"
        data-pulse={pulseBadge ? "" : undefined}
        title="Cards in hand"
        role="img"
        aria-label={badgeLabel}
      >
        {/* Labelled and set in body type on dark lacquer, so the counts never read as
            the score. */}
        <CardBack className="km-edge-card" renderSize={24} aria-hidden />
        <span className="km-edge-label">Hand</span>
        {table.spectating ? (
          <span className="km-edge-name">{table.selfName}</span>
        ) : null}
        <span>
          {table.spectating ? "" : "You "}
          {view.seats[me].handCount} ·{" "}
        </span>
        {/* A long name gives way before either count does. */}
        <span className="km-edge-name">{opponentName}</span>
        <span> {view.seats[them].handCount}</span>
      </span>
      {/* A paper chip like the edge badge, the number in score figures; the sentence
          with the opponent's name is for screen readers. */}
      {table.needText ? (
        <span className="km-need" role="img" aria-label={table.needText.full}>
          <span className="km-need-lead">{table.needText.lead}</span>
          {table.needText.count !== null ? (
            <span className="km-need-count">{table.needText.count}</span>
          ) : null}
        </span>
      ) : null}
    </section>
  );
};

/** Tile status from the card and the unit: one corner glyph in priority order. */
export const tileStatus = (
  card: KessenCardDisplay,
  unit: Unit,
  meditateCap: number,
) => {
  const unyielding = card.abilities.some((ability) => ability.k === "unyielding");
  const meditates = card.abilities.some((ability) => ability.k === "meditate");
  return {
    sealed: unit.sealed,
    unyielding,
    resilient: unit.res && !unit.sealed,
    meditate: meditates && !unit.sealed ? { gained: unit.med, cap: meditateCap } : null,
  };
};

const rowPicking = (table: MatchTable) =>
  (table.draft.card !== null && table.draft.action === null) ||
  (table.request !== null && isRowKind(table.request.kind));

/** Displayed power change of a unit under the drafted play; null when unchanged. */
const draftDelta = (table: MatchTable, id: string) => {
  const unit = table.draftUnits.find((entry) => entry.id === id);
  if (!unit || unit.before === null || unit.after === null) return null;
  const change = unit.after - unit.before;
  return change === 0 ? null : change;
};

const previewPowerOf = (table: MatchTable, instance: string) =>
  table.draftUnits.find((entry) => entry.id === instance)?.after ?? null;

const roundsLabel = (table: MatchTable) =>
  table.view.history
    .map(
      (entry) =>
        `Round ${entry.round}: ${entry.winner === null ? "tie" : entry.winner === table.me ? "won" : "lost"}`,
    )
    .concat(`Round ${table.view.round} in play`)
    .join(", ");

const OPPONENT_ROWS: Row[] = ["JUTSU", "RANGED", "CLOSE"];
