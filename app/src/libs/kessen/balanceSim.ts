/**
 * Simulated balance metrics: AI-versus-AI matches on fixed seeds, so the same catalog
 * always yields the same numbers on every device. The gauntlet plays every reference deck
 * against every other faction's; a match trial plays a card against a vanilla unit of
 * its own cost in the same deck slots, on the same seeds, so the two games differ only
 * where the card does. Games are independent jobs, which callers may spread over workers.
 */
import { KESSEN_COPY_LIMITS } from "@/drizzle/constants";
import { aiRng, decide, type KessenAiTier } from "./ai";
import {
  KESSEN_BALANCE,
  type KessenBalanceFlag,
  type KessenReferenceDeck,
} from "./balance";
import { rowTotal } from "./board";
import { VALUE_PREMIUM_MILLI } from "./catalog";
import {
  type DeckFaction,
  expandDeckCards,
  KESSEN_DECK_FACTIONS,
  starterDeck,
} from "./deck";
import { actingSeats, applyAction, createMatch, previewState, viewFor } from "./engine";
import { KESSEN_FACTION_NAMES } from "./packs";
import { ROWS } from "./rules";
import type { KessenAction, KessenCard, MatchState, Row, Seat } from "./types";

/** Simulation settings; `version` keys cached results. */
export const KESSEN_BALANCE_SIM = {
  version: 3,
  /** Stable seed cohort, independent of summary and cache changes. */
  seedVersion: 2,
  tier: "CHUNIN" satisfies KessenAiTier,
  /** Games per pair of reference decks, half with each deck opening the seats. */
  gauntletGamesPerPair: 16,
  /** Paired games per match trial on the balance page. */
  trialGames: 60,
  /** Paired games per match trial of one card in the editor, which can afford more. */
  editorTrialGames: 240,
  /** Actions after which a game counts as unfinished. */
  stepCap: 400,
} as const;

/** Item id prefix of the vanilla reference units match trials add to the catalog. */
export const TRIAL_REFERENCE_PREFIX = "kessen-balance-reference-";

/** The deck slot filler of match trials: the vanilla unit every starter deck runs. */
export const TRIAL_FILLER_ID = "kessen-musashi-ken-swordsman";

export interface KessenSimSeat {
  leaderId: string | null;
  deck: string[];
}

/** One seeded game; `metrics` also records swings and row totals. */
export interface KessenSimJob {
  id: string;
  seed: string;
  seats: [KessenSimSeat, KessenSimSeat];
  metrics: boolean;
}

export interface KessenSimOutcome {
  id: string;
  finished: boolean;
  /** Null on a draw. */
  winner: Seat | null;
  opener: Seat;
  /** Plays of cards and leaders, without tokens. */
  plays: number;
  rounds: number;
  ties: number;
  /** Board-total change of every play from the actor's side (metrics jobs only). */
  swings: number[];
  /** Largest row total seen (metrics jobs only). */
  maxRow: number;
}

/** Plays one job to the end with the balance AI on both seats. */
export const playSimGame = (
  job: KessenSimJob,
  cards: readonly KessenCard[],
  pool: readonly KessenCard[] = cards,
): KessenSimOutcome => {
  let state = createMatch({ seed: job.seed, seats: job.seats, cards: [...cards] });
  const outcome: KessenSimOutcome = {
    id: job.id,
    finished: false,
    winner: null,
    opener: state.opener,
    plays: 0,
    rounds: 0,
    ties: 0,
    swings: [],
    maxRow: 0,
  };
  for (let step = 0; step < KESSEN_BALANCE_SIM.stepCap; step++) {
    const seat = actingSeats(state)[0];
    if (seat === undefined) break;
    const action = decide(
      viewFor(state, seat),
      seat,
      { tier: KESSEN_BALANCE_SIM.tier },
      aiRng(job.seed, seat, state.step),
      { pool, deck: job.seats[seat].deck },
    );
    if (action.t === "play" || action.t === "leader") {
      if (job.metrics) outcome.swings.push(swingOf(state, seat, action));
      if (action.t === "leader" || !action.card.startsWith("t-")) outcome.plays += 1;
    }
    const result = applyAction(state, seat, action);
    if (!result.ok) throw new Error(`${job.seed}: ${result.reason}`);
    for (const event of result.events) {
      if (event.t !== "roundEnd") continue;
      outcome.rounds += 1;
      if (event.totals[0] === event.totals[1]) outcome.ties += 1;
    }
    state = result.state;
    if (job.metrics) outcome.maxRow = Math.max(outcome.maxRow, largestRow(state));
  }
  outcome.finished = state.phase === "over";
  outcome.winner = state.result?.winner ?? null;
  return outcome;
};

