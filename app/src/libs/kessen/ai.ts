/**
 * Kessen AI opponent.
 *
 * Decisions are pure functions of a redacted `MatchView`, the public catalog pool, the
 * AI's own deck list (its order stays unknown) and the AI's own seeded stream. The AI
 * never sees the opponent's hand or deck: rollouts fill those slots with samples drawn
 * from the opponent's possible pool. Heuristics are integer milli-points, and cost is
 * counted in engine applications, never wall time, so a replay reproduces every move.
 */
import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import type { KessenAbilityKind } from "@/validators/itemCard";
import { leaderAvailable, resolveAction, signalOf } from "./abilities";
import {
  capCount,
  cardOf,
  cloneState,
  displayedPower,
  findUnit,
  hasAbility,
  isInfiltrator,
  isTokenId,
  isUnyielding,
  other,
  rowTotal,
  totals,
  unitsOf,
} from "./board";
import { cardValueMilli, copyKey } from "./catalog";
import { KESSEN_DECK_RULES } from "./deck";
import { applyAction, viewFor, viewToState } from "./engine";
import { createStream, type Rng, shuffleInPlace } from "./rng";
import { ROWS, TOKEN_CARD_ID } from "./rules";
import type {
  HiddenEffect,
  KessenAction,
  KessenCard,
  KessenEvent,
  KessenRarity,
  MatchState,
  MatchView,
  Row,
  Seat,
  Target,
  TargetRequest,
} from "./types";

/**
 * Version of the AI's decisions; the pinned AI fingerprint in
 * `tests/libs/kessen/replay.test.ts` fails on any decision change until this is bumped.
 */
export const KESSEN_AI_VERSION = 2;

/** AI strength tiers, weakest first (`KESSEN_AI_TIER_SPECS`). */
export const KESSEN_AI_TIERS = ["GENIN", "CHUNIN", "JONIN", "KAGE"] as const;
export type KessenAiTier = (typeof KESSEN_AI_TIERS)[number];

/** A hold-or-play hint for one card of the NPC's deck: the card waits until it holds. */
export type KessenAiSignatureRule =
  | { hold: "untilRound"; round: number }
  | { hold: "untilEnemyRowUnits"; row: Row; min: number }
  | { hold: "untilTargetStored"; min: number };

/** A signature hint bound to one card of the NPC's deck. */
export interface KessenAiSignature {
  /** Item id of the card in the NPC's deck. */
  cardId: string;
  rule: KessenAiSignatureRule;
}

/** NPC personality (`aiProfile`); every field but the tier is optional. */
export interface KessenAiProfile {
  tier: KessenAiTier;
  /** Extra lead in points (-3..+3) required before a voluntary pass. */
  passLeadOffset?: number;
  /** Percent applied to every retention weight (clamped to 50..150). */
  lambdaScale?: number;
  /** Minimum gain in points before the leader is used outside the final round. */
  leaderThreshold?: number;
  /** -3..+3: positive contests a losing round longer and spends cards more freely. */
  aggression?: number;
  /** -2..+2: card disadvantage accepted while bleeding Round 2 after a Round 1 win. */
  bleed?: number;
  /** Pass-threshold noise range in points; defaults to the tier's. */
  jitter?: number;
  signatures?: KessenAiSignature[];
}

/** Public knowledge the AI may use besides its view. */
export interface KessenAiContext {
  /** Public catalog; the opponent's possible pool (their faction plus Neutral) comes from it. */
  pool?: readonly KessenCard[];
  /** The AI's own deck list, one card id per copy. */
  deck?: readonly string[];
  /** Engine-application budget instead of the tier's. */
  budget?: number;
}

/** `decideWithTrace`'s action with the rule that chose it and its cost. */
export interface KessenAiDecision {
  action: KessenAction;
  /** The policy rule that decided. */
  rule: string;
  /** Engine applications spent. */
  applications: number;
  /** Completed rollout samples (0 without rollouts). */
  samples: number;
  /** The rollout budget ran out and the rule-based choice was kept. */
  fallback: boolean;
}

/** The search and noise settings of one AI tier. */
export interface KessenAiTierSpec {
  /** Percent chance to take the second-best play on a non-critical decision. */
  mistakePct: number;
  /** Default pass-threshold noise range in points. */
  jitter: number;
  /** The full rule policy; false is the Genin subset. */
  fullRules: boolean;
  /** Largest plan size searched once the opponent has passed. */
  planDepth: number;
  /** Determinized rollout samples per decision (0: none). */
  samples: number;
  /** Rule-ranked plays evaluated by rollouts, besides passing. */
  rolloutCandidates: number;
  /** Target combinations per card and row in rollout turns. */
  rolloutCap: number;
  /** Rollouts play to the end of the match (true) or of the round, then scored by the rollout utility. */
  matchHorizon: boolean;
  /** Spend samples by successive halving instead of on every option equally. */
  halving: boolean;
  /**
   * Mulligan a card when its value is at most this far (milli-points) below the deck
   * average; null keeps the hand.
   */
  mulliganMargin: number | null;
  /** Engine applications per decision; rollouts stop when it runs out. */
  budget: number;
}

/**
 * Tier ladder. Genin keeps its hand and plays the rule subset; Chunin plays
 * every rule; Jonin adds round-horizon rollouts; Kage plays rollouts to the end of the
 * match with more samples, spent by successive halving, and mulligans every card below
 * its deck average. Rollout turns try one target combination per card and row.
 */
export const KESSEN_AI_TIER_SPECS: Readonly<Record<KessenAiTier, KessenAiTierSpec>> = {
  GENIN: {
    mistakePct: 25,
    jitter: 2,
    fullRules: false,
    planDepth: 1,
    samples: 0,
    rolloutCandidates: 0,
    rolloutCap: 0,
    halving: false,
    matchHorizon: false,
    mulliganMargin: null,
    budget: 2000,
  },
  CHUNIN: {
    mistakePct: 8,
    jitter: 2,
    fullRules: true,
    planDepth: 3,
    samples: 0,
    rolloutCandidates: 0,
    rolloutCap: 0,
    halving: false,
    matchHorizon: false,
    mulliganMargin: 1500,
    budget: 2000,
  },
  JONIN: {
    mistakePct: 0,
    jitter: 0,
    fullRules: true,
    planDepth: 3,
    samples: 16,
    rolloutCandidates: 4,
    rolloutCap: 1,
    halving: false,
    matchHorizon: false,
    mulliganMargin: 1500,
    budget: 60000,
  },
  KAGE: {
    mistakePct: 0,
    jitter: 0,
    fullRules: true,
    planDepth: 3,
    samples: 80,
    rolloutCandidates: 5,
    rolloutCap: 1,
    halving: true,
    matchHorizon: true,
    mulliganMargin: 0,
    budget: 60000,
  },
};

/**
 * The AI's stream for one decision. Keyed by the match step, so the server replays the
 * AI without storing generator state between requests.
 */
export const aiRng = (matchSeed: string, seat: Seat, step: number) =>
  createStream(matchSeed, `ai:${seat}:${step}`);

/** The AI's action for `seat` (the view's own seat): a mulligan, a play, the leader or a pass. */
export const decide = (
  view: MatchView,
  seat: Seat,
  profile: KessenAiProfile,
  rng: Rng,
  context: KessenAiContext = {},
): KessenAction => decideWithTrace(view, seat, profile, rng, context).action;

