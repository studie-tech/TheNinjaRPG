import { describe, expect, it } from "bun:test";
import {
  KESSEN_MIN_MATCH_SECONDS,
  KESSEN_PVP_MAX_TIMEOUTS,
  KESSEN_PVP_MULLIGAN_SECONDS,
  KESSEN_PVP_TURN_SECONDS,
  KESSEN_RANKED_RADIUS_MAX,
  KESSEN_RANKED_RADIUS_STEP,
  KESSEN_RANKED_RATING_FLOOR,
} from "@/drizzle/constants";
import { snapshotCatalog } from "@/libs/kessen/catalog";
import { expandDeckCards, starterDeck } from "@/libs/kessen/deck";
import { applyAction, createMatch } from "@/libs/kessen/engine";
import {
  kessenClockSeconds,
  kessenDuelEligibility,
  kessenForfeitWinner,
  kessenLogNames,
  kessenNextDeadline,
  kessenRankedRadius,
  kessenRatingDelta,
  pickKessenOpponent,
  resolveKessenClock,
} from "@/libs/kessen/pvp";
import type { MatchState } from "@/libs/kessen/types";
import { decodeKessenDeckSource, encodeKessenDeckSource } from "@/validators/kessen";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

const POOL = snapshotCatalog(KESSEN_SEED_CATALOG);
const T0 = new Date("2026-11-17T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const duel = (): MatchState => {
  const a = starterDeck("AKASUMI");
  const b = starterDeck("AKIKAZE");
  return createMatch({
    seed: "pvp-clock",
    seats: [
      { leaderId: a.leaderId, deck: expandDeckCards(a.cards) },
      { leaderId: b.leaderId, deck: expandDeckCards(b.cards) },
    ],
    cards: POOL,
  });
};

const mulled = () => {
  let state = duel();
  for (const seat of [0, 1] as const) {
    const applied = applyAction(state, seat, { t: "mull", cards: [] });
    if (!applied.ok) throw new Error(applied.reason);
    state = applied.state;
  }
  return state;
};

describe("kessen duel clock", () => {
  it("does nothing before the deadline", () => {
    const engine = duel();
    const resolved = resolveKessenClock({
      engine,
      timeouts: [0, 0],
      deadline: at(10),
      now: at(9),
    });
    expect(resolved.engine).toBe(engine);
    expect(resolved.timedOut).toEqual([]);
    expect(resolved.deadline).toEqual(at(10));
  });

  it("keeps both hands when the mulligan window runs out", () => {
    const resolved = resolveKessenClock({
      engine: duel(),
      timeouts: [0, 0],
      deadline: at(0),
      now: at(1),
    });
    expect(resolved.timedOut).toEqual([0, 1]);
    expect(resolved.timeouts).toEqual([1, 1]);
    expect(resolved.engine.phase).toBe("play");
    expect(resolved.forfeited).toEqual([]);
    // The next window starts when the last one ended, not when someone looked.
    expect(resolved.deadline).toEqual(at(KESSEN_PVP_TURN_SECONDS));
  });

  it("passes the round for the seat to act and forfeits at the limit", () => {
    const engine = mulled();
    const turn = engine.turn;
    const passed = resolveKessenClock({
      engine,
      timeouts: [0, 0],
      deadline: at(0),
      now: at(1),
    });
    expect(passed.timedOut).toEqual([turn]);
    expect(passed.engine.seats[turn].passed).toBe(true);
    expect(
      passed.events.some((event) => event.t === "passed" && event.seat === turn),
    ).toBe(true);
    const limit: [number, number] = [0, 0];
    limit[turn] = KESSEN_PVP_MAX_TIMEOUTS - 1;
    const forfeit = resolveKessenClock({
      engine,
      timeouts: limit,
      deadline: at(0),
      now: at(1),
    });
    expect(forfeit.forfeited).toEqual([turn]);
    expect(forfeit.deadline).toBeNull();
    expect(kessenForfeitWinner(forfeit.forfeited)).toBe(turn === 0 ? 1 : 0);
  });

  it("chains missed clocks of an abandoned duel to a double forfeit", () => {
    const resolved = resolveKessenClock({
      engine: duel(),
      timeouts: [0, 0],
      deadline: at(0),
      now: at(3600),
    });
    expect(resolved.forfeited.sort()).toEqual([0, 1]);
    expect(kessenForfeitWinner(resolved.forfeited)).toBeNull();
  });

  it("keeps the mulligan window while the other seat still owes its mulligan", () => {
    const before = duel();
    const applied = applyAction(before, 0, { t: "mull", cards: [] });
    if (!applied.ok) throw new Error(applied.reason);
    expect(kessenNextDeadline(before, applied.state, at(30), at(5))).toEqual(at(30));
    const both = applyAction(applied.state, 1, { t: "mull", cards: [] });
    if (!both.ok) throw new Error(both.reason);
    expect(kessenNextDeadline(applied.state, both.state, at(30), at(5))).toEqual(
      at(5 + KESSEN_PVP_TURN_SECONDS),
    );
    expect(kessenClockSeconds(before)).toBe(KESSEN_PVP_MULLIGAN_SECONDS);
  });
});

