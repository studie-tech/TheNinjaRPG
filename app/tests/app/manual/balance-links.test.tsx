import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import ManualBalance from "@/app/[shell]/manual/balance/page";
import ManualBackupPage from "@/app/[shell]/manual/content_backups/page";
import * as BalanceFiltering from "@/layout/BalanceFiltering";
import * as BalanceOverview from "@/layout/BalanceOverview";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import * as UserContext from "@/utils/UserContext";
import { mockUserContextValue } from "../../setup/userContext";

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("links each balance data source from its content row and column", () => {
  const links = captureLinks();
  vi.spyOn(BalanceOverview, "BalanceOverview").mockImplementation(() => <></>);
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualBalance />
    </AppRouterContext.Provider>,
  );
  const rows = view.getAllByRole("row").slice(1);
  const cells = rows.map((row) =>
    within(row)
      .getAllByRole("cell")
      .map((cell) => {
        const link = cell.querySelector("a");
        return link ? link.getAttribute("href") : cell.textContent;
      }),
  );
  expect(cells).toEqual([
    [
      "Bloodlines",
      "/manual/bloodline/balance#Usage",
      "/manual/bloodline/balance#Power",
      "/manual/bloodline/completeness#Incomplete",
      "/manual/bloodline/completeness#Diversity",
      "",
    ],
    [
      "Jutsus",
      "/manual/jutsu/balance#Usage",
      "/manual/jutsu/balance#Power",
      "/manual/jutsu/completeness#Incomplete",
      "/manual/jutsu/completeness#Diversity",
      "",
    ],
    [
      "Items",
      "/manual/item/balance#Usage",
      "/manual/item/balance#Power",
      "/manual/item/completeness#Incomplete",
      "/manual/item/completeness#Diversity",
      "",
    ],
    [
      "AI",
      "/manual/ai/balance#Usage",
      "/manual/ai/balance#Power",
      "/manual/ai/completeness",
      "",
      "",
    ],
    [
      "Skill Trees",
      "/manual/skillTree/balance#Usage",
      "/manual/skillTree/balance#Power",
      "",
      "",
      "",
    ],
    [
      "Ranked PvP",
      "/manual/pvp_rank#loadouts",
      "",
      "",
      "/manual/pvp_rank#rewards",
      "/manual/pvp_rank#matchmaking",
    ],
    ["Combat", "", "", "", "", "/manual/combat"],
  ]);
  for (const link of view.getByRole("table").querySelectorAll("a")) {
    expect(link.querySelector("svg")?.getAttribute("class")).toContain("h-4 w-4");
    const href = link.getAttribute("href")!;
    const props = links.get(href)!;
    const hasFragment = href.includes("#");
    expect(props.prefetch).toBe(hasFragment ? false : undefined);
    expectDocumentNavigation(props, hasFragment);
  }
});

it("loads usage summaries with their cohort and fragment while individual statistics keep client navigation", () => {
  const links = captureLinks();
  const filter = {
    battleTypes: ["RANKED_PVP" as const],
    userRanks: ["JONIN" as const],
    minLevel: 50,
    maxLevel: 60,
  };
  vi.spyOn(BalanceFiltering, "useBalanceFiltering").mockReturnValue({
    isReady: true,
  } as never);
  vi.spyOn(BalanceFiltering, "getBalanceFilter").mockReturnValue(filter);
  vi.spyOn(BalanceFiltering, "BalanceFiltering").mockImplementation(() => <></>);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    data: {
      getBalanceOverview: {
        useQuery: () => ({
          data: {
            periodStart: Date.UTC(2026, 10, 16),
            participants: [],
            content: [
              {
                type: "jutsu",
                contentId: "surge",
                name: "Surge",
                battleWon: 1,
                count: 4,
              },
            ],
          },
        }),
      },
      getBalanceArchives: { useQuery: () => ({ data: [] }) },
    },
  });
  render(
    <AppRouterContext.Provider value={{} as never}>
      <BalanceOverview.BalanceOverview />
    </AppRouterContext.Provider>,
  );
  for (const type of ["jutsu", "bloodline", "item"] as const) {
    const href = BalanceFiltering.getBalanceUsageHref(type, filter);
    const props = links.get(href)!;
    expect(props).toBeDefined();
    expect(props.prefetch).toBe(false);
    expectDocumentNavigation(props, true);
  }
  const statistics = links.get("/manual/jutsu/statistics/surge")!;
  expect(statistics).toBeDefined();
  expect(statistics.onNavigate).toBeUndefined();
  expect(statistics.prefetch).toBeUndefined();
});

it("creates a backup of the content type named on each button", () => {
  const createBackup = vi.fn();
  mockUserContextValue({
    data: { role: "OWNER" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    staff: {
      getBackups: { useQuery: () => ({ data: [] }) },
      createBackup: { useMutation: () => ({ mutate: createBackup, isPending: false }) },
      pushBackupToDev: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualBackupPage />
    </AppRouterContext.Provider>,
  );
  const labels = ["Back up bloodlines", "Back up jutsu", "Back up items", "Back up AI"];
  expect(
    view
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((label) => labels.includes(label ?? "")),
  ).toEqual(labels);
  for (const label of labels) {
    fireEvent.click(view.getByRole("button", { name: label }));
  }
  expect(createBackup.mock.calls).toEqual([
    [{ type: "bloodline" }],
    [{ type: "jutsu" }],
    [{ type: "item" }],
    [{ type: "ai" }],
  ]);
});

it("offers section shortcuts before the overview and report tables", () => {
  vi.spyOn(BalanceOverview, "BalanceOverview").mockImplementation(() => (
    <section id="balance-overview">Overview data</section>
  ));
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualBalance />
    </AppRouterContext.Provider>,
  );
  const nav = view.getByRole("navigation", { name: "Balance sections" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")),
  ).toEqual([
    "#balance-overview",
    "#balance-starting-turn",
    "#balance-archives",
    "#balance-reports",
  ]);
  expect(
    nav.compareDocumentPosition(view.getByText("Overview data")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

/** Inspect the owner's Link contract without exercising Next's router implementation. */
const captureLinks = () => {
  const links = new Map<string, ComponentProps<typeof Link.default>>();
  vi.spyOn(Link, "default").mockImplementation((props) => {
    links.set(String(props.href), props);
    return <a href={String(props.href)}>{props.children}</a>;
  });
  return links;
};

/** Assert that fragment destinations cancel client routing and keep the complete address. */
const expectDocumentNavigation = (
  props: ComponentProps<typeof Link.default>,
  expected: boolean,
) => {
  const preventDefault = vi.fn();
  const assign = vi.fn();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { assign, hash: "#balance-archives" } },
  });
  try {
    props.onNavigate?.({ preventDefault });
  } finally {
    Object.defineProperty(globalThis, "window", descriptor);
  }
  expect(preventDefault).toHaveBeenCalledTimes(expected ? 1 : 0);
  if (expected) expect(assign).toHaveBeenCalledWith(props.href);
  else expect(assign).not.toHaveBeenCalled();
};