/** Score of `seat` in a finished game: 1 for a win, 0.5 for a draw. */
export const scoreOf = (winner: Seat | null, seat: Seat) =>
  winner === null ? 0.5 : winner === seat ? 1 : 0;

/* ------------------------------- Gauntlet ------------------------------- */

/** A gauntlet game and the reference decks in its seats. */
export interface KessenGauntletJob extends KessenSimJob {
  decks: [string, string];
}

/**
 * Every cross-faction pair of reference decks, `gamesPerPair` games each: game 2k seats
 * the first deck first and game 2k + 1 swaps the seats on the same seed.
 */
export const gauntletJobs = (
  decks: readonly KessenReferenceDeck[],
  gamesPerPair: number = KESSEN_BALANCE_SIM.gauntletGamesPerPair,
  prefix = `kessen-balance:v${KESSEN_BALANCE_SIM.seedVersion}:gauntlet`,
): KessenGauntletJob[] => {
  const jobs: KessenGauntletJob[] = [];
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      const a = decks[i] as KessenReferenceDeck;
      const b = decks[j] as KessenReferenceDeck;
      if (a.faction === b.faction) continue;
      for (let game = 0; game < gamesPerPair; game++) {
        const [first, second] = game % 2 === 0 ? [a, b] : [b, a];
        const seed = `${prefix}:${a.key}:${b.key}:${game >> 1}`;
        jobs.push({
          id: `${seed}:${game % 2}`,
          seed,
          seats: [seatOf(first), seatOf(second)],
          metrics: true,
          decks: [first.key, second.key],
        });
      }
    }
  }
  return jobs;
};

/** A win rate with its game count and standard error. */
export interface KessenRate {
  score: number;
  games: number;
  se: number;
}

export interface KessenGauntletSummary {
  factions: { faction: DeckFaction; rate: KessenRate; flags: KessenBalanceFlag[] }[];
  decks: { key: string; rate: KessenRate; flags: KessenBalanceFlag[] }[];
  health: {
    games: number;
    skipped: number;
    unfinished: number;
    plays: number;
    tieRate: number;
    opener: number;
    swingP99: number;
    swingMax: number;
    rowMax: number;
    flags: KessenBalanceFlag[];
  };
}

/** Faction and deck win rates and match health of a played gauntlet. */
export const summarizeGauntlet = (
  decks: readonly KessenReferenceDeck[],
  jobs: readonly KessenGauntletJob[],
  outcomes: ReadonlyMap<string, KessenSimOutcome>,
): KessenGauntletSummary => {
  const factionOf = new Map(decks.map((deck) => [deck.key, deck.faction]));
  const byDeck = new Map<string, number[]>();
  const byFaction = new Map<DeckFaction, number[]>();
  const played: KessenSimOutcome[] = [];
  for (const job of jobs) {
    const outcome = outcomes.get(job.id);
    if (!outcome) continue;
    played.push(outcome);
    if (!outcome.finished) continue;
    for (const seat of [0, 1] as const) {
      const key = job.decks[seat];
      const faction = factionOf.get(key);
      const score = scoreOf(outcome.winner, seat);
      push(byDeck, key, score);
      if (faction) push(byFaction, faction, score);
    }
  }
  const [lowF, highF] = KESSEN_BALANCE.factionWinRate;
  const [lowD, highD] = KESSEN_BALANCE.deckWinRate;
  const factions = KESSEN_DECK_FACTIONS.map((faction) => {
    const rate = rateOf(byFaction.get(faction) ?? []);
    const flags: KessenBalanceFlag[] =
      rate.games > 0 && (rate.score < lowF || rate.score > highF)
        ? [
            {
              rule: "factionWinRate",
              severity: "break",
              message: `${KESSEN_FACTION_NAMES[faction]} wins ${percent(rate.score)} of gauntlet games (limit ${percent(lowF)}–${percent(highF)})`,
            },
          ]
        : [];
    return { faction, rate, flags };
  });
  const deckRates = decks.map((deck) => {
    const rate = rateOf(byDeck.get(deck.key) ?? []);
    const flags: KessenBalanceFlag[] =
      rate.games > 0 && (rate.score < lowD || rate.score > highD)
        ? [
            {
              rule: "deckWinRate",
              severity: "warn",
              message: `${KESSEN_FACTION_NAMES[deck.faction]} ${deck.label.toLowerCase()} wins ${percent(rate.score)} (limit ${percent(lowD)}–${percent(highD)})`,
            },
          ]
        : [];
    return { key: deck.key, rate, flags };
  });
  return {
    factions,
    decks: deckRates,
    health: healthOf(played, jobs.length - played.length),
  };
};

