import { describe, expect, it } from "bun:test";
import {
  advanceEvent,
  beginEventRound,
  completeEventGame,
  createEventState,
  currentEventRound,
  eligibilityError,
  eventRewardFor,
  generateEventBracket,
  isActiveEventEntrant,
  isGameInFlight,
  isSeriesAwaitingBegin,
} from "@/libs/tournament/events";
import {
  type EventTournamentConfig,
  type EventTournamentState,
  eventTournamentConfigSchema,
} from "@/validators/tournament";

const makeEvent = (count = 8, overrides: Partial<EventTournamentConfig> = {}) => {
  const config = eventTournamentConfigSchema.parse({
    name: "Colosseum Cup",
    description: "Wake Island tournament",
    registration: "OPEN",
    format: "SINGLE_ELIMINATION",
    seeding: "RANDOM",
    rules: "OPEN",
    scheduling: "SIMULTANEOUS",
    capacity: 64,
    bestOf: 1,
    roundBestOf: [],
    minBracket: 0,
    maxBracket: 7,
    minPvpWins: 0,
    minWinRate: 0,
    minMasteredJutsu: 0,
    registrationClosesAt: 1000,
    endsAt: 1000000,
    rewards: {
      winner: {},
      runnerUp: {},
      semifinalist: {},
      participation: {},
      perWin: {},
    },
    ...overrides,
  });
  const event = createEventState(config);
  event.participants = Array.from({ length: count }, (_, i) => ({
    id: `seat-${i}`,
    userId: `user-${i}`,
    username: `Player ${i}`,
    invited: false,
    accepted: true,
    withdrawn: false,
    seed: 0,
    snapshot: { bracket: 1, pvpWins: 100 - i, winRate: 50, masteredJutsu: 0 },
    previousUsers: [],
  }));
  generateEventBracket(
    event,
    event.participants.map((p) => p.id),
  );
  return event;
};

const playOut = (event: EventTournamentState, lowerWinsFinal = false) => {
  let iterations = 0;
  while (event.status !== "COMPLETED" && iterations++ < 10000) {
    advanceEvent(event, 0);
    if (String(event.status) === "COMPLETED") break;
    const started = beginEventRound(event, 0);
    expect(started).toBeNull();
    for (const series of event.series.filter((s) => s.begun && !s.complete)) {
      const game = series.games.at(-1)!;
      game.accepted = [...game.userIds];
      const index = lowerWinsFinal && series.bracket === "FINAL" ? 1 : 0;
      completeEventGame(event, series, game.userIds[index]!, "BATTLE", 0);
    }
    advanceEvent(event, 0);
  }
  expect(event.status).toBe("COMPLETED");
  return iterations;
};