describe("kessen ranked helpers", () => {
  it("rates with Elo, a provisional K-factor and a floor", () => {
    const even = kessenRatingDelta({
      rating: 1000,
      opponentRating: 1000,
      score: 1,
      played: 20,
    });
    expect(even).toBe(12);
    expect(
      kessenRatingDelta({ rating: 1000, opponentRating: 1000, score: 0, played: 20 }),
    ).toBe(-12);
    expect(
      kessenRatingDelta({ rating: 1000, opponentRating: 1000, score: 1, played: 0 }),
    ).toBe(20);
    expect(
      kessenRatingDelta({ rating: 1000, opponentRating: 1000, score: 0.5, played: 20 }),
    ).toBe(0);
    expect(
      KESSEN_RANKED_RATING_FLOOR +
        kessenRatingDelta({
          rating: KESSEN_RANKED_RATING_FLOOR,
          opponentRating: 2000,
          score: 0,
          played: 20,
        }),
    ).toBe(KESSEN_RANKED_RATING_FLOOR);
  });

  it("widens the matchmaking radius with waiting time", () => {
    expect(kessenRankedRadius(0)).toBe(KESSEN_RANKED_RADIUS_STEP);
    expect(kessenRankedRadius(-5)).toBe(KESSEN_RANKED_RADIUS_STEP);
    expect(kessenRankedRadius(25)).toBe(3 * KESSEN_RANKED_RADIUS_STEP);
    expect(kessenRankedRadius(115)).toBe(KESSEN_RANKED_RADIUS_MAX);
    expect(kessenRankedRadius(10_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it("picks the closest live opponent within the radius, never an excluded one", () => {
    const me = { userId: "me", rating: 1000, queuedAt: at(0) };
    const queue = [
      { userId: "far", rating: 1300, queuedAt: at(0) },
      { userId: "near", rating: 1040, queuedAt: at(0) },
      { userId: "closest", rating: 1010, queuedAt: at(0) },
    ];
    expect(
      pickKessenOpponent(me, queue, { now: at(1), excluded: new Set() })?.userId,
    ).toBe("closest");
    expect(
      pickKessenOpponent(me, queue, { now: at(1), excluded: new Set(["closest"]) })
        ?.userId,
    ).toBe("near");
    expect(
      pickKessenOpponent(me, [queue[0] as (typeof queue)[number]], {
        now: at(1),
        excluded: new Set(),
      }),
    ).toBeNull();
    // Long waits match anyone.
    expect(
      pickKessenOpponent(me, [queue[0] as (typeof queue)[number]], {
        now: at(600),
        excluded: new Set(),
      })?.userId,
    ).toBe("far");
  });

  it("rewards only real matches where the loser played its share", () => {
    const long = (KESSEN_MIN_MATCH_SECONDS + 1) * 1000;
    expect(
      kessenDuelEligibility({ winner: 0, durationMs: long, plays: [6, 5] }),
    ).toEqual({
      eligible: true,
    });
    expect(
      kessenDuelEligibility({ winner: 0, durationMs: 1000, plays: [6, 5] }).eligible,
    ).toBe(false);
    expect(
      kessenDuelEligibility({ winner: 0, durationMs: long, plays: [8, 1] }).eligible,
    ).toBe(false);
    expect(
      kessenDuelEligibility({ winner: null, durationMs: long, plays: [6, 6] }).eligible,
    ).toBe(false);
  });

  it("names only instances the redacted events or the view show", () => {
    expect(
      kessenLogNames(
        [
          { t: "played", seat: 1, id: "s1-4", cardId: "card-x" },
          { t: "drawn", seat: 1, cards: ["?"], banked: 0 },
        ],
        { "s0-1": "card-y" },
      ),
    ).toEqual({ "s1-4": "card-x", "s0-1": "card-y" });
  });

  it("round-trips the challenger's deck source through the request", () => {
    for (const deck of [
      { source: "saved", deckId: "abc" },
      { source: "fill", deckId: "abc" },
      { source: "loaner", faction: "HYORIN" },
    ] as const)
      expect(decodeKessenDeckSource(encodeKessenDeckSource(deck))).toEqual(deck);
    expect(decodeKessenDeckSource("loaner:NOPE")).toBeNull();
    expect(decodeKessenDeckSource(null)).toBeNull();
  });
});
