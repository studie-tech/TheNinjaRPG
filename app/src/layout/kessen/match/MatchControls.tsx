"use client";

import { Crown, Maximize2, ScrollText, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/libs/shadui";
import { KeywordText } from "../KeywordText";
import { targetPrompt } from "./matchText";
import { useLongPress } from "./useLongPress";
import { type MatchTable, placementSide } from "./useMatchTable";

/**
 * The line between the board and the hand: errors next to the action, what to choose
 * next, the drafted card's text, or the pass facts.
 */
export const PromptStrip = ({ table }: { table: MatchTable }) => {
  const { draft, request, message } = table;
  const selected = draft.card ? table.instanceCard(draft.card) : null;
  const leader =
    draft.action?.t === "leader" && table.view.seats[table.me].leader
      ? table.cardDisplay(table.view.seats[table.me].leader as string)
      : null;
  const subject = selected ?? leader;

  let tone: "error" | "info" | "facts" = "info";
  let body: React.ReactNode = null;
  const actions: React.ReactNode[] = [];

  if (message) {
    tone = "error";
    body = <span role="alert">{message}</span>;
    actions.push(
      <IconAction
        key="dismiss"
        label="Dismiss"
        onClick={() => table.setMessage(null)}
      />,
    );
  } else if (table.pending) {
    body = <span>Sending your play…</span>;
  } else if (table.holding) {
    body = <span>Round {table.view.round} is over.</span>;
  } else if (table.playing) {
    body = <span>{table.opponentName} is at the table…</span>;
    actions.push(
      <Button
        key="skip"
        type="button"
        variant="outline"
        size="sm"
        className="km-hit km-prompt-btn text-[12px]"
        onClick={table.skipPlayback}
      >
        Skip
      </Button>,
    );
  } else if (subject && (draft.card || draft.action)) {
    const ghost = table.draftGhost;
    const infiltrates =
      draft.card !== null &&
      placementSide(table.view, draft.card, table.me) !== table.me;
    // A unit with every row closed says why instead of asking for a row.
    const noRow =
      draft.card !== null &&
      draft.action === null &&
      table.rowChoices.length > 0 &&
      table.rowChoices.every((choice) => !choice.legal)
        ? (table.handNotes.get(draft.card) ?? "No row can take it now.")
        : null;
    const detail = ghost?.detail ? ` · ${ghost.detail}` : "";
    const instruction = request
      ? targetPrompt(request.kind, request.ability, request.optional)
      : table.draftError
        ? table.draftError
        : noRow
          ? noRow
          : draft.action && table.ready
            ? draft.action.t === "play" && draft.action.row
              ? ghost
                ? `${ghost.main}${detail}. Tap the row again or Confirm.`
                : "Tap the row again or Confirm."
              : table.draftNoEffect && ghost
                ? `Plays for no effect: ${ghost.fizzles.join(", ")}.`
                : ghost
                  ? `Confirm: ${ghost.them ? `${table.opponentName} ` : ""}${ghost.main}, ${ghost.totalsLine}${detail}.`
                  : "Confirm to play."
            : infiltrates
              ? `Tap a row on ${table.opponentName}'s side; it counts for them.`
              : table.placementNote
                ? `Tap a row. ${table.placementNote} this round.`
                : "Tap a row.";
    if (table.draftError || noRow) tone = "error";
    body = (
      <span className="km-prompt-card">
        <span className="km-prompt-name">{subject.name}</span>
        <span className="km-prompt-instruction">{instruction}</span>
        <span className="km-prompt-text">
          <KeywordText abilities={subject.abilities} empty="No ability." />
        </span>
      </span>
    );
    if (draft.action && table.ready) {
      // A play that would change nothing is still allowed, but never as the primary.
      const noEffect = table.draftNoEffect && !request;
      actions.push(
        <Button
          key="confirm"
          type="button"
          variant={noEffect ? "outline" : "default"}
          className="km-confirm km-prompt-btn text-[13px]"
          data-lesson-target="confirm"
          onClick={table.confirm}
          data-button-sfx="off"
        >
          {request?.optional ? "Done" : noEffect ? "Play for no effect" : "Confirm"}
        </Button>,
      );
    }
    actions.push(
      <IconAction key="cancel" label="Cancel this play" onClick={table.cancel} />,
    );
  } else if (table.over) {
    body = <span>The match is over.</span>;
  } else if (table.myTurn) {
    tone = "facts";
    body = <span>{table.facts.line}</span>;
  } else if (table.view.seats[table.me].passed) {
    body = <span>You passed this round.</span>;
  } else if (table.view.phase === "mulligan") {
    body = (
      <span>
        {table.duel
          ? `Waiting for ${table.opponentName} to finish the mulligan.`
          : "Mulligan in progress."}
      </span>
    );
  } else if (table.duel) {
    body = <span>{table.opponentName} is choosing a play…</span>;
  } else {
    body = <span>{table.opponentName}'s turn.</span>;
  }

  return (
    <div className="km-prompt" data-tone={tone} aria-live="polite">
      <div className="km-prompt-body">{body}</div>
      {actions.length > 0 ? <div className="km-prompt-actions">{actions}</div> : null}
    </div>
  );
};

/** A small ghost icon button of the prompt strip (dismiss, cancel). */
const IconAction = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="km-hit h-8 w-8"
    onClick={onClick}
    aria-label={label}
  >
    <X className="h-4 w-4" aria-hidden />
  </Button>
);

