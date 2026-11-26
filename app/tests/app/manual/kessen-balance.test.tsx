import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as Balance from "@/hooks/kessen/useKessenBalance";
import * as Hub from "@/hooks/kessen/useKessenHub";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import { catalogBalance, kessenReferenceDecks } from "@/libs/kessen/balance";
import {
  gauntletJobs,
  type KessenSimOutcome,
  summarizeGauntlet,
} from "@/libs/kessen/balanceSim";
import { runGauntlet } from "@/libs/kessen/balanceSimRunner";
import type { KessenCard } from "@/libs/kessen/types";
import { ManualKessenBalanceScreen } from "@/screens/manual/kessen/balance/ManualKessenBalanceScreen";
import {
  KESSEN_SEED_CATALOG,
  seedCardByName,
} from "../../libs/kessen/fixtures/catalog";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

const IDLE: Balance.KessenSimState = {
  status: "idle",
  stage: null,
  done: 0,
  total: 0,
  gauntlet: null,
  trials: null,
  error: null,
};
let scrollTargets: string[];

beforeEach(() => {
  scrollTargets = [];
  installBrowserGlobals({
    scrollIntoView: function (this: HTMLElement) {
      scrollTargets.push(this.id);
    },
  });
  window.history.replaceState({}, "", "/manual/kessen/balance");
  mockUserContextValue({ data: { role: "USER" } });
  vi.spyOn(ContentBox, "default").mockImplementation(({ children, id }) => (
    <section id={id}>{children}</section>
  ));
  vi.spyOn(Link, "default").mockImplementation(({ children, href, ...props }) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ));
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("shows an initial catalog failure and retries without leaving a settled loading state", () => {
  const refetch = vi.fn();
  const catalog = vi.spyOn(Hub, "useKessenCatalog").mockReturnValue({
    data: undefined,
    isError: true,
    isFetching: false,
    error: new Error("offline"),
    refetch,
  } as never);
  const balance = vi.spyOn(Balance, "useKessenBalance").mockReturnValue({
    engine: null,
    report: null,
    sims: IDLE,
  });
  const view = render(<ManualKessenBalanceScreen />);
  expect(view.getByRole("alert").textContent).toContain("offline");
  expect(view.queryByText("Loading the card catalog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledTimes(1);
  catalog.mockReturnValue({
    data: undefined,
    isError: true,
    isFetching: true,
    error: new Error("offline"),
    refetch,
  } as never);
  view.rerender(<ManualKessenBalanceScreen />);
  expect(view.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(
    true,
  );
  catalog.mockReturnValue({
    data: { cards: KESSEN_SEED_CATALOG },
    isFetching: false,
  } as never);
  balance.mockReturnValue({
    engine: KESSEN_SEED_CATALOG,
    report: catalogBalance(KESSEN_SEED_CATALOG),
    sims: IDLE,
  });
  view.rerender(<ManualKessenBalanceScreen />);
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.queryByText("Loading the card catalog")).toBeNull();
  expect(view.getByText("Cards in guidelines")).toBeTruthy();
});

it("reveals and scrolls to a flagged card after filters hide it, including repeated issue navigation", async () => {
  const card = seedCardByName("Black Maw Acolyte");
  mockReport(
    KESSEN_SEED_CATALOG.map((entry) =>
      entry.id === card.id ? { ...entry, power: 30 } : entry,
    ),
  );
  const view = render(<ManualKessenBalanceScreen />);
  const targetId = `card-${card.id}`;
  const disclosure = view.getByText(/Flagged ·/).parentElement!;
  disclosure.setAttribute("open", "");
  const issue = within(disclosure).getByRole("link", { name: card.name });
  fireEvent.click(view.getByRole("button", { name: "Cards" }));
  const faction = view.getByRole("button", { name: "Shirohana" });
  const search = view.getByRole("searchbox", { name: "Search cards" });
  const sort = view.getByRole("combobox", { name: "Sort" });
  fireEvent.change(sort, { target: { value: "name" } });
  fireEvent.click(faction);
  fireEvent.change(search, { target: { value: "no matching card" } });
  fireEvent.click(view.getByRole("switch", { name: "Flagged only" }));
  expect(document.getElementById(targetId)).toBeNull();
  fireEvent.click(issue);
  expect(document.getElementById(targetId)).toBeTruthy();
  expect(scrollTargets.at(-1)).toBe(targetId);
  expect((search as HTMLInputElement).value).toBe("");
  expect(view.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(
    view.getByRole("switch", { name: "Flagged only" }).getAttribute("aria-checked"),
  ).toBe("false");
  expect((sort as HTMLSelectElement).value).toBe("name");
  await waitFor(() => expect(window.location.hash).toBe(`#${targetId}`));
  fireEvent.click(faction);
  expect(document.getElementById(targetId)).toBeNull();
  const scrollCount = scrollTargets.length;
  fireEvent.click(issue);
  expect(document.getElementById(targetId)).toBeTruthy();
  expect(scrollTargets.length).toBe(scrollCount + 1);
  expect(scrollTargets.at(-1)).toBe(targetId);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

it.each(["cards", "factions", "guidelines", "leaders", "sets", "health"])(
  "preserves the balance report's #%s destination",
  (section) => {
    mockReport(KESSEN_SEED_CATALOG);
    const anchor = `kessen-balance-${section}`;
    window.history.replaceState({}, "", `/manual/kessen/balance#${anchor}`);
    render(<ManualKessenBalanceScreen />);
    expect(document.getElementById(anchor)).toBeTruthy();
    expect(scrollTargets).toEqual([anchor]);
  },
);

it("labels Forbidden curve exclusions with their parity check", () => {
  mockReport(KESSEN_SEED_CATALOG);
  const forbidden = KESSEN_SEED_CATALOG.find(
    (card) =>
      card.variant === "FORBIDDEN" &&
      !card.abilities.some((ability) => ability.k === "infiltrator"),
  )!;
  window.history.replaceState({}, "", `/manual/kessen/balance#card-${forbidden.id}`);
  render(<ManualKessenBalanceScreen />);
  const row = document.getElementById(`card-${forbidden.id}`)!;
  expect(row.textContent).toContain("Not priced (Forbidden parity)");
  expect(row.textContent).toContain("Parity check only");
  expect(row.textContent).not.toContain("Infiltrator");
});

it("reports zero-game factions as unavailable instead of in band", async () => {
  const cards = KESSEN_SEED_CATALOG.filter((card) => card.kind !== "LEADER");
  const gauntlet = await runGauntlet(cards, { createWorker: null, workers: 1 });
  expect(gauntlet.factions.every((entry) => entry.rate.games === 0)).toBe(true);
  mockReport(cards, { ...IDLE, status: "done", gauntlet, trials: {} });
  const view = render(<ManualKessenBalanceScreen />);
  const summary = view.getByText("Factions in band").parentElement!;
  expect(summary.textContent).toContain("0/6 · 6 unavailable");
  expect(within(summary).queryByText("In guidelines")).toBeNull();
  expect(view.getAllByText("Gauntlet win rate unavailable")).toHaveLength(6);
  fireEvent.click(view.getByRole("button", { name: "Match health" }));
  const health = within(document.getElementById("kessen-balance-health")!);
  expect(gauntlet.health).toMatchObject({ games: 0, skipped: 960, unfinished: 0 });
  expect(health.getAllByText("Unavailable")).toHaveLength(6);
  expect(health.queryByText("In guidelines")).toBeNull();
  expect(health.queryByText("Breaks a guideline")).toBeNull();
});

it("keeps observed health metrics when all games are unfinished and leaves the opener unavailable", () => {
  const decks = kessenReferenceDecks();
  const jobs = gauntletJobs(decks, 1);
  const job = jobs[0]!;
  const outcome: KessenSimOutcome = {
    id: job.id,
    finished: false,
    winner: null,
    opener: 0,
    plays: 35,
    rounds: 1,
    ties: 0,
    swings: [3],
    maxRow: 12,
  };
  const gauntlet = summarizeGauntlet(decks, jobs, new Map([[job.id, outcome]]));
  expect(gauntlet.health).toMatchObject({ games: 1, unfinished: 1 });
  mockReport(KESSEN_SEED_CATALOG, { ...IDLE, status: "done", gauntlet, trials: {} });
  const view = render(<ManualKessenBalanceScreen />);
  fireEvent.click(view.getByRole("button", { name: "Match health" }));
  const health = within(document.getElementById("kessen-balance-health")!);
  expect(health.getAllByText("Unavailable")).toHaveLength(1);
  const opener = within(health.getByText("Round 1 opener scores").parentElement!);
  expect(opener.getByText("Unavailable")).toBeTruthy();
  expect(opener.queryByText("In guidelines")).toBeNull();
  expect(opener.queryByText("Breaks a guideline")).toBeNull();
  expect(health.getAllByText("In guidelines")).toHaveLength(4);
  expect(health.getAllByText("Breaks a guideline")).toHaveLength(1);
});

it("shows one section and follows browser history and issue hashes", async () => {
  mockReport(KESSEN_SEED_CATALOG);
  const view = render(<ManualKessenBalanceScreen />);
  expect(view.getByText(/Flagged ·/).parentElement!.hasAttribute("open")).toBe(false);
  expect(document.getElementById("kessen-balance-factions")).toBeTruthy();
  expect(document.getElementById("kessen-balance-cards")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Leaders" }));
  expect(document.getElementById("kessen-balance-leaders")).toBeTruthy();
  expect(document.getElementById("kessen-balance-factions")).toBeNull();
  fireEvent.click(view.getByRole("link", { name: "Read the guidelines" }));
  expect(document.getElementById("kessen-balance-guidelines")).toBeTruthy();
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(window.location.hash).toBe("#kessen-balance-leaders");
  expect(document.getElementById("kessen-balance-leaders")).toBeTruthy();
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(window.location.hash).toBe("");
  expect(document.getElementById("kessen-balance-factions")).toBeTruthy();
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(document.getElementById("kessen-balance-leaders")).toBeTruthy();
  await act(async () => {
    window.history.forward();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(document.getElementById("kessen-balance-guidelines")).toBeTruthy();
  const leader = KESSEN_SEED_CATALOG.find((card) => card.kind === "LEADER")!;
  for (const anchor of [`card-${leader.id}`, `faction-${leader.faction}`]) {
    await act(async () => {
      window.location.hash = anchor;
    });
    await waitFor(() => expect(document.getElementById(anchor)).toBeTruthy());
    expect(scrollTargets.at(-1)).toBe(anchor);
  }
});

it("bounds card rows, resets pages for filters/sort, and reveals a later-page issue", () => {
  const card = seedCardByName("Yuki Onna");
  mockReport(
    KESSEN_SEED_CATALOG.map((entry) =>
      entry.id === card.id ? { ...entry, power: 30 } : entry,
    ),
  );
  const view = render(<ManualKessenBalanceScreen />);
  fireEvent.click(view.getByRole("button", { name: "Cards" }));
  expect(document.querySelectorAll("li[id^='card-']")).toHaveLength(10);
  expect(view.getByText(/Showing 1–10 of/)).toBeTruthy();
  for (const change of [
    () => fireEvent.change(view.getByRole("searchbox"), { target: { value: "a" } }),
    () => fireEvent.click(view.getByRole("button", { name: "Shirohana" })),
    () =>
      fireEvent.change(view.getByRole("combobox", { name: "Sort" }), {
        target: { value: "name" },
      }),
  ]) {
    fireEvent.click(view.getByRole("button", { name: "All" }));
    fireEvent.change(view.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    change();
    expect(view.getByText(/Showing 1–/)).toBeTruthy();
  }
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  fireEvent.click(view.getByRole("switch", { name: "Flagged only" }));
  expect(view.getByText(/Showing 1–/)).toBeTruthy();
  const disclosure = view.getByText(/Flagged ·/).parentElement!;
  disclosure.setAttribute("open", "");
  const issue = within(disclosure).getByRole("link", { name: card.name });
  fireEvent.click(issue);
  expect(document.getElementById(`card-${card.id}`)).toBeTruthy();
  expect(scrollTargets.at(-1)).toBe(`card-${card.id}`);
  expect(view.queryByText(/Showing 1–10 of/)).toBeNull();
  expect(document.querySelectorAll("li[id^='card-']").length).toBeLessThanOrEqual(10);
  fireEvent.click(view.getByRole("button", { name: "Page 1" }));
  expect(document.getElementById(`card-${card.id}`)).toBeNull();
  const scrollCount = scrollTargets.length;
  fireEvent.click(issue);
  expect(document.getElementById(`card-${card.id}`)).toBeTruthy();
  expect(scrollTargets.length).toBe(scrollCount + 1);
});

it("reveals an incoming later-page card hash after the catalog loads", () => {
  const card = seedCardByName("Yuki Onna");
  const catalog = vi
    .spyOn(Hub, "useKessenCatalog")
    .mockReturnValue({ isFetching: true } as never);
  const balance = vi
    .spyOn(Balance, "useKessenBalance")
    .mockReturnValue({ engine: null, report: null, sims: IDLE });
  window.history.replaceState({}, "", `/manual/kessen/balance#card-${card.id}`);
  const view = render(<ManualKessenBalanceScreen />);
  expect(document.getElementById(`card-${card.id}`)).toBeNull();
  catalog.mockReturnValue({ data: { cards: KESSEN_SEED_CATALOG } } as never);
  balance.mockReturnValue({
    engine: KESSEN_SEED_CATALOG,
    report: catalogBalance(KESSEN_SEED_CATALOG),
    sims: IDLE,
  });
  view.rerender(<ManualKessenBalanceScreen />);
  expect(document.getElementById(`card-${card.id}`)).toBeTruthy();
  expect(scrollTargets.at(-1)).toBe(`card-${card.id}`);
  expect(view.queryByText(/Showing 1–10 of/)).toBeNull();
});

it("keeps an incoming card destination visible when completed trials reorder its page", () => {
  const card = seedCardByName("Thorn Ambush Captain");
  const balance = mockReport(KESSEN_SEED_CATALOG);
  const targetId = `card-${card.id}`;
  window.history.replaceState({}, "", `/manual/kessen/balance#${targetId}`);
  const view = render(<ManualKessenBalanceScreen />);
  expect(view.getByText("Showing 71–80 of 94 cards")).toBeTruthy();
  expect(document.getElementById(targetId)).toBeTruthy();
  const scrollCount = scrollTargets.length;
  balance.mockReturnValue({
    engine: KESSEN_SEED_CATALOG,
    report: catalogBalance(KESSEN_SEED_CATALOG),
    sims: completedCardTrial(card),
  });
  view.rerender(<ManualKessenBalanceScreen />);
  expect(view.getByText("Showing 1–10 of 94 cards")).toBeTruthy();
  expect(document.getElementById(targetId)).toBeTruthy();
  expect(window.location.hash).toBe(`#${targetId}`);
  expect(scrollTargets.length).toBe(scrollCount + 1);
  expect(scrollTargets.at(-1)).toBe(targetId);
});

it.each(["page", "search", "faction", "flagged", "sort"])(
  "lets a user %s choice revoke the card destination before trials complete",
  (choice) => {
    const card = seedCardByName("Thorn Ambush Captain");
    const balance = mockReport(KESSEN_SEED_CATALOG);
    const targetId = `card-${card.id}`;
    window.history.replaceState({}, "", `/manual/kessen/balance#${targetId}`);
    const view = render(<ManualKessenBalanceScreen />);
    if (choice === "page") {
      fireEvent.click(view.getByRole("button", { name: "Page 1" }));
      fireEvent.click(view.getByRole("button", { name: "Next" }));
    } else if (choice === "search") {
      fireEvent.change(view.getByRole("searchbox"), { target: { value: "a" } });
    } else if (choice === "faction") {
      fireEvent.click(view.getByRole("button", { name: "Shirohana" }));
    } else if (choice === "flagged") {
      fireEvent.click(view.getByRole("switch", { name: "Flagged only" }));
      fireEvent.click(view.getByRole("switch", { name: "Flagged only" }));
    } else {
      fireEvent.change(view.getByRole("combobox", { name: "Sort" }), {
        target: { value: "name" },
      });
    }
    const scrollCount = scrollTargets.length;
    balance.mockReturnValue({
      engine: KESSEN_SEED_CATALOG,
      report: catalogBalance(KESSEN_SEED_CATALOG),
      sims: completedCardTrial(card, false),
    });
    view.rerender(<ManualKessenBalanceScreen />);
    expect(
      view
        .getByRole("button", { name: choice === "page" ? "Page 2" : "Page 1" })
        .getAttribute("aria-current"),
    ).toBe("page");
    if (choice === "search")
      expect((view.getByRole("searchbox") as HTMLInputElement).value).toBe("a");
    if (choice === "faction")
      expect(
        view.getByRole("button", { name: "Shirohana" }).getAttribute("aria-pressed"),
      ).toBe("true");
    if (choice === "flagged")
      expect(
        view.getByRole("switch", { name: "Flagged only" }).getAttribute("aria-checked"),
      ).toBe("false");
    if (choice === "sort")
      expect(
        (view.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value,
      ).toBe("name");
    expect(window.location.hash).toBe(`#${targetId}`);
    expect(scrollTargets.length).toBe(scrollCount);
  },
);

/** Provide computed catalog data while leaving the report's filters and navigation active. */
const mockReport = (cards: KessenCard[], sims = IDLE) => {
  vi.spyOn(Hub, "useKessenCatalog").mockReturnValue({ data: { cards } } as never);
  return vi.spyOn(Balance, "useKessenBalance").mockReturnValue({
    engine: cards,
    report: catalogBalance(cards),
    sims,
  });
};

/** Complete the pending trial without running matches in the UI test. */
const completedCardTrial = (
  card: KessenCard,
  hasWarning = true,
): Balance.KessenSimState => ({
  ...IDLE,
  status: "done",
  trials: {
    [card.id]: {
      cardId: card.id,
      edge: hasWarning ? 40 : 0,
      se: 0,
      games: 50,
      discarded: 0,
      flags: hasWarning
        ? [{ rule: "trial", severity: "warn", message: "Trial edge exceeds guideline" }]
        : [],
    },
  },
});
