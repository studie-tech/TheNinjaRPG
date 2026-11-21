/**
 * Prepared Academy positions: a play-phase `MatchState` built from plain card lists, so
 * a lesson can start mid-match (rounds already played, hands and boards set). Instance
 * ids follow zone order per seat (hand, deck, discard, then board), which keeps every
 * lesson's ids fixed and readable.
 */
import { knownCard } from "./board";
import {
  CARD_ENGINE_VERSION,
  DEFAULT_KNOBS,
  LANTERNS,
  ROWS,
  TOKEN_CARD_ID,
} from "./rules";
import type {
  KessenCard,
  MatchRules,
  MatchState,
  RoundResult,
  Row,
  Seat,
  SeatState,
  Unit,
} from "./types";

/** A unit already on the board; a bare card id is the card at its printed power. */
export type AcademyUnitSpec =
  | string
  | { card: string; stored?: number; sealed?: boolean; med?: number };

export interface AcademySideSpec {
  leader?: string | null;
  leaderUsed?: boolean;
  hand: readonly string[];
  /** Top first. */
  deck?: readonly string[];
  discard?: readonly string[];
  board?: Partial<Record<Row, readonly AcademyUnitSpec[]>>;
  passed?: boolean;
  /** Cards played from hand this round, for Rigged Odds and the reward guard. */
  played?: number;
}

export interface AcademyPositionSpec {
  round: number;
  opener: Seat;
  /** The seat to act first. */
  turn: Seat;
  /** Winners of the rounds already played, with their totals. */
  history: readonly { winner: Seat | null; totals: [number, number] }[];
  seats: readonly [AcademySideSpec, AcademySideSpec];
  /** Afflicted rows per side. */
  terrain?: readonly [readonly Row[], readonly Row[]];
  rules: MatchRules;
}

/**
 * The position as a play-phase state over a snapshot of the cards it names. Throws on a
 * card the catalog does not hold; `academyPositionProblem` checks the rest.
 */
export const buildAcademyPosition = (
  spec: AcademyPositionSpec,
  catalog: readonly KessenCard[],
  seed: string,
): MatchState => {
  const library = new Map(catalog.map((card) => [card.id, card]));
  const used = new Set<string>([TOKEN_CARD_ID]);
  for (const side of spec.seats) {
    if (side.leader) used.add(side.leader);
    for (const id of [...side.hand, ...(side.deck ?? []), ...(side.discard ?? [])])
      used.add(id);
    for (const row of ROWS)
      for (const entry of side.board?.[row] ?? []) used.add(unitCard(entry));
  }
  const cards: Record<string, KessenCard> = {};
  for (const id of [...used].sort()) {
    const card = library.get(id);
    if (!card) {
      if (id === TOKEN_CARD_ID) continue;
      throw new Error(`Unknown Academy card ${id}`);
    }
    cards[id] = card;
  }

  const inst: Record<string, string> = {};
  const counters: [number, number] = [0, 0];
  const make = (seat: Seat, cardId: string) => {
    const id = `s${seat}-${counters[seat]}`;
    counters[seat] += 1;
    inst[id] = cardId;
    return id;
  };
  const losses = (seat: Seat) =>
    spec.history.filter((round) => round.winner !== seat).length;
  const seats = ([0, 1] as const).map((seat): SeatState => {
    const side = spec.seats[seat];
    const leader = side.leader ?? null;
    return {
      leader,
      faction: leader ? (cards[leader]?.faction ?? "NEUTRAL") : "NEUTRAL",
      hand: side.hand.map((id) => make(seat, id)),
      deck: (side.deck ?? []).map((id) => make(seat, id)),
      discard: (side.discard ?? []).map((id) => make(seat, id)),
      lanterns: Math.max(0, LANTERNS - losses(seat)),
      passed: side.passed ?? false,
      leaderUsed: side.leaderUsed ?? false,
      banked: 0,
      mull: null,
      played: side.played ?? 0,
      sun: false,
    };
  }) as [SeatState, SeatState];

  let seq = 0;
  const board: MatchState["board"] = [emptyRows(), emptyRows()];
  for (const seat of [0, 1] as const) {
    for (const row of ROWS) {
      for (const entry of spec.seats[seat].board?.[row] ?? []) {
        const cardId = unitCard(entry);
        const card = cards[cardId] as KessenCard;
        const detail: Exclude<AcademyUnitSpec, string> =
          typeof entry === "string" ? { card: entry } : entry;
        seq += 1;
        board[seat][row].push({
          id: make(seat, cardId),
          owner: seat,
          stored: detail.stored ?? card.power,
          sealed: detail.sealed ?? false,
          med: detail.med ?? 0,
          res: card.abilities.some((ability) => ability.k === "resilient"),
          seq,
        });
      }
    }
  }
  const afflicted = (seat: Seat) => {
    const rows = spec.terrain?.[seat] ?? [];
    return {
      CLOSE: rows.includes("CLOSE"),
      RANGED: rows.includes("RANGED"),
      JUTSU: rows.includes("JUTSU"),
    };
  };
  const history: RoundResult[] = spec.history.map((round, index) => ({
    round: index + 1,
    totals: [round.totals[0], round.totals[1]],
    winner: round.winner,
    riggedOdds: false,
  }));
  return {
    v: CARD_ENGINE_VERSION,
    seed,
    rules: spec.rules,
    knobs: { ...DEFAULT_KNOBS, ...(spec.rules.knobs ?? {}) },
    cards,
    inst,
    tokens: 0,
    seq,
    // Every unit of the position was placed this round.
    roundSeq: 0,
    round: spec.round,
    phase: "play",
    opener: spec.opener,
    turn: spec.turn,
    step: 0,
    seats,
    board,
    terrain: [afflicted(0), afflicted(1)],
    history,
    result: null,
  };
};

