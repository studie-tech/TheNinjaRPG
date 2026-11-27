/**
 * Plays balance simulation jobs on a pool of workers. Every job is seeded on its own, so
 * the outcomes are the same for any worker count, batch size or completion order.
 */
import { kessenReferenceDecks } from "./balance";
import {
  gauntletJobs,
  isTrialSubject,
  KESSEN_BALANCE_SIM,
  type KessenGauntletSummary,
  type KessenSimJob,
  type KessenSimOutcome,
  type KessenTrialSummary,
  leaderSpreadFlags,
  playSimGame,
  summarizeGauntlet,
  summarizeTrial,
  trialCatalog,
  trialPairs,
} from "./balanceSim";
import { matchInputProblem } from "./engine";
import type { KessenCard } from "./types";

export type KessenSimRequest =
  | { type: "init"; cards: KessenCard[]; pool: KessenCard[] }
  | { type: "run"; batch: number; jobs: KessenSimJob[] };

export type KessenSimReply =
  | { type: "done"; batch: number; outcomes: KessenSimOutcome[] }
  | { type: "error"; batch: number; message: string };

/** The parts of a `Worker` the runner uses. */
export interface KessenSimWorker {
  postMessage: (message: KessenSimRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<KessenSimReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface KessenSimRun {
  cards: readonly KessenCard[];
  /** The public catalog the AI reads; defaults to `cards`. */
  pool?: readonly KessenCard[];
  jobs: readonly KessenSimJob[];
  /** Called after every batch with the jobs played so far. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Jobs a worker plays per message: small enough for smooth progress. */
const BATCH = 12;

/** Answers runner messages; the worker entry and in-process runs share it. */
export const createSimHandler = () => {
  let cards: KessenCard[] = [];
  let pool: KessenCard[] = [];
  return (request: KessenSimRequest): KessenSimReply | null => {
    if (request.type === "init") {
      cards = request.cards;
      pool = request.pool;
      return null;
    }
    try {
      return {
        type: "done",
        batch: request.batch,
        outcomes: request.jobs.map((job) => playSimGame(job, cards, pool)),
      };
    } catch (error) {
      return {
        type: "error",
        batch: request.batch,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
};

/**
 * Plays `jobs` (each id once) on `workers` workers from `createWorker`, or in this thread
 * between macrotasks when `createWorker` is null.
 */
export const runKessenSims = async (
  run: KessenSimRun,
  createWorker: (() => KessenSimWorker) | null,
  workers = 1,
): Promise<Map<string, KessenSimOutcome>> => {
  if (run.signal?.aborted) throw abortError();
  const unique = [...new Map(run.jobs.map((job) => [job.id, job])).values()];
  const batches: KessenSimJob[][] = [];
  for (let i = 0; i < unique.length; i += BATCH)
    batches.push(unique.slice(i, i + BATCH));
  const outcomes = new Map<string, KessenSimOutcome>();
  const total = unique.length;
  const record = (played: readonly KessenSimOutcome[]) => {
    for (const outcome of played) outcomes.set(outcome.id, outcome);
    run.onProgress?.(outcomes.size, total);
  };
  const cards = [...run.cards];
  const pool = [...(run.pool ?? run.cards)];
  if (!createWorker) {
    const handle = createSimHandler();
    handle({ type: "init", cards, pool });
    for (const [batch, jobs] of batches.entries()) {
      if (run.signal?.aborted) throw abortError();
      const reply = handle({ type: "run", batch, jobs });
      if (reply?.type === "error") throw new Error(reply.message);
      if (reply?.type === "done") record(reply.outcomes);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return outcomes;
  }
  let next = 0;
  const team: KessenSimWorker[] = [];
  try {
    for (let i = 0; i < Math.max(1, Math.min(workers, batches.length)); i++) {
      team.push(createWorker());
    }
    await new Promise<void>((resolve, reject) => {
      let running = 0;
      const onAbort = () => reject(abortError());
      run.signal?.addEventListener("abort", onAbort, { once: true });
      const feed = (worker: KessenSimWorker) => {
        if (run.signal?.aborted) return;
        const batch = next++;
        const jobs = batches[batch];
        if (!jobs) {
          if (running === 0) {
            run.signal?.removeEventListener("abort", onAbort);
            resolve();
          }
          return;
        }
        running += 1;
        worker.postMessage({ type: "run", batch, jobs });
      };
      for (const worker of team) {
        worker.onmessage = ({ data }) => {
          running -= 1;
          if (data.type === "error") {
            reject(new Error(data.message));
            return;
          }
          record(data.outcomes);
          feed(worker);
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ type: "init", cards, pool });
        feed(worker);
      }
      if (batches.length === 0) resolve();
    });
  } finally {
    for (const worker of team) worker.terminate();
  }
  return outcomes;
};

/** Where to run a sweep and how to report on it. */
export interface KessenSweepOptions {
  createWorker: (() => KessenSimWorker) | null;
  workers: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Plays available reference-deck matchups; skipped setups remain visible in the summary. */
export const runGauntlet = async (
  catalog: readonly KessenCard[],
  options: KessenSweepOptions,
): Promise<KessenGauntletSummary> => {
  const decks = kessenReferenceDecks();
  const jobs = gauntletJobs(decks);
  const cards = [...catalog];
  const library = new Map(cards.map((card) => [card.id, card]));
  const outcomes = await runKessenSims(
    {
      cards,
      jobs: jobs.filter((job) => !matchInputProblem({ ...job, cards }, library)),
      onProgress: options.onProgress,
      signal: options.signal,
    },
    options.createWorker,
    options.workers,
  );
  return summarizeGauntlet(decks, jobs, outcomes);
};

/**
 * Plays the match trials of `subjects` (by default every trial subject of `catalog`) at
 * `games` pairs each, skipping pairs with an unavailable setup and reporting their count.
 * Includes the leader spread flags of the leaders among them.
 */
export const runTrials = async (
  catalog: readonly KessenCard[],
  options: KessenSweepOptions,
  subjects: readonly KessenCard[] = catalog.filter(isTrialSubject),
  games: number = KESSEN_BALANCE_SIM.trialGames,
): Promise<Record<string, KessenTrialSummary>> => {
  const pairs = subjects.map((card) => ({ card, pairs: trialPairs(card, games) }));
  const cards = trialCatalog(catalog);
  const library = new Map(cards.map((card) => [card.id, card]));
  const outcomes = await runKessenSims(
    {
      cards,
      pool: catalog,
      jobs: pairs.flatMap((entry) =>
        entry.pairs
          .filter(
            (pair) =>
              !matchInputProblem({ ...pair.subject, cards }, library) &&
              !matchInputProblem({ ...pair.reference, cards }, library),
          )
          .flatMap((pair) => [pair.subject, pair.reference]),
      ),
      onProgress: options.onProgress,
      signal: options.signal,
    },
    options.createWorker,
    options.workers,
  );
  const summaries = pairs.map(({ card, pairs: list }) => ({
    card,
    trial: summarizeTrial(card, list, outcomes),
  }));
  const spread = leaderSpreadFlags(
    summaries.filter((entry) => entry.card.kind === "LEADER"),
  );
  return Object.fromEntries(
    summaries.map(({ card, trial }) => [
      card.id,
      { ...trial, flags: [...trial.flags, ...(spread.get(card.id) ?? [])] },
    ]),
  );
};

const abortError = () => new DOMException("Simulation stopped", "AbortError");
