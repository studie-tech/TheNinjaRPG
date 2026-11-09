import { nanoid } from "nanoid";
import {
  EVENT_TOURNAMENT_GAME_DELAY_SECONDS,
  EVENT_TOURNAMENT_READY_SECONDS,
} from "@/drizzle/constants";
import { collapseRewards } from "@/libs/rewards";
import type {
  EventGame,
  EventParticipant,
  EventSeries,
  EventSlot,
  EventTournamentConfig,
  EventTournamentState,
} from "@/validators/tournament";

/** Create an unpublished event with no roster, bracket or pending reward grants. */
export const createEventState = (
  config: EventTournamentConfig,
): EventTournamentState => ({
  config,
  status: "DRAFT",
  participants: [],
  series: [],
  activeRound: null,
  scheduledRoundAt: null,
  finishedAt: null,
  payRewards: false,
  standings: [],
  audit: [],
});

/** Earliest round with an unfinished series; Infinity once every series is complete. */
export const currentEventRound = (event: Pick<EventTournamentState, "series">) =>
  Math.min(...event.series.filter((s) => !s.complete).map((s) => s.round));

/** Whether a series of the given round has both seats resolved and waits to be begun. */
export const isSeriesAwaitingBegin = (series: EventSeries, round: number) =>
  series.round === round && series.resolved && !series.complete && !series.begun;

/** Whether a game has been launched and its battle has not concluded yet. */
export const isGameInFlight = (game: EventGame) =>
  ["STARTING", "FIGHTING"].includes(game.status);

/** Explain eligibility failures against the player's frozen entry snapshot. */
export const eligibilityFailures = (
  config: EventTournamentConfig,
  snapshot: EventParticipant["snapshot"],
) => [
  ...(snapshot.bracket < config.minBracket || snapshot.bracket > config.maxBracket
    ? [`Requires PvP bracket ${config.minBracket}–${config.maxBracket}`]
    : []),
  ...(snapshot.pvpWins < config.minPvpWins
    ? [`Requires ${config.minPvpWins} PvP wins`]
    : []),
  ...(snapshot.winRate < config.minWinRate
    ? [`Requires ${config.minWinRate}% PvP win rate`]
    : []),
  ...(snapshot.masteredJutsu < config.minMasteredJutsu
    ? [`Requires ${config.minMasteredJutsu} mastered jutsu`]
    : []),
];

/** Join the eligibility failures into one rejection; empty when the player qualifies. */
export const eligibilityError = (
  config: EventTournamentConfig,
  snapshot: EventParticipant["snapshot"],
) => eligibilityFailures(config, snapshot).join(". ");

/**
 * Seed accepted entrants and build the bracket in place, stopping at the staff start gate.
 * Random order is supplied by the server; ranked seeding uses frozen entry statistics.
 */
