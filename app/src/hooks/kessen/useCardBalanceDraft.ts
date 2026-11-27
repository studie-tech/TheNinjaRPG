"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemRarity } from "@/drizzle/constants";
import {
  cardBalance,
  cardBalanceChanges,
  catalogBalance,
  catalogBalanceDiff,
} from "@/libs/kessen/balance";
import {
  isTrialSubject,
  KESSEN_BALANCE_SIM,
  type KessenGauntletSummary,
  type KessenTrialSummary,
} from "@/libs/kessen/balanceSim";
import {
  balanceWorkerCount,
  balanceWorkerFactory,
} from "@/libs/kessen/balanceSimClient";
import { runGauntlet, runTrials } from "@/libs/kessen/balanceSimRunner";
import { itemToKessenCard, snapshotCatalog } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";

/** The card as the editor holds it. */
export interface CardBalanceInput {
  id: string;
  name: string;
  rarity: ItemRarity;
  cardData: unknown;
}

/**
 * A card edit against the balance guidelines: the draft's own checks, the change-log
 * lines saving it records, and the flags it raises or clears on other content. The saved
 * side is the row the editor loaded, inside the public catalog.
 */
export const useCardBalanceDraft = (
  saved: CardBalanceInput,
  draft: CardBalanceInput,
  cards: readonly KessenCard[] | undefined,
) => {
  const savedCard = useMemo(
    () =>
      itemToKessenCard({
        id: saved.id,
        name: saved.name,
        rarity: saved.rarity,
        cardData: saved.cardData,
      }),
    [saved.id, saved.name, saved.rarity, saved.cardData],
  );
  const draftCard = useMemo(
    () =>
      itemToKessenCard({
        id: draft.id,
        name: draft.name,
        rarity: draft.rarity,
        cardData: draft.cardData,
      }),
    [draft.id, draft.name, draft.rarity, draft.cardData],
  );
  const savedCatalog = useMemo(
    () => (cards ? withCard(snapshotCatalog(cards), saved.id, savedCard) : null),
    [cards, saved.id, savedCard],
  );
  const savedReport = useMemo(
    () => (savedCatalog ? catalogBalance(savedCatalog) : null),
    [savedCatalog],
  );
  const analysis = useMemo(() => {
    if (!draftCard || !savedCatalog || !savedReport) return null;
    const draftCatalog = withCard(savedCatalog, draft.id, draftCard);
    const draftReport = catalogBalance(draftCatalog);
    return {
      draftCatalog,
      draftFingerprint: draftReport.fingerprint,
      entry: cardBalance(draftCard, draftCatalog),
      changes: cardBalanceChanges(savedCard, draftCard),
      elsewhere: catalogBalanceDiff(savedReport, draftReport, draft.id),
    };
  }, [draftCard, savedCard, savedCatalog, savedReport, draft.id]);
  return {
    savedCard,
    draftCard,
    savedCatalog,
    savedFingerprint: savedReport?.fingerprint ?? null,
    analysis,
  };
};

/** Saved and draft numbers of one "Test in matches" run. */
export interface CardMatchTest {
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  /** Both simulated catalogs; a change on either side makes the result stale. */
  savedFingerprint: string | null;
  draftFingerprint: string | null;
  trial: { saved: KessenTrialSummary | null; draft: KessenTrialSummary | null } | null;
  gauntlet: { saved: KessenGauntletSummary; draft: KessenGauntletSummary } | null;
  error: string | null;
}

/** Editor trials use finer pairing than the page's sweep of every card. */
const TRIAL_GAMES = KESSEN_BALANCE_SIM.editorTrialGames;

const IDLE_TEST: CardMatchTest = {
  status: "idle",
  done: 0,
  total: 0,
  savedFingerprint: null,
  draftFingerprint: null,
  trial: null,
  gauntlet: null,
  error: null,
};

