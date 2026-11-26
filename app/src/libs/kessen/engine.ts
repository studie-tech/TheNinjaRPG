/**
 * Kessen match engine: creation, the turn and round flow, redacted views, previews and
 * state fingerprints.
 *
 * Determinism rules: integers only; every random draw happens in `createMatch` (the
 * `engine` stream shuffles and tosses the coin, the `ids` stream labels instances);
 * every iteration follows the canonical unit order (seat 0 first, rows outward,
 * ascending `seq`); no wall clock.
 */
import {
  illegal,
  leaderAvailable,
  legalActions,
  probeAction,
  resolveAction,
  rowOptions,
  signalOf,
  targetOptions,
  turnErrorOf,
} from "./abilities";
import {
  allUnits,
  capCount,
  cardOf,
  cloneState,
  displayedPower,
  drawCards,
  fewestUnitsRow,
  hasAbility,
  isInfiltrator,
  isTokenId,
  isUnyielding,
  knownCard,
  other,
  place,
  rowHasSpace,
  sweepDestroyed,
  totals,
  type UnitRef,
  unitsOf,
} from "./board";
import { createStream, hashString, shuffleInPlace } from "./rng";
import {
  CARD_ENGINE_VERSION,
  DEFAULT_KNOBS,
  GAMBIT_ROW,
  LANTERNS,
  LAST_ROUND,
  ROUND_DRAWS,
  ROWS,
  START_HAND,
  TOKEN_CARD_ID,
} from "./rules";
import type {
  ApplyResult,
  CreateMatchInput,
  HiddenEffect,
  KessenAction,
  KessenCard,
  KessenEvent,
  MatchState,
  MatchView,
  PartialOption,
  PartialPreview,
  PreviewResult,
  Row,
  Seat,
  SeatState,
  SeatView,
  SideBoard,
  SideTerrain,
  UnitDelta,
} from "./types";

/** Why `createMatch` would reject an input (an unknown leader or deck card); else null. */
export const matchInputProblem = (input: CreateMatchInput): string | null => {
  const library = new Map(input.cards.map((card) => [card.id, card]));
  for (const setup of input.seats) {
    if (setup.leaderId !== null && library.get(setup.leaderId)?.kind !== "LEADER") {
      return `Unknown leader ${setup.leaderId}`;
    }
    for (const cardId of setup.deck) {
      const card = library.get(cardId);
      if (!card || card.kind === "LEADER" || cardId === TOKEN_CARD_ID) {
        return `Unknown deck card ${cardId}`;
      }
    }
  }
  return null;
};

/** Builds a match in its Round 1 mulligan step. Throws on unknown card or leader ids. */
export const createMatch = (input: CreateMatchInput): MatchState => {
  const problem = matchInputProblem(input);
  if (problem) throw new Error(problem);
  const rules = input.rules ?? {};
  const knobs = { ...DEFAULT_KNOBS, ...(rules.knobs ?? {}) };
  const library = new Map(input.cards.map((card) => [card.id, card]));
  const token: KessenCard = {
    ...(library.get(TOKEN_CARD_ID) ?? SHADOW_CLONE),
    power: knobs.gambitPower,
  };
  library.set(TOKEN_CARD_ID, token);

  const used = new Set<string>([TOKEN_CARD_ID]);
  for (const setup of input.seats) {
    if (setup.leaderId !== null) used.add(setup.leaderId);
    for (const cardId of setup.deck) used.add(cardId);
  }
  const cards: Record<string, KessenCard> = {};
  for (const id of [...used].sort()) cards[id] = library.get(id) as KessenCard;

  const engine = createStream(input.seed, "engine");
  const labels = createStream(input.seed, "ids");
  const inst: Record<string, string> = {};
  const seats = input.seats.map((setup, index): SeatState => {
    const order = [...setup.deck];
    const shuffled = setup.shuffle !== false;
    if (shuffled) shuffleInPlace(engine, order);
    // Labels are a separate permutation, so an instance id never reveals a deck position.
    const label = order.map((_, n) => n);
    if (shuffled) shuffleInPlace(labels, label);
    const deck = order.map((cardId, n) => {
      const id = `s${index}-${label[n]}`;
      inst[id] = cardId;
      return id;
    });
    return {
      leader: setup.leaderId,
      faction:
        setup.leaderId === null
          ? "NEUTRAL"
          : (cards[setup.leaderId]?.faction ?? "NEUTRAL"),
      deck,
      hand: [],
      discard: [],
      lanterns: LANTERNS,
      passed: false,
      leaderUsed: false,
      banked: 0,
      mull: null,
      played: 0,
      sun: false,
    };
  }) as [SeatState, SeatState];
  const opener: Seat = engine.int(2) === 0 ? 0 : 1;

  const s: MatchState = {
    v: CARD_ENGINE_VERSION,
    seed: input.seed,
    rules,
    knobs,
    cards,
    inst,
    tokens: 0,
    seq: 0,
    roundSeq: 0,
    round: 1,
    phase: "mulligan",
    opener,
    turn: opener,
    step: 0,
    seats,
    board: [emptySide(), emptySide()],
    terrain: [clearTerrain(), clearTerrain()],
    history: [],
    result: null,
  };
  const events: KessenEvent[] = [{ t: "roundStart", round: 1, opener }];
  drawCards(s, events, 0, START_HAND);
  drawCards(s, events, 1, START_HAND);
  beginMulliganStep(s, events);
  return s;
};

