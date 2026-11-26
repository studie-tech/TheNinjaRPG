import { afterEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import {
  useCardBalanceDraft,
  useCardMatchTest,
} from "@/hooks/kessen/useCardBalanceDraft";
import { CardBalancePanel } from "@/layout/kessen/balance/CardBalancePanel";
import * as Link from "@/layout/Link";
import { kessenReferenceDecks } from "@/libs/kessen/balance";
import { summarizeGauntlet } from "@/libs/kessen/balanceSim";
import * as runner from "@/libs/kessen/balanceSimRunner";
import { catalogFingerprint, kessenCardToCardData } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";
import { KESSEN_SEED_CATALOG, seedCardByName } from "../libs/kessen/fixtures/catalog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
