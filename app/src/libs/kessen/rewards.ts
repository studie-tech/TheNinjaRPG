/**
 * Pure reward math of Kessen NPC matches: eligibility, daily caps, ryo, first-win grants,
 * seeded drop-table rolls and dupe protection over owned quantities.
 * `server/utils/kessenPayout.ts` applies the plan with SQL increments and day and week
 * guards; nothing here reads a clock.
 */
import {
  KESSEN_COPY_LIMITS,
  KESSEN_DAILY_DROP_ROLLS,
  KESSEN_DAILY_REWARDED_MATCHES,
  KESSEN_MATCH_LOSS_RYO,
  KESSEN_MATCH_WIN_RYO,
  KESSEN_MIN_LOSER_PLAYS,
  KESSEN_MIN_MATCH_SECONDS,
  KESSEN_MIN_TOTAL_PLAYS,
  KESSEN_NPC_FULL_PAY_WINS,
  KESSEN_NPC_HALF_PAY_WINS,
  type KessenTier,
} from "@/drizzle/constants";
import { copyKey } from "./catalog";
import { createRng, type Rng } from "./rng";
import { TOKEN_PREFIX } from "./rules";
import type { KessenCard, KessenEvent, KessenRarity, Seat } from "./types";

/** Basis points: weights and chances below are out of 10,000. */
export const BASIS_POINTS = 10_000;

const RARITIES: readonly KessenRarity[] = ["COMMON", "RARE", "EPIC", "LEGENDARY"];

/**
 * Integer weighted pick: one `rng.int(total)` draw walked through `order`. Null when every
 * weight is zero. Keys missing from `weights` weigh zero.
 */
export const selectWeighted = <K extends string>(
  weights: Readonly<Partial<Record<K, number>>>,
  order: readonly K[],
  rng: Rng,
): K | null => {
  let total = 0;
  for (const key of order) total += Math.max(0, weights[key] ?? 0);
  if (total <= 0) return null;
  let roll = rng.int(total);
  for (const key of order) {
    const weight = Math.max(0, weights[key] ?? 0);
    if (roll < weight) return key;
    roll -= weight;
  }
  return null;
};

/** The drop table an NPC rolls on. */
export type KessenDropTableKey = "NOVICE" | "ADEPT" | "MASTER" | "KAGE";

export interface KessenDropTable {
  /** Chance that a rewarded win drops a card. */
  cardBp: number;
  /** Rarity weights of a dropped card. */
  rarityBp: Record<KessenRarity, number>;
  /** Independent chance of a Forbidden variant on top of the card roll. */
  forbiddenBp: number;
}

/** Repeat-win drop tables, in basis points. */
export const KESSEN_DROP_TABLES: Readonly<Record<KessenDropTableKey, KessenDropTable>> =
  {
    NOVICE: {
      cardBp: 2500,
      rarityBp: { COMMON: 8000, RARE: 1800, EPIC: 200, LEGENDARY: 0 },
      forbiddenBp: 0,
    },
    ADEPT: {
      cardBp: 3000,
      rarityBp: { COMMON: 6600, RARE: 2700, EPIC: 650, LEGENDARY: 50 },
      forbiddenBp: 0,
    },
    MASTER: {
      cardBp: 3500,
      rarityBp: { COMMON: 5200, RARE: 3400, EPIC: 1300, LEGENDARY: 100 },
      forbiddenBp: 0,
    },
    KAGE: {
      cardBp: 4000,
      rarityBp: { COMMON: 4500, RARE: 3500, EPIC: 1900, LEGENDARY: 100 },
      forbiddenBp: 10,
    },
  };

/** Owned copies per item id; callers include copies listed in the auction house. */
export type OwnedCounts = Readonly<Record<string, number>>;

/** Owned copies per copy-limit name (a Forbidden variant counts as its base card). */
export const copiesByName = (owned: OwnedCounts, cards: Iterable<KessenCard>) => {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const have = owned[card.id] ?? 0;
    if (have > 0) counts.set(copyKey(card), (counts.get(copyKey(card)) ?? 0) + have);
  }
  return counts;
};

