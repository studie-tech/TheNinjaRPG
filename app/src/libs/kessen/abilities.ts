/**
 * Ability handlers, action legality and target enumeration.
 *
 * One resolver serves every purpose: applying an action, previewing it, and probing
 * which choice a partial action needs next. Targets are consumed from the payload in
 * printed ability order; a probe stops at the first missing choice and reports its
 * options, so the client can ask for every target up front.
 */
import type {
  KessenAbility,
  KessenAbilityKind,
  KessenFaction,
} from "@/validators/itemCard";
import {
  allUnits,
  capCount,
  cardOf,
  cloneState,
  destroyUnit,
  displayedPower,
  drawCards,
  fewestUnitsRow,
  findUnit,
  hasAbility,
  isInfiltrator,
  isTokenId,
  isUnyielding,
  knownCard,
  other,
  place,
  placeableRows,
  removeUnit,
  rowHasSpace,
  rowTotal,
  sweepDestroyed,
  type UnitRef,
  unitsOf,
} from "./board";
import { permafrostHolds, ROWS } from "./rules";
import type {
  HiddenEffect,
  KessenAction,
  KessenCard,
  KessenEvent,
  MatchState,
  MatchView,
  Row,
  Seat,
  Target,
  TargetKind,
  TargetRequest,
  TargetStatus,
} from "./types";

/** Resolves a play or leader action on `s` in place (no turn change). */
export const resolveAction = (
  s: MatchState,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
  probe = false,
) => {
  const turnError = turnErrorOf(s, seat);
  if (turnError) illegal(turnError);
  const given: unknown = action.targets ?? [];
  if (!Array.isArray(given) || given.some((target) => typeof target !== "string")) {
    illegal("Targets must be a list of ids and rows");
  }
  const leaderRow = action.t === "leader" ? (action.row ?? null) : null;
  if (leaderRow !== null && !ROWS.includes(leaderRow)) illegal("Choose a row");
  const ctx: Ctx = {
    s,
    seat,
    targets: [...(action.targets ?? [])],
    cursor: 0,
    leaderRow,
    probe,
    events: [],
    hidden: [],
    lastTarget: null,
    lastKilled: false,
  };
  if (action.t === "play") resolvePlay(ctx, action);
  else resolveLeader(ctx);
  if (ctx.leaderRow !== null) illegal("This leader takes no row");
  if (ctx.cursor < ctx.targets.length) illegal("Too many targets");
  // A unit left at stored <= 0 (a 0-power Shadow Clone) is destroyed.
  sweepDestroyed(s, ctx.events, "depleted");
  return { events: ctx.events, hidden: ctx.hidden };
};

/** Why `seat` cannot act now, or null. */
export const turnErrorOf = (s: MatchState, seat: Seat) => {
  if (s.phase === "over") return "The match is over";
  if (s.phase === "mulligan") return "Finish the mulligan first";
  if (s.turn !== seat) return "Not your turn";
  if (s.seats[seat].passed) return "You have passed this round";
  return null;
};

export const leaderAvailable = (s: MatchState, seat: Seat) =>
  s.seats[seat].leader !== null && !s.seats[seat].leaderUsed;

/**
 * Whether a (partial) play or leader action is complete, needs another choice, or is
 * illegal. A need with `optional` means the action is already complete as given.
 */
export const targetOptions = (
  s: MatchState,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
): TargetStatus => {
  try {
    resolveAction(cloneState(s), seat, action, true);
    return { status: "complete" };
  } catch (error) {
    const signal = signalOf(error);
    if (signal?.need) return { status: "need", request: signal.need };
    if (signal?.illegal) return { status: "illegal", reason: signal.illegal };
    throw error;
  }
};

/**
 * Resolves a (partial) action on a copy of `s` up to its first missing choice. The copy
 * shows every choice made so far; `request` is the next choice, null when complete.
 */