/** `decide` with the deciding rule and its cost. */
export const decideWithTrace = (
  view: MatchView,
  seat: Seat,
  profile: KessenAiProfile,
  rng: Rng,
  context: KessenAiContext = {},
): KessenAiDecision => {
  if (view.me !== seat) throw new Error("The AI decides only from its own view");
  if (view.phase === "mulligan") {
    const margin = KESSEN_AI_TIER_SPECS[profile.tier].mulliganMargin;
    return {
      action: {
        t: "mull",
        cards: margin === null ? [] : chooseMulligan(view, seat, context, margin),
      },
      rule: "mulligan",
      applications: 0,
      samples: 0,
      fallback: false,
    };
  }
  const zone = view.seats[seat];
  if (view.phase !== "play" || view.turn !== seat || zone.passed) {
    throw new Error("It is not the AI's turn");
  }
  const tier = KESSEN_AI_TIER_SPECS[profile.tier];
  const jitterRange = profile.jitter ?? tier.jitter;
  const jitterRoll = rng.int(2 * jitterRange + 1) - jitterRange;
  const mistake = rng.int(100) < tier.mistakePct;
  const pool = canonicalPool(view, context);
  const budget: Budget = { used: 0, limit: context.budget ?? tier.budget };
  const ownDeck = remainingDeck(view, seat, context.deck);
  const base = viewToState(view, {
    cards: [...pool],
    decks: { [seat]: ownDeckOrder(view, ownDeck) },
  });
  const threats: [number | null, number | null] = [null, null];
  const rootThreat = (at: Seat) => {
    const value = threats[at] ?? threatOf(base, at, pool, budget);
    threats[at] = value;
    return value;
  };
  const aggression = clampInt(profile.aggression ?? 0, -3, 3);
  const env: Env = {
    fullRules: tier.fullRules,
    lamScale: Math.trunc(
      (clampInt(profile.lambdaScale ?? 100, 50, 150) * (100 - 5 * aggression)) / 10,
    ),
    offset: clampInt(profile.passLeadOffset ?? 0, -3, 3) * 1000,
    jitter: jitterRoll * 1000,
    aggression,
    bleed: clampInt(profile.bleed ?? 0, -2, 2),
    leaderThreshold: (profile.leaderThreshold ?? 0) * 1000,
    signatures: (target) => (target === seat ? (profile.signatures ?? []) : []),
    threat: (s, at) => (s === base ? rootThreat(at) : threatOf(s, at, pool, budget)),
    cap: ROOT_CAP,
    planDepth: tier.planDepth,
    planWidth: ROOT_PLAN_WIDTH,
    budget,
    mistake,
    deckAverage: averageRetention(view, seat, context.deck),
  };
  const choice = policy(env, base, seat);
  const opponentActive = !view.seats[other(seat)].passed;
  if (tier.samples === 0 || !opponentActive) {
    return {
      action: choice.action,
      rule: choice.rule,
      applications: budget.used,
      samples: 0,
      fallback: false,
    };
  }
  return rolloutChoice({
    view,
    seat,
    profile,
    tier,
    choice,
    pool,
    ownDeck,
    budget,
    rng,
    rootThreat,
  });
};

/**
 * Cards to mulligan: Summon copies beyond the first of a group, Terrains beyond
 * the first, Clear Skies against an opponent without Terrain, a Seal-only tactic against
 * a faction without engines, Infiltrators after Round 1, then every card at least
 * `margin` (default 1.5 points) below the deck's average value, lowest first, up to the
 * allowance.
 */