describe("staff event tournament brackets", () => {
  for (const format of [
    "SINGLE_ELIMINATION",
    "DOUBLE_ELIMINATION",
    "ROUND_ROBIN",
  ] as const) {
    it(`${format} completes with every roster size from two to 64`, () => {
      for (let count = 2; count <= 64; count++) {
        const event = makeEvent(count, { format });
        expect(event.status).toBe("PREPARED");
        expect(event.series.every((s) => !s.begun)).toBe(true);
        playOut(event);
        if (format === "ROUND_ROBIN") {
          expect(event.series).toHaveLength((count * (count - 1)) / 2);
          const pairs = event.series.map((s) => [...s.seats].sort().join(":"));
          expect(new Set(pairs).size).toBe(pairs.length);
        }
      }
    });
  }
  it("creates a double-elimination final reset only when the lower finalist wins", () => {
    const event = makeEvent(8, { format: "DOUBLE_ELIMINATION" });
    playOut(event, true);
    expect(event.series.filter((s) => s.bracket === "FINAL")).toHaveLength(2);
    expect(event.standings[0]).toBe(event.series.at(-1)!.seats[1]!);
  });
  it("awards a final bye when both upper finalists fail to show", () => {
    const event = makeEvent(4, { format: "DOUBLE_ELIMINATION" });
    beginEventRound(event, 0);
    for (const series of event.series.filter((s) => s.begun)) {
      const game = series.games.at(-1)!;
      game.accepted = [...game.userIds];
      completeEventGame(event, series, game.userIds[0]!, "BATTLE", 0);
    }
    advanceEvent(event, 0);
    beginEventRound(event, 0);
    const upper = event.series.find((s) => s.bracket === "WINNERS" && !s.complete)!;
    const lower = event.series.find((s) => s.bracket === "LOSERS" && s.begun)!;
    completeEventGame(event, upper, null, "DOUBLE_NO_SHOW", 0);
    const game = lower.games.at(-1)!;
    game.accepted = [...game.userIds];
    completeEventGame(event, lower, game.userIds[0]!, "BATTLE", 0);
    advanceEvent(event, 0);
    expect(event.status).toBe("COMPLETED");
    expect(event.series.filter((s) => s.bracket === "FINAL")).toHaveLength(1);
    expect(event.standings[0]).toBe(lower.winnerId);
  });
  it("sequential scheduling requires a fresh staff start for each series", () => {
    const event = makeEvent(8, { scheduling: "SEQUENTIAL" });
    expect(beginEventRound(event, 0)).toBeNull();
    expect(event.series.filter((s) => s.begun && !s.complete)).toHaveLength(1);
    expect(beginEventRound(event, 0)).toBe("Another series is in progress");
    playOut(eventAfterFirstGame(event));
  });
  it("preserves won games and eliminates after a second dodge in best-of-five", () => {
    const event = makeEvent(8, { bestOf: 5 });
    beginEventRound(event, 0);
    const series = event.series[0]!;
    let game = series.games.at(-1)!;
    game.accepted = [...game.userIds];
    completeEventGame(event, series, game.userIds[0]!, "BATTLE", 0);
    game = series.games.at(-1)!;
    game.accepted = [game.userIds[1]!];
    completeEventGame(event, series, game.userIds[1]!, "NO_SHOW", 0);
    expect(series.scores).toEqual([1, 1]);
    expect(series.complete).toBe(false);
    game = series.games.at(-1)!;
    game.accepted = [game.userIds[1]!];
    completeEventGame(event, series, game.userIds[1]!, "NO_SHOW", 0);
    expect(series.complete).toBe(true);
    expect(series.winnerId).toBe(series.seats[1]);
  });
  it("double no-shows propagate an empty slot and free advance", () => {
    const event = makeEvent(4);
    beginEventRound(event, 0);
    const first = event.series[0]!;
    const second = event.series[1]!;
    completeEventGame(event, first, null, "DOUBLE_NO_SHOW", 0);
    const game = second.games.at(-1)!;
    game.accepted = [...game.userIds];
    completeEventGame(event, second, game.userIds[0]!, "BATTLE", 0);
    advanceEvent(event, 0);
    expect(event.status).toBe("COMPLETED");
    expect(event.standings[0]).toBe(second.winnerId!);
  });
  it("keeps empty championship placements when both finalists fail to show", () => {
    const event = makeEvent(4);
    beginEventRound(event, 0);
    for (const series of event.series.filter((s) => s.begun)) {
      const game = series.games.at(-1)!;
      game.accepted = [...game.userIds];
      completeEventGame(event, series, game.userIds[0]!, "BATTLE", 0);
    }
    advanceEvent(event, 0);
    beginEventRound(event, 0);
    const final = event.series.at(-1)!;
    completeEventGame(event, final, null, "DOUBLE_NO_SHOW", 0);
    advanceEvent(event, 0);
    expect(event.standings.slice(0, 2)).toEqual([null, null]);
    expect(event.standings.slice(2)).toHaveLength(2);
  });
  it("retains a scheduled next round when the previous round is still active", () => {
    const event = makeEvent(8);
    beginEventRound(event, 0);
    event.scheduledRoundAt = 123;
    expect(beginEventRound(event, 123)).toBe("This round has already begun");
    expect(event.scheduledRoundAt).toBe(123);
  });
  it("pays participation plus the decided series win when a best-of-five is forfeited", () => {
    const event = makeEvent(2, { bestOf: 5 });
    event.config.rewards.participation.reward_money = 10;
    event.config.rewards.perWin.reward_money = 5;
    event.config.rewards.winner.reward_money = 100;
    beginEventRound(event, 0);
    const series = event.series[0]!;
    const game = series.games.at(-1)!;
    game.accepted = [game.userIds[0]!];
    completeEventGame(event, series, game.userIds[0]!, "NO_SHOW", 0, true);
    advanceEvent(event, 0);
    expect(series.games).toHaveLength(1);
    expect(series.winnerUserId).toBe(game.userIds[0]!);
    expect(eventRewardFor(event, game.userIds[0]!)?.reward_money).toBe(115);
    const notSeeded = {
      ...event.participants[0]!,
      userId: "withdrawn-before-seed",
      id: "withdrawn",
      seed: 0,
      withdrawn: true,
    };
    event.participants.push(notSeeded);
    expect(eventRewardFor(event, notSeeded.userId)).toBeNull();
  });
  it("uses frozen wins for seeded brackets and round-specific series lengths", () => {
    const event = makeEvent(8, { seeding: "PVP_WINS", roundBestOf: [1, 3, 5] });
    expect(event.participants[0]!.seed).toBe(1);
    expect(event.series.filter((s) => s.round === 3)[0]!.bestOf).toBe(5);
  });
  it("shields registered and surviving entrants from open-world attacks until eliminated", () => {
    const event = makeEvent(4);
    const registering = createEventState(event.config);
    registering.status = "REGISTRATION";
    registering.participants = event.participants.map((p) => ({ ...p }));
    registering.participants[1]!.withdrawn = true;
    registering.participants[2]!.accepted = false;
    expect(isActiveEventEntrant(registering, "user-0")).toBe(true);
    expect(isActiveEventEntrant(registering, "user-1")).toBe(false);
    expect(isActiveEventEntrant(registering, "user-2")).toBe(false);
    expect(isActiveEventEntrant(registering, "stranger")).toBe(false);
    expect(isActiveEventEntrant({ ...registering, status: "DRAFT" }, "user-0")).toBe(
      false,
    );
    // Prepared bracket: every seeded entrant waits for a first-round ready check.
    expect(event.participants.every((p) => isActiveEventEntrant(event, p.userId))).toBe(
      true,
    );
    beginEventRound(event, 0);
    const first = event.series.find((s) => s.begun)!;
    const game = first.games.at(-1)!;
    game.accepted = [...game.userIds];
    completeEventGame(event, first, game.userIds[0]!, "BATTLE", 0);
    advanceEvent(event, 0);
    // The winner waits on the other semifinal; the loser is out and attackable again.
    expect(isActiveEventEntrant(event, game.userIds[0]!)).toBe(true);
    expect(isActiveEventEntrant(event, game.userIds[1]!)).toBe(false);
    eventAfterFirstGame(event);
    playOut(event);
    expect(event.participants.some((p) => isActiveEventEntrant(event, p.userId))).toBe(
      false,
    );
  });
  it("keeps a double-elimination upper-bracket loser shielded for the lower bracket", () => {
    const event = makeEvent(4, { format: "DOUBLE_ELIMINATION" });
    beginEventRound(event, 0);
    const first = event.series.find((s) => s.begun)!;
    const game = first.games.at(-1)!;
    game.accepted = [...game.userIds];
    completeEventGame(event, first, game.userIds[0]!, "BATTLE", 0);
    advanceEvent(event, 0);
    expect(isActiveEventEntrant(event, game.userIds[1]!)).toBe(true);
  });
});
const eventAfterFirstGame = (event: EventTournamentState) => {
  const series = event.series.find((s) => s.begun && !s.complete)!;
  const game = series.games.at(-1)!;
  game.accepted = [...game.userIds];
  completeEventGame(event, series, game.userIds[0]!, "BATTLE", 0);
  return event;
};