export const probeAction = (
  s: MatchState,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
):
  | {
      ok: true;
      state: MatchState;
      events: KessenEvent[];
      hidden: HiddenEffect[];
      request: TargetRequest | null;
    }
  | { ok: false; reason: string } => {
  const work = cloneState(s);
  try {
    const resolved = resolveAction(work, seat, action, true);
    return { ok: true, state: work, ...resolved, request: null };
  } catch (error) {
    const signal = signalOf(error);
    if (signal?.need) {
      return {
        ok: true,
        state: work,
        events: signal.partial?.events ?? [],
        hidden: signal.partial?.hidden ?? [],
        request: signal.need,
      };
    }
    if (signal?.illegal) return { ok: false, reason: signal.illegal };
    throw error;
  }
};

/** Validates a fully specified play or leader action; null when legal. */
export const actionError = (
  s: MatchState,
  seat: Seat,
  action: Extract<KessenAction, { t: "play" | "leader" }>,
) => {
  try {
    resolveAction(cloneState(s), seat, action, false);
    return null;
  } catch (error) {
    const signal = signalOf(error);
    if (signal?.illegal) return signal.illegal;
    throw error;
  }
};

export interface RowOption {
  row: Row;
  /** The side the unit joins (the opponent's for Infiltrators). */
  side: Seat;
  legal: boolean;
  reason: string | null;
}

/** Placement rows of a unit in hand with the reason a row is disabled ("Row full"). */
export const rowOptions = (
  s: MatchState,
  seat: Seat,
  cardInstance: string,
): RowOption[] => {
  const card = cardOf(s, cardInstance);
  if (card?.kind !== "UNIT" || card.row === null) return [];
  const side = isInfiltrator(card) ? other(seat) : seat;
  const rows = card.row === "ANY" ? ROWS : [card.row];
  return rows.map((row) => {
    const status = targetOptions(s, seat, { t: "play", card: cardInstance, row });
    return {
      row,
      side,
      legal: status.status !== "illegal",
      reason: status.status === "illegal" ? status.reason : null,
    };
  });
};

/**
 * Every legal fully specified action of `seat` now. Mulligans list only "keep": any
 * subset of hand cards up to `mulliganAllowance` is legal. `dedupeCopies` expands one
 * instance per card id; `limit` caps the list (default 5000).
 */
export const legalActions = (
  s: MatchState,
  seat: Seat,
  options: { dedupeCopies?: boolean; limit?: number } = {},
): KessenAction[] => {
  if (s.phase === "mulligan") {
    return s.seats[seat].mull !== null ? [{ t: "mull", cards: [] }] : [];
  }
  if (turnErrorOf(s, seat)) return [];
  const limit = options.limit ?? 5000;
  const out: KessenAction[] = [{ t: "pass" }];
  const seen = new Set<string>();
  for (const id of s.seats[seat].hand) {
    const card = cardOf(s, id);
    if (!card) continue;
    if (options.dedupeCopies) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
    }
    const rows: (Row | undefined)[] =
      card.kind !== "UNIT" || card.row === null
        ? [undefined]
        : card.row === "ANY"
          ? [...ROWS]
          : [card.row];
    for (const row of rows) {
      expandTargets(
        s,
        seat,
        row === undefined ? { t: "play", card: id } : { t: "play", card: id, row },
        out,
        limit,
      );
    }
  }
  if (leaderAvailable(s, seat)) expandTargets(s, seat, { t: "leader" }, out, limit);
  return out.slice(0, limit);
};

const expandTargets = (
  s: MatchState,
  seat: Seat,
  base: Extract<KessenAction, { t: "play" | "leader" }>,
  out: KessenAction[],
  limit: number,
) => {
  const visit = (targets: Target[]) => {
    if (out.length >= limit) return;
    const action = targets.length > 0 ? { ...base, targets } : base;
    const status = targetOptions(s, seat, action);
    if (status.status === "complete") {
      out.push(action);
      return;
    }
    if (status.status === "illegal") return;
    if (status.request.optional && actionError(s, seat, action) === null)
      out.push(action);
    for (const option of status.request.options) visit([...targets, option]);
  };
  visit([]);
};

// ---------------------------------------------------------------------------
// Resolution