/**
 * Pass, Leader, Hand and Log. Passing takes one tap, except when the opponent has passed
 * and passing loses or ties the round: then the button states what it keeps and needs a
 * second tap within three seconds, which the button itself counts down. A lesson asks
 * before a pass its coach advises against (`onPassRequest`).
 */
export const ActionBar = ({
  table,
  lesson,
  onPassRequest,
  onOpenHand,
  onOpenLog,
}: {
  table: MatchTable;
  lesson: boolean;
  /** Called instead of passing, so the pass is confirmed first. */
  onPassRequest?: () => void;
  onOpenHand: () => void;
  onOpenLog: () => void;
}) => {
  const { view, me } = table;
  const zone = view.seats[me];
  const leaderReady = table.canAct && zone.leader !== null && !zone.leaderUsed;
  const leaderActive = table.draft.action?.t === "leader";
  // Right-click or a long press reads the leader like any card; so does a tap while the
  // ability cannot be used.
  const readLeader = () => table.inspect(`leader:${me}`);
  const { consumeLongPress, ...leaderPress } = useLongPress({
    onLongPress: readLeader,
  });
  return (
    <div className="km-actions" role="toolbar" aria-label="Match actions">
      <PassControl table={table} lesson={lesson} onPassRequest={onPassRequest} />
      {zone.leader === null ? null : (
        <Button
          type="button"
          variant={leaderActive ? "default" : "secondary"}
          className={cn("km-action gap-[5px]", !leaderReady && "opacity-60")}
          data-lesson-target="leader"
          onClick={() => {
            if (consumeLongPress()) return;
            if (leaderReady) table.startLeader();
            else readLeader();
          }}
          aria-pressed={leaderReady ? leaderActive : undefined}
          title={
            leaderReady
              ? "Use your leader (once per match). Right-click or hold to read it."
              : zone.leaderUsed
                ? "Leader ability used. Tap to read it."
                : "Tap to read your leader."
          }
          data-button-sfx="off"
          {...leaderPress}
        >
          <Crown className="h-4 w-4" aria-hidden />
          <span>Leader</span>
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        className="km-action km-action-square gap-[5px]"
        onClick={onOpenHand}
        aria-label="Show the whole hand"
        title="Show the whole hand"
      >
        <Maximize2 className="h-4 w-4" aria-hidden />
        <span>Hand</span>
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="km-action km-action-square gap-[5px]"
        onClick={onOpenLog}
        aria-label="Play log, discards and options"
        title="Play log, discards and options"
      >
        <ScrollText className="h-4 w-4" aria-hidden />
        <span>Log</span>
      </Button>
    </div>
  );
};

const PassControl = ({
  table,
  lesson,
  onPassRequest,
}: {
  table: MatchTable;
  lesson: boolean;
  onPassRequest?: () => void;
}) => {
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(ARM_SECONDS);
  const confirmId = useId();
  const facts = table.facts;
  // A finished match has no round left to end, so Pass never states what it keeps.
  const needsSecondTap = facts.armed && !lesson && !table.over;
  const armed = needsSecondTap && armedAt !== null;

  useEffect(() => {
    if (armedAt === null) return;
    setSecondsLeft(ARM_SECONDS);
    const tick = window.setInterval(() => {
      const left = Math.ceil((armedAt + ARM_SECONDS * 1000 - Date.now()) / 1000);
      if (left <= 0) setArmedAt(null);
      else setSecondsLeft(left);
    }, 250);
    return () => window.clearInterval(tick);
  }, [armedAt]);

  // A changed board (or turn) disarms the second tap.
  useEffect(() => setArmedAt(null), [table.view, table.canAct]);

  const onClick = () => {
    if (!table.canAct) return;
    if (onPassRequest) {
      onPassRequest();
      return;
    }
    if (needsSecondTap && !armed) {
      setArmedAt(Date.now());
      return;
    }
    setArmedAt(null);
    table.pass();
  };
  // The confirm lives on the button's own second line, so nothing covers the hand.
  return (
    <div className="km-pass-wrap">
      <Button
        type="button"
        variant={armed ? "destructive" : "default"}
        decoration="gold"
        className="km-btn-pass w-full"
        data-lesson-target="pass"
        data-armed={armed ? "" : undefined}
        disabled={!table.canAct}
        onClick={onClick}
        data-long={needsSecondTap ? "" : undefined}
        aria-label={armed ? `${facts.label}: tap again to confirm` : undefined}
        aria-describedby={armed ? confirmId : undefined}
        data-button-sfx="off"
      >
        {armed ? (
          <>
            <span className="km-pass-main">
              Tap again · <span className="km-pass-count">{secondsLeft}s</span>
            </span>{" "}
            <span className="km-pass-sub">to end the round</span>
            <span className="km-pass-timer" aria-hidden />
          </>
        ) : needsSecondTap ? (
          <PassLabel label={facts.label} />
        ) : (
          "Pass"
        )}
      </Button>
      <span id={confirmId} className="sr-only" role="status">
        {armed ? "Tap again within 3 seconds to end the round." : ""}
      </span>
    </div>
  );
};

/** "End round, keep 6 cards" on two lines when the button is narrow, never cut off. */
const PassLabel = ({ label }: { label: string }) => {
  const split = label.indexOf(", ");
  if (split < 0) return <>{label}</>;
  return (
    <>
      <span className="km-pass-main">{label.slice(0, split + 1)}</span>{" "}
      <span className="km-pass-sub">{label.slice(split + 2)}</span>
    </>
  );
};

const ARM_SECONDS = 3;
