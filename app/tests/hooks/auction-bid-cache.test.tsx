import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { getPlacedBid } from "@/deltas/auction";
import { useAuctionBidCacheUpdate } from "@/hooks/useAuctionBidCacheUpdate";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

const search = {
  listingType: "AUCTION" as const,
  status: "ACTIVE" as const,
  limit: 10,
};
const otherSearch = { ...search, onlyMine: true as const, listingType: undefined };
const row = (id: string) => ({ id, status: "ACTIVE", currentPrice: 100, bids: [] });
const detail = { ...row("lot"), bids: [] };
let queryClient: QueryClient;
let calls: { path: string; input: unknown }[];

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  calls = [];
  Object.assign(vi.spyOn(client, "api" as never), {
    auction: testApi.auction,
    useUtils: testApi.useUtils,
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

const mount = () => {
  const trpcClient = fakeTrpcClient((path, input) => {
    calls.push({ path, input });
    if (path === "auction.getAuctionListing") return detail;
    const cursor = (input as { cursor?: number | null }).cursor ?? 0;
    return cursor === 0
      ? { data: [row("first")], nextCursor: 1 }
      : { data: [row("lot")], nextCursor: null };
  });
  return renderHook(
    () => {
      const listings = testApi.auction.getAuctionListings.useInfiniteQuery(search, {
        getNextPageParam: (page) => page.nextCursor,
      });
      const listing = testApi.auction.getAuctionListing.useQuery({ auctionId: "lot" });
      return { listings, listing, cache: useAuctionBidCacheUpdate("lot", search) };
    },
    {
      wrapper: ({ children }) => (
        <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
          {children}
        </TrpcTestProviders>
      ),
    },
  );
};

const placedBid = getPlacedBid({
  auction: { id: "lot", currentPrice: 100 },
  existingBid: undefined,
  bidId: "bid",
  bidder: { userId: "viewer", username: "Viewer", avatar: null },
  amount: 150,
  updatedAt: new Date(1),
});

it("patches the opened listing on a later page of the captured search without reading it", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.listing.data).toBeDefined());
  await waitFor(() => expect(view.result.current.listings.data).toBeDefined());
  await act(() => view.result.current.listings.fetchNextPage());
  await waitFor(() => expect(view.result.current.listings.data?.pages).toHaveLength(2));
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  // An inactive search for another tab only becomes stale.
  queryClient.setQueryData(
    [["auction", "getAuctionListings"], { input: otherSearch, type: "infinite" }],
    { pages: [{ data: [row("lot")], nextCursor: null }], pageParams: [null] },
  );
  calls = [];
  const snapshot = view.result.current.cache.prepareBidUpdate();
  await act(() =>
    view.result.current.cache.updateBid(
      { success: true, message: "Bid placed", placedBid },
      snapshot,
    ),
  );
  expect(calls).toEqual([]);
  const pages = queryClient.getQueryData<{
    pages: { data: { id: string; currentPrice: number }[] }[];
  }>([["auction", "getAuctionListings"], { input: search, type: "infinite" }])?.pages;
  expect(pages?.[0]?.data[0]?.currentPrice).toBe(100);
  expect(pages?.[1]?.data[0]).toMatchObject({ id: "lot", currentPrice: 150 });
  expect(
    queryClient.getQueryData([
      ["auction", "getAuctionListing"],
      { input: { auctionId: "lot" }, type: "query" },
    ]),
  ).toMatchObject({ currentPrice: 150 });
  expect(
    queryClient.getQueryState([
      ["auction", "getAuctionListings"],
      { input: otherSearch, type: "infinite" },
    ])?.isInvalidated,
  ).toBe(true);
});

it("reads both views again after a buyout", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.listing.data).toBeDefined());
  await waitFor(() => expect(view.result.current.listings.data).toBeDefined());
  calls = [];
  const snapshot = view.result.current.cache.prepareBidUpdate();
  await act(() =>
    view.result.current.cache.updateBid(
      { success: true, message: "Buyout successful - auction completed" },
      snapshot,
    ),
  );
  await waitFor(() =>
    expect(calls.map((call) => call.path).sort()).toEqual([
      "auction.getAuctionListing",
      "auction.getAuctionListings",
    ]),
  );
});