/** True when the player already holds the copy limit of this card's name. */
export const isMaxed = (card: KessenCard, byName: ReadonlyMap<string, number>) =>
  (byName.get(copyKey(card)) ?? 0) >= KESSEN_COPY_LIMITS[card.rarity];

/** A `dupeProtectedPick` result. */
export interface ProtectedPick {
  card: KessenCard;
  /** The first pick was maxed and a non-maxed card replaced it. */
  rerolled: boolean;
  /** Every candidate was maxed, so the pick is a surplus copy. */
  surplus: boolean;
}

/**
 * Dupe protection: a uniform pick that, when maxed, is re-rolled once among
 * the non-maxed candidates of the same list. Null for an empty list.
 */
export const dupeProtectedPick = (
  rng: Rng,
  candidates: readonly KessenCard[],
  byName: ReadonlyMap<string, number>,
): ProtectedPick | null => {
  if (candidates.length === 0) return null;
  const first = candidates[rng.int(candidates.length)] as KessenCard;
  if (!isMaxed(first, byName)) return { card: first, rerolled: false, surplus: false };
  const open = candidates.filter((card) => !isMaxed(card, byName));
  if (open.length === 0) return { card: first, rerolled: false, surplus: true };
  return {
    card: open[rng.int(open.length)] as KessenCard,
    rerolled: true,
    surplus: false,
  };
};

export interface DropRollInput {
  /** Unique per rewarded win and unknown to the player, e.g. `kessen-drop:<match seed>`. */
  seed: string;
  table: KessenDropTableKey;
  /** The NPC's droppable cards (`npcDropPool`). */
  pool: readonly KessenCard[];
  /** Forbidden variants a Kage win may drop. */
  forbiddenPool?: readonly KessenCard[];
  /** Copies by name, from `copiesByName`. */
  byName: ReadonlyMap<string, number>;
}

/** What `rollNpcDrop` dropped: a card, a Forbidden variant, both or neither. */
export interface DropRollResult {
  card: ProtectedPick | null;
  /** The rarity rolled (before downgrading to one the pool has); null without a drop. */
  rarity: KessenRarity | null;
  forbidden: KessenCard | null;
}

/**
 * One drop roll of a rewarded win: does a card drop, which rarity, then a dupe-protected
 * uniform pick among the pool's cards of that rarity (the next lower rarity the pool holds
 * when it has none). Kage tables then roll their Forbidden chance.
 */
