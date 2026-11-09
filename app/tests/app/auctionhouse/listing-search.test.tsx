import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import { AuctionListing } from "@/app/[shell]/auctionhouse/Listings";
import * as pagination from "@/libs/pagination";
import * as UserContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "viewer" },
    timeDiff: 0,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    auction: {
      getAuctionListings: {
        useInfiniteQuery: () => ({
          data: { pages: [] },
          isLoading: false,
          hasNextPage: false,
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("names the item search after the browsed listings", () => {
  const placeholders = (["AUCTION", "DIRECT", "MINE", "MY_BIDS"] as const).map(
    (browseTab) => {
      render(
        <AppRouterContext.Provider value={{} as never}>
          <AuctionListing browseTab={browseTab} selectedStatus="ACTIVE" />
        </AppRouterContext.Provider>,
      );
      const input = screen.getAllByRole("textbox")[0]?.getAttribute("placeholder");
      cleanup();
      return input;
    },
  );
  expect(placeholders).toEqual([
    "Search by item name…",
    "Search by item name…",
    "Search your listings by item…",
    "Search by item name…",
  ]);
});
