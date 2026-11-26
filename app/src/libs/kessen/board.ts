/**
 * Board primitives shared by the ability handlers and the match flow: card lookups,
 * the canonical unit order, the additive power model and zone moves.
 */
import type { KessenAbilityKind } from "@/validators/itemCard";
import { ROWS, TOKEN_CARD_ID, TOKEN_PREFIX } from "./rules";
import type {
  DestroyCause,
  KessenCard,
  KessenEvent,
  MatchState,
  PlacementSource,
  Row,
  Seat,
  Unit,
} from "./types";

/** A unit with the side and row it stands on. */
export interface UnitRef {
  unit: Unit;
  side: Seat;
  row: Row;
}

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export const isTokenId = (id: string) => id.startsWith(TOKEN_PREFIX);

/** Catalog card of an instance; undefined for a hidden or unknown instance. */
export const cardOf = (s: MatchState, id: string): KessenCard | undefined => {
  const cardId = s.inst[id];
  return cardId === undefined ? undefined : s.cards[cardId];
};

/** Card of an instance that must be known (board, discards, own hand). */
export const knownCard = (s: MatchState, id: string): KessenCard => {
  const card = cardOf(s, id);
  if (!card) throw new Error(`Unknown card instance ${id}`);
  return card;
};

export const hasAbility = (card: KessenCard, k: KessenAbilityKind) =>
  card.abilities.some((ability) => ability.k === k);

export const isUnyielding = (card: KessenCard) => hasAbility(card, "unyielding");
export const isInfiltrator = (card: KessenCard) => hasAbility(card, "infiltrator");

const rallyOf = (card: KessenCard) => {
  let total = 0;
  for (const ability of card.abilities) if (ability.k === "rally") total += ability.x;
  return total;
};

/** The set a card's Bond counts, or null without a Bond. */
const bondSetOf = (card: KessenCard) => {
  for (const ability of card.abilities) if (ability.k === "bond") return ability.group;
  return null;
};

/** Units of one side in canonical order: rows outward, then ascending `seq`. */
export const unitsOf = (s: MatchState, side: Seat): UnitRef[] => {
  const out: UnitRef[] = [];
  for (const row of ROWS)
    for (const unit of s.board[side][row]) out.push({ unit, side, row });
  return out;
};

/** Every unit in canonical order: seat 0 first. */
export const allUnits = (s: MatchState): UnitRef[] => [
  ...unitsOf(s, 0),
  ...unitsOf(s, 1),
];

/** A unit by instance id, on a match state's board or a redacted view's. */
export const findUnit = (s: Pick<MatchState, "board">, id: string): UnitRef | null => {
  for (const side of [0, 1] as const) {
    for (const row of ROWS) {
      const unit = s.board[side][row].find((candidate) => candidate.id === id);
      if (unit) return { unit, side, row };
    }
  }
  return null;
};

/** Power before Terrain: stored plus Rally and Bond auras. */
export const rawPower = (s: MatchState, ref: UnitRef) => {
  const { unit, side, row } = ref;
  let aura = 0;
  for (const neighbour of s.board[side][row]) {
    if (neighbour.id === unit.id || neighbour.sealed) continue;
    aura += rallyOf(knownCard(s, neighbour.id));
  }
  // Bond counts the other unsealed units on its side in the set it names.
  const set = unit.sealed ? null : bondSetOf(knownCard(s, unit.id));
  if (set !== null) {
    let partners = 0;
    for (const mate of unitsOf(s, side)) {
      if (mate.unit.id === unit.id || mate.unit.sealed) continue;
      if (knownCard(s, mate.unit.id).sets.includes(set)) partners++;
    }
    aura += Math.min(s.knobs.bondCap, s.knobs.bondStep * partners);
  }
  return Math.max(0, unit.stored) + aura;
};

/** Power shown on the board and counted in the round total. */
export const displayedPower = (s: MatchState, ref: UnitRef) => {
  const raw = rawPower(s, ref);
  const afflicted =
    s.terrain[ref.side][ref.row] &&
    !isUnyielding(knownCard(s, ref.unit.id)) &&
    raw >= 1;
  return afflicted ? Math.max(1, raw - s.knobs.terrainPenalty) : raw;
};