/** Applies one action of `seat`; never mutates `state`. */
export const applyAction = (
  state: MatchState,
  seat: Seat,
  action: KessenAction,
): ApplyResult => {
  if (seat !== 0 && seat !== 1) return { ok: false, reason: "Unknown seat" };
  const s = cloneState(state);
  const events: KessenEvent[] = [];
  try {
    switch (action.t) {
      case "mull":
        applyMulligan(s, events, seat, action.cards);
        break;
      case "pass": {
        const error = turnErrorOf(s, seat);
        if (error) illegal(error);
        s.seats[seat].passed = true;
        events.push({ t: "passed", seat, auto: false });
        advance(s, events, seat);
        break;
      }
      case "play":
      case "leader": {
        const resolved = resolveAction(s, seat, action);
        events.push(...resolved.events);
        advance(s, events, seat);
        break;
      }
      default:
        return { ok: false, reason: "Unknown action" };
    }
  } catch (error) {
    const signal = signalOf(error);
    if (signal?.illegal) return { ok: false, reason: signal.illegal };
    if (signal?.need) return { ok: false, reason: "Choose every target" };
    throw error;
  }
  s.step += 1;
  return { ok: true, state: s, events };
};

/** Seats that must act now: both during a mulligan step, else the active seat. */
export const actingSeats = (s: MatchState): Seat[] => {
  if (s.phase === "over") return [];
  if (s.phase === "mulligan")
    return ([0, 1] as const).filter((seat) => s.seats[seat].mull !== null);
  return [s.turn];
};

/** Mulligans `seat` may take in the pending step (0 when none is pending). */
export const mulliganAllowance = (s: MatchState, seat: Seat) => s.seats[seat].mull ?? 0;

// ---------------------------------------------------------------------------
// Round flow

const beginMulliganStep = (s: MatchState, events: KessenEvent[]) => {
  s.phase = "mulligan";
  for (const seat of [0, 1] as const) {
    const zone = s.seats[seat];
    const base =
      s.round === 1
        ? (s.rules.r1MulliganCap ?? s.knobs.r1Mulligans)
        : s.knobs.laterMulligans + zone.banked;
    const tailwind = zone.faction === "AKIKAZE" ? s.knobs.tailwind : 0;
    const allowance = Math.min(
      base + tailwind + extraMulligans(s, seat),
      zone.deck.length,
      capCount(zone.hand),
    );
    zone.banked = 0;
    zone.mull = allowance > 0 ? allowance : null;
  }
  if (s.seats[0].mull === null && s.seats[1].mull === null) finishMulligans(s, events);
};

