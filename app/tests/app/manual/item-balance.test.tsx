import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import ManualItemsBalance from "@/app/[shell]/manual/item/balance/page";
import * as ContentBox from "@/layout/ContentBox";
import * as ItemBalanceFiltering from "@/layout/ItemBalanceFiltering";
import * as UserContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const usage = [
  { name: "Kunai", itemId: "kunai", battleWon: 1, count: 3, equippedCount: 4 },
  { name: "Kunai", itemId: "kunai", battleWon: 0, count: 2, equippedCount: 4 },
  { name: "Scroll", itemId: "scroll", battleWon: 1, count: 9, equippedCount: 1 },
];

beforeEach(() => {
  installBrowserGlobals();
  localStorage.clear();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(ItemBalanceFiltering, "default").mockImplementation(() => null);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { role: "USER" },
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    data: {
      getItemBalanceStatistics: { useQuery: () => ({ data: usage, isPending: false }) },
    },
    item: {
      getAllNames: {
        useQuery: () => ({
          data: [
            { id: "kunai", name: "Kunai" },
            { id: "scroll", name: "Scroll" },
          ],
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("lists one row per item by usage, each linking to that item's statistics", () => {
  const view = render(
    <AppRouterContext.Provider value={{} as never}>
      <ManualItemsBalance />
    </AppRouterContext.Provider>,
  );
  const rows = view.getAllByRole("row").slice(1);
  expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
    "Scroll",
    "Kunai",
  ]);
  expect(rows.map((row) => within(row).getByRole("link").getAttribute("href"))).toEqual(
    ["/manual/item/statistics/scroll", "/manual/item/statistics/kunai"],
  );
  expect(rows.map((row) => within(row).getAllByRole("cell")[1]?.textContent)).toEqual([
    "9",
    "5",
  ]);
});
