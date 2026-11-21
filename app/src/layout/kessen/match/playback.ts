/**
 * Event playback for the match table: folds the server's ordered events over the view
 * the player saw before acting, so every placement, hit and round end can be shown one
 * step at a time. The frames are close approximations of the engine state (Evergreen
 * resets and similar rewrites only arrive with the confirmed view, which replaces the
 * last frame); they never decide anything.
 */
import { boardTotals } from "@/libs/kessen/engine";
import { TOKEN_CARD_ID, TOKEN_PREFIX } from "@/libs/kessen/rules";
import type {
  KessenEvent,
  MatchRules,
  MatchView,
  Row,
  Seat,
  Unit,
} from "@/libs/kessen/types";

/**
 * Builds the playback of `events` starting from `start`. Durations are milliseconds;
 * without motion every step is short so the board still updates in order.
 */
export const buildPlayback = (
  start: MatchView,
  events: readonly KessenEvent[],
  motion: boolean,
): PlaybackStep[] => {
  const steps: PlaybackStep[] = [];
  let frame = start;
  let group: { seat: Seat; before: [number, number]; from: number } | null = null;
  const closeGroup = () => {
    if (!group || steps.length <= group.from) {
      group = null;
      return;
    }
    const after = safeTotals(frame);
    const seat = group.seat;
    const swing =
      after[seat] -
      group.before[seat] -
      (after[other(seat)] - group.before[other(seat)]);
    const last = steps[steps.length - 1];
    if (last && swing >= BIG_PLAY_SWING) last.bigPlay = { seat, swing };
    group = null;
  };
  let previous: KessenEvent | null = null;
  for (const event of events) {
    if (event.t === "played" || event.t === "leader") {
      closeGroup();
      group = { seat: event.seat, before: safeTotals(frame), from: steps.length };
    } else if (
      event.t === "turn" ||
      event.t === "passed" ||
      event.t === "roundEnd" ||
      event.t === "matchEnd"
    ) {
      closeGroup();
    }
    const before = frame;
    const after = applyPlaybackEvent(before, event);
    const removal =
      event.t === "destroyed" ||
      event.t === "cleanup" ||
      (event.t === "returned" && event.from === "board");
    steps.push({
      event,
      frame: removal ? before : after,
      duration: stepDuration(event, previous, start.me, motion, before.rules),
      fx: stepFx(event),
      hold: event.t === "roundEnd",
      bigPlay: null,
      before,
    });
    frame = after;
    previous = event;
  }
  closeGroup();
  return steps;
};

