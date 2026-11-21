import { describe, expect, it } from "bun:test";
import { aiRng, decide } from "@/libs/kessen/ai";
import { rowTotal } from "@/libs/kessen/board";
import {
  type DeckFaction,
  expandDeckCards,
  KESSEN_DECK_FACTIONS,
  starterDeck,
} from "@/libs/kessen/deck";
import {
  actingSeats,
  applyAction,
  createMatch,
  previewState,
  viewFor,
} from "@/libs/kessen/engine";
import { KESSEN_NPCS } from "@/libs/kessen/npcs";
import { ROWS } from "@/libs/kessen/rules";
import type { KessenAction, MatchState, Seat } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

/**
 * Balance smoke run: Chunin plays Chunin across every cross-faction pair of
 * the curated decks (starter and champion lists) with seats swapped on a shared seed.
 * The bands are deliberately coarse; the large sweeps run outside the repository.
 */
describe("Kessen balance smoke run", () => {
  const games = playRoundRobin(GAMES_PER_PAIR);

  it("finishes every match", () => {
    expect(games.every((game) => game.finished)).toBe(true);
    expect(games).toHaveLength(CROSS_FACTION_PAIRS * GAMES_PER_PAIR);
  });

  it("keeps every faction inside a coarse win-rate band", () => {
    const rates = Object.fromEntries(
      KESSEN_DECK_FACTIONS.map((faction) => {
        let score = 0;
        let played = 0;
        for (const game of games) {
          for (const seat of [0, 1] as const) {
            if (game.factions[seat] !== faction) continue;
            score += scoreOf(game.winner, seat);
            played += 1;
          }
        }
        const rate = Math.round((100 * score) / played);
        return [faction, rate >= 35 && rate <= 65 ? "in band" : `${rate}%`];
      }),
    );
    expect(rates).toEqual(
      Object.fromEntries(KESSEN_DECK_FACTIONS.map((faction) => [faction, "in band"])),
    );
  });

  it("keeps the match length, ties and the Round 1 opener inside their bands", () => {
    const plays = games.reduce((sum, game) => sum + game.plays, 0) / games.length;
    const rounds = games.reduce((sum, game) => sum + game.rounds, 0);
    const ties = games.reduce((sum, game) => sum + game.ties, 0);
    const opener =
      games.reduce((sum, game) => sum + scoreOf(game.winner, game.opener), 0) /
      games.length;
    expect(plays).toBeGreaterThanOrEqual(18);
    expect(plays).toBeLessThanOrEqual(32);
    expect(ties / rounds).toBeLessThanOrEqual(0.08);
    expect(opener).toBeGreaterThanOrEqual(0.36);
    expect(opener).toBeLessThanOrEqual(0.64);
  });

  it("bounds single-play swings and the largest row total", () => {
    const swings = games.flatMap((game) => game.swings).sort((a, b) => a - b);
    const p99 = swings[Math.floor(swings.length * 0.99)] ?? 0;
    expect(p99).toBeLessThanOrEqual(20);
    expect(swings.at(-1) ?? 0).toBeLessThanOrEqual(30);
    expect(Math.max(...games.map((game) => game.maxRow))).toBeLessThanOrEqual(50);
  });
});

const GAMES_PER_PAIR = 6;
/** Twelve decks, two per faction: 66 pairs minus the 6 same-faction ones. */
const CROSS_FACTION_PAIRS = 60;

const CHAMPIONS: Readonly<Record<DeckFaction, string>> = {
  SHIROHANA: "hisame",
  TSUKIMORI: "junko",
  HYORIN: "kimiko",
  AKASUMI: "crowned-captain",
  AKIKAZE: "kaze-no-seirei",
  SYNDICATE: "ravena",
};

interface Deck {
  key: string;
  faction: DeckFaction;
  leaderId: string;
  cards: string[];
}