const extraMulligans = (s: MatchState, seat: Seat) => {
  const extra = s.rules.extraMulligans;
  if (extra === undefined) return 0;
  if (typeof extra === "number") return extra;
  const target = extra.seat === "human" ? 0 : extra.seat;
  return target === seat ? extra.n : 0;
};

const applyMulligan = (
  s: MatchState,
  events: KessenEvent[],
  seat: Seat,
  cards: string[],
) => {
  if (s.phase !== "mulligan") illegal("No mulligan step is open");
  const zone = s.seats[seat];
  if (zone.mull === null) illegal("Your mulligan is done");
  if (!Array.isArray(cards) || new Set(cards).size !== cards.length) {
    illegal("Choose each card once");
  }
  if (cards.length > (zone.mull ?? 0)) illegal(`Mulligan up to ${zone.mull} cards`);
  for (const id of cards) {
    if (!zone.hand.includes(id)) illegal("That card is not in your hand");
    if (isTokenId(id)) illegal("The Shadow Clone cannot be mulliganed");
  }
  const removed = zone.hand.filter((id) => cards.includes(id));
  zone.hand = zone.hand.filter((id) => !cards.includes(id));
  const drawn = zone.deck.splice(0, removed.length);
  zone.hand.push(...drawn);
  zone.deck.push(...removed);
  zone.mull = null;
  events.push({ t: "mulligan", seat, count: removed.length, removed, drawn });
  if (s.seats[0].mull === null && s.seats[1].mull === null) finishMulligans(s, events);
};

const finishMulligans = (s: MatchState, events: KessenEvent[]) => {
  if (s.round === 1) openingGambit(s, events);
  if (s.round === 3) {
    returningTide(s, events, 0);
    returningTide(s, events, 1);
  }
  for (const entry of s.rules.startTerrain ?? []) {
    if (!entry.rounds.includes(s.round)) continue;
    for (const side of [0, 1] as const) {
      if (s.terrain[side][entry.row]) continue;
      s.terrain[side][entry.row] = true;
      events.push({ t: "terrain", side, row: entry.row, on: true, source: "rule" });
    }
  }
  const carry = s.rules.carryBonus ?? 0;
  if (carry > 0) {
    for (const ref of allUnits(s)) {
      if (ref.unit.seq > s.roundSeq) continue;
      ref.unit.stored += carry;
      events.push({
        t: "boosted",
        id: ref.unit.id,
        amount: carry,
        stored: ref.unit.stored,
        source: "rule",
        cause: "carry",
      });
    }
  }
  s.phase = "play";
  if (!beginTurn(s, events, s.opener)) advance(s, events, s.opener);
};

/**
 * Opening Gambit: the Round 1 opener starts with a Shadow Clone on its
 * Taijutsu row (or the rules' `gambitRow`). It restores last-play parity without
 * costing the opener a turn.
 */
const openingGambit = (s: MatchState, events: KessenEvent[]) => {
  s.tokens += 1;
  const id = `t-${s.tokens}`;
  // Cloned states share the instance map, so a new entry replaces it.
  s.inst = { ...s.inst, [id]: TOKEN_CARD_ID };
  events.push({ t: "token", seat: s.opener, id, cardId: TOKEN_CARD_ID });
  const row = s.rules.gambitRow ?? GAMBIT_ROW;
  if (!rowHasSpace(s, s.opener, row)) return;
  place(s, events, {
    id,
    owner: s.opener,
    side: s.opener,
    row,
    source: "gambit",
  });
  sweepDestroyed(s, events, "depleted");
};

