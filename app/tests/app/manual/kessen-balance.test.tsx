import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import * as Balance from "@/hooks/kessen/useKessenBalance";
import * as Hub from "@/hooks/kessen/useKessenHub";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import { catalogBalance } from "@/libs/kessen/balance";
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
  const issue = within(
    view.getByRole("heading", { name: "Flagged" }).parentElement!,
  ).getByRole("link", { name: card.name });
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

it.each(["cards", "factions"])(
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
  render(<ManualKessenBalanceScreen />);
  const forbidden = KESSEN_SEED_CATALOG.find(
    (card) =>
      card.variant === "FORBIDDEN" &&
      !card.abilities.some((ability) => ability.k === "infiltrator"),
  )!;
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
});

/** Provide computed catalog data while leaving the report's filters and navigation active. */
const mockReport = (cards: KessenCard[], sims = IDLE) => {
  vi.spyOn(Hub, "useKessenCatalog").mockReturnValue({ data: { cards } } as never);
  vi.spyOn(Balance, "useKessenBalance").mockReturnValue({
    engine: cards,
    report: catalogBalance(cards),
    sims,
  });
};
