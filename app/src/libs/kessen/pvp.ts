import {
  KESSEN_MIN_LOSER_PLAYS,
  KESSEN_MIN_MATCH_SECONDS,
  KESSEN_MIN_TOTAL_PLAYS,
  KESSEN_PVP_MAX_TIMEOUTS,
  KESSEN_PVP_MULLIGAN_SECONDS,
  KESSEN_PVP_TURN_SECONDS,
  KESSEN_RANKED_K_FACTOR,
  KESSEN_RANKED_PROVISIONAL_K_FACTOR,
  KESSEN_RANKED_PROVISIONAL_MATCHES,
  KESSEN_RANKED_QUEUE_MAX_WAIT_SECONDS,
  KESSEN_RANKED_RADIUS_MAX,
  KESSEN_RANKED_RADIUS_STEP,
  KESSEN_RANKED_RADIUS_STEP_SECONDS,
  KESSEN_RANKED_RATING_FLOOR,
} from "@/drizzle/constants";
import { actingSeats, applyAction } from "./engine";
import type { Eligibility } from "./rewards";
import type { KessenAction, KessenEvent, MatchState, Seat } from "./types";

/**
 * Live duels between two players. Every decision runs on a clock: the Round mulligans
 * share one window for both seats, every play-phase decision gets its own. A seat whose
 * clock runs out keeps its hand (mulligan) or passes the round (play), which counts as a
 * timeout; `KESSEN_PVP_MAX_TIMEOUTS` timeouts forfeit the match. A disconnect is only
 * missed clocks, so a player who leaves loses within a few minutes.
 */

/** Seconds the decision `state` waits on may take. */
export const kessenClockSeconds = (state: MatchState) =>
  state.phase === "mulligan" ? KESSEN_PVP_MULLIGAN_SECONDS : KESSEN_PVP_TURN_SECONDS;

/**
 * The clock after a decision moved `before` to `after`: none once the match is over, the
 * running window while the other seat still owes its mulligan in the same step, else a
 * fresh window from `now`.
 */
export const kessenNextDeadline = (
  before: MatchState,
  after: MatchState,
  current: Date | null,
  now: Date,
): Date | null => {
  if (after.phase === "over") return null;
  if (
    current &&
    before.phase === "mulligan" &&
    after.phase === "mulligan" &&
    before.round === after.round
  )
    return current;
  return new Date(now.getTime() + kessenClockSeconds(after) * 1000);
};

/** What `resolveKessenClock` did to an overdue match. */
export interface KessenClockResolution {
  engine: MatchState;
  /** Unredacted events of the forced decisions, oldest first. */
  events: KessenEvent[];
  timeouts: [number, number];
  deadline: Date | null;
  /** One entry per missed clock, in order. */
  timedOut: Seat[];
  /** Seats that reached the timeout limit; the match is forfeited when non-empty. */
  forfeited: Seat[];
}

/** The decision a seat whose clock ran out makes: keep its hand, or pass the round. */
export const kessenTimeoutAction = (state: MatchState): KessenAction =>
  state.phase === "mulligan" ? { t: "mull", cards: [] } : { t: "pass" };

/**
 * Forces every decision whose clock ran out by `now`. Each following window starts when
 * the previous one ended, not when someone looked, so the outcome of an abandoned match
 * does not depend on when it is read. Stops at a forfeit or when the match ends.
 */
export const resolveKessenClock = (input: {
  engine: MatchState;
  timeouts: readonly [number, number];
  deadline: Date | null;
  now: Date;
}): KessenClockResolution => {
  let engine = input.engine;
  let deadline = input.deadline;
  const timeouts: [number, number] = [input.timeouts[0], input.timeouts[1]];
  const events: KessenEvent[] = [];
  const timedOut: Seat[] = [];
  const forfeited: Seat[] = [];
  for (
    let guard = 0;
    guard < 64 && deadline && engine.phase !== "over" && input.now >= deadline;
    guard++
  ) {
    const seats = actingSeats(engine);
    for (const seat of seats) {
      const applied = applyAction(engine, seat, kessenTimeoutAction(engine));
      if (!applied.ok)
        throw new Error(`Kessen timeout was rejected: ${applied.reason}`);
      engine = applied.state;
      events.push(...applied.events);
      timeouts[seat] += 1;
      timedOut.push(seat);
    }
    for (const seat of seats)
      if (timeouts[seat] >= KESSEN_PVP_MAX_TIMEOUTS && !forfeited.includes(seat))
        forfeited.push(seat);
    if (forfeited.length > 0 || engine.phase === "over") {
      deadline = null;
      break;
    }
    deadline = new Date(deadline.getTime() + kessenClockSeconds(engine) * 1000);
  }
  return { engine, events, timeouts, deadline, timedOut, forfeited };
};