/** Akasumi: deploy the strongest eligible unit (printed power <= max) from the discard. */
const returningTide = (s: MatchState, events: KessenEvent[], seat: Seat) => {
  const zone = s.seats[seat];
  if (zone.faction !== "AKASUMI") return;
  for (let n = 0; n < s.knobs.tideCount; n++) {
    let best: { id: string; card: KessenCard; row: Row } | null = null;
    for (const id of zone.discard) {
      const card = knownCard(s, id);
      if (
        card.kind !== "UNIT" ||
        card.power > s.knobs.tideMaxPower ||
        isUnyielding(card) ||
        isInfiltrator(card) ||
        isTokenId(id) ||
        hasAbility(card, "revive")
      ) {
        continue;
      }
      const row =
        card.row === "ANY"
          ? fewestUnitsRow(s, seat)
          : card.row !== null && rowHasSpace(s, seat, card.row)
            ? card.row
            : null;
      if (row === null) continue;
      if (!best || card.power > best.card.power) best = { id, card, row };
    }
    if (!best) return;
    zone.discard.splice(zone.discard.indexOf(best.id), 1);
    place(s, events, {
      id: best.id,
      owner: seat,
      side: seat,
      row: best.row,
      source: "tide",
    });
  }
};

/** Starts a turn: Meditate triggers, then an empty-handed player without a leader passes. */
const beginTurn = (s: MatchState, events: KessenEvent[], seat: Seat) => {
  s.turn = seat;
  events.push({ t: "turn", seat });
  for (const ref of unitsOf(s, seat)) {
    if (ref.unit.sealed || ref.unit.med >= s.knobs.meditateCap) continue;
    let rate = 0;
    for (const ability of knownCard(s, ref.unit.id).abilities) {
      if (ability.k === "meditate") rate += ability.x;
    }
    if (rate <= 0) continue;
    const gain = Math.min(rate, s.knobs.meditateCap - ref.unit.med);
    ref.unit.stored += gain;
    ref.unit.med += gain;
    events.push({
      t: "boosted",
      id: ref.unit.id,
      amount: gain,
      stored: ref.unit.stored,
      source: ref.unit.id,
      cause: "meditate",
    });
  }
  const zone = s.seats[seat];
  if (zone.hand.length === 0 && !leaderAvailable(s, seat)) {
    zone.passed = true;
    events.push({ t: "passed", seat, auto: true });
    return false;
  }
  return true;
};

/** Hands the turn on after `last` acted; ends the round once both have passed. */
const advance = (s: MatchState, events: KessenEvent[], last: Seat) => {
  let current = last;
  for (;;) {
    if (s.seats[0].passed && s.seats[1].passed) {
      endRound(s, events);
      return;
    }
    const opponent = other(current);
    const next = s.seats[opponent].passed ? current : opponent;
    if (beginTurn(s, events, next)) return;
    current = next;
  }
};

const endRound = (s: MatchState, events: KessenEvent[]) => {
  const roundTotals = totals(s);
  let winner: Seat | null =
    roundTotals[0] > roundTotals[1] ? 0 : roundTotals[1] > roundTotals[0] ? 1 : null;
  let riggedOdds = false;
  if (winner === null) {
    const rigged = riggedOddsWinner(s);
    if (rigged !== null) {
      winner = rigged;
      riggedOdds = true;
    }
  }
  const lost: Seat[] = winner === null ? [0, 1] : [other(winner)];
  for (const seat of lost)
    s.seats[seat].lanterns = Math.max(0, s.seats[seat].lanterns - 1);
  s.history.push({ round: s.round, totals: roundTotals, winner, riggedOdds });
  events.push({
    t: "roundEnd",
    round: s.round,
    totals: roundTotals,
    winner,
    riggedOdds,
    lanterns: [s.seats[0].lanterns, s.seats[1].lanterns],
  });

  const out0 = s.seats[0].lanterns === 0;
  const out1 = s.seats[1].lanterns === 0;
  if (out0 || out1 || s.round >= LAST_ROUND) {
    const matchWinner: Seat | null =
      out0 && out1 ? null : out0 ? 1 : out1 ? 0 : (winner ?? null);
    s.phase = "over";
    s.result = { winner: matchWinner };
    events.push({ t: "matchEnd", winner: matchWinner });
    return;
  }

  if (s.rules.leaderRecharge === "onRoundLoss") {
    const seat = s.rules.leaderRechargeSeat ?? 1;
    const zone = s.seats[seat];
    if (lost.includes(seat) && zone.leader !== null && zone.leaderUsed) {
      zone.leaderUsed = false;
      events.push({ t: "leaderRecharged", seat });
    }
  }

  const opener = winner ?? other(s.opener);
  cleanup(s, events);
  startRound(s, events, s.round + 1, opener);
};