/* ----------------------------- Match trials ----------------------------- */

/** A trial game pair: the same seed and seats, with the subject or its reference. */
export interface KessenTrialPair {
  /** Seat of the trial deck. */
  seat: Seat;
  subject: KessenSimJob;
  reference: KessenSimJob;
}

/** Cards a match trial covers: collectible standard deck cards and collectible leaders. */
export const isTrialSubject = (card: KessenCard) =>
  card.isCollectible && card.variant === "STANDARD";

/**
 * A leader without active abilities preserves its faction passive. Deck cards use a
 * vanilla unit at their curve target, on their row (Taijutsu for tactics and any-row units).
 */
export const trialReference = (card: KessenCard): KessenCard => {
  if (card.kind === "LEADER") {
    return {
      ...card,
      id: `${TRIAL_REFERENCE_PREFIX}leader-${card.faction.toLowerCase()}`,
      name: "Leader without abilities",
      abilities: [],
      isCollectible: false,
    };
  }
  const power = card.provision + Math.round(VALUE_PREMIUM_MILLI[card.rarity] / 1000);
  const row: Row =
    card.kind === "UNIT" && card.row !== "ANY" && card.row ? card.row : "CLOSE";
  return {
    id: `${TRIAL_REFERENCE_PREFIX}${card.provision}-${power}-${row.toLowerCase()}`,
    name: `Vanilla ${power}`,
    rarity: card.rarity,
    kind: "UNIT",
    faction: "NEUTRAL",
    row,
    power,
    provision: card.provision,
    abilities: [],
    sets: [],
    leaderBonus: 0,
    variant: "STANDARD",
    baseCardId: null,
    isCollectible: false,
  };
};

/** The catalog plus every trial reference its cards need. */
export const trialCatalog = (catalog: readonly KessenCard[]): KessenCard[] => {
  const references = new Map<string, KessenCard>();
  for (const card of catalog) {
    if (!isTrialSubject(card)) continue;
    const reference = trialReference(card);
    references.set(reference.id, reference);
  }
  return [...catalog, ...references.values()];
};

/**
 * The paired games of one card's match trial. A deck card fills the slots of its own
 * copies in the home faction's starter deck, then those of the vanilla filler, up to its
 * copy limit; the reference takes the same slots. A leader leads the starter deck of its
 * faction against the same deck with a leader without active abilities, preserving the
 * faction passive. Neutral cards play from every faction.
 */
export const trialPairs = (
  card: KessenCard,
  games: number = KESSEN_BALANCE_SIM.trialGames,
): KessenTrialPair[] => {
  const homes: DeckFaction[] =
    card.faction === "NEUTRAL" ? [...KESSEN_DECK_FACTIONS] : [card.faction];
  const pairsPerMatchup = Math.max(
    1,
    Math.round(games / (2 * homes.length * (KESSEN_DECK_FACTIONS.length - 1))),
  );
  const pairs: KessenTrialPair[] = [];
  for (const home of homes) {
    const starter = starterDeck(home);
    const deck = expandDeckCards(starter.cards);
    const slots = card.kind === "LEADER" ? null : slotDecks(card, deck);
    const subject: KessenSimSeat = slots
      ? { leaderId: starter.leaderId, deck: slots.subject }
      : { leaderId: card.id, deck };
    const reference: KessenSimSeat = slots
      ? { leaderId: starter.leaderId, deck: slots.reference }
      : { leaderId: trialReference(card).id, deck };
    // Cards of one cost and row that fill the same slots share their reference games.
    const referenceKey = slots
      ? `${trialReference(card).id}:${slots.slots.join(".")}:filler:${slots.surplus.join(".")}`
      : trialReference(card).id;
    for (const opponent of KESSEN_DECK_FACTIONS) {
      if (opponent === home) continue;
      const other = starterDeck(opponent);
      const rival: KessenSimSeat = {
        leaderId: other.leaderId,
        deck: expandDeckCards(other.cards),
      };
      for (let game = 0; game < 2 * pairsPerMatchup; game++) {
        const seat: Seat = game % 2 === 0 ? 0 : 1;
        const seed = `kessen-balance:v${KESSEN_BALANCE_SIM.seedVersion}:trial:${home}:${opponent}:${game >> 1}`;
        const seats = (own: KessenSimSeat): [KessenSimSeat, KessenSimSeat] =>
          seat === 0 ? [own, rival] : [rival, own];
        pairs.push({
          seat,
          subject: {
            id: `${seed}:${seat}:${card.id}`,
            seed,
            seats: seats(subject),
            metrics: false,
          },
          reference: {
            id: `${seed}:${seat}:ref:${referenceKey}`,
            seed,
            seats: seats(reference),
            metrics: false,
          },
        });
      }
    }
  }
  return pairs;
};