/**
 * Why a built position breaks an engine invariant, else null: every instance in exactly
 * one zone, units in rows they may stand in, row and hand caps, leaders outside decks,
 * lanterns that match the round history, and an acting seat that has not passed.
 */
export const academyPositionProblem = (s: MatchState): string | null => {
  if (s.phase !== "play" || s.result) return "A position starts in the play phase";
  if (s.history.length !== s.round - 1)
    return "The history must cover every earlier round";
  const seen = new Set<string>();
  const claim = (id: string) => {
    if (seen.has(id)) return `Instance ${id} is in two zones`;
    if (!(id in s.inst)) return `Instance ${id} has no card`;
    seen.add(id);
    return null;
  };
  for (const seat of [0, 1] as const) {
    const zone = s.seats[seat];
    for (const id of [...zone.hand, ...zone.deck, ...zone.discard]) {
      const problem = claim(id);
      if (problem) return problem;
      const card = knownCard(s, id);
      if (card.kind === "LEADER" || card.id === TOKEN_CARD_ID)
        return `${card.name} cannot be a deck card`;
    }
    if (zone.hand.length > s.knobs.handCap) return "A hand is over the hand cap";
    if (zone.leader !== null && s.cards[zone.leader]?.kind !== "LEADER")
      return `Unknown leader ${zone.leader}`;
    const lost = s.history.filter((round) => round.winner !== seat).length;
    if (zone.lanterns !== LANTERNS - lost || zone.lanterns < 1)
      return "Lanterns must match the rounds already lost";
    for (const row of ROWS) {
      const units: Unit[] = s.board[seat][row];
      if (units.length > s.knobs.rowCap) return `Row ${row} is over the row cap`;
      for (const unit of units) {
        const problem = claim(unit.id);
        if (problem) return problem;
        const card = knownCard(s, unit.id);
        if (card.kind !== "UNIT") return `${card.name} is not a unit`;
        if (card.row !== "ANY" && card.row !== row)
          return `${card.name} cannot stand in ${row}`;
        if (unit.stored <= 0) return `${card.name} has no power left`;
      }
    }
  }
  if (s.seats[s.turn].passed) return "The acting seat has passed";
  if (s.seats[0].passed && s.seats[1].passed) return "Both seats have passed";
  return null;
};

const unitCard = (entry: AcademyUnitSpec) =>
  typeof entry === "string" ? entry : entry.card;

const emptyRows = (): Record<Row, Unit[]> => ({ CLOSE: [], RANGED: [], JUTSU: [] });