/** Syndicate wins a tie when it played a card from hand this round (not in mirrors). */
const riggedOddsWinner = (s: MatchState): Seat | null => {
  if (!s.knobs.riggedOdds || (s.round >= 3 && !s.knobs.riggedOddsR3)) return null;
  const syndicate = ([0, 1] as const).filter(
    (seat) => s.seats[seat].faction === "SYNDICATE",
  );
  if (syndicate.length !== 1) return null;
  const seat = syndicate[0] as Seat;
  return s.seats[seat].played > 0 ? seat : null;
};

/** Round-end cleanup, seat 0's side first. */
const cleanup = (s: MatchState, events: KessenEvent[]) => {
  const kept: string[] = [];
  const discarded: string[] = [];
  const banished: string[] = [];
  for (const side of [0, 1] as const) {
    const stay = new Set<string>();
    for (const ref of unitsOf(s, side)) {
      const card = knownCard(s, ref.unit.id);
      if (
        ref.unit.res &&
        !ref.unit.sealed &&
        !isUnyielding(card) &&
        !isInfiltrator(card) &&
        !isTokenId(ref.unit.id)
      ) {
        stay.add(ref.unit.id);
        ref.unit.res = false;
      }
    }
    if (s.round <= 2 && s.knobs.evergreen && s.seats[side].faction === "TSUKIMORI") {
      let pick: UnitRef | null = null;
      for (const ref of unitsOf(s, side)) {
        const card = knownCard(s, ref.unit.id);
        if (
          ref.unit.owner !== side ||
          ref.unit.sealed ||
          isUnyielding(card) ||
          isInfiltrator(card) ||
          isTokenId(ref.unit.id) ||
          stay.has(ref.unit.id)
        ) {
          continue;
        }
        if (!pick || ref.unit.seq > pick.unit.seq) pick = ref;
      }
      if (pick) {
        stay.add(pick.unit.id);
        if (s.knobs.evergreenReset) {
          pick.unit.stored = knownCard(s, pick.unit.id).power;
          pick.unit.med = 0;
        }
      }
    }
    for (const row of ROWS) {
      const remaining = [];
      for (const unit of s.board[side][row]) {
        if (stay.has(unit.id)) {
          remaining.push(unit);
          kept.push(unit.id);
        } else if (isTokenId(unit.id)) {
          banished.push(unit.id);
        } else {
          s.seats[unit.owner].discard.push(unit.id);
          discarded.push(unit.id);
        }
      }
      s.board[side][row] = remaining;
    }
  }
  for (const seat of [0, 1] as const) {
    const zone = s.seats[seat];
    for (const id of zone.hand) if (isTokenId(id)) banished.push(id);
    zone.hand = zone.hand.filter((id) => !isTokenId(id));
  }
  s.terrain = [clearTerrain(), clearTerrain()];
  events.push({ t: "cleanup", kept, discarded, banished });
};

const startRound = (
  s: MatchState,
  events: KessenEvent[],
  round: number,
  opener: Seat,
) => {
  s.round = round;
  s.opener = opener;
  s.turn = opener;
  s.roundSeq = s.seq;
  for (const zone of s.seats) {
    zone.passed = false;
    zone.played = 0;
    zone.sun = false;
  }
  events.push({ t: "roundStart", round, opener });
  const draws = ROUND_DRAWS[round] ?? 0;
  drawCards(s, events, opener, draws);
  drawCards(s, events, other(opener), draws);
  beginMulliganStep(s, events);
};

// ---------------------------------------------------------------------------
// Views and previews

/**
 * The match as `viewer` may see it: its own hand only, decks and the other hand as
 * counts. A spectator (`viewer` null) sees both hands as counts, from seat 0's side.
 */