export const generateEventBracket = (
  event: EventTournamentState,
  shuffledIds: string[],
) => {
  const entrants = event.participants.filter((p) => p.accepted && !p.withdrawn);
  const ordered =
    event.config.seeding === "PVP_WINS"
      ? [...entrants].sort(
          (a, b) =>
            b.snapshot.pvpWins - a.snapshot.pvpWins || a.userId.localeCompare(b.userId),
        )
      : shuffledIds
          .map((id) => entrants.find((p) => p.id === id))
          .filter((p): p is EventParticipant => !!p);
  ordered.forEach((p, i) => {
    p.seed = i + 1;
  });
  const makeSeries = (
    round: number,
    bracket: EventSeries["bracket"],
    slots: EventSeries["slots"],
  ) => {
    const series: EventSeries = {
      id: nanoid(),
      round,
      bracket,
      slots,
      seats: [null, null],
      resolved: false,
      complete: false,
      winnerId: null,
      loserId: null,
      winnerUserId: null,
      bestOf: event.config.roundBestOf[round - 1] ?? event.config.bestOf,
      scores: [0, 0],
      dodges: [0, 0],
      games: [],
      readyUserIds: [],
      begun: false,
      scheduledAt: null,
    };
    event.series.push(series);
    return series;
  };
  if (event.config.format === "ROUND_ROBIN") {
    const rotation: (EventParticipant | null)[] = [...ordered];
    if (rotation.length % 2) rotation.push(null);
    for (let round = 1; round < rotation.length; round++) {
      for (let i = 0; i < rotation.length / 2; i++) {
        const a = rotation[i];
        const b = rotation[rotation.length - 1 - i];
        if (a && b) makeSeries(round, "LEAGUE", [{ seatId: a.id }, { seatId: b.id }]);
      }
      rotation.splice(1, 0, rotation.pop() ?? null);
    }
  } else {
    const size = 2 ** Math.ceil(Math.log2(ordered.length));
    // Standard seed positions separate the highest seeds and distribute empty slots as byes.
    let seeds = [1, 2];
    while (seeds.length < size)
      seeds = seeds.flatMap((n) => [n, seeds.length * 2 + 1 - n]);
    const slots: EventSlot[] = seeds.map((n) =>
      ordered[n - 1] ? { seatId: ordered[n - 1]!.id } : null,
    );
    const winners: EventSeries[][] = [];
    const source = (series: EventSeries, result: "WINNER" | "LOSER"): EventSlot => ({
      seriesId: series.id,
      result,
    });
    // Single elimination numbers winners rounds r + 1. Double elimination numbers rounds
    // on one timeline shared by both brackets: winners rounds 1, 2, 4, 6, ..., the first
    // losers round 2, each drop-in losers round r * 2 + 1, each merge round r * 2 + 2,
    // and the final after the last of them. Series with the same number form one event
    // round, and roundBestOf[round - 1] applies to all of them in both brackets.
    for (let r = 0; 2 ** r < size; r++) {
      const round = r < 2 ? r + 1 : r * 2;
      const previous = winners[r - 1];
      const inputs = previous ? previous.map((s) => source(s, "WINNER")) : slots;
      const current: EventSeries[] = [];
      for (let i = 0; i < inputs.length; i += 2)
        current.push(
          makeSeries(
            event.config.format === "DOUBLE_ELIMINATION" ? round : r + 1,
            "WINNERS",
            [inputs[i] ?? null, inputs[i + 1] ?? null],
          ),
        );
      winners.push(current);
    }
    if (event.config.format === "DOUBLE_ELIMINATION") {
      let lower: EventSeries[] = [];
      const first = winners[0]!;
      for (let i = 0; i < first.length; i += 2) {
        if (first[i + 1])
          lower.push(
            makeSeries(2, "LOSERS", [
              source(first[i]!, "LOSER"),
              source(first[i + 1]!, "LOSER"),
            ]),
          );
      }
      for (let r = 1; r < winners.length; r++) {
        const dropping = winners[r]!;
        lower = dropping.map((s, i) =>
          makeSeries(r * 2 + 1, "LOSERS", [
            source(lower[i]!, "WINNER"),
            source(dropping[dropping.length - 1 - i] ?? s, "LOSER"),
          ]),
        );
        if (r < winners.length - 1) {
          const joined: EventSeries[] = [];
          for (let i = 0; i < lower.length; i += 2)
            joined.push(
              makeSeries(r * 2 + 2, "LOSERS", [
                source(lower[i]!, "WINNER"),
                source(lower[i + 1]!, "WINNER"),
              ]),
            );
          lower = joined;
        }
      }
      const final = winners.at(-1)![0]!;
      const lowerSource = lower[0]
        ? source(lower[0], "WINNER")
        : source(final, "LOSER");
      makeSeries(Math.max(...event.series.map((s) => s.round)) + 1, "FINAL", [
        source(final, "WINNER"),
        lowerSource,
      ]);
    }
  }
  event.status = "PREPARED";
  resolveEventSlots(event);
};

/**
 * Resolve completed source series in place and advance occupied seats through byes.
 * Null winners carry double no-shows through the graph without creating opponents.
 */
export const resolveEventSlots = (event: EventTournamentState) => {
  for (const series of event.series) {
    if (series.resolved) continue;
    const ready = series.slots.every(
      (slot) =>
        !slot ||
        "seatId" in slot ||
        event.series.find((s) => s.id === slot.seriesId)?.complete,
    );
    if (!ready) continue;
    series.seats = series.slots.map((slot) => {
      if (!slot) return null;
      if ("seatId" in slot) return slot.seatId;
      const source = event.series.find((s) => s.id === slot.seriesId);
      return (slot.result === "WINNER" ? source?.winnerId : source?.loserId) ?? null;
    }) as EventSeries["seats"];
    series.resolved = true;
    const active = series.seats.filter(
      (id) => id && !event.participants.find((p) => p.id === id)?.withdrawn,
    );
    if (active.length < 2) {
      series.complete = true;
      series.winnerId = active[0] ?? null;
      series.loserId = null;
    }
  }
};