/** The winner of a forfeit: the other seat, or nobody when both ran out together. */
export const kessenForfeitWinner = (forfeited: readonly Seat[]): Seat | null =>
  forfeited.length === 1 ? (forfeited[0] === 0 ? 1 : 0) : null;

/** Elo change of a rated match for one player; the K-factor is higher while provisional. */
export const kessenRatingDelta = (input: {
  rating: number;
  opponentRating: number;
  /** 1 win, 0.5 draw, 0 loss. */
  score: 0 | 0.5 | 1;
  /** Rated matches the player finished before this one. */
  played: number;
}) => {
  const k =
    input.played < KESSEN_RANKED_PROVISIONAL_MATCHES
      ? KESSEN_RANKED_PROVISIONAL_K_FACTOR
      : KESSEN_RANKED_K_FACTOR;
  const expected = 1 / (1 + 10 ** ((input.opponentRating - input.rating) / 400));
  const delta = Math.round(k * (input.score - expected));
  // The floor keeps ratings positive; the stored update applies the same floor.
  return Math.max(KESSEN_RANKED_RATING_FLOOR, input.rating + delta) - input.rating;
};

/** The rating difference two queued players may have after `secondsInQueue` of waiting. */
export const kessenRankedRadius = (secondsInQueue: number) => {
  if (secondsInQueue >= KESSEN_RANKED_QUEUE_MAX_WAIT_SECONDS)
    return Number.POSITIVE_INFINITY;
  const steps = Math.floor(
    Math.max(0, secondsInQueue) / KESSEN_RANKED_RADIUS_STEP_SECONDS,
  );
  return Math.min(KESSEN_RANKED_RADIUS_MAX, KESSEN_RANKED_RADIUS_STEP * (steps + 1));
};

/** One queued player as matchmaking sees it. */
export interface KessenQueueEntry {
  userId: string;
  rating: number;
  queuedAt: Date;
}

/**
 * The opponent for `me` among `candidates` (already filtered to live, unclaimed rows):
 * within the radius of whichever of the two has waited longer, never an excluded player,
 * closest rating first, then the longest wait.
 */
export const pickKessenOpponent = <Entry extends KessenQueueEntry>(
  me: KessenQueueEntry,
  candidates: readonly Entry[],
  options: { now: Date; excluded: ReadonlySet<string> },
): Entry | null => {
  const waited = (entry: KessenQueueEntry) =>
    (options.now.getTime() - entry.queuedAt.getTime()) / 1000;
  const fits = candidates.filter(
    (entry) =>
      entry.userId !== me.userId &&
      !options.excluded.has(entry.userId) &&
      Math.abs(entry.rating - me.rating) <=
        kessenRankedRadius(Math.max(waited(me), waited(entry))),
  );
  fits.sort(
    (a, b) =>
      Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating) ||
      a.queuedAt.getTime() - b.queuedAt.getTime() ||
      (a.userId < b.userId ? -1 : 1),
  );
  return fits[0] ?? null;
};

/**
 * Anti-farm guard of a ranked reward: the match lasted the minimum time and had the
 * minimum card plays in total, and the losing seat played its share, however it ended.
 */
export const kessenDuelEligibility = (input: {
  winner: Seat | null;
  durationMs: number;
  plays: readonly [number, number];
}): Eligibility => {
  if (input.winner === null) return { eligible: false, reason: "Draws pay no reward." };
  if (input.durationMs < KESSEN_MIN_MATCH_SECONDS * 1000)
    return { eligible: false, reason: "The match was too short to be rewarded." };
  if (input.plays[0] + input.plays[1] < KESSEN_MIN_TOTAL_PLAYS)
    return { eligible: false, reason: "Too few cards were played to be rewarded." };
  if (input.plays[input.winner === 0 ? 1 : 0] < KESSEN_MIN_LOSER_PLAYS)
    return {
      eligible: false,
      reason: "Your opponent played too few cards for the win to be rewarded.",
    };
  return { eligible: true };
};

/**
 * Instance-to-card names a viewer's play log may use: those its redacted events name
 * themselves, then what the viewer's current view shows.
 */
export const kessenLogNames = (
  events: readonly KessenEvent[],
  visible: Readonly<Record<string, string>>,
): Record<string, string> => {
  const names: Record<string, string> = {};
  for (const event of events)
    if ("cardId" in event && "id" in event && event.id !== "?")
      names[event.id] = event.cardId;
  return { ...names, ...visible };
};
