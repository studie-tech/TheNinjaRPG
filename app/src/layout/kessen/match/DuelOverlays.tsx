"use client";

import {
  ArrowDown,
  ArrowUp,
  Coins,
  Hourglass,
  Info,
  Package,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AvatarImage from "@/layout/Avatar";
import { kessenPackName } from "@/libs/kessen/packs";
import type { Seat } from "@/libs/kessen/types";
import { cn } from "@/libs/shadui";
import type { KessenPvpMatchPayload } from "@/validators/kessen";
import { EndRounds } from "./MatchOverlays";
import type { MatchTable } from "./useMatchTable";

/**
 * The duel's turn clock above the prompt: whose decision it is, the seconds left as a
 * draining bar (red under ten seconds) and, once anyone missed a turn, both seats' missed
 * turns against the forfeit limit. A turn just lost to the clock is named here until the
 * next one. The deadline is read against the server's time of the payload, so a skewed
 * device clock shows the same seconds.
 */
export const DuelClock = ({
  table,
  duel,
}: {
  table: MatchTable;
  duel: KessenPvpMatchPayload;
}) => {
  const { clock } = duel;
  const left = useSecondsLeft(duel);
  const timeout = useLatestTimeout(duel, table.spectating);
  const { spectating, selfName } = table;
  if (!clock.deadline || duel.status !== "ACTIVE") return null;
  const mine = clock.acting.includes(duel.seat);
  const theirs = clock.acting.includes(table.them);
  const mulligan = table.confirmed.view.phase === "mulligan";
  const total = mulligan ? clock.mulliganSeconds : clock.turnSeconds;
  const label = mulligan
    ? spectating
      ? "Mulligan"
      : mine
        ? "Your mulligan"
        : `${table.opponentName}'s mulligan`
    : mine
      ? spectating
        ? `${selfName}'s turn`
        : "Your turn"
      : theirs
        ? `${table.opponentName}'s turn`
        : "Next turn";
  const urgent = left !== null && left <= URGENT_SECONDS;
  const missed = clock.timeouts.some((count) => count > 0);
  return (
    <div
      className="km-duel-clock"
      data-mine={mine && !spectating ? "" : undefined}
      data-urgent={urgent ? "" : undefined}
      role="timer"
      aria-label={`${label}: ${left ?? 0} seconds left`}
    >
      <div className="flex items-center gap-[6px]">
        <Hourglass className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
        <span className="km-duel-seconds">{formatSeconds(left ?? 0)}</span>
      </div>
      <Progress
        value={left === null ? 0 : Math.max(0, Math.min(100, (left / total) * 100))}
        className="km-duel-bar h-1.5"
        aria-hidden
      />
      {timeout || missed ? (
        <p className="km-duel-missed">
          {timeout ? <span className="font-semibold">{timeout} </span> : null}
          {missed
            ? `Missed turns: ${spectating ? selfName : "you"} ${clock.timeouts[duel.seat]}/${clock.maxTimeouts} · ${table.opponentName} ${clock.timeouts[table.them]}/${clock.maxTimeouts}. ${clock.maxTimeouts} forfeits the duel.`
            : null}
        </p>
      ) : null}
    </div>
  );
};

/**
 * Duel end over the board: the opponent's avatar under the result banner, how it ended
 * (play, concession, the clock, or no result), the rounds and, for a ranked duel, the
 * rating change of both players, the reward and why one was not paid. While the result
 * still settles it says so; the table refetches it. "Challenge again" or "Queue again"
 * and Leave table follow. A spectator sees the winner by name, with their portrait.
 */
export const DuelEndScreen = ({
  table,
  duel,
  onClose,
  onRematch,
  rematchLabel,
  isStarting = false,
  startError = null,
}: {
  table: MatchTable;
  duel: KessenPvpMatchPayload;
  onClose: () => void;
  onRematch?: () => void;
  rematchLabel?: string;
  isStarting?: boolean;
  startError?: string | null;
}) => {
  const { me, them, spectating } = table;
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);
  const result = duel.result;
  const outcome = result?.outcome ?? "draw";
  const winner = result?.winner ?? null;
  const title =
    spectating && outcome !== "void"
      ? winner === null
        ? "A draw"
        : `${duel.players[winner].username} won`
      : {
          win: "You won",
          loss: "You lost",
          draw: "You drew",
          void: "No result",
        }[outcome];
  const how = endedByText(duel, spectating);
  // A spectator sees the winner's portrait, a seat its opponent's.
  const opponent = duel.players[spectating && winner !== null ? winner : them];
  const history = table.confirmed.view.history;
  const rating = result?.rating ?? null;
  const reward = result?.reward ?? null;
  return (
    <section
      className="km-overlay km-match-end"
      data-outcome={
        outcome === "win"
          ? "won"
          : outcome === "loss"
            ? "lost"
            : outcome === "void"
              ? "expired"
              : "draw"
      }
      aria-label={title}
    >
      <div className="km-end-stack">
        <div className="km-end-story">
          <div className="km-end-hero">
            <span className="km-end-medallion" aria-hidden>
              <AvatarImage
                href={opponent.avatar}
                alt=""
                size={128}
                className="m-0 h-full w-full"
              />
            </span>
            <div className="km-brush-banner" data-size="large">
              <h2>{title}</h2>
              {how ? <p className="km-brush-line">{how}</p> : null}
            </div>
          </div>
          {spectating ? (
            <p className="km-bark km-end-bark">
              {duel.kind === "RANKED" ? "Ranked duel" : "Friendly duel"} between{" "}
              <span className="km-bark-name">{duel.players[0].username}</span> and{" "}
              <span className="km-bark-name">{duel.players[1].username}</span>
            </p>
          ) : (
            <p className="km-bark km-end-bark">
              {duel.kind === "RANKED" ? "Ranked duel" : "Friendly duel"} against{" "}
              <span className="km-bark-name">{opponent.username}</span>
              {opponent.villageName ? ` of ${opponent.villageName}` : ""}, level{" "}
              {opponent.level}
            </p>
          )}
          <EndRounds history={history} me={me} them={them} />
        </div>
        <div className="km-end-claim">
          {duel.kind === "RANKED" || result?.note || result?.settling ? (
            <section className="km-rewards" aria-label="Ranked result">
              <div className="km-reward-box">
                <h3 className="km-reward-title">
                  {duel.kind === "RANKED" ? "Ranked result" : "Result"}
                </h3>
                {result?.settling ? (
                  <p className="km-reward-line" role="status">
                    <Hourglass aria-hidden /> Settling the result…
                  </p>
                ) : null}
                {rating ? (
                  <div className="grid gap-1">
                    <RatingLine
                      label={
                        spectating
                          ? `${duel.players[me].username}'s rating`
                          : "Your rating"
                      }
                      change={rating.you}
                    />
                    <RatingLine
                      label={`${duel.players[them].username}'s rating`}
                      change={rating.opponent}
                    />
                  </div>
                ) : null}
                {reward && reward.ryo > 0 ? (
                  <p className="km-reward-line">
                    <Coins aria-hidden /> Ryo gained:{" "}
                    <strong>+{reward.ryo.toLocaleString()}</strong>
                  </p>
                ) : null}
                {reward?.packItemId ? (
                  <p className="km-reward-line">
                    <Package aria-hidden /> Weekly ranked pack:{" "}
                    <strong>{kessenPackName(reward.packItemId) ?? "Card pack"}</strong>
                  </p>
                ) : null}
                {result?.note ? (
                  <p className="km-reward-note">
                    <Info aria-hidden />
                    <span>{result.note}</span>
                  </p>
                ) : null}
              </div>
            </section>
          ) : (
            <p className="km-end-hint">
              Friendly duels pay no rewards and move no rating.
            </p>
          )}
          {onRematch && startError ? (
            <p className="km-overlay-error" role="alert">
              {startError}
            </p>
          ) : null}
          <div className="km-end-actions grid gap-2 sm:grid-cols-2">
            {onRematch ? (
              <Button
                ref={primaryRef}
                type="button"
                data-primary=""
                className="w-full gap-[6px]"
                loading={isStarting}
                onClick={onRematch}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                <span>{rematchLabel ?? "Play again"}</span>
              </Button>
            ) : null}
            <Button
              ref={onRematch ? undefined : primaryRef}
              type="button"
              variant={onRematch ? "secondary" : "default"}
              className={cn("w-full gap-[6px]", !onRematch && "sm:col-span-2")}
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
              <span>Leave table</span>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

/** "1012 → 1036 (+24)" with the direction's colour. */
const RatingLine = ({
  label,
  change,
}: {
  label: string;
  change: { before: number; after: number; delta: number };
}) => (
  <p className="km-reward-line">
    {change.delta >= 0 ? (
      <ArrowUp aria-hidden data-trend="up" />
    ) : (
      <ArrowDown aria-hidden data-trend="down" />
    )}
    <span className="min-w-0 truncate">{label}:</span>{" "}
    <strong className="tabular-nums">
      {change.before} → {change.after} ({change.delta >= 0 ? "+" : ""}
      {change.delta})
    </strong>
  </p>
);

/** The line under the banner: how the duel ended. */
const endedByText = (duel: KessenPvpMatchPayload, spectating: boolean) => {
  const result = duel.result;
  if (!result) return null;
  const loserIsMe = result.loserBy === duel.seat && !spectating;
  const loser = result.loserBy === null ? null : duel.players[result.loserBy].username;
  switch (result.endedBy) {
    case "concede":
      return loserIsMe ? "You conceded" : `${loser} conceded`;
    case "timeout":
      return loser === null
        ? "Both ran out of time"
        : loserIsMe
          ? "Your time ran out too often"
          : `${loser}'s time ran out too often`;
    case "void":
      return "Ended without a result";
    default:
      return null;
  }
};

/**
 * Seconds until the duel's deadline, measured against the payload's server time: the
 * offset to the device clock is taken when a payload arrives. Null without a deadline.
 */
const useSecondsLeft = (duel: KessenPvpMatchPayload) => {
  const deadline = duel.clock.deadline ? new Date(duel.clock.deadline).getTime() : null;
  const serverNow = new Date(duel.clock.serverNow).getTime();
  const [anchor, setAnchor] = useState(() => ({
    version: duel.version,
    skew: serverNow - Date.now(),
  }));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (anchor.version !== duel.version)
      setAnchor({ version: duel.version, skew: serverNow - Date.now() });
  }, [anchor.version, duel.version, serverNow]);
  useEffect(() => {
    if (deadline === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (now + anchor.skew)) / 1000));
};

