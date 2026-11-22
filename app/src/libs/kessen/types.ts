import type { ItemRarity } from "@/drizzle/constants";
import type {
  KessenAbility,
  KessenAbilityKind,
  KessenCardKind,
  KessenCardVariant,
  KessenFaction,
  KessenRow,
} from "@/validators/itemCard";

export type Seat = 0 | 1;
export type Row = KessenRow;
export type KessenRarity = ItemRarity;

/** Engine input for one card, built from an `Item` row and its `cardData`. */
export interface KessenCard {
  id: string;
  name: string;
  rarity: KessenRarity;
  kind: KessenCardKind;
  faction: KessenFaction;
  row: Row | "ANY" | null;
  power: number;
  provision: number;
  abilities: KessenAbility[];
  summonGroups: string[];
  leaderBonus: number;
  variant: KessenCardVariant;
  baseCardId: string | null;
  isCollectible: boolean;
}

/** One seat at match creation: the leader item id (null: no leader, no perk) and deck. */
export interface SeatSetup {
  leaderId: string | null;
  /** Card ids, one entry per copy. */
  deck: string[];
  /** False keeps the given order (scripted lessons); the first entry is the top. */
  shuffle?: boolean;
}

/** Tunable numbers of the rules; balance sims override them through `MatchRules.knobs`. */
export interface KessenKnobs {
  handCap: number;
  maxBanked: number;
  rowCap: number;
  r1Mulligans: number;
  laterMulligans: number;
  gambitPower: number;
  terrainPenalty: number;
  meditateCap: number;
  bondStep: number;
  bondCap: number;
  purgeThreshold: number;
  sunBonus: number;
  evergreen: boolean;
  evergreenReset: boolean;
  permafrost: boolean;
  permafrostR3: boolean;
  tideCount: number;
  tideMaxPower: number;
  tailwind: number;
  riggedOdds: boolean;
  riggedOddsR3: boolean;
}

/** Terrain a house rule lays on `row` at the start of each listed round. */
export interface StartTerrain {
  row: Row;
  rounds: number[];
}

/** House and boss rules: a closed set of typed flags (both seats unless stated). */
export interface MatchRules {
  /** Round 3: every unit placed from hand gets +N stored. */
  r3PlacementBonus?: number;
  /** A unit kept by Resilient or Evergreen gets +N stored when the next round starts. */
  carryBonus?: number;
  /** Rows afflicted on both sides at the start of the listed rounds. */
  startTerrain?: StartTerrain[];
  /** Extra mulligans at every step, for both seats or one seat ("human" is seat 0). */
  extraMulligans?: number | { seat: Seat | "human"; n: number };
  /** Every Strike deals +N. */
  strikeBonus?: number;
  /** Mulligan allowance before Round 1 instead of the default 3. */
  r1MulliganCap?: number;
  /** Row of the Opening Gambit's Shadow Clone instead of Taijutsu. */
  gambitRow?: Row;
  /** The leader of `leaderRechargeSeat` (default seat 1) recharges after each lost round. */
  leaderRecharge?: "onRoundLoss";
  leaderRechargeSeat?: Seat;
  /** Balance-sim overrides of the default knobs. */
  knobs?: Partial<KessenKnobs>;
}

/** Everything `createMatch` needs; `cards` must cover every card id the seats name. */
export interface CreateMatchInput {
  seed: string;
  seats: [SeatSetup, SeatSetup];
  rules?: MatchRules;
  cards: KessenCard[];
}

/** A unit instance on the board. Leaving the board discards this record. */
export interface Unit {
  id: string;
  /** The player whose deck the card came from; it returns to this player's discard. */
  owner: Seat;
  stored: number;
  sealed: boolean;
  /** Power gained through Meditate so far. */
  med: number;
  /** Resilient: the unit stays on the board through the next cleanup. */
  res: boolean;
  /** Match-wide placement order (`MatchState.seq` when it was placed). */
  seq: number;
}

export type SideBoard = Record<Row, Unit[]>;
export type SideTerrain = Record<Row, boolean>;