export const viewFor = (s: MatchState, viewer: Seat | null): MatchView => {
  const visible: string[] = [];
  for (const ref of allUnits(s)) visible.push(ref.unit.id);
  for (const zone of s.seats) visible.push(...zone.discard);
  if (viewer !== null) visible.push(...s.seats[viewer].hand);
  // A token outside the hidden hands has been played, which is public.
  const hiddenHands = ([0, 1] as const)
    .filter((seat) => seat !== viewer)
    .flatMap((seat) => s.seats[seat].hand);
  for (const id of Object.keys(s.inst))
    if (isTokenId(id) && !hiddenHands.includes(id)) visible.push(id);
  const inst: Record<string, string> = {};
  for (const id of visible) {
    const cardId = s.inst[id];
    if (cardId !== undefined) inst[id] = cardId;
  }
  const cardIds = new Set<string>(Object.values(inst));
  cardIds.add(TOKEN_CARD_ID);
  for (const zone of s.seats) if (zone.leader !== null) cardIds.add(zone.leader);
  for (const id of viewer === null ? [] : s.seats[viewer].deck) {
    const cardId = s.inst[id];
    if (cardId !== undefined) cardIds.add(cardId);
  }
  const cards: Record<string, KessenCard> = {};
  for (const id of [...cardIds].sort()) {
    const card = s.cards[id];
    if (card) cards[id] = card;
  }
  const seatView = (viewed: Seat): SeatView => {
    const zone = s.seats[viewed];
    const own = viewed === viewer;
    return {
      leader: zone.leader,
      faction: zone.faction,
      lanterns: zone.lanterns,
      passed: zone.passed,
      leaderUsed: zone.leaderUsed,
      handCount: zone.hand.length,
      deckCount: zone.deck.length,
      discard: [...zone.discard],
      hand: own ? [...zone.hand] : null,
      banked: zone.banked,
      mullPending: zone.mull !== null,
      mull: own ? zone.mull : null,
      played: zone.played,
      sun: zone.sun,
    };
  };
  const board = cloneState(s).board;
  return {
    v: s.v,
    me: viewer ?? 0,
    rules: s.rules,
    knobs: s.knobs,
    cards,
    inst,
    tokens: s.tokens,
    seq: s.seq,
    roundSeq: s.roundSeq,
    round: s.round,
    phase: s.phase,
    opener: s.opener,
    turn: s.turn,
    step: s.step,
    seats: [seatView(0), seatView(1)],
    board,
    terrain: [{ ...s.terrain[0] }, { ...s.terrain[1] }],
    history: s.history.map((entry) => ({ ...entry, totals: [...entry.totals] })),
    result: s.result ? { ...s.result } : null,
  };
};

/** Card ids for hidden slots of a view, e.g. a sampled opponent hand for AI rollouts. */
export interface ViewFill {
  hands?: Partial<Record<Seat, string[]>>;
  decks?: Partial<Record<Seat, string[]>>;
  cards?: KessenCard[];
}

/**
 * A playable state from a view. Hidden hand and deck slots become placeholder instances
 * (`x<seat>h<n>`, `x<seat>d<n>`) whose card is unknown unless `fill` supplies it; the
 * engine flags effects that would read an unknown card instead of resolving them.
 */