/** Sum of displayed power on one row. */
export const rowTotal = (s: MatchState, side: Seat, row: Row) => {
  let total = 0;
  for (const unit of s.board[side][row])
    total += displayedPower(s, { unit, side, row });
  return total;
};

/**
 * Sum of displayed power on one side. Same arithmetic as `displayedPower` per unit, with
 * each side's Rally auras and set memberships gathered once instead of once per unit.
 */
export const sideTotal = (s: MatchState, side: Seat) => {
  const board = s.board[side];
  const cards: KessenCard[] = [];
  const bonds: (string | null)[] = [];
  const setNames: string[] = [];
  const setCounts: number[] = [];
  const rallies = [0, 0, 0];
  for (let r = 0; r < ROWS.length; r++) {
    for (const unit of board[ROWS[r] as Row]) {
      const card = knownCard(s, unit.id);
      cards.push(card);
      bonds.push(unit.sealed ? null : bondSetOf(card));
      if (unit.sealed) continue;
      rallies[r] = (rallies[r] as number) + rallyOf(card);
      for (const set of card.sets) {
        const at = setNames.indexOf(set);
        if (at < 0) {
          setNames.push(set);
          setCounts.push(1);
        } else setCounts[at] = (setCounts[at] as number) + 1;
      }
    }
  }
  let total = 0;
  let n = 0;
  for (let r = 0; r < ROWS.length; r++) {
    const row = ROWS[r] as Row;
    const afflicted = s.terrain[side][row];
    for (const unit of board[row]) {
      const card = cards[n] as KessenCard;
      const bond = bonds[n] as string | null;
      n += 1;
      let aura = (rallies[r] as number) - (unit.sealed ? 0 : rallyOf(card));
      if (bond !== null) {
        // A Bond unit is unsealed, so its own sets were counted with the others.
        const members = setCounts[setNames.indexOf(bond)] ?? 0;
        const partners = members - (card.sets.includes(bond) ? 1 : 0);
        aura += Math.min(s.knobs.bondCap, s.knobs.bondStep * partners);
      }
      const raw = Math.max(0, unit.stored) + aura;
      total +=
        afflicted && raw >= 1 && !isUnyielding(card)
          ? Math.max(1, raw - s.knobs.terrainPenalty)
          : raw;
    }
  }
  return total;
};

/** Round totals, seat 0 first. */
export const totals = (s: MatchState): [number, number] => [
  sideTotal(s, 0),
  sideTotal(s, 1),
];

export const rowHasSpace = (s: MatchState, side: Seat, row: Row) =>
  s.board[side][row].length < s.knobs.rowCap;

/** Hand size against the cap; tokens are exempt. */
export const capCount = (hand: readonly string[]) =>
  hand.reduce((count, id) => (isTokenId(id) ? count : count + 1), 0);

/** Fewest own units, ties Taijutsu > Bukijutsu > Ninjutsu; only rows with space. */
export const fewestUnitsRow = (s: MatchState, side: Seat): Row | null => {
  let best: Row | null = null;
  for (const row of ROWS) {
    if (!rowHasSpace(s, side, row)) continue;
    if (best === null || s.board[side][row].length < s.board[side][best].length)
      best = row;
  }
  return best;
};

/** Rows a unit card can enter on `side`: its printed row or, for Any row, every row. */
export const placeableRows = (s: MatchState, card: KessenCard, side: Seat): Row[] => {
  if (card.kind !== "UNIT" || card.row === null) return [];
  const rows = card.row === "ANY" ? ROWS : [card.row];
  return rows.filter((row) => rowHasSpace(s, side, row));
};