interface Ctx {
  s: MatchState;
  seat: Seat;
  targets: readonly Target[];
  cursor: number;
  /** A leader action's `row`: it answers the first row choice, wherever that falls. */
  leaderRow: Row | null;
  probe: boolean;
  events: KessenEvent[];
  hidden: HiddenEffect[];
  /** Target of the last single-target Strike or Seal (for "then Strike it"). */
  lastTarget: string | null;
  /** Whether the last single-target Strike destroyed its target. */
  lastKilled: boolean;
}

interface Source {
  /** Instance id, or the leader card id. */
  id: string;
  card: KessenCard;
  /** The source unit on the board; null for tactics and leaders. */
  ref: UnitRef | null;
}

const resolvePlay = (ctx: Ctx, action: Extract<KessenAction, { t: "play" }>) => {
  const { s, seat } = ctx;
  const zone = s.seats[seat];
  const index = zone.hand.indexOf(action.card);
  if (index < 0) illegal("That card is not in your hand");
  const card = cardOf(s, action.card);
  if (!card) return illegal("That card is hidden");
  if (card.kind === "LEADER") illegal("Leaders are not played from hand");
  const token = isTokenId(action.card);
  if (token && s.round !== 1) illegal("The Shadow Clone is playable only in Round 1");
  zone.hand.splice(index, 1);
  if (!token) zone.played += 1;
  ctx.events.push({ t: "played", seat, id: action.card, cardId: card.id });

  if (card.kind === "TACTIC") {
    if (action.row !== undefined) illegal("Tactics take no row");
    resolveAbilities(ctx, { id: action.card, card, ref: null }, card.abilities);
    zone.discard.push(action.card);
    return;
  }

  const infiltrator = isInfiltrator(card);
  const side = infiltrator ? other(seat) : seat;
  const row = card.row === "ANY" ? action.row : (action.row ?? card.row);
  if (row === undefined || row === null || !ROWS.includes(row))
    return illegal("Choose a row");
  if (card.row !== "ANY" && row !== card.row) illegal("This unit has a printed row");
  if (!rowHasSpace(s, side, row)) illegal("Row full");
  const ref = place(s, ctx.events, {
    id: action.card,
    owner: seat,
    side,
    row,
    source: "hand",
  });
  if (!infiltrator && zone.faction === "SHIROHANA" && !zone.sun) {
    zone.sun = true;
    boost(ctx, ref, s.knobs.sunBonus, "perk", "sun");
  }
  const highNoon = s.rules.r3PlacementBonus ?? 0;
  if (s.round === 3 && highNoon > 0) boost(ctx, ref, highNoon, "rule", "highNoon");
  if (infiltrator) drawFor(ctx, 1);
  resolveAbilities(ctx, { id: action.card, card, ref }, card.abilities);
};

const resolveLeader = (ctx: Ctx) => {
  const { s, seat } = ctx;
  const zone = s.seats[seat];
  if (zone.leader === null) return illegal("You have no leader");
  if (zone.leaderUsed) illegal("Your leader ability is used");
  const card = s.cards[zone.leader];
  if (!card) return illegal("Unknown leader");
  zone.leaderUsed = true;
  ctx.events.push({ t: "leader", seat, cardId: card.id });
  resolveAbilities(ctx, { id: card.id, card, ref: null }, card.abilities);
};

const resolveAbilities = (
  ctx: Ctx,
  src: Source,
  abilities: readonly KessenAbility[],
) => {
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i];
    if (!ability) continue;
    const next = abilities[i + 1];
    switch (ability.k) {
      case "strike":
        strike(ctx, src, ability);
        break;
      case "empower":
        empower(ctx, src, ability);
        break;
      case "summon":
        summon(ctx, src, ability.group);
        break;
      case "revive":
        revive(ctx, src, ability.times ?? 1);
        break;
      case "substitution":
        substitution(ctx, src);
        break;
      case "grantResilient":
        grantResilient(ctx, src);
        break;
      case "purge":
        purge(ctx, src, ability.mode);
        break;
      case "terrain":
        terrain(ctx, src, ability.row);
        break;
      case "clearSkies":
        clearSkies(ctx, src);
        break;
      case "seal":
        seal(ctx, src, ability.mode, next?.k === "strike" && next.sameTarget === true);
        break;
      case "draw":
        if (!ability.ifKilled || ctx.lastKilled) drawFor(ctx, ability.x);
        break;
      case "fence":
        fence(ctx, src);
        break;
      case "recall":
        recall(ctx, src);
        break;
      case "allHands":
        allHands(ctx, src);
        break;
      case "cycle":
        cycle(ctx, src, ability.x);
        break;
      case "rally":
      case "bond":
      case "meditate":
      case "infiltrator":
      case "resilient":
      case "unyielding":
        break;
    }
  }
};