/** A card's trial: its edge over the reference in win-rate points. */
export interface KessenTrialSummary {
  cardId: string;
  /** Mean score difference in win-rate points (100 = always wins where the reference lost). */
  edge: number;
  /** Standard error of `edge`. */
  se: number;
  games: number;
  /** Pairs excluded because either game was unavailable or unfinished. */
  discarded: number;
  flags: KessenBalanceFlag[];
}

/**
 * A card's trial result. Reference games are shared between cards of the same cost and
 * row, so callers play each job id once.
 */
export const summarizeTrial = (
  card: KessenCard,
  pairs: readonly KessenTrialPair[],
  outcomes: ReadonlyMap<string, KessenSimOutcome>,
): KessenTrialSummary => {
  const diffs: number[] = [];
  for (const pair of pairs) {
    const subject = outcomes.get(pair.subject.id);
    const reference = outcomes.get(pair.reference.id);
    if (!subject?.finished || !reference?.finished) continue;
    diffs.push(
      scoreOf(subject.winner, pair.seat) - scoreOf(reference.winner, pair.seat),
    );
  }
  const n = diffs.length;
  const mean = n > 0 ? diffs.reduce((sum, d) => sum + d, 0) / n : 0;
  const variance =
    n > 1 ? diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1) : 0;
  const edge = round1(100 * mean);
  const se = round1(n > 0 ? (100 * Math.sqrt(variance)) / Math.sqrt(n) : 0);
  const flags: KessenBalanceFlag[] = [];
  const discarded = pairs.length - n;
  if (discarded > 0) {
    flags.push({
      rule: "trial",
      severity: "warn",
      message: `${discarded} trial pairs excluded because a game was unavailable or unfinished; ${n} completed pairs remain`,
    });
  }
  if (card.kind !== "LEADER" && n > 0) {
    const clear = Math.abs(edge) - 2 * se > 0;
    if (Math.abs(edge) > KESSEN_BALANCE.trialEdge && clear) {
      flags.push({
        rule: "trial",
        severity: "warn",
        message: `Wins ${Math.abs(edge).toFixed(1)} ± ${(2 * se).toFixed(1)} points ${edge > 0 ? "more" : "less"} than a vanilla ${trialReference(card).power}-power unit of its cost in match trials (limit ${KESSEN_BALANCE.trialEdge})`,
      });
    }
  }
  return { cardId: card.id, edge, se, games: n, discarded, flags };
};

/** Flags leaders whose trial edge sits far from the median leader's. */
export const leaderSpreadFlags = (
  leaders: readonly { card: KessenCard; trial: KessenTrialSummary }[],
): Map<string, KessenBalanceFlag[]> => {
  const out = new Map<string, KessenBalanceFlag[]>();
  const completed = leaders.filter((entry) => entry.trial.games > 0);
  if (completed.length === 0) return out;
  const median = medianOf(completed.map((entry) => entry.trial.edge));
  for (const { card, trial } of completed) {
    const offset = trial.edge - median;
    if (Math.abs(offset) <= KESSEN_BALANCE.leaderSpread) continue;
    out.set(card.id, [
      {
        rule: "leaderTrial",
        severity: "warn",
        message: `Adds ${trial.edge.toFixed(1)} win-rate points over a leader without abilities, ${Math.abs(offset).toFixed(1)} ${offset > 0 ? "above" : "below"} the median leader (limit ${KESSEN_BALANCE.leaderSpread})`,
      },
    ]);
  }
  return out;
};

/** Median of a non-empty list. */
export const medianOf = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** Win rate as a whole percent: 0.5 is "50%". */
export const percent = (rate: number) => `${Math.round(100 * rate)}%`;

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