export const viewToState = (view: MatchView, fill: ViewFill = {}): MatchState => {
  const inst: Record<string, string> = { ...view.inst };
  const cards: Record<string, KessenCard> = { ...view.cards };
  // The match's snapshot wins over a live catalog, as it does on the server.
  for (const card of fill.cards ?? []) if (!(card.id in cards)) cards[card.id] = card;
  const seats = ([0, 1] as const).map((seat): SeatState => {
    const zone = view.seats[seat];
    const hand =
      zone.hand ??
      Array.from({ length: zone.handCount }, (_, n) => {
        const id = `x${seat}h${n}`;
        inst[id] = fill.hands?.[seat]?.[n] ?? "?";
        return id;
      });
    const deck = Array.from({ length: zone.deckCount }, (_, n) => {
      const id = `x${seat}d${n}`;
      inst[id] = fill.decks?.[seat]?.[n] ?? "?";
      return id;
    });
    return {
      leader: zone.leader,
      faction: zone.faction,
      deck,
      hand: [...hand],
      discard: [...zone.discard],
      lanterns: zone.lanterns,
      passed: zone.passed,
      leaderUsed: zone.leaderUsed,
      banked: zone.banked,
      mull: zone.mull ?? (zone.mullPending ? 0 : null),
      played: zone.played,
      sun: zone.sun,
    };
  }) as [SeatState, SeatState];
  return cloneState({
    v: view.v,
    seed: "",
    rules: view.rules,
    knobs: view.knobs,
    cards,
    inst,
    tokens: view.tokens,
    seq: view.seq,
    roundSeq: view.roundSeq,
    round: view.round,
    phase: view.phase,
    opener: view.opener,
    turn: view.turn,
    step: view.step,
    seats,
    board: view.board,
    terrain: view.terrain,
    history: view.history,
    result: view.result,
  });
};

/** `targetOptions` on a view: the next choice a partial action needs. */
export const targetOptionsForView = (
  view: MatchView,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
) => targetOptions(viewToState(view), seat, action);

/** `rowOptions` on a view: placement rows of a unit in the viewer's hand. */
export const rowOptionsForView = (view: MatchView, seat: Seat, cardInstance: string) =>
  rowOptions(viewToState(view), seat, cardInstance);

/** `legalActions` on a view. */
export const legalActionsForView = (
  view: MatchView,
  seat: Seat,
  options?: Parameters<typeof legalActions>[2],
) => legalActions(viewToState(view), seat, options);

/**
 * Preview of a partial play or leader action on a view: the board after every choice
 * made so far, the next choice it needs (null when complete) and, for each option of
 * that choice, the board it leads to, for hover hints such as "destroys".
 */
export const previewPartial = (
  view: MatchView,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
) => previewPartialState(viewToState(view), seat, action);

/** `previewPartial` on a full or view-derived state. */
export const previewPartialState = (
  s: MatchState,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
): PartialPreview => {
  const before = snapshotPowers(s);
  const beforeTotals = totals(s);
  const outcome = (probe: Extract<ReturnType<typeof probeAction>, { ok: true }>) => ({
    totals: { before: beforeTotals, after: totals(probe.state) },
    units: deltas(before, snapshotPowers(probe.state)),
    kills: probe.events.flatMap((event) => (event.t === "destroyed" ? [event.id] : [])),
    hidden: [...new Set(probe.hidden)],
    next: probe.request,
  });
  const probe = probeAction(s, seat, action);
  if (!probe.ok) return probe;
  const options: PartialOption[] = [];
  for (const target of probe.request?.options ?? []) {
    const next = probeAction(s, seat, {
      ...action,
      targets: [...(action.targets ?? []), target],
    });
    options.push(
      next.ok
        ? { target, ok: true, ...outcome(next) }
        : { target, ok: false, reason: next.reason },
    );
  }
  const { next, ...current } = outcome(probe);
  return { ok: true, ...current, events: probe.events, request: next, options };
};

/** Exact board result of an action on a view, for ghost numbers. Hidden draws and pulls are flagged. */
export const previewAction = (view: MatchView, seat: Seat, action: KessenAction) =>
  previewState(viewToState(view), seat, action);

/** `previewAction` on a full or view-derived state; the turn does not advance. */
export const previewState = (
  s: MatchState,
  seat: Seat,
  action: KessenAction,
): PreviewResult => {
  const before = snapshotPowers(s);
  const beforeTotals = totals(s);
  if (action.t === "pass" || action.t === "mull") {
    const error = action.t === "pass" ? turnErrorOf(s, seat) : null;
    if (error) return { ok: false, reason: error };
    return {
      ok: true,
      totals: { before: beforeTotals, after: beforeTotals },
      units: deltas(before, before),
      hidden: [],
      events: [],
    };
  }
  const work = cloneState(s);
  let events: KessenEvent[];
  let hidden: HiddenEffect[];
  try {
    const resolved = resolveAction(work, seat, action);
    events = resolved.events;
    hidden = [...new Set(resolved.hidden)];
  } catch (error) {
    const signal = signalOf(error);
    if (signal?.illegal) return { ok: false, reason: signal.illegal };
    if (signal?.need) return { ok: false, reason: "Choose every target" };
    throw error;
  }
  return {
    ok: true,
    totals: { before: beforeTotals, after: totals(work) },
    units: deltas(before, snapshotPowers(work)),
    hidden,
    events,
  };
};