/**
 * Whether a player holds a live seat that the event may still call to a ready check:
 * a registration before the bracket exists, or a seat not yet eliminated from it.
 * Used to shield waiting entrants from open-world attacks that would fail their ready check.
 */
export const isActiveEventEntrant = (event: EventTournamentState, userId: string) => {
  const seat = event.participants.find(
    (p) => p.userId === userId && p.accepted && !p.withdrawn,
  );
  if (!seat || !["REGISTRATION", "PREPARED", "RUNNING"].includes(event.status))
    return false;
  if (!event.series.length) return true;
  // A seat stays live while it occupies an unfinished series or a finished series
  // routes it onward (bye, win, or a double-elimination drop) into an unresolved one.
  return event.series.some(
    (s) =>
      (!s.complete && s.seats.includes(seat.id)) ||
      (!s.resolved &&
        s.slots.some((slot) => {
          if (!slot || !("seriesId" in slot)) return false;
          const source = event.series.find((x) => x.id === slot.seriesId);
          return (
            source?.complete &&
            (slot.result === "WINNER" ? source.winnerId : source.loserId) === seat.id
          );
        })),
  );
};

/** Append a ready check with stable game/battle IDs; accepting it launches combat later. */
export const openEventGame = (
  event: EventTournamentState,
  series: EventSeries,
  now: number,
  delay = 0,
) => {
  const userIds = series.seats
    .map((id) => event.participants.find((p) => p.id === id)?.userId)
    .filter((id): id is string => !!id);
  series.games.push({
    id: nanoid(),
    battleId: nanoid(),
    status: "READY",
    opensAt: now + delay,
    deadline: now + delay + EVENT_TOURNAMENT_READY_SECONDS * 1000,
    accepted: [],
    userIds,
    winnerId: null,
    outcome: null,
  });
};

/**
 * Open ready checks in the earliest unfinished round, mutating the event in place.
 * Sequential events open one series; simultaneous events open all eligible series.
 * Return a user-facing rejection or null on success.
 */
export const beginEventRound = (
  event: EventTournamentState,
  now: number,
  seriesId?: string,
) => {
  resolveEventSlots(event);
  const round = currentEventRound(event);
  if (!Number.isFinite(round)) return "No matches remain";
  const candidates = event.series.filter((s) => isSeriesAwaitingBegin(s, round));
  if (event.config.scheduling === "SEQUENTIAL") {
    if (event.series.some((s) => s.begun && !s.complete))
      return "Another series is in progress";
    const selected =
      candidates.find((s) => s.id === seriesId) ??
      (!seriesId ? candidates[0] : undefined);
    if (!selected) return "Series is not ready in this round";
    selected.begun = true;
    selected.scheduledAt = null;
    openEventGame(event, selected, now);
  } else {
    if (!candidates.length) return "This round has already begun";
    for (const s of candidates) {
      s.begun = true;
      openEventGame(event, s, now);
    }
  }
  event.activeRound = round;
  event.status = "RUNNING";
  event.scheduledRoundAt = null;
  return null;
};

/**
 * Complete the current game once and apply the shared score/dodge policy in place.
 * A forced series result ends a withdrawal immediately; otherwise open the next game
 * after the configured delay unless the score or no-show limit decides the series.
 */
export const completeEventGame = (
  event: EventTournamentState,
  series: EventSeries,
  winnerUserId: string | null,
  outcome: NonNullable<EventSeries["games"][number]["outcome"]>,
  now: number,
  forceSeries = false,
) => {
  const game = series.games.at(-1);
  if (!game || game.status === "COMPLETE") return;
  game.status = "COMPLETE";
  game.winnerId = winnerUserId;
  game.outcome = outcome;
  const winnerIndex = game.userIds.indexOf(winnerUserId ?? "");
  if (winnerIndex >= 0) series.scores[winnerIndex as 0 | 1]++;
  if (outcome === "NO_SHOW" || outcome === "DOUBLE_NO_SHOW") {
    for (const i of [0, 1] as const)
      if (!game.accepted.includes(game.userIds[i] ?? "")) series.dodges[i]++;
  }
  const required = Math.ceil(series.bestOf / 2);
  const eliminated = series.dodges.map((n) => n >= Math.min(2, required));
  const doubleNoShow = outcome === "DOUBLE_NO_SHOW";
  if (
    forceSeries ||
    doubleNoShow ||
    eliminated.some(Boolean) ||
    series.scores.some((n) => n >= required)
  ) {
    series.complete = true;
    const index = forceSeries
      ? winnerIndex
      : doubleNoShow
        ? -1
        : eliminated[0]
          ? 1
          : eliminated[1]
            ? 0
            : series.scores[0] >= required
              ? 0
              : 1;
    series.winnerId = index < 0 ? null : (series.seats[index as 0 | 1] ?? null);
    series.loserId = index < 0 ? null : (series.seats[1 - index] ?? null);
    series.winnerUserId = index < 0 ? null : (game.userIds[index] ?? null);
  } else openEventGame(event, series, now, EVENT_TOURNAMENT_GAME_DELAY_SECONDS * 1000);
};