/** The view after one event; never mutates `view`. */
export const applyPlaybackEvent = (view: MatchView, event: KessenEvent): MatchView => {
  const next = structuredClone(view);
  const seatOf = (seat: Seat) => next.seats[seat];
  switch (event.t) {
    case "roundStart":
      next.round = event.round;
      next.opener = event.opener;
      next.turn = event.opener;
      next.roundSeq = next.seq;
      for (const zone of next.seats) {
        zone.passed = false;
        zone.played = 0;
        zone.sun = false;
      }
      break;
    case "drawn": {
      const zone = seatOf(event.seat);
      zone.handCount += event.cards.length;
      zone.deckCount = Math.max(0, zone.deckCount - event.cards.length);
      if (zone.hand) {
        for (const id of event.cards) if (id !== "?") zone.hand.push(id);
      }
      break;
    }
    case "mulligan": {
      const zone = seatOf(event.seat);
      if (zone.hand) {
        zone.hand = zone.hand.filter((id) => !event.removed.includes(id));
        for (const id of event.drawn) if (id !== "?") zone.hand.push(id);
      }
      zone.mullPending = false;
      zone.mull = null;
      break;
    }
    case "token":
      next.inst[event.id] = event.cardId;
      next.tokens += 1;
      break;
    case "turn":
      next.turn = event.seat;
      next.phase = "play";
      break;
    case "played": {
      const zone = seatOf(event.seat);
      next.inst[event.id] = event.cardId;
      zone.handCount = Math.max(0, zone.handCount - 1);
      if (zone.hand) zone.hand = zone.hand.filter((id) => id !== event.id);
      if (!event.id.startsWith(TOKEN_PREFIX)) zone.played += 1;
      const card = next.cards[event.cardId];
      if (card?.kind === "TACTIC") zone.discard.push(event.id);
      break;
    }
    case "leader":
      seatOf(event.seat).leaderUsed = true;
      break;
    case "placed": {
      next.inst[event.id] = event.cardId;
      next.seq += 1;
      for (const zone of next.seats) {
        zone.discard = zone.discard.filter((id) => id !== event.id);
      }
      if (event.source === "summon" || event.source === "allHands") {
        const zone = seatOf(event.owner);
        zone.deckCount = Math.max(0, zone.deckCount - 1);
      }
      const card = next.cards[event.cardId];
      const unit: Unit = {
        id: event.id,
        owner: event.owner,
        stored: event.stored,
        sealed: false,
        med: 0,
        res: card?.abilities.some((ability) => ability.k === "resilient") ?? false,
        seq: next.seq,
      };
      next.board[event.side][event.row].push(unit);
      break;
    }
    case "damaged":
    case "boosted": {
      const unit = findUnit(next, event.id);
      if (unit) {
        unit.stored = event.stored;
        if (event.t === "boosted" && event.cause === "meditate")
          unit.med += event.amount;
      }
      break;
    }
    case "destroyed": {
      removeUnit(next, event.id);
      const token = event.id.startsWith(TOKEN_PREFIX) || event.cardId === TOKEN_CARD_ID;
      if (!token) seatOf(event.owner).discard.push(event.id);
      break;
    }
    case "sealed": {
      const unit = findUnit(next, event.id);
      if (unit) unit.sealed = true;
      break;
    }
    case "resilient": {
      const unit = findUnit(next, event.id);
      if (unit) unit.res = true;
      break;
    }
    case "terrain":
      next.terrain[event.side][event.row] = event.on;
      break;
    case "returned": {
      const zone = seatOf(event.seat);
      if (event.from === "board") removeUnit(next, event.id);
      if (event.from === "discard") {
        zone.discard = zone.discard.filter((id) => id !== event.id);
      }
      if (event.from === "hand") {
        zone.handCount = Math.max(0, zone.handCount - 1);
        if (zone.hand) zone.hand = zone.hand.filter((id) => id !== event.id);
      }
      if (event.to === "hand") {
        zone.handCount += 1;
        if (zone.hand && event.id !== "?") zone.hand.push(event.id);
      } else {
        zone.deckCount += 1;
      }
      break;
    }
    case "passed":
      seatOf(event.seat).passed = true;
      break;
    case "roundEnd":
      next.history.push({
        round: event.round,
        totals: [...event.totals],
        winner: event.winner,
        riggedOdds: event.riggedOdds,
      });
      next.seats[0].lanterns = event.lanterns[0];
      next.seats[1].lanterns = event.lanterns[1];
      break;
    case "leaderRecharged":
      seatOf(event.seat).leaderUsed = false;
      break;
    case "cleanup": {
      const kept = new Set(event.kept);
      for (const side of [0, 1] as const) {
        for (const row of ROW_ORDER) {
          const remaining: Unit[] = [];
          for (const unit of next.board[side][row]) {
            if (kept.has(unit.id)) remaining.push(unit);
            else if (!unit.id.startsWith(TOKEN_PREFIX)) {
              next.seats[unit.owner].discard.push(unit.id);
            }
          }
          next.board[side][row] = remaining;
        }
        next.terrain[side] = { CLOSE: false, RANGED: false, JUTSU: false };
      }
      break;
    }
    case "matchEnd":
      next.phase = "over";
      next.result = { winner: event.winner };
      break;
    case "fizzled":
      break;
  }
  return next;
};

/** Round totals of a frame; frames with unknown cards count as zero. */
export const safeTotals = (view: MatchView): [number, number] => {
  try {
    return boardTotals(view);
  } catch {
    return [0, 0];
  }
};

/** The visual effect of one step on the units it touches. */
const stepFx = (event: KessenEvent): PlaybackFx | null => {
  switch (event.t) {
    case "placed": {
      const kind: PlaybackFxKind =
        event.source === "summon" || event.source === "allHands"
          ? "summon"
          : event.source === "revive" || event.source === "fence"
            ? "revive"
            : event.source === "tide"
              ? "tide"
              : event.owner !== event.side
                ? "infiltrate"
                : "placed";
      return { ids: [event.id], kind, amount: event.stored };
    }
    case "damaged":
      return { ids: [event.id], kind: "damage", amount: event.amount };
    case "boosted":
      return { ids: [event.id], kind: "boost", amount: event.amount };
    case "destroyed":
      return { ids: [event.id], kind: event.cause === "purge" ? "purge" : "destroy" };
    case "sealed":
      return { ids: [event.id], kind: "seal" };
    case "resilient":
      return { ids: [event.id], kind: "resilient" };
    case "returned":
      return event.from === "board" ? { ids: [event.id], kind: "return" } : null;
    case "cleanup":
      return {
        ids: [...event.discarded, ...event.banished],
        kind: "sweep",
        kept: event.kept,
      };
    case "terrain":
      return { ids: [], kind: "terrain", row: { side: event.side, row: event.row } };
    default:
      return null;
  }
};