const strike = (
  ctx: Ctx,
  src: Source,
  ability: Extract<KessenAbility, { k: "strike" }>,
) => {
  const { s } = ctx;
  const enemy = other(ctx.seat);
  const amount = ability.x + (s.rules.strikeBonus ?? 0);
  let hits: string[] = [];
  let primary: string | null = null;
  switch (ability.mode) {
    case "single": {
      const target = ability.sameTarget
        ? ctx.lastTarget !== null && findUnit(s, ctx.lastTarget)
          ? ctx.lastTarget
          : null
        : take(ctx, src, "strike", "enemyUnit", ids(unitsOf(s, enemy)));
      if (target !== null) {
        hits = [target];
        primary = target;
      }
      break;
    }
    case "oppositeRow":
      if (src.ref) hits = s.board[enemy][src.ref.row].map((unit) => unit.id);
      break;
    case "chosenRow": {
      const rows = ROWS.filter((row) => s.board[enemy][row].length > 0);
      const row = take(ctx, src, "strike", "enemyRow", rows) as Row | null;
      if (row !== null) hits = s.board[enemy][row].map((unit) => unit.id);
      break;
    }
    case "allEnemies":
      hits = ids(unitsOf(s, enemy));
      break;
  }
  ctx.lastTarget = primary;
  ctx.lastKilled = false;
  if (hits.length === 0) return fizzle(ctx, src, "strike");
  for (const id of hits) {
    const ref = findUnit(s, id);
    if (!ref) continue;
    ref.unit.stored -= amount;
    ctx.events.push({
      t: "damaged",
      id,
      amount,
      stored: ref.unit.stored,
      source: src.id,
    });
  }
  const destroyed = sweepDestroyed(s, ctx.events, "strike");
  ctx.lastKilled = primary !== null && destroyed.includes(primary);
};

const empower = (
  ctx: Ctx,
  src: Source,
  ability: Extract<KessenAbility, { k: "empower" }>,
) => {
  const { s, seat } = ctx;
  const mine = unitsOf(s, seat).filter((ref) => ref.unit.id !== src.id);
  let hits: string[] = [];
  switch (ability.mode) {
    case "single": {
      const target = take(ctx, src, "empower", "ownUnit", ids(mine));
      if (target !== null) hits = [target];
      break;
    }
    case "ownRowOthers": {
      const sourceRow = src.ref?.row;
      if (sourceRow) hits = ids(mine.filter((ref) => ref.row === sourceRow));
      break;
    }
    case "chosenRow": {
      const rows = ROWS.filter((row) => mine.some((ref) => ref.row === row));
      if (rows.length === 0 && !src.ref)
        illegal("Needs one of your units in the chosen row");
      const row = take(ctx, src, "empower", "ownRow", rows);
      if (row !== null) hits = ids(mine.filter((ref) => ref.row === row));
      break;
    }
    case "allMine":
      if (mine.length === 0 && !src.ref) illegal("Needs one of your units");
      hits = ids(mine);
      break;
  }
  if (hits.length === 0) return fizzle(ctx, src, "empower");
  for (const id of hits) {
    const ref = findUnit(s, id);
    if (ref) boost(ctx, ref, ability.x, src.id, "empower");
  }
};