/** Resolve bracket progress, retain manual round gates, and freeze final standings in place. */
export const advanceEvent = (event: EventTournamentState, now: number) => {
  resolveEventSlots(event);
  // A lower-bracket finalist must beat the undefeated finalist twice.
  const final = event.series.find((s) => s.bracket === "FINAL");
  if (
    final?.complete &&
    final.seats[0] &&
    final.winnerId &&
    final.winnerId === final.seats[1] &&
    event.series.filter((s) => s.bracket === "FINAL").length === 1
  ) {
    event.series.push({
      ...final,
      id: nanoid(),
      round: final.round + 1,
      slots: final.seats.map((id) =>
        id ? { seatId: id } : null,
      ) as EventSeries["slots"],
      complete: false,
      winnerId: null,
      loserId: null,
      winnerUserId: null,
      scores: [0, 0],
      dodges: [0, 0],
      games: [],
      readyUserIds: [],
      begun: false,
      scheduledAt: null,
    });
  }
  if (event.series.length && event.series.every((s) => s.complete)) {
    const championship = event.series.at(-1)!;
    event.standings =
      event.config.format === "ROUND_ROBIN"
        ? leagueStandings(event)
        : eliminationStandings(event, championship);
    event.status = "COMPLETED";
    event.finishedAt = now;
    event.payRewards = true;
    event.activeRound = null;
  } else if (
    event.activeRound !== null &&
    event.series.filter((s) => s.round === event.activeRound).every((s) => s.complete)
  ) {
    event.status = "PREPARED";
    event.activeRound = null;
  }
};

/** Return active participant seat IDs ordered by series wins, game wins and original seed. */
export const leagueStandings = (event: EventTournamentState) => {
  const entrants = event.participants.filter((p) => p.accepted && !p.withdrawn);
  const wins = (id: string) => event.series.filter((s) => s.winnerId === id).length;
  const gameWins = (id: string) =>
    event.series.reduce((sum, s) => sum + (s.scores[s.seats.indexOf(id)] ?? 0), 0);
  // Stable, published tiebreaks: series wins, game wins, then original seed.
  return entrants
    .sort(
      (a, b) =>
        wins(b.id) - wins(a.id) || gameWins(b.id) - gameWins(a.id) || a.seed - b.seed,
    )
    .map((p) => p.id);
};

/** Preserve empty finalist places and rank remaining eliminated seats by their last round. */
const eliminationStandings = (event: EventTournamentState, final: EventSeries) => {
  const leaders = [final.winnerId, final.loserId];
  const eliminated = [...event.series]
    .sort((a, b) => b.round - a.round)
    .flatMap((s) => (s.loserId ? [s.loserId] : []));
  return [...leaders, ...new Set(eliminated.filter((id) => !leaders.includes(id)))];
};

/**
 * Calculate deferred rewards without granting them; unseeded users receive no reward.
 * Placement follows the current seat holder, while series wins stay with their original
 * player after substitution. Both current and former seeded players earn participation.
 */
export const eventRewardFor = (event: EventTournamentState, userId: string) => {
  const seeded = event.participants.some(
    (p) =>
      p.seed > 0 &&
      (p.userId === userId || p.previousUsers.some((u) => u.userId === userId)),
  );
  if (!seeded) return null;
  const position = event.standings.findIndex(
    (id) => id && event.participants.find((p) => p.id === id)?.userId === userId,
  );
  const rewards = [event.config.rewards.participation];
  if (event.status === "COMPLETED" && position >= 0 && position < 4)
    rewards.push(
      position === 0
        ? event.config.rewards.winner
        : position === 1
          ? event.config.rewards.runnerUp
          : event.config.rewards.semifinalist,
    );
  for (const series of event.series)
    if (series.complete && series.winnerUserId === userId)
      rewards.push(event.config.rewards.perWin);
  return collapseRewards(rewards);
};
