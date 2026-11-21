import { legalActions } from "@/libs/kessen/abilities";
import { actingSeats, applyAction, createMatch } from "@/libs/kessen/engine";
import { createRng } from "@/libs/kessen/rng";
import { CARD_ENGINE_VERSION, DEFAULT_KNOBS, ROWS } from "@/libs/kessen/rules";
import type {
  KessenAction,
  KessenCard,
  KessenEvent,
  KessenKnobs,
  MatchRules,
  MatchState,
  Row,
  Seat,
  SeatState,
  Unit,
} from "@/libs/kessen/types";
import { seedCardByName } from "./fixtures/catalog";
import { KESSEN_RULES_CATALOG } from "./fixtures/rulesCatalog";

/**
 * Card data of the engine scenarios: the frozen rules catalog, so balance edits to the
 * seed catalog never move a mechanics test.
 */
export const CATALOG = Object.fromEntries(
  KESSEN_RULES_CATALOG.map((card) => [card.id, card]),
);

/** Card id of a seed card by name. */
export const cid = (name: string) => seedCardByName(name).id;

/** Expands `[name, copies]` pairs into deck card ids. */
export const deckOf = (entries: [string, number][]) =>
  entries.flatMap(([name, copies]) => Array.from({ length: copies }, () => cid(name)));

export interface UnitSpec {
  name: string;
  stored?: number;
  sealed?: boolean;
  res?: boolean;
  med?: number;
  /** Owner when it differs from the side (Infiltrators, Fenced units). */
  owner?: Seat;
}

export interface SideSpec {
  leader?: string | null;
  leaderUsed?: boolean;
  hand?: string[];
  deck?: string[];
  discard?: string[];
  board?: Partial<Record<Row, (string | UnitSpec)[]>>;
  lanterns?: number;
  passed?: boolean;
  played?: number;
  sun?: boolean;
}

export interface ScenarioSpec {
  p0?: SideSpec;
  p1?: SideSpec;
  round?: number;
  turn?: Seat;
  opener?: Seat;
  rules?: MatchRules;
  knobs?: Partial<KessenKnobs>;
}

/**
 * A play-phase state built directly from names. Instance ids follow zone order per seat
 * (hand, deck, discard, then board), so tests can address them through `Scenario` lists.
 */
export const scenario = (spec: ScenarioSpec) => {
  const inst: Record<string, string> = {};
  const counters: [number, number] = [0, 0];
  const make = (seat: Seat, name: string) => {
    const id = `s${seat}-${counters[seat]}`;
    counters[seat] += 1;
    inst[id] = cid(name);
    return id;
  };
  let seq = 0;
  const emptySide = () => ({
    CLOSE: [] as Unit[],
    RANGED: [] as Unit[],
    JUTSU: [] as Unit[],
  });
  const board: MatchState["board"] = [emptySide(), emptySide()];
  const seats = ([0, 1] as const).map((seat): SeatState => {
    const side = specOf(spec, seat);
    const leaderCard = side.leader ? seedCardByName(side.leader) : null;
    return {
      leader: leaderCard ? leaderCard.id : null,
      faction: leaderCard ? leaderCard.faction : "NEUTRAL",
      hand: (side.hand ?? []).map((name) => make(seat, name)),
      deck: (side.deck ?? []).map((name) => make(seat, name)),
      discard: (side.discard ?? []).map((name) => make(seat, name)),
      lanterns: side.lanterns ?? 2,
      passed: side.passed ?? false,
      leaderUsed: side.leaderUsed ?? false,
      banked: 0,
      mull: null,
      played: side.played ?? 0,
      sun: side.sun ?? false,
    };
  }) as [SeatState, SeatState];
  for (const side of [0, 1] as const) {
    for (const row of ROWS) {
      for (const entry of specOf(spec, side).board?.[row] ?? []) {
        const unitSpec = typeof entry === "string" ? { name: entry } : entry;
        const owner = unitSpec.owner ?? side;
        const id = make(owner, unitSpec.name);
        const card = CATALOG[cid(unitSpec.name)] as KessenCard;
        seq += 1;
        board[side][row].push({
          id,
          owner,
          stored: unitSpec.stored ?? card.power,
          sealed: unitSpec.sealed ?? false,
          med: unitSpec.med ?? 0,
          res:
            unitSpec.res ?? card.abilities.some((ability) => ability.k === "resilient"),
          seq,
        });
      }
    }
  }
  const s: MatchState = {
    v: CARD_ENGINE_VERSION,
    seed: "scenario",
    rules: spec.rules ?? {},
    knobs: { ...DEFAULT_KNOBS, ...(spec.knobs ?? spec.rules?.knobs ?? {}) },
    cards: CATALOG,
    inst,
    tokens: 0,
    seq,
    roundSeq: 0,
    round: spec.round ?? 1,
    phase: "play",
    opener: spec.opener ?? 0,
    turn: spec.turn ?? 0,
    step: 0,
    seats,
    board,
    terrain: [
      { CLOSE: false, RANGED: false, JUTSU: false },
      { CLOSE: false, RANGED: false, JUTSU: false },
    ],
    history: [],
    result: null,
  };
  return s;
};

