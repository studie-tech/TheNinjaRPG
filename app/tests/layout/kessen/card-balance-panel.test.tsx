import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  type CardMatchTest,
  useCardBalanceDraft,
} from "@/hooks/kessen/useCardBalanceDraft";
import { CardBalancePanel } from "@/layout/kessen/balance/CardBalancePanel";
import * as Link from "@/layout/Link";
import { kessenReferenceDecks } from "@/libs/kessen/balance";
import { gauntletJobs, percent, summarizeGauntlet } from "@/libs/kessen/balanceSim";
import { runGauntlet } from "@/libs/kessen/balanceSimRunner";
import { kessenCardToCardData } from "@/libs/kessen/catalog";
import type { KessenCard } from "@/libs/kessen/types";
import { cardDataSchema } from "@/validators/itemCard";
import {
  KESSEN_SEED_CATALOG,
  seedCardByName,
} from "../../libs/kessen/fixtures/catalog";

beforeEach(() => {
  vi.spyOn(Link, "default").mockImplementation(({ href, children }) => (
    <a href={String(href)}>{children}</a>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("leaves skipped faction comparisons unavailable without a guideline status", async () => {
  const card: KessenCard = {
    ...seedCardByName("Musashi Ken Swordsman"),
    kind: "LEADER",
    row: null,
    power: 0,
    provision: 0,
    leaderBonus: 12,
  };
  expect(cardDataSchema.safeParse(kessenCardToCardData(card)).success).toBe(true);
  const catalog = KESSEN_SEED_CATALOG.map((entry) =>
    entry.id === card.id ? card : entry,
  );
  const unavailable = await runGauntlet(catalog, { createWorker: null, workers: 1 });
  expect(unavailable.health).toMatchObject({ games: 0, skipped: 960 });
  const view = render(
    <Editor card={card} gauntlet={{ saved: unavailable, draft: unavailable }} />,
  );
  const rows = within(
    view
      .getByText("Faction gauntlet win rate, saved → edited")
      .parentElement!.querySelector<HTMLUListElement>("ul")!,
  ).getAllByRole("listitem");
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(row.textContent).toContain("Unavailable → Unavailable");
    expect(within(row).queryByText("In guidelines")).toBeNull();
  }
});

it("shows faction status only for measured drafts even when the saved rate is unavailable", () => {
  const card = seedCardByName("Musashi Ken Swordsman");
  const decks = kessenReferenceDecks();
  const jobs = gauntletJobs(decks, 1);
  const job = jobs[0]!;
  const unavailable = summarizeGauntlet(decks, jobs, new Map());
  const measured = summarizeGauntlet(
    decks,
    jobs,
    new Map([
      [
        job.id,
        {
          id: job.id,
          finished: true,
          winner: null,
          opener: 0,
          plays: 35,
          rounds: 3,
          ties: 1,
          swings: [3],
          maxRow: 12,
        },
      ],
    ]),
  );
  const view = render(
    <Editor card={card} gauntlet={{ saved: unavailable, draft: measured }} />,
  );
  const comparison = within(
    view
      .getByText("Faction gauntlet win rate, saved → edited")
      .parentElement!.querySelector<HTMLUListElement>("ul")!,
  );
  const rows = comparison.getAllByRole("listitem");
  expect(
    rows.filter((row) => row.textContent?.includes(`Unavailable → ${percent(0.5)}`)),
  ).toHaveLength(2);
  expect(comparison.getAllByText("In guidelines")).toHaveLength(2);
  view.rerender(
    <Editor card={card} gauntlet={{ saved: measured, draft: unavailable }} />,
  );
  expect(
    comparison
      .getAllByRole("listitem")
      .filter((row) => row.textContent?.includes(`${percent(0.5)} → Unavailable`)),
  ).toHaveLength(2);
  expect(comparison.queryByText("In guidelines")).toBeNull();
});

function Editor({
  card,
  gauntlet,
}: {
  card: KessenCard;
  gauntlet: NonNullable<CardMatchTest["gauntlet"]>;
}) {
  const input = { ...card, cardData: kessenCardToCardData(card) };
  const draft = useCardBalanceDraft(input, input, KESSEN_SEED_CATALOG);
  const test: CardMatchTest = {
    status: "done",
    done: 2000,
    total: 2000,
    savedFingerprint: draft.savedFingerprint,
    draftFingerprint: draft.analysis?.draftFingerprint ?? null,
    trial: null,
    gauntlet,
    error: null,
  };
  return <CardBalancePanel draft={draft} test={test} canTest onTest={() => {}} />;
}