interface GameRecord {
  finished: boolean;
  factions: [DeckFaction, DeckFaction];
  winner: Seat | null;
  opener: Seat;
  plays: number;
  rounds: number;
  ties: number;
  /** Board-total change of every play and leader activation, from the actor's side. */
  swings: number[];
  maxRow: number;
}

const scoreOf = (winner: Seat | null, seat: Seat) =>
  winner === null ? 0.5 : winner === seat ? 1 : 0;

const curatedDecks = (): Deck[] =>
  KESSEN_DECK_FACTIONS.flatMap((faction) => {
    const starter = starterDeck(faction);
    const champion = KESSEN_NPCS.find((npc) => npc.key === CHAMPIONS[faction]);
    if (!champion) throw new Error(`No champion for ${faction}`);
    return [
      {
        key: `starter-${faction}`,
        faction,
        leaderId: starter.leaderId,
        cards: expandDeckCards(starter.cards),
      },
      {
        key: `champion-${faction}`,
        faction,
        leaderId: champion.standard.deck.leaderId,
        cards: expandDeckCards(champion.standard.deck.cards),
      },
    ];
  });

/** Game 2k seats deck a first and game 2k + 1 swaps the seats on the same seed. */
const playRoundRobin = (perPair: number): GameRecord[] => {
  const decks = curatedDecks();
  const records: GameRecord[] = [];
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      const a = decks[i] as Deck;
      const b = decks[j] as Deck;
      if (a.faction === b.faction) continue;
      for (let game = 0; game < perPair; game++) {
        const seats: [Deck, Deck] = game % 2 === 0 ? [a, b] : [b, a];
        records.push(playGame(`balance:${a.key}:${b.key}:${game >> 1}`, seats));
      }
    }
  }
  return records;
};

const playGame = (seed: string, decks: [Deck, Deck]): GameRecord => {
  let state = createMatch({
    seed,
    seats: [
      { leaderId: decks[0].leaderId, deck: decks[0].cards },
      { leaderId: decks[1].leaderId, deck: decks[1].cards },
    ],
    cards: KESSEN_SEED_CATALOG,
  });
  const record: GameRecord = {
    finished: false,
    factions: [decks[0].faction, decks[1].faction],
    winner: null,
    opener: state.opener,
    plays: 0,
    rounds: 0,
    ties: 0,
    swings: [],
    maxRow: 0,
  };
  for (let step = 0; step < 400; step++) {
    const seat = actingSeats(state)[0];
    if (seat === undefined) break;
    const action = decide(
      viewFor(state, seat),
      seat,
      { tier: "CHUNIN" },
      aiRng(seed, seat, state.step),
      { pool: KESSEN_SEED_CATALOG, deck: decks[seat].cards },
    );
    if (action.t === "play" || action.t === "leader") {
      record.swings.push(swingOf(state, seat, action));
      if (action.t === "leader" || !action.card.startsWith("t-")) record.plays += 1;
    }
    const result = applyAction(state, seat, action);
    if (!result.ok) throw new Error(`${seed}: ${result.reason}`);
    for (const event of result.events) {
      if (event.t !== "roundEnd") continue;
      record.rounds += 1;
      if (event.totals[0] === event.totals[1]) record.ties += 1;
    }
    state = result.state;
    record.maxRow = Math.max(record.maxRow, largestRow(state));
  }
  record.finished = state.phase === "over";
  record.winner = state.result?.winner ?? null;
  return record;
};

/** Board-total change of a play from the acting seat's side. */
const swingOf = (state: MatchState, seat: Seat, action: KessenAction) => {
  const preview = previewState(state, seat, action);
  if (!preview.ok) return 0;
  const other = seat === 0 ? 1 : 0;
  const { before, after } = preview.totals;
  return after[seat] - after[other] - (before[seat] - before[other]);
};

const largestRow = (state: MatchState) => {
  if (state.phase !== "play") return 0;
  let largest = 0;
  for (const side of [0, 1] as const) {
    for (const row of ROWS) largest = Math.max(largest, rowTotal(state, side, row));
  }
  return largest;
};