/** Places an instance at its printed state and appends it to the row. */
export const place = (
  s: MatchState,
  events: KessenEvent[],
  input: { id: string; owner: Seat; side: Seat; row: Row; source: PlacementSource },
): UnitRef => {
  const card = knownCard(s, input.id);
  s.seq += 1;
  const unit: Unit = {
    id: input.id,
    owner: input.owner,
    stored: card.power,
    sealed: false,
    med: 0,
    res: hasAbility(card, "resilient"),
    seq: s.seq,
  };
  s.board[input.side][input.row].push(unit);
  events.push({
    t: "placed",
    id: unit.id,
    cardId: card.id,
    owner: unit.owner,
    side: input.side,
    row: input.row,
    source: input.source,
    stored: unit.stored,
  });
  return { unit, side: input.side, row: input.row };
};

/** Takes a unit off its row without moving it to any zone. */
export const removeUnit = (s: MatchState, ref: UnitRef) => {
  const row = s.board[ref.side][ref.row];
  const index = row.findIndex((unit) => unit.id === ref.unit.id);
  if (index >= 0) row.splice(index, 1);
};

/** Draws up to `n`; a draw over the hand cap stays in the deck and banks a mulligan. */
export const drawCards = (
  s: MatchState,
  events: KessenEvent[],
  seat: Seat,
  n: number,
) => {
  const zone = s.seats[seat];
  const drawn: string[] = [];
  let banked = 0;
  for (let i = 0; i < n; i++) {
    if (zone.deck.length === 0) break;
    if (capCount(zone.hand) >= s.knobs.handCap) {
      if (zone.banked < s.knobs.maxBanked) {
        zone.banked += 1;
        banked += 1;
      }
      continue;
    }
    const id = zone.deck.shift();
    if (id === undefined) break;
    zone.hand.push(id);
    drawn.push(id);
  }
  if (n > 0) events.push({ t: "drawn", seat, cards: drawn, banked });
  return drawn;
};

/** Destroys every unit at `stored <= 0` in canonical order; tokens are banished. */
export const sweepDestroyed = (
  s: MatchState,
  events: KessenEvent[],
  cause: DestroyCause,
): string[] => {
  const destroyed: string[] = [];
  if (!anyDepleted(s)) return destroyed;
  for (const ref of allUnits(s)) {
    if (ref.unit.stored > 0) continue;
    destroyUnit(s, events, ref, cause);
    destroyed.push(ref.unit.id);
  }
  return destroyed;
};

const anyDepleted = (s: MatchState) => {
  for (const side of s.board)
    for (const row of ROWS)
      for (const unit of side[row]) if (unit.stored <= 0) return true;
  return false;
};

/** Removes a unit to its owner's discard (tokens are banished) and records the event. */
export const destroyUnit = (
  s: MatchState,
  events: KessenEvent[],
  ref: UnitRef,
  cause: DestroyCause,
) => {
  removeUnit(s, ref);
  const token = isTokenId(ref.unit.id) || s.inst[ref.unit.id] === TOKEN_CARD_ID;
  if (!token) s.seats[ref.unit.owner].discard.push(ref.unit.id);
  events.push({
    t: "destroyed",
    id: ref.unit.id,
    cardId: knownCard(s, ref.unit.id).id,
    owner: ref.unit.owner,
    side: ref.side,
    row: ref.row,
    cause,
  });
};

/**
 * Deep copy of the mutable parts. The catalog snapshot, rules, knobs and the instance
 * map are shared: `inst` only grows when a token is created, which replaces the map.
 */
export const cloneState = (s: MatchState): MatchState => ({
  ...s,
  seats: [cloneSeat(s.seats[0]), cloneSeat(s.seats[1])],
  board: [cloneSide(s.board[0]), cloneSide(s.board[1])],
  terrain: [{ ...s.terrain[0] }, { ...s.terrain[1] }],
  history: s.history.map((entry) => ({ ...entry, totals: [...entry.totals] })),
  result: s.result ? { ...s.result } : null,
});

const cloneSeat = (seat: MatchState["seats"][number]) => ({
  ...seat,
  deck: [...seat.deck],
  hand: [...seat.hand],
  discard: [...seat.discard],
});

const cloneSide = (side: MatchState["board"][number]) => ({
  CLOSE: side.CLOSE.map((unit) => ({ ...unit })),
  RANGED: side.RANGED.map((unit) => ({ ...unit })),
  JUTSU: side.JUTSU.map((unit) => ({ ...unit })),
});