interface PowerEntry {
  cardId: string;
  side: Seat;
  row: Row;
  power: number;
}

const snapshotPowers = (s: MatchState) => {
  const out = new Map<string, PowerEntry>();
  for (const ref of allUnits(s)) {
    out.set(ref.unit.id, {
      cardId: s.inst[ref.unit.id] ?? "?",
      side: ref.side,
      row: ref.row,
      power: displayedPower(s, ref),
    });
  }
  return out;
};

const deltas = (before: Map<string, PowerEntry>, after: Map<string, PowerEntry>) => {
  const out: UnitDelta[] = [];
  for (const [id, entry] of before) {
    const now = after.get(id);
    out.push({
      id,
      cardId: entry.cardId,
      side: now?.side ?? entry.side,
      row: now?.row ?? entry.row,
      before: entry.power,
      after: now ? now.power : null,
    });
  }
  for (const [id, entry] of after) {
    if (before.has(id)) continue;
    out.push({
      id,
      cardId: entry.cardId,
      side: entry.side,
      row: entry.row,
      before: null,
      after: entry.power,
    });
  }
  return out;
};

/**
 * Events as `viewer` may see them: the opponent's hidden draws and returns lose their
 * ids; a spectator (`viewer` null) sees neither seat's.
 */
export const redactEvents = (
  events: readonly KessenEvent[],
  viewer: Seat | null,
): KessenEvent[] =>
  events.map((event) => {
    if (event.t === "drawn" && event.seat !== viewer) {
      return { ...event, cards: event.cards.map(() => "?") };
    }
    if (event.t === "mulligan" && event.seat !== viewer) {
      return {
        ...event,
        removed: event.removed.map(() => "?"),
        drawn: event.drawn.map(() => "?"),
      };
    }
    if (event.t === "returned" && event.seat !== viewer && event.from === "hand") {
      return { ...event, id: "?" };
    }
    return event;
  });

/** Stable fingerprint of a state; key order does not matter (MySQL JSON reorders keys). */
export const stateHash = (s: MatchState | MatchView) => hashString(canonicalJson(s));

/** JSON with object keys sorted, so equal values always serialise identically. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

/** Displayed power of a unit on the board of a state or view, or null. */
export const unitPower = (s: MatchState | MatchView, id: string) => {
  const state = s as MatchState;
  for (const ref of allUnits(state))
    if (ref.unit.id === id) return displayedPower(state, ref);
  return null;
};

/** Round totals of a state or view, seat 0 first. */
export const boardTotals = (s: MatchState | MatchView) => totals(s as MatchState);

/** Catalog card of an instance in a state or view; undefined when hidden. */
export const instanceCard = (s: MatchState | MatchView, id: string) =>
  cardOf(s as MatchState, id);

const emptySide = (): SideBoard => ({ CLOSE: [], RANGED: [], JUTSU: [] });
const clearTerrain = (): SideTerrain => ({ CLOSE: false, RANGED: false, JUTSU: false });

/** Fallback Opening Gambit token when the catalog does not carry it. */
const SHADOW_CLONE: KessenCard = {
  id: TOKEN_CARD_ID,
  name: "Shadow Clone",
  rarity: "COMMON",
  kind: "UNIT",
  faction: "NEUTRAL",
  row: "ANY",
  power: DEFAULT_KNOBS.gambitPower,
  provision: 0,
  abilities: [],
  sets: [],
  leaderBonus: 0,
  variant: "STANDARD",
  baseCardId: null,
  isCollectible: false,
};