const summon = (ctx: Ctx, src: Source, group: string) => {
  const { s, seat } = ctx;
  const deck = s.seats[seat].deck;
  for (let i = 0; i < deck.length; i++) {
    const id = deck[i] as string;
    const card = cardOf(s, id);
    if (!card) {
      ctx.hidden.push("summon");
      return;
    }
    if (
      card.kind !== "UNIT" ||
      !card.summonGroups.includes(group) ||
      isInfiltrator(card)
    ) {
      continue;
    }
    const row =
      card.row === "ANY" ? (src.ref?.row ?? fewestUnitsRow(s, seat)) : card.row;
    if (row === null || !rowHasSpace(s, seat, row)) continue;
    deck.splice(i, 1);
    place(s, ctx.events, { id, owner: seat, side: seat, row, source: "summon" });
    return;
  }
  fizzle(ctx, src, "summon");
};

const revive = (ctx: Ctx, src: Source, times: number) => {
  const { s, seat } = ctx;
  const zone = s.seats[seat];
  const picked: string[] = [];
  for (let n = 0; n < times; n++) {
    const options = zone.discard.filter((id) => {
      if (picked.includes(id)) return false;
      const card = knownCard(s, id);
      return (
        card.kind === "UNIT" &&
        !isUnyielding(card) &&
        !isInfiltrator(card) &&
        !hasAbility(card, "revive") &&
        placeableRows(s, card, seat).length > 0
      );
    });
    const id = take(ctx, src, "revive", "discard", options);
    if (id === null) {
      fizzle(ctx, src, "revive");
      continue;
    }
    picked.push(id);
    const card = knownCard(s, id);
    const row = chooseRow(ctx, src, "revive", card, seat);
    zone.discard.splice(zone.discard.indexOf(id), 1);
    const ref = place(s, ctx.events, {
      id,
      owner: seat,
      side: seat,
      row,
      source: "revive",
    });
    resolveAbilities(ctx, { id, card, ref }, card.abilities);
  }
};

const substitution = (ctx: Ctx, src: Source) => {
  const { s, seat } = ctx;
  const hand = s.seats[seat].hand;
  if (capCount(hand) >= s.knobs.handCap) illegal("Hand full");
  const options = unitsOf(s, seat).filter((ref) => {
    const card = knownCard(s, ref.unit.id);
    return (
      ref.unit.owner === seat &&
      ref.unit.id !== src.id &&
      !isTokenId(ref.unit.id) &&
      !isUnyielding(card) &&
      !isInfiltrator(card)
    );
  });
  const id = take(ctx, src, "substitution", "ownUnit", ids(options));
  if (id === null) return fizzle(ctx, src, "substitution");
  const ref = findUnit(s, id);
  if (!ref) return;
  removeUnit(s, ref);
  hand.push(id);
  ctx.events.push({ t: "returned", id, seat, to: "hand", from: "board" });
};

const grantResilient = (ctx: Ctx, src: Source) => {
  const { s, seat } = ctx;
  const options = unitsOf(s, seat).filter((ref) => {
    const card = knownCard(s, ref.unit.id);
    return (
      ref.unit.id !== src.id &&
      !ref.unit.sealed &&
      !ref.unit.res &&
      !isTokenId(ref.unit.id) &&
      !isUnyielding(card) &&
      !isInfiltrator(card)
    );
  });
  const id = take(ctx, src, "grantResilient", "ownUnit", ids(options));
  if (id === null) return fizzle(ctx, src, "grantResilient");
  const ref = findUnit(s, id);
  if (!ref) return;
  ref.unit.res = true;
  ctx.events.push({ t: "resilient", id, source: src.id });
};

