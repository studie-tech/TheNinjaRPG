import { afterEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import {
  useCardBalanceDraft,
  useCardMatchTest,
} from "@/hooks/kessen/useCardBalanceDraft";
import { CardBalancePanel } from "@/layout/kessen/balance/CardBalancePanel";
import * as Link from "@/layout/Link";
import { kessenReferenceDecks } from "@/libs/kessen/balance";
import {
  isTrialSubject,
  KESSEN_BALANCE_SIM,
  type KessenTrialSummary,
  summarizeGauntlet,
} from "@/libs/kessen/balanceSim";
import * as runner from "@/libs/kessen/balanceSimRunner";
import { catalogFingerprint, kessenCardToCardData } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";
import { cardDataSchema } from "@/validators/itemCard";
import { KESSEN_SEED_CATALOG, seedCardByName } from "../libs/kessen/fixtures/catalog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["Cryverin", "Colossus", "Ravena Bloodsilk", "Divine Shishi"])(
  "shares identical catalog simulations for %s",
  async (name) => {
    const card = seedCardByName(name);
    const catalog = KESSEN_SEED_CATALOG.map((entry) => ({ ...entry }));
    const trial: KessenTrialSummary = Object.freeze({
      cardId: card.id,
      edge: 0,
      se: 0,
      games: KESSEN_BALANCE_SIM.editorTrialGames,
      discarded: 0,
      flags: [],
    });
    const trials = vi
      .spyOn(runner, "runTrials")
      .mockResolvedValue({ [card.id]: trial });
    const summary = Object.freeze(
      summarizeGauntlet(kessenReferenceDecks(), [], new Map()),
    );
    const gauntlet = vi.spyOn(runner, "runGauntlet").mockResolvedValue(summary);
    const fingerprint = catalogFingerprint(catalog);
    const { result } = renderHook(useCardMatchTest);
    await act(async () => {
      await result.current.run({
        savedCatalog: KESSEN_SEED_CATALOG,
        draftCatalog: catalog,
        savedCard: card,
        draftCard: { ...card },
        savedFingerprint: fingerprint,
        draftFingerprint: fingerprint,
      });
    });
    const hasTrial = isTrialSubject(card);
    expect(trials).toHaveBeenCalledTimes(hasTrial ? 1 : 0);
    if (hasTrial) {
      expect(trials.mock.calls[0]?.[0]).toBe(catalog);
      expect(trials.mock.calls[0]?.slice(2)).toEqual([
        card.kind === "LEADER"
          ? catalog.filter((entry) => entry.kind === "LEADER" && isTrialSubject(entry))
          : [card],
        KESSEN_BALANCE_SIM.editorTrialGames,
      ]);
    }
    expect(gauntlet).toHaveBeenCalledTimes(1);
    expect(result.current.test).toMatchObject({
      status: "done",
      done: hasTrial ? 2000 : 1000,
      total: hasTrial ? 2000 : 1000,
      trial: { saved: hasTrial ? trial : null, draft: hasTrial ? trial : null },
      gauntlet: { saved: summary, draft: summary },
      error: null,
    });
    expect(result.current.test.gauntlet?.saved).toBe(summary);
    expect(result.current.test.gauntlet?.draft).toBe(summary);
    expect(result.current.test.trial?.saved).toBe(hasTrial ? trial : null);
    expect(result.current.test.trial?.draft).toBe(hasTrial ? trial : null);
  },
);

