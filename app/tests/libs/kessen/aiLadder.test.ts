import { describe, expect, it } from "bun:test";
import { availableParallelism } from "node:os";
import type { KessenAiTier } from "@/libs/kessen/ai";
import type { LadderJob, LadderTally } from "./aiHelpers";

const PREFIX = "ladder-";
/** Pinned games per pair in the regular suite. */
const QUICK_GAMES = 48;

/**
 * Each tier against the one below on mirrored starter decks. The suite plays a short
 * pinned sample per pair and asserts only that the stronger tier comes out ahead. The
 * calibrated ladder runs with `KESSEN_AI_LADDER=full`: there a threshold sits at least
 * three standard errors (of its game count) below the rate measured on 2,400 fresh
 * seeds, so a pass does not depend on the pinned seeds: Chunin beats Genin about 61%,
 * Jonin beats Chunin about 73% and Kage beats Jonin about 63% of the time.
 */
const FULL = process.env.KESSEN_AI_LADDER === "full";

const LADDER: {
  stronger: KessenAiTier;
  weaker: KessenAiTier;
  games: number;
  threshold: number;
}[] = FULL
  ? [
      { stronger: "CHUNIN", weaker: "GENIN", games: 1200, threshold: 0.56 },
      { stronger: "JONIN", weaker: "CHUNIN", games: 600, threshold: 0.65 },
      { stronger: "KAGE", weaker: "JONIN", games: 400, threshold: 0.55 },
    ]
  : [
      { stronger: "CHUNIN", weaker: "GENIN", games: QUICK_GAMES, threshold: 0.5 },
      { stronger: "JONIN", weaker: "CHUNIN", games: QUICK_GAMES, threshold: 0.5 },
      { stronger: "KAGE", weaker: "JONIN", games: QUICK_GAMES, threshold: 0.5 },
    ];

describe("Kessen AI tier ladder", () => {
  for (const { stronger, weaker, games, threshold } of LADDER) {
    it(
      `${stronger} beats ${weaker} in at least ${Math.round(100 * threshold)}% of ${games} mirror starter games`,
      async () => {
        const tally = await playLadder(stronger, weaker, games);
        const score = (2 * tally.wins + tally.draws) / (2 * games);
        expect({ stronger, weaker, passes: score >= threshold, tally }).toEqual({
          stronger,
          weaker,
          passes: true,
          tally,
        });
      },
      FULL ? 900_000 : 300_000,
    );
  }
});

/**
 * Splits the games across workers. Every game is seeded on its own, so the tally is the
 * same for any worker count.
 */
const playLadder = async (
  a: KessenAiTier,
  b: KessenAiTier,
  games: number,
): Promise<LadderTally> => {
  const workers = Math.max(1, Math.min(8, availableParallelism()));
  const shares: number[][] = Array.from({ length: workers }, () => []);
  for (let game = 0; game < games; game++) shares[game % workers]?.push(game);
  const tallies = await Promise.all(
    shares.map((share) => runWorker({ a, b, prefix: PREFIX, games: share })),
  );
  return tallies.reduce(
    (sum, tally) => ({
      wins: sum.wins + tally.wins,
      losses: sum.losses + tally.losses,
      draws: sum.draws + tally.draws,
    }),
    { wins: 0, losses: 0, draws: 0 },
  );
};

const runWorker = (job: LadderJob) =>
  new Promise<LadderTally>((resolve, reject) => {
    const worker = new Worker(new URL("./aiLadderWorker.ts", import.meta.url).href);
    worker.onmessage = (event: MessageEvent<LadderTally>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(job);
  });
