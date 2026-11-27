import type { KessenSimWorker } from "./balanceSimRunner";

/**
 * A browser worker for balance simulations, or null where none can run; the runner then
 * plays in this thread between macrotasks.
 */
export const balanceWorkerFactory = (): (() => KessenSimWorker) | null =>
  typeof window === "undefined" ||
  typeof Worker === "undefined" ||
  process.env.NODE_ENV === "test"
    ? null
    : () =>
        new Worker(new URL("./balanceSim.worker.ts", import.meta.url), {
          type: "module",
          name: "kessen-balance",
        }) as unknown as KessenSimWorker;

/** Workers to run at once: every core but one for the page, at most eight. */
export const balanceWorkerCount = () =>
  typeof navigator === "undefined"
    ? 1
    : Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