const purge = (
  ctx: Ctx,
  src: Source,
  mode: Extract<KessenAbility, { k: "purge" }>["mode"],
) => {
  const { s } = ctx;
  const enemy = other(ctx.seat);
  let rows: readonly Row[] = [];
  if (mode === "oppositeRow") rows = src.ref ? [src.ref.row] : [];
  else if (mode === "eachEnemyRow") rows = ROWS;
  else {
    const row = take(ctx, src, "purge", "enemyRow", [...ROWS]) as Row | null;
    rows = row ? [row] : [];
  }
  const victims: UnitRef[] = [];
  for (const row of rows) {
    if (rowTotal(s, enemy, row) < s.knobs.purgeThreshold) continue;
    let best: { ref: UnitRef; power: number } | null = null;
    for (const unit of s.board[enemy][row]) {
      if (isUnyielding(knownCard(s, unit.id))) continue;
      const ref = { unit, side: enemy, row };
      const power = displayedPower(s, ref);
      if (
        !best ||
        power > best.power ||
        (power === best.power && unit.seq > best.ref.unit.seq)
      ) {
        best = { ref, power };
      }
    }
    if (best) victims.push(best.ref);
  }
  if (victims.length === 0) return fizzle(ctx, src, "purge");
  for (const ref of victims) destroyUnit(s, ctx.events, ref, "purge");
};

/**
 * Sides a Terrain cast by `seat` afflicts: only the enemy's under Hyorin's Permafrost,
 * otherwise both. Takes a match state or a view.
 */
export const terrainSides = (
  s: Pick<MatchView, "round"> & {
    seats: readonly { faction: KessenFaction }[];
    knobs: Pick<MatchView["knobs"], "permafrost" | "permafrostR3">;
  },
  seat: Seat,
): Seat[] => {
  return permafrostHolds(s.seats[seat]?.faction, s.round, s.knobs)
    ? [other(seat)]
    : [0, 1];
};

const terrain = (
  ctx: Ctx,
  src: Source,
  printed: Extract<KessenAbility, { k: "terrain" }>["row"],
) => {
  const { s, seat } = ctx;
  const enemy = other(seat);
  const sides = terrainSides(s, seat);
  const fresh = (row: Row) => sides.filter((side) => !s.terrain[side][row]);
  let row: Row | null;
  if (printed === "chosen") {
    const rows = ROWS.filter((candidate) => fresh(candidate).length > 0);
    row = take(ctx, src, "terrain", "anyRow", rows) as Row | null;
  } else if (printed === "enemyMostUnits") {
    row = ROWS.reduce((best, candidate) =>
      s.board[enemy][candidate].length > s.board[enemy][best].length ? candidate : best,
    );
  } else {
    row = printed;
  }
  const newSides = row === null ? [] : fresh(row);
  if (row === null || newSides.length === 0) {
    if (!src.ref) illegal("Terrain would afflict nothing new");
    return fizzle(ctx, src, "terrain");
  }
  for (const side of newSides) {
    s.terrain[side][row] = true;
    ctx.events.push({ t: "terrain", side, row, on: true, source: src.id });
  }
};

const clearSkies = (ctx: Ctx, src: Source) => {
  const { s } = ctx;
  for (const side of [0, 1] as const) {
    for (const row of ROWS) {
      if (!s.terrain[side][row]) continue;
      s.terrain[side][row] = false;
      ctx.events.push({ t: "terrain", side, row, on: false, source: src.id });
    }
  }
};

const seal = (
  ctx: Ctx,
  src: Source,
  mode: Extract<KessenAbility, { k: "seal" }>["mode"],
  enemyOnly: boolean,
) => {
  const { s } = ctx;
  const enemy = other(ctx.seat);
  const sealable = (ref: UnitRef) =>
    ref.unit.id !== src.id &&
    !ref.unit.sealed &&
    !isUnyielding(knownCard(s, ref.unit.id));
  let hits: string[] = [];
  switch (mode) {
    case "single": {
      const pool = enemyOnly ? unitsOf(s, enemy) : allUnits(s);
      const target = take(
        ctx,
        src,
        "seal",
        enemyOnly ? "enemyUnit" : "anyUnit",
        ids(pool.filter(sealable)),
      );
      ctx.lastTarget = target;
      if (target !== null) hits = [target];
      break;
    }
    case "chosenEnemyRow": {
      const rows = ROWS.filter((row) =>
        s.board[enemy][row].some((unit) => sealable({ unit, side: enemy, row })),
      );
      const row = take(ctx, src, "seal", "enemyRow", rows) as Row | null;
      if (row !== null) {
        hits = ids(unitsOf(s, enemy).filter((ref) => ref.row === row && sealable(ref)));
      }
      break;
    }
    case "joinRowOthers": {
      const at = src.ref;
      if (at) {
        hits = ids(
          unitsOf(s, at.side).filter((ref) => ref.row === at.row && sealable(ref)),
        );
      }
      break;
    }
    case "upTo2": {
      const first = take(
        ctx,
        src,
        "seal",
        "enemyUnit",
        ids(unitsOf(s, enemy).filter(sealable)),
      );
      if (first !== null) {
        hits = [first];
        const second = take(
          ctx,
          src,
          "seal",
          "enemyUnit",
          ids(
            unitsOf(s, enemy).filter((ref) => ref.unit.id !== first && sealable(ref)),
          ),
          true,
        );
        if (second !== null) hits.push(second);
      }
      break;
    }
  }
  if (hits.length === 0) return fizzle(ctx, src, "seal");
  for (const id of hits) {
    const ref = findUnit(s, id);
    if (!ref) continue;
    ref.unit.sealed = true;
    ref.unit.res = false;
    ctx.events.push({ t: "sealed", id, source: src.id });
  }
};