/**
 * Plays a card's match trial and the reference-deck gauntlet on both catalogs with the
 * same seeds. Cards outside the decks can affect the AI's catalog-based threat estimates.
 */
export const useCardMatchTest = () => {
  const [test, setTest] = useState<CardMatchTest>(IDLE_TEST);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async (input: {
    savedCatalog: KessenCard[];
    draftCatalog: KessenCard[];
    savedCard: KessenCard | null;
    draftCard: KessenCard;
    savedFingerprint: string;
    draftFingerprint: string;
  }) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const { savedCatalog, draftCatalog, savedCard, draftCard } = input;
    // Equal full catalogs also have the same eligible leader cohort and AI estimates.
    const sameCatalog = input.savedFingerprint === input.draftFingerprint;
    const phases = [
      isTrialSubject(draftCard),
      !sameCatalog && !!savedCard && isTrialSubject(savedCard),
      true,
      !sameCatalog,
    ];
    const totalPhases = phases.filter(Boolean).length;
    let finishedPhases = 0;
    const options = {
      createWorker: balanceWorkerFactory(),
      workers: balanceWorkerCount(),
      signal: current.signal,
      onProgress: (done: number, total: number) => {
        if (current.signal.aborted) return;
        setTest((previous) => ({
          ...previous,
          done: finishedPhases * 1000 + Math.round((1000 * done) / Math.max(1, total)),
          total: totalPhases * 1000,
        }));
      },
    };
    const next = <T>(value: T) => {
      finishedPhases += 1;
      return value;
    };
    setTest({
      ...IDLE_TEST,
      status: "running",
      total: totalPhases * 1000,
      savedFingerprint: input.savedFingerprint,
      draftFingerprint: input.draftFingerprint,
    });
    try {
      let draftTrial: KessenTrialSummary | null = null;
      if (isTrialSubject(draftCard)) {
        const trials = await runTrials(
          draftCatalog,
          options,
          editorTrialSubjects(draftCatalog, draftCard),
          TRIAL_GAMES,
        );
        if (current.signal.aborted) return;
        const trial = trials[draftCard.id];
        if (trial) draftTrial = trial;
        next(null);
      }
      let savedTrial: KessenTrialSummary | null = null;
      if (sameCatalog) {
        savedTrial = draftTrial;
      } else if (savedCard) {
        if (isTrialSubject(savedCard)) {
          const trials = await runTrials(
            savedCatalog,
            options,
            editorTrialSubjects(savedCatalog, savedCard),
            TRIAL_GAMES,
          );
          if (current.signal.aborted) return;
          const trial = trials[savedCard.id];
          if (trial) savedTrial = trial;
          next(null);
        }
      }
      const savedGauntlet = next(await runGauntlet(savedCatalog, options));
      if (current.signal.aborted) return;
      let draftGauntlet = savedGauntlet;
      if (!sameCatalog) {
        draftGauntlet = next(await runGauntlet(draftCatalog, options));
      }
      if (current.signal.aborted) return;
      setTest((previous) => ({
        ...previous,
        status: "done",
        done: previous.total,
        trial: { saved: savedTrial, draft: draftTrial },
        gauntlet: { saved: savedGauntlet, draft: draftGauntlet },
      }));
    } catch (error) {
      if (current.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setTest((previous) => ({
        ...previous,
        status: "error",
        error: message,
      }));
    }
  };
  return { test, run };
};

/** The catalog with `card` in place of the entry `id` (added when new, removed when null). */
const withCard = (
  catalog: readonly KessenCard[],
  id: string,
  card: KessenCard | null,
) => {
  const rest = catalog.filter((entry) => entry.id !== id);
  return card ? [...rest, card] : rest;
};

/** Leader warnings compare the edited leader with every eligible leader in its catalog. */
const editorTrialSubjects = (catalog: readonly KessenCard[], card: KessenCard) =>
  card.kind === "LEADER"
    ? catalog.filter((entry) => entry.kind === "LEADER" && isTrialSubject(entry))
    : [card];