/** One seat's full, unredacted state; `SeatView` is what a player may see of it. */
export interface SeatState {
  leader: string | null;
  faction: KessenFaction;
  /** Instance ids; index 0 is the top. */
  deck: string[];
  hand: string[];
  /** Instance ids in discard order (index 0 is the earliest). */
  discard: string[];
  lanterns: number;
  passed: boolean;
  leaderUsed: boolean;
  banked: number;
  /** Mulligans allowed in the pending mulligan step; null when none is pending. */
  mull: number | null;
  /** Non-token cards played from hand this round. */
  played: number;
  /** Sun-Blessed already applied this round. */
  sun: boolean;
}

/** A finished round's totals and winner, kept in `MatchState.history`. */
export interface RoundResult {
  round: number;
  totals: [number, number];
  /** Null on a tie that both players lost. */
  winner: Seat | null;
  riggedOdds: boolean;
}

export type MatchPhase = "mulligan" | "play" | "over";

/**
 * The authoritative, unredacted match, JSON-serialisable and fully determined by `seed`
 * and the applied actions; a player sees it through `viewFor`.
 */
export interface MatchState {
  /** `CARD_ENGINE_VERSION` the match was created under. */
  v: number;
  seed: string;
  rules: MatchRules;
  knobs: KessenKnobs;
  /** Catalog snapshot by card id; never mutated after creation. */
  cards: Record<string, KessenCard>;
  /** Instance id to card id. */
  inst: Record<string, string>;
  /** Tokens created so far; numbers the next token's instance id. */
  tokens: number;
  /** Match-wide placement counter. */
  seq: number;
  /** `seq` when the current round started; lower `seq` units were kept. */
  roundSeq: number;
  round: number;
  phase: MatchPhase;
  opener: Seat;
  turn: Seat;
  /** Applied actions, including mulligans. */
  step: number;
  seats: [SeatState, SeatState];
  board: [SideBoard, SideBoard];
  terrain: [SideTerrain, SideTerrain];
  history: RoundResult[];
  /** Set when the match is over; winner null is a draw. */
  result: { winner: Seat | null } | null;
}

/** Unit or card instance id, or a row name for row choices. */
export type Target = string;

/** One player decision; the engine validates it against the current state. */
export type KessenAction =
  | { t: "play"; card: string; row?: Row; targets?: Target[] }
  | { t: "leader"; row?: Row; targets?: Target[] }
  | { t: "pass" }
  | { t: "mull"; cards: string[] };

/** How a unit reached the board. */
export type PlacementSource =
  | "hand"
  | "summon"
  | "revive"
  | "fence"
  | "tide"
  | "allHands"
  /** The Opening Gambit's Shadow Clone, placed by the rules after the Round 1 mulligans. */
  | "gambit";
export type BoostCause = "empower" | "meditate" | "sun" | "highNoon" | "carry";
/** `depleted`: a unit that entered at stored <= 0, such as a 0-power Shadow Clone. */
export type DestroyCause = "strike" | "purge" | "depleted";

/** What applying an action did, in order; clients animate and narrate from these. */
export type KessenEvent =
  | { t: "roundStart"; round: number; opener: Seat }
  | { t: "drawn"; seat: Seat; cards: string[]; banked: number }
  | { t: "mulligan"; seat: Seat; count: number; removed: string[]; drawn: string[] }
  | { t: "token"; seat: Seat; id: string; cardId: string }
  | { t: "turn"; seat: Seat }
  | { t: "played"; seat: Seat; id: string; cardId: string }
  | { t: "leader"; seat: Seat; cardId: string }
  | {
      t: "placed";
      id: string;
      cardId: string;
      owner: Seat;
      side: Seat;
      row: Row;
      source: PlacementSource;
      stored: number;
    }
  | { t: "damaged"; id: string; amount: number; stored: number; source: string }
  | {
      t: "boosted";
      id: string;
      amount: number;
      stored: number;
      source: string;
      cause: BoostCause;
    }
  | {
      t: "destroyed";
      id: string;
      cardId: string;
      owner: Seat;
      side: Seat;
      row: Row;
      cause: DestroyCause;
    }
  | { t: "sealed"; id: string; source: string }
  | { t: "resilient"; id: string; source: string }
  | { t: "terrain"; side: Seat; row: Row; on: boolean; source: string }
  | {
      t: "returned";
      id: string;
      seat: Seat;
      to: "hand" | "deck";
      from: "board" | "hand" | "discard";
    }
  | { t: "fizzled"; ability: KessenAbilityKind; source: string }
  | { t: "passed"; seat: Seat; auto: boolean }
  | {
      t: "roundEnd";
      round: number;
      totals: [number, number];
      winner: Seat | null;
      riggedOdds: boolean;
      lanterns: [number, number];
    }
  | { t: "leaderRecharged"; seat: Seat }
  | { t: "cleanup"; kept: string[]; discarded: string[]; banished: string[] }
  | { t: "matchEnd"; winner: Seat | null };