const fence = (ctx: Ctx, src: Source) => {
  const { s, seat } = ctx;
  const enemy = other(seat);
  const zone = s.seats[enemy];
  const options = zone.discard.filter((id) => {
    const card = knownCard(s, id);
    return (
      card.kind === "UNIT" &&
      !isUnyielding(card) &&
      !isInfiltrator(card) &&
      placeableRows(s, card, seat).length > 0
    );
  });
  const id = take(ctx, src, "fence", "enemyDiscard", options);
  if (id === null) return fizzle(ctx, src, "fence");
  const card = knownCard(s, id);
  const row = chooseRow(ctx, src, "fence", card, seat);
  zone.discard.splice(zone.discard.indexOf(id), 1);
  place(s, ctx.events, { id, owner: enemy, side: seat, row, source: "fence" });
};

const recall = (ctx: Ctx, src: Source) => {
  const { s, seat } = ctx;
  const zone = s.seats[seat];
  if (capCount(zone.hand) >= s.knobs.handCap) illegal("Hand full");
  const options = zone.discard.filter((id) => {
    const card = knownCard(s, id);
    return card.kind === "UNIT" && !isUnyielding(card) && !isInfiltrator(card);
  });
  const id = take(ctx, src, "recall", "discard", options);
  if (id === null) return fizzle(ctx, src, "recall");
  zone.discard.splice(zone.discard.indexOf(id), 1);
  zone.hand.push(id);
  ctx.events.push({ t: "returned", id, seat, to: "hand", from: "discard" });
};

const allHands = (ctx: Ctx, src: Source) => {
  const { s, seat } = ctx;
  const deck = s.seats[seat].deck;
  for (let i = 0; i < deck.length; i++) {
    const id = deck[i] as string;
    const card = cardOf(s, id);
    if (!card) {
      ctx.hidden.push("summon");
      return;
    }
    if (card.kind !== "UNIT" || !hasAbility(card, "summon") || isInfiltrator(card))
      continue;
    const row =
      card.row === "ANY"
        ? fewestUnitsRow(s, seat)
        : card.row !== null && rowHasSpace(s, seat, card.row)
          ? card.row
          : null;
    if (row === null) continue;
    deck.splice(i, 1);
    const ref = place(s, ctx.events, {
      id,
      owner: seat,
      side: seat,
      row,
      source: "allHands",
    });
    const summons = card.abilities.filter((ability) => ability.k === "summon");
    resolveAbilities(ctx, { id, card, ref }, summons);
    return;
  }
  fizzle(ctx, src, "allHands");
};

