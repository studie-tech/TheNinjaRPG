import { afterEach, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCardMatchTest } from "@/hooks/kessen/useCardBalanceDraft";
import { kessenReferenceDecks } from "@/libs/kessen/balance";
import { summarizeGauntlet } from "@/libs/kessen/balanceSim";
import * as runner from "@/libs/kessen/balanceSimRunner";
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
    draftKey: JSON.stringify(draftCard),
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
    });
  });
  expect(result.current.test.status).toBe("error");
  expect(result.current.test.error).toBe("Worker failed");
  expect(gauntlet).not.toHaveBeenCalled();
});