const stepDuration = (
  event: KessenEvent,
  previous: KessenEvent | null,
  me: Seat,
  motion: boolean,
  rules: MatchRules,
) => {
  const full = baseDuration(event, previous, me);
  if (event.t === "roundEnd") return full;
  // A round whose house rule acts at its start keeps its stamp up long enough to read,
  // with or without motion.
  if (event.t === "roundStart" && roundRuleActs(rules, event.round)) {
    return RULE_STAMP_MS;
  }
  return motion ? full : Math.min(full, 140);
};

/** Whether a house rule changes something as round `round` starts. */
const roundRuleActs = (rules: MatchRules, round: number) =>
  round > 1 &&
  ((round === 3 && (rules.r3PlacementBonus ?? 0) > 0) ||
    (rules.startTerrain ?? []).some((entry) => entry.rounds.includes(round)) ||
    (rules.carryBonus ?? 0) > 0);

const RULE_STAMP_MS = 2200;

const baseDuration = (event: KessenEvent, previous: KessenEvent | null, me: Seat) => {
  switch (event.t) {
    case "placed":
      return event.source === "hand" || event.source === "gambit" ? 460 : 560;
    case "damaged":
      return 420;
    case "boosted":
      return event.cause === "meditate" ? 320 : 360;
    case "destroyed":
      return 620;
    case "sealed":
      return 420;
    case "resilient":
      return 280;
    case "terrain":
      return 520;
    case "returned":
      return event.from === "board" ? 440 : 0;
    case "fizzled":
      return 260;
    case "leader":
      return 700;
    case "passed":
      return 720;
    case "drawn":
      return event.seat === me && event.cards.length > 0 ? 300 : 0;
    case "turn":
      // A beat before the opponent acts, so their play reads as a reply.
      return event.seat !== me && previous?.t !== "roundStart" ? 520 : 0;
    case "roundEnd":
      return 1500;
    case "cleanup":
      return 560;
    case "roundStart":
      return event.round > 1 ? 900 : 0;
    case "leaderRecharged":
      return 520;
    default:
      return 0;
  }
};

const findUnit = (view: MatchView, id: string) => {
  for (const side of view.board) {
    for (const row of ROW_ORDER) {
      const unit = side[row].find((entry) => entry.id === id);
      if (unit) return unit;
    }
  }
  return null;
};

const removeUnit = (view: MatchView, id: string) => {
  for (const side of view.board) {
    for (const row of ROW_ORDER) side[row] = side[row].filter((unit) => unit.id !== id);
  }
};

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

const ROW_ORDER: readonly Row[] = ["CLOSE", "RANGED", "JUTSU"];

/** One action that swings the totals by this much earns a "Big Play" callout. */
export const BIG_PLAY_SWING = 10;

export type PlaybackFxKind =
  | "placed"
  /** The player's own card settling where its ghost already stood. */
  | "settle"
  | "summon"
  | "infiltrate"
  | "revive"
  | "tide"
  | "damage"
  | "boost"
  | "destroy"
  | "purge"
  | "seal"
  | "resilient"
  | "return"
  | "sweep"
  | "terrain";

export interface PlaybackFx {
  ids: string[];
  kind: PlaybackFxKind;
  amount?: number;
  /** Units a round-end cleanup keeps on the board. */
  kept?: string[];
  row?: { side: Seat; row: Row };
}

export interface PlaybackStep {
  event: KessenEvent;
  /** The board shown while this step plays (removals show the unit leaving). */
  frame: MatchView;
  /** The board before the event, for log lines that name a unit about to leave. */
  before: MatchView;
  duration: number;
  fx: PlaybackFx | null;
  /** Round ends wait until the player continues. */
  hold: boolean;
  /** The action that ended on this step swung the totals by `swing` for `seat`. */
  bigPlay: { seat: Seat; swing: number } | null;
}