const cycle = (ctx: Ctx, src: Source, count: number) => {
  const { s, seat } = ctx;
  const zone = s.seats[seat];
  const picks: string[] = [];
  for (let n = 0; n < count; n++) {
    const options = zone.hand.filter((id) => !isTokenId(id) && !picks.includes(id));
    const id = take(ctx, src, "cycle", "hand", options, true);
    if (id === null) break;
    picks.push(id);
  }
  const moved = zone.hand.filter((id) => picks.includes(id));
  zone.hand = zone.hand.filter((id) => !picks.includes(id));
  zone.deck.push(...moved);
  for (const id of moved)
    ctx.events.push({ t: "returned", id, seat, to: "deck", from: "hand" });
  if (moved.length > 0) drawFor(ctx, moved.length);
};

const drawFor = (ctx: Ctx, n: number) => {
  const drawn = drawCards(ctx.s, ctx.events, ctx.seat, n);
  if (drawn.some((id) => !cardOf(ctx.s, id))) ctx.hidden.push("draw");
};

const boost = (
  ctx: Ctx,
  ref: UnitRef,
  amount: number,
  source: string,
  cause: "empower" | "sun" | "highNoon",
) => {
  if (amount <= 0) return;
  ref.unit.stored += amount;
  ctx.events.push({
    t: "boosted",
    id: ref.unit.id,
    amount,
    stored: ref.unit.stored,
    source,
    cause,
  });
};

/** Row for a unit deployed from a discard: Any row asks, a printed row is fixed. */
const chooseRow = (
  ctx: Ctx,
  src: Source,
  ability: KessenAbilityKind,
  card: KessenCard,
  side: Seat,
): Row => {
  const rows = placeableRows(ctx.s, card, side);
  const row =
    card.row === "ANY"
      ? (take(ctx, src, ability, "ownRow", rows) as Row | null)
      : rows[0];
  if (!row) return illegal("No room for that unit");
  return row;
};

const fizzle = (ctx: Ctx, src: Source, ability: KessenAbilityKind) => {
  ctx.events.push({ t: "fizzled", ability, source: src.id });
};

const ids = (refs: readonly UnitRef[]) => refs.map((ref) => ref.unit.id);

const ROW_KINDS = new Set<TargetKind>(["ownRow", "anyRow", "enemyRow"]);

/**
 * Consumes the next target. No options: the ability fizzles and consumes nothing.
 * Missing target: a probe reports the request; otherwise it is illegal unless optional.
 */
const take = (
  ctx: Ctx,
  src: Source,
  ability: KessenAbilityKind,
  kind: TargetKind,
  options: readonly Target[],
  optional = false,
): Target | null => {
  if (options.length === 0) return null;
  if (ctx.leaderRow !== null && ROW_KINDS.has(kind)) {
    const row = ctx.leaderRow;
    if (!options.includes(row)) return illegal(`Invalid row for ${ability}`);
    ctx.leaderRow = null;
    return row;
  }
  if (ctx.cursor >= ctx.targets.length) {
    if (ctx.probe) {
      throw signal({
        need: { kind, options: [...options], optional, ability, source: src.id },
        partial: { events: ctx.events, hidden: ctx.hidden },
      });
    }
    if (optional) return null;
    return illegal(`Choose a target for ${ability}`);
  }
  const target = ctx.targets[ctx.cursor] as Target;
  if (!options.includes(target)) {
    if (optional) return null;
    return illegal(`Invalid target for ${ability}`);
  }
  ctx.cursor += 1;
  return target;
};

// ---------------------------------------------------------------------------
// Signals

interface KessenSignal {
  illegal?: string;
  need?: TargetRequest;
  /** What resolved before a probe stopped at `need`. */
  partial?: { events: KessenEvent[]; hidden: HiddenEffect[] };
}

/**
 * Resolution signals are thrown as plain objects: AI searches raise thousands per
 * decision, and an `Error` would capture a stack trace for each.
 */
class KessenSignalThrow {
  constructor(readonly kessen: KessenSignal) {}
}

const signal = (payload: KessenSignal) => new KessenSignalThrow(payload);

/** Aborts resolution with a player-facing reason. */
export function illegal(reason: string): never {
  throw signal({ illegal: reason });
}

/** The engine signal carried by an error thrown during resolution, if any. */
export const signalOf = (error: unknown): KessenSignal | null => {
  return error instanceof KessenSignalThrow ? error.kessen : null;
};