const seatOf = (deck: KessenReferenceDeck): KessenSimSeat => ({
  leaderId: deck.list.leaderId,
  deck: expandDeckCards(deck.list.cards),
});

/** The card's slots in the deck, the deck with the card there and with its reference. */
const slotDecks = (card: KessenCard, deck: readonly string[]) => {
  const own: number[] = [];
  const filler: number[] = [];
  deck.forEach((id, index) => {
    if (id === card.id) own.push(index);
    else if (id === TRIAL_FILLER_ID) filler.push(index);
  });
  const slots = [...own, ...filler].slice(0, KESSEN_COPY_LIMITS[card.rarity]);
  const surplus = own.slice(KESSEN_COPY_LIMITS[card.rarity]);
  const reference = trialReference(card).id;
  const baseline = card.id === TRIAL_FILLER_ID ? reference : TRIAL_FILLER_ID;
  const subject = [...deck];
  const control = [...deck];
  for (const index of surplus) {
    subject[index] = baseline;
    control[index] = baseline;
  }
  for (const index of slots) {
    subject[index] = card.id;
    control[index] = reference;
  }
  return { slots, surplus, subject, reference: control };
};

const healthOf = (played: readonly KessenSimOutcome[], skipped: number) => {
  const games = played.length;
  const completed = played.filter((game) => game.finished);
  const rounds = played.reduce((sum, game) => sum + game.rounds, 0);
  const swings = played.flatMap((game) => game.swings).sort((a, b) => a - b);
  const health = {
    games,
    skipped,
    unfinished: played.filter((game) => !game.finished).length,
    plays: games > 0 ? round1(played.reduce((sum, g) => sum + g.plays, 0) / games) : 0,
    tieRate: rounds > 0 ? played.reduce((sum, g) => sum + g.ties, 0) / rounds : 0,
    opener:
      completed.length > 0
        ? completed.reduce((sum, g) => sum + scoreOf(g.winner, g.opener), 0) /
          completed.length
        : 0,
    swingP99: swings[Math.floor(swings.length * 0.99)] ?? 0,
    swingMax: swings.at(-1) ?? 0,
    rowMax: Math.max(0, ...played.map((game) => game.maxRow)),
  };
  const limits = KESSEN_BALANCE.health;
  const flags: KessenBalanceFlag[] = [];
  if (skipped > 0)
    flags.push({
      rule: "health",
      severity: "warn",
      message: `${skipped} gauntlet games skipped because a deck or leader was unavailable`,
    });
  const add = (broken: boolean, message: string) => {
    if (games > 0 && broken) flags.push({ rule: "health", severity: "break", message });
  };
  add(health.unfinished > 0, `${health.unfinished} gauntlet games never finished`);
  add(
    health.plays < limits.plays[0] || health.plays > limits.plays[1],
    `Matches average ${health.plays} plays (limit ${limits.plays[0]}–${limits.plays[1]})`,
  );
  add(
    health.tieRate > limits.tieRate,
    `${percent(health.tieRate)} of rounds end in a tie (limit ${percent(limits.tieRate)})`,
  );
  add(
    completed.length > 0 &&
      (health.opener < limits.opener[0] || health.opener > limits.opener[1]),
    `The Round 1 opener scores ${percent(health.opener)} (limit ${percent(limits.opener[0])}–${percent(limits.opener[1])})`,
  );
  add(
    health.swingP99 > limits.swingP99,
    `1% of plays swing the board by more than ${health.swingP99} (limit ${limits.swingP99})`,
  );
  add(
    health.swingMax > limits.swingMax,
    `One play swung the board by ${health.swingMax} (limit ${limits.swingMax})`,
  );
  add(
    health.rowMax > limits.rowMax,
    `A row reached ${health.rowMax} power (limit ${limits.rowMax})`,
  );
  return { ...health, flags };
};

const rateOf = (scores: readonly number[]): KessenRate => {
  const games = scores.length;
  const score = games > 0 ? scores.reduce((sum, s) => sum + s, 0) / games : 0;
  const variance =
    games > 1 ? scores.reduce((sum, s) => sum + (s - score) ** 2, 0) / (games - 1) : 0;
  return { score, games, se: games > 0 ? Math.sqrt(variance / games) : 0 };
};

const push = <K>(map: Map<K, number[]>, key: K, value: number) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const round1 = (value: number) => Math.round(10 * value) / 10;