/**
 * The turn just lost to the clock, from the missed-turn counts rising between two
 * payloads; cleared by the next payload without one.
 */
const useLatestTimeout = (duel: KessenPvpMatchPayload, spectating: boolean) => {
  const [seen, setSeen] = useState({
    version: duel.version,
    timeouts: duel.clock.timeouts,
    phase: duel.view.phase,
    text: null as string | null,
  });
  if (seen.version !== duel.version) {
    const rose = ([0, 1] as const).filter(
      (seat) => duel.clock.timeouts[seat] > seen.timeouts[seat],
    );
    setSeen({
      version: duel.version,
      timeouts: duel.clock.timeouts,
      phase: duel.view.phase,
      text:
        rose.length > 0
          ? timeoutText(duel, rose, seen.phase === "mulligan", spectating)
          : null,
    });
  }
  return seen.text;
};

/** "Kimiko ran out of time and passed the round." */
const timeoutText = (
  duel: KessenPvpMatchPayload,
  seats: readonly Seat[],
  mulligan: boolean,
  spectating: boolean,
) => {
  // The viewer's own missed turn is named first.
  const names = [...seats]
    .sort((a, b) => (a === duel.seat ? -1 : b === duel.seat ? 1 : 0))
    .map((seat) =>
      seat === duel.seat && !spectating ? "You" : duel.players[seat].username,
    );
  return `${names.join(" and ")} ran out of time and ${mulligan ? "kept the hand" : "passed the round"}.`;
};

const formatSeconds = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const URGENT_SECONDS = 10;