describe("staff event tournament predicates", () => {
  it("tracks the earliest unfinished round and the series waiting in it", () => {
    const event = makeEvent(4);
    advanceEvent(event, 0);
    const round = currentEventRound(event);
    expect(round).toBe(Math.min(...event.series.map((s) => s.round)));
    const series = event.series.find((s) => s.round === round)!;
    expect(isSeriesAwaitingBegin(series, round)).toBe(series.resolved);
    expect(isSeriesAwaitingBegin(series, round + 1)).toBe(false);
    expect(
      isSeriesAwaitingBegin({ ...series, resolved: true, begun: true }, round),
    ).toBe(false);
    expect(currentEventRound({ series: [] })).toBe(Infinity);
  });

  it("treats only launched games as in flight", () => {
    expect(isGameInFlight({ status: "STARTING" } as never)).toBe(true);
    expect(isGameInFlight({ status: "FIGHTING" } as never)).toBe(true);
    expect(isGameInFlight({ status: "READY" } as never)).toBe(false);
  });

  it("joins every failed requirement into one rejection", () => {
    const { config } = makeEvent(2, { minPvpWins: 5, minWinRate: 40 });
    const snapshot = { bracket: 1, pvpWins: 0, winRate: 0, masteredJutsu: 0 };
    expect(eligibilityError(config, snapshot)).toBe(
      "Requires 5 PvP wins. Requires 40% PvP win rate",
    );
    expect(eligibilityError(config, { ...snapshot, pvpWins: 5, winRate: 40 })).toBe("");
  });
});
