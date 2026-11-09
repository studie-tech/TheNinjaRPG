import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { AuctionOffers } from "@/app/[shell]/auctionhouse/Offers";
import * as pagination from "@/libs/pagination";

const fetchNextPage = vi.fn(async () => undefined);
let paginate: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  paginate = vi
    .spyOn(pagination, "useInfinitePagination")
    .mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    item: { getUserItems: { useQuery: () => ({ data: [], isPending: false }) } },
    auction: {
      getAuctionOffers: {
        useInfiniteQuery: () => ({
          data: { pages: [{ data: [], nextCursor: 10 }] },
          isLoading: false,
          isPlaceholderData: false,
          hasNextPage: true,
          fetchNextPage,
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("loads further offers from a sentinel like the sibling auction tabs", () => {
  const view = render(<AuctionOffers offerType="REQUEST" status="ACTIVE" />);
  expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
  const last = paginate.mock.calls.at(-1)?.[0] as Parameters<
    typeof pagination.useInfinitePagination
  >[0];
  expect(last.fetchNextPage).toBe(fetchNextPage);
  expect(last.hasNextPage).toBe(true);
  expect(last.lastElement).toBeInstanceOf(HTMLDivElement);
});