export const chooseMulligan = (
  view: MatchView,
  seat: Seat,
  context: KessenAiContext = {},
  margin = MULLIGAN_MARGIN,
): string[] => {
  const zone = view.seats[seat];
  const allowance = zone.mull ?? 0;
  if (allowance <= 0 || !zone.hand) return [];
  const pool = canonicalPool(view, context);
  const average = averageRetention(view, seat, context.deck);
  const entries = zone.hand
    .filter((id) => !isTokenId(id))
    .map((id) => {
      const card = view.cards[view.inst[id] ?? ""];
      return { id, card, value: card ? mulliganValue(card) : 0 };
    })
    .filter((entry): entry is { id: string; card: KessenCard; value: number } =>
      Boolean(entry.card),
    );
  const byValue = [...entries].sort(
    (a, b) => a.value - b.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const opponentTerrain =
    (view.rules.startTerrain?.length ?? 0) > 0 ||
    pool.some(
      (card) =>
        card.faction === view.seats[other(seat)].faction &&
        card.faction !== "NEUTRAL" &&
        hasAbility(card, "terrain"),
    );
  const opponentEngines = factionHasEngines(pool, view.seats[other(seat)].faction);
  const forced = new Set<string>();
  const summonGroups = new Set<string>();
  let terrains = 0;
  for (const entry of entries) {
    for (const ability of entry.card.abilities) {
      if (ability.k !== "summon") continue;
      if (summonGroups.has(ability.group)) forced.add(entry.id);
      summonGroups.add(ability.group);
    }
    if (entry.card.kind === "TACTIC" && hasAbility(entry.card, "terrain")) {
      terrains += 1;
      if (terrains > 1) forced.add(entry.id);
    }
    if (
      entry.card.kind === "TACTIC" &&
      hasAbility(entry.card, "clearSkies") &&
      !opponentTerrain
    ) {
      forced.add(entry.id);
    }
    if (sealOnlyTactic(entry.card) && !opponentEngines) forced.add(entry.id);
    // An Infiltrator is an opening play; later its points only help the opponent.
    if (view.round > 1 && isInfiltrator(entry.card)) forced.add(entry.id);
  }
  const picks: string[] = [];
  for (const entry of byValue) if (forced.has(entry.id)) picks.push(entry.id);
  for (const entry of byValue) {
    if (!forced.has(entry.id) && entry.value <= average - margin) {
      picks.push(entry.id);
    }
  }
  return picks.slice(0, allowance);
};

/**
 * Largest single-turn board gain (milli-points) the opponent of `view.me` could make now:
 * every card of their possible pool on every legal row with its best targets, Summon
 * pulling the strongest group member, plus their unused leader.
 */
export const oppThreat = (view: MatchView, catalog: readonly KessenCard[]) => {
  const pool = canonicalPool(view, { pool: catalog });
  const s = viewToState(view, { cards: [...pool] });
  return threatOf(s, view.me, pool, { used: 0, limit: THREAT_BUDGET });
};

/**
 * Baseline bot for balance tests: keeps every mulligan, plays the largest immediate board
 * gain, and passes only once the opponent has passed and it leads.
 */
export const greedyDecide = (view: MatchView, seat: Seat): KessenAction => {
  if (view.phase === "mulligan") return { t: "mull", cards: [] };
  const s = viewToState(view);
  const budget: Budget = { used: 0, limit: KESSEN_AI_TIER_SPECS.GENIN.budget };
  const opponent = s.seats[other(seat)];
  if (opponent.passed && leadOf(s, seat) > 0) return { t: "pass" };
  const plays = enumerate(s, seat, ROOT_CAP, budget, null);
  if (plays.length === 0) return { t: "pass" };
  plays.sort((a, b) => b.delta - a.delta || compareTies(a, b));
  return (plays[0] as Candidate).action;
};

// ---------------------------------------------------------------------------
// Constants (milli-points unless noted)

const ROOT_CAP = 40;
const ROOT_PLAN_WIDTH = 6;
const ROLLOUT_PLAN_WIDTH = 3;
const THREAT_CAP = 12;
const THREAT_BUDGET = 4000;
const MIN_SAMPLES = 4;
const ROLLOUT_STEPS = 60;

const LAMBDA_R1 = 700;
const LAMBDA_BLEED = 1000;
const LAMBDA_MUST_WIN = 350;
const LAMBDA_GENIN = 0;

const GENIN_PASS_LEAD = 12000;
const CONCEDE_MARGIN = 4000;
const REMOVAL_BONUS = 3000;
const SUMMON_COPY_PENALTY = 2000;
const IDLE_TERRAIN_PENALTY = 3000;
const INFILTRATOR_RETENTION = 4000;
const INFILTRATOR_MULLIGAN = 9000;
const MULLIGAN_MARGIN = 1500;
const UNKNOWN_DRAW = 6500;
const UNKNOWN_DRAW_FINAL = 3500;
const FINAL_GAIN_PER_POWER = 600;
const HIDDEN_SUMMON = 3000;
const KILL_BONUS = 1000;
const OWN_INFILTRATOR_PENALTY = 2000;
const OWN_SEAL_PENALTY = 500;
const MEDITATE_WEIGHT = 600;
const CARRY_WEIGHT = 800;
const BANK_RETENTION = 8000;
const REPLAY_DEPLOY = 5000;
const PURGE_MIN = 6000;
const TERRAIN_MIN = 4000;
const CLEAR_SKIES_MIN = 3000;
const REMOVAL_HOLD = 6000;
const LEADER_RETENTION: Record<number, number> = { 1: 6000, 2: 5000, 3: 0 };
const CYCLE_RETENTION = 2000;

const ROUND_WIN: Record<number, number> = { 1: 30000, 2: 45000, 3: 45000 };
const CARD_WEIGHT: Record<number, number> = { 1: 7000, 2: 9000, 3: 0 };
const MATCH_DECIDED = 100000;

/** Sampling weight per available copy: commons fill most of a real deck. */
const RARITY_WEIGHT: Record<KessenRarity, number> = {
  COMMON: 8,
  RARE: 4,
  EPIC: 2,
  LEGENDARY: 1,
};

const REMOVAL: readonly KessenAbilityKind[] = ["strike", "purge", "seal"];
const CONTINUOUS: readonly KessenAbilityKind[] = [
  "rally",
  "bond",
  "meditate",
  "resilient",
];
const DEPLOY: readonly KessenAbilityKind[] = [
  "strike",
  "empower",
  "summon",
  "revive",
  "purge",
  "terrain",
  "clearSkies",
  "seal",
  "grantResilient",
  "substitution",
];

// ---------------------------------------------------------------------------
// Policy

type PlayAction = Extract<KessenAction, { t: "play" | "leader" }>;

interface Budget {
  used: number;
  limit: number;
}

interface Env {
  fullRules: boolean;
  /** Per-mille multiplier on every retention weight. */
  lamScale: number;
  offset: number;
  jitter: number;
  aggression: number;
  bleed: number;
  leaderThreshold: number;
  signatures: (seat: Seat) => readonly KessenAiSignature[];
  threat: (s: MatchState, seat: Seat) => number;
  cap: number;
  planDepth: number;
  planWidth: number;
  budget: Budget;
  mistake: boolean;
  deckAverage: number;
}

interface Candidate {
  action: PlayAction;
  after: MatchState;
  card: KessenCard;
  leader: boolean;
  /** Instance id, or the leader card id. */
  inst: string;
  /** Row index for tie-breaks; -1 without a row. */
  row: number;
  order: number;
  /** Own total minus opponent total after the play. */
  lead: number;
  /** Change of the lead, plus the expected body of a hidden Summon. */
  delta: number;
  /** Future terms, kill bonus and penalties. */
  fixed: number;
  /** Retention of cards gained minus cards returned to the deck. */
  gainRet: number;
  /** Value of gained cards in a final round. */
  gainNow: number;
  /** Retention of the spent card or leader. */
  ret: number;
  held: string | null;
  score: number;
}

interface Choice {
  action: KessenAction;
  rule: string;
  /** Unheld plays ranked by the deciding weight; empty for plan decisions. */
  plays: Candidate[];
}

/**
 * The rule policy: the first matching rule decides. Branches by match
 * situation: the opponent has passed (exact plan search), the final round, a must-win
 * round, a match-point round (bleed) and an open round.
 */
const policy = (env: Env, s: MatchState, seat: Seat): Choice => {
  const zone = s.seats[seat];
  const opponent = other(seat);
  const oz = s.seats[opponent];
  const final = s.round >= 3 || (zone.lanterns === 1 && oz.lanterns === 1);
  const mustWin = !final && zone.lanterns === 1;
  const matchPoint = !final && oz.lanterns === 1;
  const plays = enumerate(s, seat, env.cap, env.budget, env);
  if (plays.length === 0) return pass("nothing to play");
  const lead = leadOf(s, seat);
  const myHand = zone.hand.length;
  const oppHand = oz.hand.length;
  const cardAdv = myHand - oppHand;

  if (oz.passed) {
    if (lead > 0 || (lead === 0 && winsTies(s, seat))) return pass("leading");
    const depth = env.fullRules ? env.planDepth : 1;
    const plan = minimalPlan(env, s, seat, plays, depth);
    if (!plan) return bankOrPass(env, s, plays, final || mustWin, "no plan");
    const spend =
      matchPoint ||
      mustWin ||
      final ||
      plan.size === 1 ||
      (plan.size === 2 && myHand - 2 >= oppHand);
    if (spend)
      return { action: plan.first.action, rule: `plan ${plan.size}`, plays: [] };
    return bankOrPass(env, s, plays, false, "concede round");
  }

  if (!env.fullRules) {
    if (s.round === 1 && lead >= GENIN_PASS_LEAD + env.jitter)
      return pass("genin lead");
    const ranked = rank(plays, LAMBDA_GENIN, env, false);
    return playOf(ranked, env.mistake, "genin play");
  }

  const threat = env.threat(s, seat);
  const margin = threat + env.jitter + env.offset;
  if (final) {
    const lam = 0;
    for (const c of plays) {
      if (
        !c.held &&
        c.card.kind === "TACTIC" &&
        REMOVAL.some((k) => hasAbility(c.card, k)) &&
        oppHand > 0 &&
        myHand > 2 &&
        c.delta < REMOVAL_HOLD
      ) {
        c.held = "hold removal";
      }
    }
    const leaderLeft = leaderAvailable(s, opponent) ? 1 : 0;
    const multiplier = Math.max(Math.min(oppHand, 2), leaderLeft);
    if (lead > threat * multiplier + env.jitter + env.offset) return pass("final lead");
    const ranked = rank(plays, lam, env, true);
    if (ranked.length > 0) return playOf(ranked, false, "final play");
    if (lead <= 0) return playOf(rank(plays, lam, env, false), false, "final forced");
    return pass("final hold");
  }

  if (mustWin) {
    const lam = scaleLambda(LAMBDA_MUST_WIN, env);
    const ranked = rank(plays, lam, env, true);
    if (lead <= 0) {
      const options = ranked.length > 0 ? ranked : rank(plays, lam, env, false);
      return playOf(options, false, "must win");
    }
    const improves = ranked.some((c) => c.delta > 0);
    if (
      (lead > margin && oppHand <= 1) ||
      lead > 2 * threat + env.jitter + env.offset
    ) {
      return pass("must win lead");
    }
    if (!improves) return pass("no improvement");
    return playOf(ranked, false, "must win push");
  }

  if (matchPoint) {
    const lam = scaleLambda(LAMBDA_BLEED, env);
    if (oppHand >= myHand + 2 + env.bleed) return pass("save for round 3");
    // Even hands contest the round: the opponent must answer every card, and a Round 2
    // win ends the match. Fewer cards pass at once and make the opponent spend.
    if (oz.played === 0 && cardAdv < env.bleed) return pass("force spend");
    if (lead > margin) return pass("bleed lead");
    if (cardAdv < -env.bleed) return pass("bleed stop");
    const ranked = rank(plays, lam, env, true);
    if (ranked.length === 0) return pass("bleed hold");
    return playOf(ranked, env.mistake, "bleed");
  }

  const lam = scaleLambda(LAMBDA_R1, env);
  const ranked = rank(plays, lam, env, true);
  if (zone.played === 0) {
    const infiltrator = ranked.find((c) => !c.leader && isInfiltrator(c.card));
    if (infiltrator)
      return { action: infiltrator.action, rule: "infiltrate", plays: ranked };
  }
  if (lead > margin && cardAdv >= 0 && oz.played >= 2) return pass("round lead");
  const concede = threat + CONCEDE_MARGIN + 2000 * env.aggression;
  if (lead < -concede && zone.played >= 3 && oz.played >= 3 && cardAdv <= 0) {
    return bankOrPass(env, s, plays, false, "concede");
  }
  if (ranked.length === 0) return pass("hold");
  return playOf(ranked, env.mistake, "round play");
};

const pass = (rule: string): Choice => ({ action: { t: "pass" }, rule, plays: [] });

const playOf = (ranked: Candidate[], mistake: boolean, rule: string): Choice => {
  const pick = mistake && ranked.length > 1 ? ranked[1] : ranked[0];
  if (!pick) return pass(rule);
  return {
    action: pick.action,
    rule: mistake && ranked.length > 1 ? `${rule} (mistake)` : rule,
    plays: ranked,
  };
};

/** Conceding a round: bank a high-retention unit with a Substitution tactic, else pass. */
const bankOrPass = (
  env: Env,
  s: MatchState,
  plays: Candidate[],
  pointless: boolean,
  rule: string,
): Choice => {
  if (!pointless && env.fullRules) {
    let best: { c: Candidate; value: number } | null = null;
    for (const c of plays) {
      if (c.card.kind !== "TACTIC" || !hasAbility(c.card, "substitution")) continue;
      const target = c.action.targets?.[0];
      const card = target === undefined ? undefined : cardOf(s, target);
      if (!card) continue;
      const value = retentionOf(card, s, -1, target as string);
      if (value < BANK_RETENTION) continue;
      if (!best || value > best.value) best = { c, value };
    }
    if (best) return { action: best.c.action, rule: "bank", plays: [] };
  }
  return pass(rule);
};

const scaleLambda = (lam: number, env: Env) => Math.trunc((lam * env.lamScale) / 1000);

/** Plays ranked by score at weight `lam`; `rules` drops held plays. */
const rank = (plays: Candidate[], lam: number, env: Env, rules: boolean) => {
  for (const c of plays) c.score = scoreOf(c, lam);
  const out = plays.filter((c) => !rules || !c.held);
  if (rules) {
    const limit = env.leaderThreshold;
    return out
      .filter((c) => !c.leader || lam === 0 || c.delta + c.fixed >= limit)
      .sort(compareCandidates);
  }
  return out.sort(compareCandidates);
};

const scoreOf = (c: Candidate, lam: number) =>
  c.delta +
  c.fixed +
  Math.trunc((lam * (c.gainRet - c.ret)) / 1000) +
  (lam === 0 ? c.gainNow : 0);

/** Score desc, then provision asc, instance id asc, row, canonical target order. */
const compareCandidates = (a: Candidate, b: Candidate) =>
  b.score - a.score || compareTies(a, b);

const compareTies = (a: Candidate, b: Candidate) =>
  a.card.provision - b.card.provision ||
  (a.inst < b.inst ? -1 : a.inst > b.inst ? 1 : 0) ||
  a.row - b.row ||
  a.order - b.order;

interface Plan {
  size: number;
  first: Candidate;
  cost: number;
}

/**
 * Fewest plays, then lowest total retention, that win the round once the opponent has
 * passed. Exact: the opponent cannot respond, so every engine result is certain.
 */
const minimalPlan = (
  env: Env,
  s: MatchState,
  seat: Seat,
  plays: Candidate[],
  depth: number,
): Plan | null => {
  const allowed = plays.filter((c) => !signatureHeld(env, s, seat, c));
  let best: Plan | null = null;
  for (const c of allowed) {
    if (!wins(c, seat)) continue;
    if (
      !best ||
      c.ret < best.cost ||
      (c.ret === best.cost && compareTies(c, best.first) < 0)
    )
      best = { size: 1, first: c, cost: c.ret };
  }
  if (best || depth < 2) return best;
  for (let size = 2; size <= depth && !best; size++) {
    for (const first of widest(allowed, env.planWidth)) {
      const stepped = stepTurn(s, seat, first.action, env.budget);
      if (!stepped) continue;
      const rest = cheapestWin(env, stepped, seat, size - 1);
      if (rest === null) continue;
      const cost = first.ret + rest;
      if (!best || cost < best.cost) best = { size, first, cost };
    }
  }
  return best;
};

/** Lowest retention that wins within exactly `remaining` more plays, or null. */
const cheapestWin = (
  env: Env,
  s: MatchState,
  seat: Seat,
  remaining: number,
): number | null => {
  if (env.budget.used >= env.budget.limit) return null;
  const next = enumerate(s, seat, env.cap, env.budget, env).filter(
    (c) => !signatureHeld(env, s, seat, c),
  );
  let cost: number | null = null;
  if (remaining === 1) {
    for (const c of next) {
      if (wins(c, seat) && (cost === null || c.ret < cost)) cost = c.ret;
    }
    return cost;
  }
  for (const c of widest(next, env.planWidth)) {
    const stepped = stepTurn(s, seat, c.action, env.budget);
    if (!stepped) continue;
    const rest = cheapestWin(env, stepped, seat, remaining - 1);
    if (rest !== null && (cost === null || c.ret + rest < cost)) cost = c.ret + rest;
  }
  return cost;
};

/** The `width` plays with the largest board gain. */
const widest = (plays: Candidate[], width: number) =>
  [...plays].sort((a, b) => b.delta - a.delta || compareTies(a, b)).slice(0, width);

/** Applies a play with the turn flow; null unless `seat` acts again in the same round. */
const stepTurn = (s: MatchState, seat: Seat, action: KessenAction, budget: Budget) => {
  budget.used += 1;
  const result = applyAction(s, seat, action);
  if (!result.ok) return null;
  const next = result.state;
  if (next.phase !== "play" || next.round !== s.round || next.turn !== seat)
    return null;
  return next;
};

/** Whether passing right after this play wins the round for `seat`. */
const wins = (c: Candidate, seat: Seat) =>
  c.lead > 0 || (c.lead === 0 && winsTies(c.after, seat));

/** Syndicate's Rigged Odds for `seat` in the current round. */
const winsTies = (s: MatchState, seat: Seat) => {
  if (!s.knobs.riggedOdds || (s.round >= 3 && !s.knobs.riggedOddsR3)) return false;
  const mine = s.seats[seat].faction === "SYNDICATE";
  const theirs = s.seats[other(seat)].faction === "SYNDICATE";
  return mine && !theirs && s.seats[seat].played > 0;
};

const leadOf = (s: MatchState, seat: Seat) => {
  const [a, b] = totals(s);
  return (seat === 0 ? a - b : b - a) * 1000;
};

// ---------------------------------------------------------------------------
// Candidates

/**
 * Every play and leader action of `seat` (one instance per card id), each with up to
 * `cap` target combinations explored in heuristic order, resolved on a copy.
 */
const enumerate = (
  s: MatchState,
  seat: Seat,
  cap: number,
  budget: Budget,
  env: Env | null,
): Candidate[] => {
  const zone = s.seats[seat];
  const final =
    s.round >= 3 || (zone.lanterns === 1 && s.seats[other(seat)].lanterns === 1);
  const beforeLead = leadOf(s, seat);
  const beforeFuture = futureOf(s, seat, final);
  const out: Candidate[] = [];
  const firstOf = new Map<string, string>();
  for (const id of zone.hand) {
    const cardId = s.inst[id];
    if (cardId === undefined || !s.cards[cardId]) continue;
    const known = firstOf.get(cardId);
    if (known === undefined || id < known) firstOf.set(cardId, id);
  }
  const instances = [...firstOf.values()].sort();
  const push = (
    action: PlayAction,
    after: MatchState,
    events: KessenEvent[],
    hidden: HiddenEffect[],
    meta: { card: KessenCard; leader: boolean; inst: string; row: number },
  ) => {
    const afterLead = leadOf(after, seat);
    const c: Candidate = {
      action,
      after,
      card: meta.card,
      leader: meta.leader,
      inst: meta.inst,
      row: meta.row,
      order: out.length,
      lead: afterLead,
      delta: afterLead - beforeLead,
      fixed: futureOf(after, seat, final) - beforeFuture,
      gainRet: 0,
      gainNow: 0,
      ret: meta.leader
        ? final
          ? 0
          : (LEADER_RETENTION[s.round] ?? 0)
        : retentionOf(meta.card, s, seat, meta.inst),
      held: null,
      score: 0,
    };
    scoreEvents(c, s, seat, events, hidden, final);
    if (env) c.held = heldReason(env, s, seat, c);
    out.push(c);
  };
  const explore = (
    base: PlayAction,
    meta: { card: KessenCard; leader: boolean; inst: string; row: number },
  ) => {
    let found = 0;
    const visit = (targets: Target[]) => {
      if (found >= cap || budget.used >= budget.limit) return;
      const action: PlayAction = targets.length > 0 ? { ...base, targets } : base;
      budget.used += 1;
      const work = cloneState(s);
      try {
        const result = resolveAction(work, seat, action, true);
        found += 1;
        push(action, work, result.events, result.hidden, meta);
      } catch (error) {
        const signal = signalOf(error);
        if (!signal) throw error;
        if (!signal.need) return;
        if (signal.need.optional) {
          budget.used += 1;
          const settled = cloneState(s);
          try {
            const result = resolveAction(settled, seat, action, false);
            found += 1;
            push(action, settled, result.events, result.hidden, meta);
          } catch (inner) {
            if (!signalOf(inner)) throw inner;
          }
        }
        for (const option of orderOptions(s, seat, signal.need)) {
          visit([...targets, option]);
        }
      }
    };
    visit([]);
  };
  for (const inst of instances) {
    const card = cardOf(s, inst) as KessenCard;
    if (card.kind === "UNIT" && card.row !== null) {
      const rows = card.row === "ANY" ? ROWS : [card.row];
      for (const row of rows) {
        explore(
          { t: "play", card: inst, row },
          { card, leader: false, inst, row: ROWS.indexOf(row) },
        );
      }
    } else {
      explore({ t: "play", card: inst }, { card, leader: false, inst, row: -1 });
    }
  }
  if (leaderAvailable(s, seat) && zone.leader !== null) {
    const card = s.cards[zone.leader];
    if (card) {
      const meta = { card, leader: true, inst: card.id, row: -1 };
      const cycle = card.abilities.find((ability) => ability.k === "cycle");
      if (cycle && cycle.k === "cycle") {
        const average = env?.deckAverage ?? null;
        const draws = card.abilities.some((ability) => ability.k === "draw");
        const action = cycleAction(s, seat, cycle.x, average, draws);
        if (action) {
          budget.used += 1;
          const work = cloneState(s);
          try {
            const result = resolveAction(work, seat, action, false);
            push(action, work, result.events, result.hidden, meta);
            if (average !== null)
              cycleValue(out[out.length - 1] as Candidate, s, seat, average, final);
          } catch (error) {
            if (!signalOf(error)) throw error;
          }
        }
      } else {
        explore({ t: "leader" }, meta);
      }
    }
  }
  return out;
};

/**
 * Cycle trades the chosen cards for draws of average value (plus any extra draw): the
 * rule evaluation's own deck order is weakest first, which would price every draw at
 * the deck's worst card. Spending the leader on it costs `CYCLE_RETENTION` outside the
 * final round.
 */
const cycleValue = (
  c: Candidate,
  s: MatchState,
  seat: Seat,
  average: number,
  final: boolean,
) => {
  let gain = 0;
  let now = 0;
  for (const id of c.action.targets ?? []) {
    const card = cardOf(s, id);
    if (!card) continue;
    gain += average - retentionOf(card, s, seat, id);
    now += (average - mulliganValue(card)) >> 1;
  }
  for (const ability of c.card.abilities) {
    if (ability.k !== "draw") continue;
    gain += ability.x * average;
    now += ability.x * UNKNOWN_DRAW_FINAL;
  }
  c.gainRet = gain;
  c.gainNow = final ? Math.max(0, now) : 0;
  c.ret = final ? 0 : CYCLE_RETENTION;
};

/**
 * Cycle the lowest-retention hand cards that sit below the deck average; with an extra
 * draw the leader is worth using even when nothing needs replacing.
 */
const cycleAction = (
  s: MatchState,
  seat: Seat,
  count: number,
  average: number | null,
  draws: boolean,
): PlayAction | null => {
  const hand = s.seats[seat].hand.filter((id) => !isTokenId(id) && cardOf(s, id));
  const ranked = hand
    .map((id) => ({ id, value: retentionOf(cardOf(s, id) as KessenCard, s, seat, id) }))
    .sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const limit = average ?? UNKNOWN_DRAW;
  const picks = ranked.filter((entry) => entry.value < limit).slice(0, count);
  if (picks.length === 0 && !draws) return null;
  return { t: "leader", targets: picks.map((entry) => entry.id) };
};

/** Board-independent value terms of a resolved play: draws, returns, kills, seals. */
const scoreEvents = (
  c: Candidate,
  s: MatchState,
  seat: Seat,
  events: KessenEvent[],
  hidden: HiddenEffect[],
  final: boolean,
) => {
  const enemy = other(seat);
  for (const event of events) {
    if (event.t === "drawn" && event.seat === seat) {
      for (const id of event.cards) gain(c, cardOf(c.after, id), s, seat, id, final);
    } else if (event.t === "returned" && event.seat === seat) {
      const card = cardOf(c.after, event.id);
      if (event.to === "hand") gain(c, card, s, seat, event.id, final);
      else if (card) {
        c.gainRet -= retentionOf(card, s, seat, event.id);
        c.gainNow -= card.power * FINAL_GAIN_PER_POWER;
      }
    } else if (event.t === "destroyed" && event.side === enemy) {
      c.fixed += event.owner === seat ? -OWN_INFILTRATOR_PENALTY : KILL_BONUS;
    } else if (event.t === "sealed") {
      const ref = findUnit(c.after, event.id);
      if (ref && ref.side === seat && ref.unit.owner === seat)
        c.fixed -= OWN_SEAL_PENALTY;
    } else if (event.t === "damaged") {
      const ref = findUnit(s, event.id);
      if (ref && ref.side === enemy && ref.unit.owner === seat) {
        c.fixed -= OWN_INFILTRATOR_PENALTY;
      }
    }
  }
  if (hidden.includes("summon")) c.delta += HIDDEN_SUMMON;
};

const gain = (
  c: Candidate,
  card: KessenCard | undefined,
  s: MatchState,
  seat: Seat,
  id: string,
  final: boolean,
) => {
  if (!card) {
    c.gainRet += UNKNOWN_DRAW;
    c.gainNow += final ? UNKNOWN_DRAW_FINAL : 0;
    return;
  }
  c.gainRet += retentionOf(card, s, seat, id);
  c.gainNow += card.power * FINAL_GAIN_PER_POWER;
};

/** Card-specific rules and the NPC's signature hints. */
const heldReason = (
  env: Env,
  s: MatchState,
  seat: Seat,
  c: Candidate,
): string | null => {
  if (signatureHeld(env, s, seat, c)) return "signature";
  if (!env.fullRules) return null;
  const card = c.card;
  if (c.leader && s.round < 3 && c.delta + c.fixed < env.leaderThreshold) {
    return "leader threshold";
  }
  if (!c.leader && card.kind !== "TACTIC") return null;
  if (hasAbility(card, "purge") && c.delta < PURGE_MIN) return "purge";
  if (hasAbility(card, "terrain") && c.delta < TERRAIN_MIN) return "terrain";
  if (hasAbility(card, "clearSkies") && c.delta < CLEAR_SKIES_MIN) return "clear skies";
  if (hasAbility(card, "seal") && !hasAbility(card, "strike")) {
    if (sealedEngines(s, seat, c) === 0) return "seal";
  }
  if (!c.leader && hasAbility(card, "substitution")) {
    const target = c.action.targets?.[0];
    const returned = target === undefined ? undefined : cardOf(s, target);
    if (!returned || deployValue(returned) < REPLAY_DEPLOY) return "substitution";
  }
  return null;
};

/** Enemy units a play newly sealed that carried a continuous keyword or Resilient. */
const sealedEngines = (s: MatchState, seat: Seat, c: Candidate) => {
  let count = 0;
  for (const ref of unitsOf(c.after, other(seat))) {
    if (!ref.unit.sealed) continue;
    const before = findUnit(s, ref.unit.id);
    if (!before || before.unit.sealed) continue;
    const card = cardOf(s, ref.unit.id);
    if (card && (CONTINUOUS.some((k) => hasAbility(card, k)) || before.unit.res))
      count++;
  }
  return count;
};

/** Whether an NPC signature hint holds this play back. */
const signatureHeld = (env: Env, s: MatchState, seat: Seat, c: Candidate) => {
  for (const signature of env.signatures(seat)) {
    if (signature.cardId !== c.card.id) continue;
    const rule = signature.rule;
    if (rule.hold === "untilRound" && s.round < rule.round) return true;
    if (rule.hold === "untilEnemyRowUnits") {
      const units = s.board[other(seat)][rule.row].filter((unit) => {
        const card = cardOf(s, unit.id);
        return !card || !isUnyielding(card);
      });
      if (units.length < rule.min) return true;
    }
    if (rule.hold === "untilTargetStored") {
      const target = c.action.targets?.find((id) => findUnit(s, id));
      const ref = target === undefined ? null : findUnit(s, target);
      if (!ref || ref.unit.stored < rule.min) return true;
    }
  }
  return false;
};

/** Value of a unit's Deploy abilities beyond its body (for replaying it). */
const deployValue = (card: KessenCard) => {
  if (!DEPLOY.some((k) => hasAbility(card, k))) return 0;
  return (cardValueMilli(card) ?? 0) - card.power * 1000;
};

/**
 * The value of holding a card for later rounds: its curve value plus situational terms
 *. Tokens are worth nothing, since they never leave Round 1.
 */
const retentionOf = (
  card: KessenCard,
  s: MatchState,
  seat: Seat | -1,
  inst: string,
) => {
  if (isTokenId(inst) || card.id === TOKEN_CARD_ID) return 0;
  let value = cardValueMilli(card) ?? INFILTRATOR_RETENTION;
  if (REMOVAL.some((k) => hasAbility(card, k))) value += REMOVAL_BONUS;
  if (seat !== -1 && sealOnlyTactic(card) && !engineTarget(s, other(seat))) return 0;
  if (seat !== -1) {
    const groups = card.abilities.flatMap((ability) =>
      ability.k === "summon" ? [ability.group] : [],
    );
    if (groups.length > 0) {
      const twin = s.seats[seat].hand.some((id) => {
        if (id === inst) return false;
        const other = cardOf(s, id);
        return other?.abilities.some(
          (ability) => ability.k === "summon" && groups.includes(ability.group),
        );
      });
      if (twin) value -= SUMMON_COPY_PENALTY;
    }
    if (hasAbility(card, "terrain")) {
      const enemy = other(seat);
      const crowded = ROWS.some(
        (row) =>
          s.board[enemy][row].filter((unit) => {
            const target = cardOf(s, unit.id);
            return !target || !isUnyielding(target);
          }).length >= 2,
      );
      if (!crowded) value -= IDLE_TERRAIN_PENALTY;
    }
  }
  return Math.max(0, value);
};

/** A Seal tactic without a Strike: it only ever switches off continuous keywords. */
const sealOnlyTactic = (card: KessenCard) =>
  card.kind === "TACTIC" && hasAbility(card, "seal") && !hasAbility(card, "strike");

const enginesByPool = new WeakMap<object, Map<string, boolean>>();

/** Whether `faction`'s own units carry a continuous keyword (Rally, Bond, Meditate, Resilient). */
const factionHasEngines = (
  cards: readonly KessenCard[] | Readonly<Record<string, KessenCard>>,
  faction: string,
) => {
  let known = enginesByPool.get(cards);
  if (!known) {
    known = new Map();
    enginesByPool.set(cards, known);
  }
  const cached = known.get(faction);
  if (cached !== undefined) return cached;
  const list = Array.isArray(cards) ? cards : Object.values(cards);
  const found = list.some(
    (card) =>
      card.faction === faction &&
      card.kind === "UNIT" &&
      CONTINUOUS.some((k) => hasAbility(card, k)),
  );
  known.set(faction, found);
  return found;
};

/** An engine a Seal could hit is on `side`'s board now or in its faction's pool. */
const engineTarget = (s: MatchState, side: Seat) => {
  for (const ref of unitsOf(s, side)) {
    const card = cardOf(s, ref.unit.id);
    if (!ref.unit.sealed && card && CONTINUOUS.some((k) => hasAbility(card, k)))
      return true;
  }
  return factionHasEngines(s.cards, s.seats[side].faction);
};

const mulliganValue = (card: KessenCard) =>
  isInfiltrator(card)
    ? INFILTRATOR_MULLIGAN
    : (cardValueMilli(card) ?? INFILTRATOR_MULLIGAN) +
      (REMOVAL.some((k) => hasAbility(card, k)) ? REMOVAL_BONUS : 0);

/**
 * Future value of the board for `seat`: Meditate growth still to come this round and,
 * outside the final round, points that carry over through Resilient.
 */
const futureOf = (s: MatchState, seat: Seat, final: boolean) => {
  let value = 0;
  for (const side of [0, 1] as const) {
    const sign = side === seat ? 1 : -1;
    const zone = s.seats[side];
    const turns = zone.passed ? 0 : Math.min(capCount(zone.hand), 3);
    for (const row of ROWS) {
      for (const unit of s.board[side][row]) {
        if (unit.sealed) continue;
        const card = cardOf(s, unit.id);
        if (!card) continue;
        let rate = 0;
        for (const ability of card.abilities)
          if (ability.k === "meditate") rate += ability.x;
        if (rate > 0 && turns > 0) {
          const room = Math.max(0, s.knobs.meditateCap - unit.med);
          value += sign * Math.min(room, rate * turns) * MEDITATE_WEIGHT;
        }
        if (
          !final &&
          unit.res &&
          !isUnyielding(card) &&
          !isInfiltrator(card) &&
          !isTokenId(unit.id)
        ) {
          value += sign * Math.max(0, unit.stored) * CARRY_WEIGHT;
        }
      }
    }
  }
  return value;
};

/** Target options in the order most likely to be best, so a capped search keeps them. */
const orderOptions = (s: MatchState, seat: Seat, request: TargetRequest): Target[] => {
  const enemy = other(seat);
  const power = (id: string) => {
    const ref = findUnit(s, id);
    return ref ? displayedPower(s, ref) : 0;
  };
  const keyed = (key: (option: Target) => number) =>
    request.options
      .map((option, index) => ({ option, index, key: key(option) }))
      .sort((a, b) => b.key - a.key || a.index - b.index)
      .map((entry) => entry.option);
  switch (request.kind) {
    case "enemyUnit":
      return keyed((id) => power(id) * 4 + engineWeight(s, id));
    case "anyUnit":
      return keyed((id) => {
        const ref = findUnit(s, id);
        const side = ref?.side === enemy ? 1000 : 0;
        return side + engineWeight(s, id) * 10 + power(id);
      });
    case "ownUnit":
      return keyed((id) => {
        const ref = findUnit(s, id);
        return (ref?.unit.res ? 100 : 0) + power(id);
      });
    case "enemyRow":
      return keyed((row) => rowTotal(s, enemy, row as Row));
    case "anyRow":
      return keyed(
        (row) =>
          s.board[enemy][row as Row].length * 100 - s.board[seat][row as Row].length,
      );
    case "ownRow":
      return keyed((row) => s.board[seat][row as Row].length);
    case "discard":
    case "enemyDiscard":
      return keyed((id) => cardOf(s, id)?.power ?? 0);
    case "hand":
      return keyed((id) => {
        const card = cardOf(s, id);
        return card ? -retentionOf(card, s, seat, id) : 0;
      });
  }
};

/** How much a unit's continuous abilities are worth to its side (target ordering). */
const engineWeight = (s: MatchState, id: string) => {
  const card = cardOf(s, id);
  if (!card) return 0;
  let weight = 0;
  for (const ability of card.abilities) {
    if (ability.k === "rally") weight += ability.x * 2;
    if (ability.k === "bond" || ability.k === "meditate") weight += 2;
  }
  const ref = findUnit(s, id);
  if (ref?.unit.res) weight += 2;
  return weight;
};

// ---------------------------------------------------------------------------
// Opponent threat

/** Exact `oppThreat` on a view-derived state. */
const threatOf = (
  s: MatchState,
  seat: Seat,
  pool: readonly KessenCard[],
  budget: Budget,
): number => {
  const opponent = other(seat);
  const oz = s.seats[opponent];
  if (oz.passed || s.phase !== "play") return 0;
  const work = cloneState(s);
  work.turn = opponent;
  const candidates = oz.hand.length > 0 ? possiblePool(s, opponent, pool) : [];
  const deck = candidates
    .filter((card) => card.kind === "UNIT")
    .sort((a, b) => b.power - a.power || (a.id < b.id ? -1 : 1));
  const inst: Record<string, string> = { ...work.inst };
  work.seats[opponent].deck = deck.map((card, n) => {
    inst[`q${n}`] = card.id;
    return `q${n}`;
  });
  candidates.forEach((card, n) => {
    inst[`p${n}`] = card.id;
  });
  work.inst = inst;
  const before = leadOf(work, opponent);
  let best = 0;
  for (let n = 0; n < candidates.length; n++) {
    work.seats[opponent].hand = [`p${n}`];
    for (const c of enumerate(work, opponent, THREAT_CAP, budget, null)) {
      if (c.leader) continue;
      best = Math.max(best, leadOf(c.after, opponent) - before);
    }
  }
  if (leaderAvailable(work, opponent)) {
    work.seats[opponent].hand = [];
    for (const c of enumerate(work, opponent, THREAT_CAP, budget, null)) {
      best = Math.max(best, leadOf(c.after, opponent) - before);
    }
  }
  return best;
};

/**
 * Cards the opponent may still hold: their faction plus Neutral, collectible, minus names
 * whose copy limit (or the deck's legendary and Infiltrator caps) is already on display.
 */
const possiblePool = (s: MatchState, opponent: Seat, pool: readonly KessenCard[]) => {
  const seen = seenCopies(s, opponent);
  const faction = s.seats[opponent].faction;
  return pool.filter(
    (card) =>
      card.isCollectible &&
      card.kind !== "LEADER" &&
      card.variant === "STANDARD" &&
      (card.faction === faction || card.faction === "NEUTRAL") &&
      (seen.byKey.get(copyKey(card)) ?? 0) < KESSEN_COPY_LIMITS[card.rarity] &&
      !(
        card.rarity === "LEGENDARY" &&
        seen.legendaries >= KESSEN_DECK_RULES.maxLegendaries
      ) &&
      !(isInfiltrator(card) && seen.infiltrators >= KESSEN_DECK_RULES.maxInfiltrators),
  );
};

/** Visible copies the opponent owns: their discard and every board unit they own. */
const seenCopies = (s: MatchState, owner: Seat) => {
  const byKey = new Map<string, number>();
  let legendaries = 0;
  let infiltrators = 0;
  const count = (id: string) => {
    if (isTokenId(id)) return;
    const card = cardOf(s, id);
    if (!card) return;
    const key = copyKey(card);
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
    if (card.rarity === "LEGENDARY") legendaries += 1;
    if (isInfiltrator(card)) infiltrators += 1;
  };
  for (const id of s.seats[owner].discard) count(id);
  for (const side of [0, 1] as const) {
    for (const ref of unitsOf(s, side))
      if (ref.unit.owner === owner) count(ref.unit.id);
  }
  return { byKey, legendaries, infiltrators };
};

/** The catalog pool in item-id order, so a decision never depends on how it was read. */
const canonicalPool = (view: MatchView, context: KessenAiContext) =>
  [...(context.pool ?? Object.values(view.cards))].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

// ---------------------------------------------------------------------------
// Rollouts

interface RolloutInput {
  view: MatchView;
  seat: Seat;
  profile: KessenAiProfile;
  tier: KessenAiTierSpec;
  /** The rule policy's decision, kept unless a rollout alternative scores higher. */
  choice: Choice;
  pool: readonly KessenCard[];
  ownDeck: string[] | null;
  budget: Budget;
  rng: Rng;
  rootThreat: (seat: Seat) => number;
}

/**
 * Determinized rollouts (Jonin and Kage): the rule choice, the best-ranked plays and a
 * pass, each played out on the same hidden-information samples; the highest total wins.
 */
const rolloutChoice = (input: RolloutInput): KessenAiDecision => {
  const { view, seat, profile, tier, choice, pool, ownDeck, budget, rng, rootThreat } =
    input;
  const options: KessenAction[] = [choice.action];
  const keys = new Set([actionKey(choice.action)]);
  const add = (action: KessenAction) => {
    const key = actionKey(action);
    if (keys.has(key)) return;
    keys.add(key);
    options.push(action);
  };
  for (const c of choice.plays.slice(0, tier.rolloutCandidates)) add(c.action);
  add({ t: "pass" });
  const keep = (samples: number, fallback: boolean): KessenAiDecision => ({
    action: choice.action,
    rule: choice.rule,
    applications: budget.used,
    samples,
    fallback,
  });
  if (options.length < 2) return keep(0, false);

  // Rollout turns judge threats from public knowledge, as the real players must: each
  // side's exact pool threat at the root, so no side plays as if it saw the other's hand.
  const fixedThreat: [number, number] = [0, 0];
  fixedThreat[seat] = rootThreat(seat);
  fixedThreat[other(seat)] = rootThreat(other(seat));
  const env: Env = {
    fullRules: true,
    lamScale: 1000,
    offset: 0,
    jitter: 0,
    aggression: 0,
    bleed: 0,
    leaderThreshold: 0,
    signatures: (target) => (target === seat ? (profile.signatures ?? []) : []),
    threat: (s, at) => (s.seats[other(at)].passed ? 0 : fixedThreat[at]),
    cap: tier.rolloutCap,
    planDepth: 2,
    planWidth: ROLLOUT_PLAN_WIDTH,
    budget,
    mistake: false,
    deckAverage: averageRetention(view, seat, null),
  };
  // Every option plays the same samples. With halving, all options play the first
  // quarter, the better half (always with the rule choice) plays on to half, and the best
  // two (or the best and the rule choice) play all of them.
  const samples: MatchState[] = [];
  const sampleAt = (k: number) => {
    while (samples.length <= k)
      samples.push(sampleState(view, seat, pool, ownDeck, rng));
    return samples[k] as MatchState;
  };
  const values: number[][] = options.map(() => []);
  const total = (index: number, count: number) => {
    let sum = 0;
    for (let k = 0; k < count; k++) sum += values[index]?.[k] ?? 0;
    return sum;
  };
  let alive = options.map((_, index) => index);
  let exhausted = false;
  const stages = tier.halving ? halvingStages(tier.samples) : [tier.samples];
  for (const stage of stages) {
    for (let k = 0; k < stage && !exhausted; k++) {
      for (const index of alive) {
        const done = values[index] as number[];
        if (done.length > k) continue;
        const value = rollout(
          env,
          sampleAt(k),
          seat,
          options[index] as KessenAction,
          tier.matchHorizon,
        );
        if (value === null) {
          exhausted = true;
          break;
        }
        done.push(value);
      }
    }
    if (exhausted) break;
    const ranked = [...alive].sort(
      (a, b) => total(b, stage) - total(a, stage) || a - b,
    );
    const width = Math.max(2, (alive.length + 1) >> 1);
    alive = ranked.slice(0, width);
    if (!alive.includes(0)) alive.push(0);
  }
  let completed = tier.samples;
  for (const index of alive)
    completed = Math.min(completed, values[index]?.length ?? 0);
  if (completed < Math.min(MIN_SAMPLES, tier.samples)) return keep(completed, true);
  let best = 0;
  for (const index of alive) {
    if (total(index, completed) > total(best, completed)) best = index;
  }
  return {
    action: options[best] as KessenAction,
    rule: best === 0 ? choice.rule : "rollout",
    applications: budget.used,
    samples: completed,
    fallback: false,
  };
};

/** Cumulative sample counts of the halving stages: a quarter, a half, then all. */
const halvingStages = (samples: number) => {
  const stages = [Math.max(1, samples >> 2), Math.max(1, samples >> 1), samples];
  return stages.filter(
    (stage, index) => index === 0 || stage > (stages[index - 1] ?? 0),
  );
};

const actionKey = (action: KessenAction) => JSON.stringify(action);

/**
 * Plays `first`, then both sides by the rule policy (rule mulligans between rounds) to
 * the end of the round or, with `matchHorizon`, of the match; scored by `outcome`. Null
 * when the budget runs out.
 */
const rollout = (
  env: Env,
  start: MatchState,
  seat: Seat,
  first: KessenAction,
  matchHorizon: boolean,
): number | null => {
  env.budget.used += 1;
  const opened = applyAction(start, seat, first);
  if (!opened.ok) return -MATCH_DECIDED;
  let s = opened.state;
  const rounds = start.history.length;
  for (let step = 0; step < horizonSteps(matchHorizon); step++) {
    if (s.phase === "over" || (!matchHorizon && s.history.length > rounds)) break;
    if (env.budget.used >= env.budget.limit) return null;
    env.budget.used += 1;
    if (s.phase === "mulligan") {
      const actor = s.seats[0].mull !== null ? 0 : 1;
      const cards = chooseMulligan(viewFor(s, actor), actor);
      const result = applyAction(s, actor, { t: "mull", cards });
      if (!result.ok) throw new Error("A rollout mulligan was rejected");
      s = result.state;
      continue;
    }
    const actor = s.turn;
    const action = policy(env, s, actor).action;
    const result = applyAction(s, actor, action);
    s = result.ok ? result.state : forcePass(s, actor);
  }
  if (env.budget.used > env.budget.limit) return null;
  return outcome(s, seat, rounds);
};

const horizonSteps = (matchHorizon: boolean) =>
  matchHorizon ? 3 * ROLLOUT_STEPS : ROLLOUT_STEPS;

const forcePass = (s: MatchState, seat: Seat) => {
  const result = applyAction(s, seat, { t: "pass" });
  if (!result.ok) throw new Error("A rollout reached a state without a legal pass");
  return result.state;
};

/** Rollout utility for `seat` once the rollout stopped: the match result, else the round's. */
const outcome = (s: MatchState, seat: Seat, rounds: number) => {
  const opponent = other(seat);
  if (s.phase === "over") {
    const winner = s.result?.winner ?? null;
    return winner === seat ? MATCH_DECIDED : winner === null ? 0 : -MATCH_DECIDED;
  }
  const last = s.history[rounds];
  if (!last) {
    const lead = leadOf(s, seat);
    return lead > 0 ? 1 : lead < 0 ? -1 : 0;
  }
  const weight = ROUND_WIN[last.round] ?? 0;
  let value =
    last.winner === seat ? weight : last.winner === opponent ? -weight : -(weight >> 1);
  value +=
    (CARD_WEIGHT[last.round] ?? 0) *
    (capCount(s.seats[seat].hand) - capCount(s.seats[opponent].hand));
  const [a, b] = totals(s);
  value += CARRY_WEIGHT * (seat === 0 ? a - b : b - a);
  return value;
};

/**
 * One determinization: the opponent's hand and deck sampled from their possible pool
 * (rarity-weighted, without replacement, within copy and deck caps) and the AI's own
 * remaining deck in a sampled order.
 */
const sampleState = (
  view: MatchView,
  seat: Seat,
  pool: readonly KessenCard[],
  ownDeck: string[] | null,
  rng: Rng,
): MatchState => {
  const opponent = other(seat);
  const oz = view.seats[opponent];
  const probe = viewToState(view, { cards: [...pool] });
  const available = possiblePool(probe, opponent, pool);
  const seen = seenCopies(probe, opponent);
  const copies: KessenCard[] = [];
  for (const card of available) {
    const left = KESSEN_COPY_LIMITS[card.rarity] - (seen.byKey.get(copyKey(card)) ?? 0);
    for (let n = 0; n < left; n++) copies.push(card);
  }
  let legendaries = seen.legendaries;
  let infiltrators = seen.infiltrators;
  const draw = () => {
    for (;;) {
      let total = 0;
      for (const card of copies) total += RARITY_WEIGHT[card.rarity];
      if (total === 0) return undefined;
      let roll = rng.int(total);
      let index = 0;
      for (; index < copies.length; index++) {
        roll -= RARITY_WEIGHT[(copies[index] as KessenCard).rarity];
        if (roll < 0) break;
      }
      const card = copies.splice(index, 1)[0] as KessenCard;
      if (
        card.rarity === "LEGENDARY" &&
        legendaries >= KESSEN_DECK_RULES.maxLegendaries
      )
        continue;
      if (isInfiltrator(card) && infiltrators >= KESSEN_DECK_RULES.maxInfiltrators)
        continue;
      if (card.rarity === "LEGENDARY") legendaries += 1;
      if (isInfiltrator(card)) infiltrators += 1;
      return card.id;
    }
  };
  const hand: string[] = [];
  while (hand.length < oz.handCount) hand.push(draw() ?? "?");
  const deck: string[] = [];
  while (deck.length < oz.deckCount) deck.push(draw() ?? "?");
  const own = ownDeck ? shuffleInPlace(rng, [...ownDeck]) : undefined;
  return viewToState(view, {
    cards: [...pool],
    hands: { [opponent]: hand },
    decks: own ? { [opponent]: deck, [seat]: own } : { [opponent]: deck },
  });
};

// ---------------------------------------------------------------------------
// Own deck knowledge

/** The AI's own undrawn cards (deck list minus every visible copy it owns); null if unknown. */
const remainingDeck = (
  view: MatchView,
  seat: Seat,
  deck: readonly string[] | undefined,
): string[] | null => {
  if (!deck) return null;
  const left = new Map<string, number>();
  for (const cardId of deck) left.set(cardId, (left.get(cardId) ?? 0) + 1);
  const take = (id: string) => {
    if (isTokenId(id)) return;
    const cardId = view.inst[id];
    if (cardId === undefined) return;
    const count = left.get(cardId) ?? 0;
    if (count > 0) left.set(cardId, count - 1);
  };
  for (const id of view.seats[seat].hand ?? []) take(id);
  for (const id of view.seats[seat].discard) take(id);
  for (const side of view.board) {
    for (const row of ROWS) {
      for (const unit of side[row]) if (unit.owner === seat) take(unit.id);
    }
  }
  const out: string[] = [];
  for (const cardId of [...left.keys()].sort()) {
    for (let n = 0; n < (left.get(cardId) ?? 0); n++) out.push(cardId);
  }
  return out.slice(0, view.seats[seat].deckCount);
};

/** Deck order for rule evaluation: weakest first, so Summon and draws are never overrated. */
const ownDeckOrder = (view: MatchView, remaining: string[] | null) => {
  if (!remaining) return [];
  return [...remaining].sort((a, b) => {
    const pa = view.cards[a]?.power ?? 0;
    const pb = view.cards[b]?.power ?? 0;
    return pa - pb || (a < b ? -1 : a > b ? 1 : 0);
  });
};

/** Average mulligan value of the AI's deck list (or its hand when the list is unknown). */
const averageRetention = (
  view: MatchView,
  seat: Seat,
  deck: readonly string[] | null | undefined,
) => {
  const ids =
    deck && deck.length > 0
      ? [...deck]
      : (view.seats[seat].hand ?? [])
          .filter((id) => !isTokenId(id))
          .map((id) => view.inst[id] ?? "");
  let total = 0;
  let count = 0;
  for (const cardId of ids) {
    const card = view.cards[cardId];
    if (!card) continue;
    total += mulliganValue(card);
    count += 1;
  }
  return count === 0 ? 0 : Math.trunc(total / count);
};

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(value)));
