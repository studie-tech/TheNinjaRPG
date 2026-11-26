"use client";

import { useEffect, useMemo, useState } from "react";
import { catalogBalance, type KessenCatalogBalance } from "@/libs/kessen/balance";
import {
  KESSEN_BALANCE_SIM,
  type KessenGauntletSummary,
  type KessenTrialSummary,
} from "@/libs/kessen/balanceSim";
import {
  balanceWorkerCount,
  balanceWorkerFactory,
} from "@/libs/kessen/balanceSimClient";
import { runGauntlet, runTrials } from "@/libs/kessen/balanceSimRunner";
import { snapshotCatalog } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";

/** Simulated metrics of a catalog as they arrive: the gauntlet first, then the trials. */
export interface KessenSimState {
  status: "idle" | "running" | "done" | "error";
  stage: "gauntlet" | "trials" | null;
  done: number;
  total: number;
  gauntlet: KessenGauntletSummary | null;
  trials: Record<string, KessenTrialSummary> | null;
  error: string | null;
}

const IDLE: KessenSimState = {
  status: "idle",
  stage: null,
  done: 0,
  total: 0,
  gauntlet: null,
  trials: null,
  error: null,
};

/**
 * The balance report of a catalog and its simulated metrics. The report is immediate;
 * the simulations run in workers and are kept per catalog fingerprint in this browser,
 * since the same catalog always yields the same numbers.
 */
export const useKessenBalance = (cards: readonly KessenCard[] | undefined) => {
  const engine = useMemo(() => (cards ? snapshotCatalog(cards) : null), [cards]);
  const report = useMemo(() => (engine ? catalogBalance(engine) : null), [engine]);
  const sims = useKessenSims(engine, report);
  return { engine, report, sims };
};

/** Runs the gauntlet and the match trials of `engine` once per fingerprint. */
const useKessenSims = (
  engine: KessenCard[] | null,
  report: KessenCatalogBalance | null,
): KessenSimState => {
  const fingerprint = report?.fingerprint ?? null;
  const [state, setState] = useState<{ key: string | null; sims: KessenSimState }>({
    key: null,
    sims: IDLE,
  });
  useEffect(() => {
    if (!engine || !fingerprint) return;
    const key = cacheKey(fingerprint);
    const cached = readCache(key);
    if (cached) {
      setState({ key: fingerprint, sims: cached });
      return;
    }
    const controller = new AbortController();
    const options = {
      createWorker: balanceWorkerFactory(),
      workers: balanceWorkerCount(),
      signal: controller.signal,
    };
    const update = (patch: Partial<KessenSimState>) =>
      setState((previous) => ({
        key: fingerprint,
        sims: { ...(previous.key === fingerprint ? previous.sims : IDLE), ...patch },
      }));
    const run = async () => {
      update({ status: "running", stage: "gauntlet", done: 0, total: 0 });
      const gauntlet = await runGauntlet(engine, {
        ...options,
        onProgress: (done, total) => update({ done, total }),
      });
      update({ gauntlet, stage: "trials", done: 0, total: 0 });
      const trials = await runTrials(engine, {
        ...options,
        onProgress: (done, total) => update({ done, total }),
      });
      const finished: KessenSimState = {
        ...IDLE,
        status: "done",
        gauntlet,
        trials,
      };
      writeCache(key, finished);
      update(finished);
    };
    run().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      update({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => controller.abort();
  }, [engine, fingerprint]);
  return state.key === fingerprint ? state.sims : IDLE;
};

const cacheKey = (fingerprint: string) =>
  `kessenBalance:v${KESSEN_BALANCE_SIM.version}:${fingerprint}`;

/** A finished sweep of this browser, or null; storage may be unavailable. */
const readCache = (key: string): KessenSimState | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KessenSimState;
    return parsed.status === "done" && parsed.gauntlet && parsed.trials ? parsed : null;
  } catch {
    return null;
  }
};

/** Keeps only the latest sweep, so old catalogs do not pile up. */
const writeCache = (key: string, sims: KessenSimState) => {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const stored = window.localStorage.key(i);
      if (stored?.startsWith("kessenBalance:") && stored !== key) {
        window.localStorage.removeItem(stored);
      }
    }
    window.localStorage.setItem(key, JSON.stringify(sims));
  } catch {
    // Storage is a convenience; the next visit simulates again.
  }
};