export const rollNpcDrop = (input: DropRollInput): DropRollResult => {
  const table = KESSEN_DROP_TABLES[input.table];
  const rng = createRng(input.seed);
  const pool = [...input.pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let card: ProtectedPick | null = null;
  let rarity: KessenRarity | null = null;
  if (rng.int(BASIS_POINTS) < table.cardBp) {
    rarity = selectWeighted(table.rarityBp, RARITIES, rng);
    for (
      let rank = rarity ? RARITIES.indexOf(rarity) : -1;
      rank >= 0 && !card;
      rank--
    ) {
      const wanted = RARITIES[rank];
      card = dupeProtectedPick(
        rng,
        pool.filter((entry) => entry.rarity === wanted),
        input.byName,
      );
    }
  }
  let forbidden: KessenCard | null = null;
  const forbiddenPool = input.forbiddenPool ?? [];
  if (table.forbiddenBp > 0 && forbiddenPool.length > 0) {
    if (rng.int(BASIS_POINTS) < table.forbiddenBp) {
      forbidden = forbiddenPool[rng.int(forbiddenPool.length)] as KessenCard;
    }
  }
  return { card, rarity, forbidden };
};

/** A finished match from the player's side. */
export type KessenOutcome = "win" | "loss" | "draw";
/** How a match ended: through play, a concession or idle expiry. */
export type KessenMatchEnd = "play" | "concede" | "expire";

/** Match outcome for the human (seat 0) from the engine's winner. */
export const outcomeFor = (winner: Seat | null, seat: Seat = 0): KessenOutcome =>
  winner === null ? "draw" : winner === seat ? "win" : "loss";

/** Cards played from hand per seat in an event log; tokens are excluded. */
export const countPlays = (events: readonly KessenEvent[]): [number, number] => {
  const plays: [number, number] = [0, 0];
  for (const event of events) {
    if (event.t === "played" && !event.id.startsWith(TOKEN_PREFIX))
      plays[event.seat] += 1;
  }
  return plays;
};

export interface EligibilityInput {
  outcome: KessenOutcome;
  endedBy: KessenMatchEnd;
  /** Server-measured match length. */
  durationMs: number;
  /** Card plays from hand, `[human, npc]`. */
  plays: readonly [number, number];
}

/** Whether a match pays a reward, with the player-facing reason when it does not. */
export type Eligibility = { eligible: true } | { eligible: false; reason: string };

/**
 * Anti-farm guards: the match ended through play, lasted `KESSEN_MIN_MATCH_SECONDS`, had
 * `KESSEN_MIN_TOTAL_PLAYS` card plays in total, and a loss or draw needs
 * `KESSEN_MIN_LOSER_PLAYS` plays by the player.
 */
export const rewardEligibility = (input: EligibilityInput): Eligibility => {
  if (input.endedBy !== "play") {
    return { eligible: false, reason: "Conceded and expired matches pay no reward." };
  }
  if (input.durationMs < KESSEN_MIN_MATCH_SECONDS * 1000) {
    return { eligible: false, reason: "The match was too short to be rewarded." };
  }
  if (input.plays[0] + input.plays[1] < KESSEN_MIN_TOTAL_PLAYS) {
    return { eligible: false, reason: "Too few cards were played to be rewarded." };
  }
  if (input.outcome !== "win" && input.plays[0] < KESSEN_MIN_LOSER_PLAYS) {
    return { eligible: false, reason: "Play more of your cards to earn a reward." };
  }
  return { eligible: true };
};

/** Daily counters of `KessenProgress`; a different `dayKey` means they are stale. */
export interface KessenDailyCounters {
  dayKey: string;
  rewarded: number;
  drops: number;
  npcWins: Readonly<Record<string, number>>;
}

/** The counters as of `dayKey`: stored ones on the same day, zero otherwise. */
export const dailyCountersFor = (
  stored: KessenDailyCounters | null,
  dayKey: string,
): KessenDailyCounters =>
  stored && stored.dayKey === dayKey
    ? stored
    : { dayKey, rewarded: 0, drops: 0, npcWins: {} };

/** Weekly win counter of `KessenProgress`; a different `weekKey` means it is stale. */
export interface KessenWeeklyCounter {
  weekKey: string;
  weeklyWins: number;
}

/** Rewarded wins counted in the week of `weekKey`: the stored count that week, else zero. */
export const weeklyWinsFor = (stored: KessenWeeklyCounter | null, weekKey: string) =>
  stored && stored.weekKey === weekKey ? stored.weeklyWins : 0;

/**
 * Ryo of a rewarded result; `winIndex` is today's 1-based win count against this NPC
 * including this win: full pay up to `KESSEN_NPC_FULL_PAY_WINS`, half up to
 * `KESSEN_NPC_HALF_PAY_WINS`, none after. Losses and draws pay the tier's loss ryo.
 */
export const matchRyo = (
  tier: KessenTier,
  outcome: KessenOutcome,
  winIndex: number,
) => {
  if (outcome !== "win") return KESSEN_MATCH_LOSS_RYO[tier];
  const full = KESSEN_MATCH_WIN_RYO[tier];
  if (winIndex <= KESSEN_NPC_FULL_PAY_WINS) return full;
  if (winIndex <= KESSEN_NPC_HALF_PAY_WINS) return Math.floor(full / 2);
  return 0;
};

export interface PayoutInput {
  counters: KessenDailyCounters | null;
  dayKey: string;
  npcKey: string;
  tier: KessenTier;
  outcome: KessenOutcome;
  eligibility: Eligibility;
  /**
   * Rewarded wins already counted this week (`weeklyWinsFor`); the week's first rewarded
   * win grants a Paper Bundle.
   */
  weeklyWins: number;
  /** Academy lessons pay only their own reward. */
  lesson?: boolean;
  /** Quest challenge matches pay only their quest objective. */
  challenge?: boolean;
}

/** Why a quest challenge match pays no Circuit reward. */
export const KESSEN_CHALLENGE_UNREWARDED =
  "Quest challenges pay only their quest objective.";

/** What one finished match pays, and the counters to write with it. */
export interface PayoutPlan {
  rewarded: boolean;
  /** Why the match pays nothing; null when rewarded. */
  reason: string | null;
  ryo: number;
  /** Roll the NPC's drop table for this win. */
  dropRoll: boolean;
  /** Grant the weekly first-win Paper Bundle. */
  weeklyFirstWin: boolean;
  /** Counters after this match, for the guarded increments. */
  counters: KessenDailyCounters;
}

/**
 * Applies the daily caps (`KESSEN_DAILY_REWARDED_MATCHES` rewarded matches,
 * `KESSEN_DAILY_DROP_ROLLS` drop rolls), per-NPC diminishing ryo and the weekly first win
 * to one finished match.
 */
export const planMatchPayout = (input: PayoutInput): PayoutPlan => {
  const counters = dailyCountersFor(input.counters, input.dayKey);
  const unrewarded = (reason: string): PayoutPlan => ({
    rewarded: false,
    reason,
    ryo: 0,
    dropRoll: false,
    weeklyFirstWin: false,
    counters,
  });
  if (input.lesson) return unrewarded("Lessons pay only their Academy reward.");
  if (input.challenge) return unrewarded(KESSEN_CHALLENGE_UNREWARDED);
  if (!input.eligibility.eligible) return unrewarded(input.eligibility.reason);
  if (counters.rewarded >= KESSEN_DAILY_REWARDED_MATCHES) {
    return unrewarded("Daily reward limit reached; this match was practice.");
  }
  const win = input.outcome === "win";
  const winIndex = (counters.npcWins[input.npcKey] ?? 0) + (win ? 1 : 0);
  const dropRoll = win && counters.drops < KESSEN_DAILY_DROP_ROLLS;
  return {
    rewarded: true,
    reason: null,
    ryo: matchRyo(input.tier, input.outcome, winIndex),
    dropRoll,
    weeklyFirstWin: win && input.weeklyWins === 0,
    counters: {
      dayKey: input.dayKey,
      rewarded: counters.rewarded + 1,
      drops: counters.drops + (dropRoll ? 1 : 0),
      npcWins: win
        ? { ...counters.npcWins, [input.npcKey]: winIndex }
        : counters.npcWins,
    },
  };
};

/** First-win rewards need a win that ended through play; they ignore the daily caps. */
export const firstWinEarned = (outcome: KessenOutcome, endedBy: KessenMatchEnd) =>
  outcome === "win" && endedBy === "play";

/** Standard legendaries the player owns no copy of. */
export const unownedLegendaries = (cards: Iterable<KessenCard>, owned: OwnedCounts) => {
  const list = [...cards];
  const byName = copiesByName(owned, list);
  return standardLegendaries(list).filter(
    (card) => (byName.get(copyKey(card)) ?? 0) === 0,
  );
};

/** Collectible standard legendaries that are not leaders, by id. */
export const standardLegendaries = (cards: Iterable<KessenCard>) =>
  [...cards]
    .filter(
      (card) =>
        card.rarity === "LEGENDARY" &&
        card.kind !== "LEADER" &&
        card.isCollectible &&
        card.variant === "STANDARD",
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