const specOf = (spec: ScenarioSpec, seat: Seat): SideSpec =>
  (seat === 0 ? spec.p0 : spec.p1) ?? {};

/** Instance id of the n-th unit in a row. */
export const unitAt = (s: MatchState, side: Seat, row: Row, index = 0) => {
  const unit = s.board[side][row][index];
  if (!unit) throw new Error(`No unit at ${side}:${row}:${index}`);
  return unit.id;
};

/** Hand instance id of the first card with this name. */
export const handCard = (s: MatchState, seat: Seat, name: string) => {
  const id = s.seats[seat].hand.find((entry) => s.inst[entry] === cid(name));
  if (!id) throw new Error(`${name} is not in seat ${seat}'s hand`);
  return id;
};

/** Applies an action that must be legal. */
export const act = (s: MatchState, seat: Seat, action: KessenAction) => {
  const result = applyAction(s, seat, action);
  if (!result.ok) throw new Error(`Illegal action: ${result.reason}`);
  return result;
};

export const stored = (s: MatchState, id: string) => {
  for (const side of s.board)
    for (const row of ROWS) {
      const unit = side[row].find((entry) => entry.id === id);
      if (unit) return unit.stored;
    }
  return null;
};

/** A deterministic random bot: picks legal actions and mulligans from its own seed. */
export const playBotMatch = (input: {
  seed: string;
  botSeed: string;
  decks: [string[], string[]];
  leaders: [string | null, string | null];
  rules?: MatchRules;
  maxSteps?: number;
  /** Catalog of the match; the frozen rules catalog by default. */
  cards?: KessenCard[];
}) => {
  const rng = createRng(input.botSeed);
  let state = createMatch({
    seed: input.seed,
    seats: [
      { leaderId: input.leaders[0], deck: input.decks[0] },
      { leaderId: input.leaders[1], deck: input.decks[1] },
    ],
    rules: input.rules,
    cards: input.cards ?? KESSEN_RULES_CATALOG,
  });
  const states: MatchState[] = [state];
  const log: { seat: Seat; action: KessenAction }[] = [];
  const events: KessenEvent[] = [];
  for (let step = 0; step < (input.maxSteps ?? 400); step++) {
    const seats = actingSeats(state);
    const seat = seats[0];
    if (seat === undefined) break;
    let action: KessenAction;
    if (state.phase === "mulligan") {
      const allowance = state.seats[seat].mull ?? 0;
      const count = rng.int(allowance + 1);
      const hand = [...state.seats[seat].hand];
      const cards: string[] = [];
      for (let i = 0; i < count && hand.length > 0; i++) {
        cards.push(hand.splice(rng.int(hand.length), 1)[0] as string);
      }
      action = { t: "mull", cards };
    } else {
      const options = legalActions(state, seat, { limit: 400 });
      const plays = options.filter((option) => option.t !== "pass");
      // Pass about one turn in six, otherwise play a random legal action.
      action =
        plays.length === 0 || rng.int(6) === 0
          ? { t: "pass" }
          : (plays[rng.int(plays.length)] as KessenAction);
    }
    const result = act(state, seat, action);
    state = result.state;
    states.push(state);
    log.push({ seat, action });
    events.push(...result.events);
  }
  return { state, states, log, events };
};