it("stops a superseded comparison before starting its next phase", async () => {
  let finishTrial!: (value: Record<string, KessenTrialSummary>) => void;
  const pending = new Promise<Record<string, KessenTrialSummary>>((resolve) => {
    finishTrial = resolve;
  });
  const trials = vi
    .spyOn(runner, "runTrials")
    .mockReturnValueOnce(pending)
    .mockResolvedValue({});
  const gauntlet = vi
    .spyOn(runner, "runGauntlet")
    .mockResolvedValue(summarizeGauntlet(kessenReferenceDecks(), [], new Map()));
  const card = seedCardByName("Colossus");
  const input = {
    savedCatalog: KESSEN_SEED_CATALOG,
    draftCatalog: KESSEN_SEED_CATALOG,
    savedCard: card,
    draftCard: card,
    savedFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
    draftFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
  };
  const { result } = renderHook(useCardMatchTest);
  let first!: Promise<void>;
  act(() => {
    first = result.current.run(input);
  });
  expect(result.current.test).toMatchObject({ status: "running", total: 2000 });
  await act(async () => {
    await result.current.run(input);
  });
  const completed = result.current.test;
  await act(async () => {
    trials.mock.calls[0]?.[1].onProgress?.(1, 1);
    finishTrial({});
    await first;
  });
  expect(trials.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  expect(gauntlet).toHaveBeenCalledTimes(1);
  expect(result.current.test).toBe(completed);
  expect(completed.status).toBe("done");
});

it("compares both gauntlets for a card outside every reference deck", async () => {
  const savedCard = seedCardByName("Colossus");
  const draftCard = { ...savedCard, power: 20 };
  const draftCatalog = KESSEN_SEED_CATALOG.map((card) =>
    card.id === draftCard.id ? draftCard : card,
  );
  const decks = kessenReferenceDecks();
  expect(
    decks.some(
      (deck) =>
        deck.list.leaderId === savedCard.id ||
        deck.list.cards.some((entry) => entry.itemId === savedCard.id),
    ),
  ).toBe(false);
  const savedGauntlet = summarizeGauntlet(decks, [], new Map());
  const draftGauntlet = {
    ...savedGauntlet,
    health: { ...savedGauntlet.health, plays: 30 },
  };
  const gauntlet = vi
    .spyOn(runner, "runGauntlet")
    .mockResolvedValueOnce(savedGauntlet)
    .mockResolvedValueOnce(draftGauntlet);
  const trials = vi.spyOn(runner, "runTrials").mockResolvedValue({});
  const { result } = renderHook(useCardMatchTest);
  await act(async () => {
    await result.current.run({
      savedCatalog: KESSEN_SEED_CATALOG,
      draftCatalog,
      savedCard,
      draftCard,
      savedFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
      draftFingerprint: catalogFingerprint(draftCatalog),
    });
  });
  expect(gauntlet).toHaveBeenCalledTimes(2);
  expect(gauntlet.mock.calls[0]?.[0]).toBe(KESSEN_SEED_CATALOG);
  expect(gauntlet.mock.calls[1]?.[0]).toBe(draftCatalog);
  expect(trials).toHaveBeenCalledTimes(2);
  expect(trials.mock.calls[0]?.slice(2)).toEqual([
    [draftCard],
    KESSEN_BALANCE_SIM.editorTrialGames,
  ]);
  expect(trials.mock.calls[1]?.slice(2)).toEqual([
    [savedCard],
    KESSEN_BALANCE_SIM.editorTrialGames,
  ]);
  expect(result.current.test).toMatchObject({
    status: "done",
    done: 4000,
    total: 4000,
    savedFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
    draftFingerprint: catalogFingerprint(draftCatalog),
    trial: { saved: null, draft: null },
    gauntlet: { saved: savedGauntlet, draft: draftGauntlet },
    error: null,
  });
});

it("compares saved and draft leaders with their own full cohort at editor precision", async () => {
  const savedCard = seedCardByName("Ravena Bloodsilk");
  const draftCard: KessenCard = { ...savedCard, abilities: [{ k: "draw", x: 20 }] };
  expect(cardDataSchema.safeParse(kessenCardToCardData(draftCard)).success).toBe(true);
  const draftCatalog = KESSEN_SEED_CATALOG.map((card) =>
    card.id === draftCard.id ? draftCard : card,
  );
  const savedTrial: KessenTrialSummary = {
    cardId: savedCard.id,
    edge: 0,
    se: 0,
    games: KESSEN_BALANCE_SIM.editorTrialGames,
    discarded: 0,
    flags: [],
  };
  const draftTrial: KessenTrialSummary = {
    ...savedTrial,
    edge: 80,
    flags: [{ rule: "leaderTrial", severity: "warn", message: "Draft cohort warning" }],
  };
  const trials = vi
    .spyOn(runner, "runTrials")
    .mockResolvedValueOnce({ [draftCard.id]: draftTrial })
    .mockResolvedValueOnce({ [savedCard.id]: savedTrial });
  vi.spyOn(runner, "runGauntlet").mockResolvedValue(
    summarizeGauntlet(kessenReferenceDecks(), [], new Map()),
  );
  const { result } = renderHook(useCardMatchTest);
  await act(async () => {
    await result.current.run({
      savedCatalog: KESSEN_SEED_CATALOG,
      draftCatalog,
      savedCard,
      draftCard,
      savedFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
      draftFingerprint: catalogFingerprint(draftCatalog),
    });
  });
  expect(trials).toHaveBeenCalledTimes(2);
  for (const [call, catalog] of [
    [trials.mock.calls[0], draftCatalog],
    [trials.mock.calls[1], KESSEN_SEED_CATALOG],
  ] as const) {
    expect(call?.[0]).toBe(catalog);
    expect(call?.slice(2)).toEqual([
      catalog.filter((card) => card.kind === "LEADER" && isTrialSubject(card)),
      KESSEN_BALANCE_SIM.editorTrialGames,
    ]);
  }
  expect(result.current.test).toMatchObject({
    status: "done",
    done: 4000,
    total: 4000,
  });
  const { saved, draft } = result.current.test.trial!;
  expect(saved).toBe(savedTrial);
  expect(draft).toBe(draftTrial);
});

it("reports simulation failures and clears the running state", async () => {
  vi.spyOn(runner, "runTrials").mockRejectedValue(new Error("Worker failed"));
  const gauntlet = vi.spyOn(runner, "runGauntlet");
  const card = seedCardByName("Colossus");
  const { result } = renderHook(useCardMatchTest);
  await act(async () => {
    await result.current.run({
      savedCatalog: KESSEN_SEED_CATALOG,
      draftCatalog: KESSEN_SEED_CATALOG,
      savedCard: card,
      draftCard: card,
      savedFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
      draftFingerprint: catalogFingerprint(KESSEN_SEED_CATALOG),
    });
  });
  expect(result.current.test.status).toBe("error");
  expect(result.current.test.error).toBe("Worker failed");
  expect(gauntlet).not.toHaveBeenCalled();
});

it("marks a completed comparison stale when saving changes the baseline or another catalog card changes", async () => {
  vi.spyOn(Link, "default").mockImplementation(({ href, children }) => (
    <a href={String(href)}>{children}</a>
  ));
  vi.spyOn(runner, "runTrials").mockResolvedValue({});
  vi.spyOn(runner, "runGauntlet").mockResolvedValue(
    summarizeGauntlet(kessenReferenceDecks(), [], new Map()),
  );
  const saved = { ...seedCardByName("Colossus"), power: 4 };
  const edited = { ...saved, power: 9 };
  const input = (card: KessenCard) => ({
    id: card.id,
    name: card.name,
    rarity: card.rarity,
    cardData: kessenCardToCardData(card),
  });
  function Editor({ baseline, cards }: { baseline: KessenCard; cards: KessenCard[] }) {
    const draft = useCardBalanceDraft(input(baseline), input(edited), cards);
    const { test, run } = useCardMatchTest();
    return (
      <CardBalancePanel
        draft={draft}
        test={test}
        canTest
        onTest={() => {
          const { savedCatalog, savedCard, draftCard, savedFingerprint, analysis } =
            draft;
          if (!savedCatalog || !draftCard || !savedFingerprint || !analysis) return;
          void run({
            savedCatalog,
            savedCard,
            draftCard,
            draftCatalog: analysis.draftCatalog,
            savedFingerprint,
            draftFingerprint: analysis.draftFingerprint,
          });
        }}
      />
    );
  }
  const view = render(<Editor baseline={saved} cards={KESSEN_SEED_CATALOG} />);
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Test in matches" }));
  });
  const staleMessage = /catalog changed since this test/;
  expect(view.queryByText(staleMessage)).toBeNull();
  const savedCatalog = KESSEN_SEED_CATALOG.map((card) =>
    card.id === edited.id ? edited : card,
  );
  view.rerender(<Editor baseline={edited} cards={savedCatalog} />);
  expect(view.getByText(staleMessage)).toBeTruthy();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Test again" }));
  });
  expect(view.queryByText(staleMessage)).toBeNull();
  view.rerender(
    <Editor
      baseline={edited}
      cards={savedCatalog.map((card) =>
        card.id === edited.id ? card : { ...card, power: card.power + 1 },
      )}
    />,
  );
  expect(view.getByText(staleMessage)).toBeTruthy();
});
