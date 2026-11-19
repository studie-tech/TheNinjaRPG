import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ComponentProps } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import * as client from "@/app/_trpc/client";
import ManualBalance from "@/app/[shell]/manual/balance/page";
import ManualBackupPage from "@/app/[shell]/manual/content_backups/page";
import * as BalanceFiltering from "@/layout/BalanceFiltering";
import * as BalanceOverview from "@/layout/BalanceOverview";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

beforeEach(() => {
  installBrowserGlobals({ events: ["CustomEvent"] });
  window.localStorage.clear();
  window.history.replaceState({}, "", "/manual/balance");
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
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("links each balance data source from its content row and column", () => {
  window.history.replaceState({}, "", "/manual/balance#Reports");
  const links = captureLinks();
  vi.spyOn(BalanceOverview, "BalanceOverview").mockImplementation(() => null);
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
            exclusions: { short: 1200, idle: 34 },
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
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <BalanceOverview.BalanceOverview />
    </AppRouterContext.Provider>,
  );
  expect(view.container.textContent).toContain(
    "Excluded so far: 1,234 player results (1,200 shorter than 3 rounds, 34 with an idle player or side).",
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

it("uses header tabs to show only the selected balance section", () => {
  vi.spyOn(BalanceOverview, "BalanceOverview").mockImplementation(({ tab, navTabs }) =>
    tab === "Reports" ? null : (
      <section>
        {navTabs}
        <p>{tab} data</p>
      </section>
    ),
  );
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualBalance />
    </AppRouterContext.Provider>,
  );
  expect(view.getByText("Overview data")).toBeTruthy();
  expect(view.queryByRole("navigation", { name: "Balance sections" })).toBeNull();
  expect(view.queryByRole("table")).toBeNull();
  for (const tab of ["Starting turns", "Archives", "Overview"]) {
    fireEvent.click(view.getByRole("button", { name: tab }));
    expect(view.getByText(`${tab} data`)).toBeTruthy();
    expect(view.getByRole("button", { name: tab }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(view.queryByRole("table")).toBeNull();
  }
  fireEvent.click(view.getByRole("button", { name: "Reports" }));
  expect(view.getByRole("table")).toBeTruthy();
  expect(view.queryByText("Overview data")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Overview" }));
  expect(view.getByText("Overview data")).toBeTruthy();
  expect(view.queryByRole("table")).toBeNull();
});

it("opens a named tab from its fragment and falls back for unknown values", () => {
  vi.spyOn(BalanceOverview, "BalanceOverview").mockImplementation(({ tab, navTabs }) =>
    tab === "Reports" ? null : (
      <section>
        {navTabs}
        <p>{tab} data</p>
      </section>
    ),
  );
  window.history.replaceState({}, "", "/manual/balance#Archives");
  const first = render(<ManualBalance />);
  expect(first.getByText("Archives data")).toBeTruthy();
  first.unmount();
  window.history.replaceState({}, "", "/manual/balance#unknown");
  const second = render(<ManualBalance />);
  expect(second.getByText("Overview data")).toBeTruthy();
});

it.each([
  { fragment: "#Archives", savedTab: "Reports", expectedTab: "Archives" },
  { fragment: "", savedTab: "Reports", expectedTab: "Reports" },
])(
  "hydrates Overview before applying $expectedTab from browser state",
  async ({ fragment, savedTab, expectedTab }) => {
    captureLinks();
    vi.spyOn(BalanceOverview, "BalanceOverview").mockImplementation(
      ({ tab, navTabs }) =>
        tab === "Reports" ? null : (
          <section>
            {navTabs}
            <p>{tab} data</p>
          </section>
        ),
    );
    window.history.replaceState({}, "", `/manual/balance${fragment}`);
    window.localStorage.setItem("manualBalanceTab", JSON.stringify(savedTab));
    const element = (
      <AppRouterContext.Provider value={{} as never}>
        <ManualBalance />
      </AppRouterContext.Provider>
    );
    const container = document.createElement("div");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")!;
    try {
      Reflect.deleteProperty(globalThis, "window");
      container.innerHTML = renderToString(element);
    } finally {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    }
    expect(container.textContent).toContain("Overview data");
    document.body.appendChild(container);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(
        within(container)
          .getByRole("button", { name: expectedTab })
          .getAttribute("aria-current"),
      ).toBe("true");
      expect(errors).toEqual([]);
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  },
);

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