/** A new state and its events, or why the action was rejected (the state is untouched). */
export type ApplyResult =
  | { ok: true; state: MatchState; events: KessenEvent[] }
  | { ok: false; reason: string };

/** What a target slot accepts; rows are row names, everything else instance ids. */
export type TargetKind =
  | "enemyUnit"
  | "ownUnit"
  | "anyUnit"
  | "enemyRow"
  | "ownRow"
  | "anyRow"
  | "discard"
  | "enemyDiscard"
  | "hand";

/** The next choice a partially specified action needs. */
export interface TargetRequest {
  kind: TargetKind;
  options: Target[];
  /** The action is complete without this choice. */
  optional: boolean;
  ability: KessenAbilityKind;
  /** Instance id of the card whose ability asks (the leader card id for leaders). */
  source: string;
}

export type TargetStatus =
  | { status: "complete" }
  | { status: "need"; request: TargetRequest }
  | { status: "illegal"; reason: string };

/** Effects a preview cannot resolve because they reveal hidden cards. */
export type HiddenEffect = "draw" | "summon";

/** A seat as `MatchView` shows it: counts instead of the hidden hand and deck. */
export interface SeatView {
  leader: string | null;
  faction: KessenFaction;
  lanterns: number;
  passed: boolean;
  leaderUsed: boolean;
  handCount: number;
  deckCount: number;
  discard: string[];
  /** Only the viewer's own hand; null for the opponent. */
  hand: string[] | null;
  banked: number;
  mullPending: boolean;
  /** Mulligan allowance, only for the viewer. */
  mull: number | null;
  played: number;
  sun: boolean;
}

/** Redacted match for one seat: no seed, no opponent hand, no deck order. */
export interface MatchView {
  v: number;
  me: Seat;
  rules: MatchRules;
  knobs: KessenKnobs;
  /** Catalog entries of visible cards, both leaders, the token and the viewer's deck. */
  cards: Record<string, KessenCard>;
  /** Instance id to card id for visible instances. */
  inst: Record<string, string>;
  tokens: number;
  seq: number;
  roundSeq: number;
  round: number;
  phase: MatchPhase;
  opener: Seat;
  turn: Seat;
  step: number;
  seats: [SeatView, SeatView];
  board: [SideBoard, SideBoard];
  terrain: [SideTerrain, SideTerrain];
  history: RoundResult[];
  result: { winner: Seat | null } | null;
}

/** One unit whose displayed power a previewed action changes. */
export interface UnitDelta {
  id: string;
  cardId: string;
  side: Seat;
  row: Row;
  /** Displayed power before; null when the unit was not on the board. */
  before: number | null;
  /** Displayed power after; null when the unit left the board. */
  after: number | null;
}

/** The board a complete action leads to, without revealing hidden cards. */
export type PreviewResult =
  | {
      ok: true;
      totals: { before: [number, number]; after: [number, number] };
      units: UnitDelta[];
      hidden: HiddenEffect[];
      events: KessenEvent[];
    }
  | { ok: false; reason: string };

/** The board one option of a partial action leads to (up to its next choice). */
export type PartialOption =
  | {
      target: Target;
      ok: true;
      totals: { before: [number, number]; after: [number, number] };
      units: UnitDelta[];
      /** Units this option destroys. */
      kills: string[];
      hidden: HiddenEffect[];
      /** The choice after this one; null when the action would be complete. */
      next: TargetRequest | null;
    }
  | { target: Target; ok: false; reason: string };

/** The board a partial action leads to so far, and where each next option leads. */
export type PartialPreview =
  | {
      ok: true;
      totals: { before: [number, number]; after: [number, number] };
      units: UnitDelta[];
      kills: string[];
      hidden: HiddenEffect[];
      events: KessenEvent[];
      /** The next choice; null when the action is complete as given. */
      request: TargetRequest | null;
      /** One entry per option of `request`. */
      options: PartialOption[];
    }
  | { ok: false; reason: string };
