import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useMutation,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import { AuctionDetailsDialog } from "@/app/[shell]/auctionhouse/ListingDetailsDialog";
import { auctionHouseLevelMessage } from "@/drizzle/constants";
import * as ItemDetails from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

type Bid = { auctionId: string; amount: number };
const placeBid = vi.fn((_input: Bid) => new Promise<never>(() => undefined));
let queryClient: QueryClient;

const listingFor = (overrides: object = {}) => ({
  id: "listing",
  sellerId: "seller",
  status: "ACTIVE",
  listingType: "AUCTION",
  currencyType: "MONEY",
  currentPrice: 100,
  buyoutPrice: 500,
  bidderMinLevel: 1,
  bidderMaxLevel: 100,
  targetUserId: null,
  targetUser: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  bids: [
    {
      id: "bid",
      bidderId: "viewer",
      amount: 100,
      status: "ACTIVE",
      createdAt: new Date(),
      bidder: null,
    },
  ],
  seller: { userId: "seller", username: "Seller", avatar: "/seller.webp" },
  quantity: 4,
  item: { name: "Ore", canStack: true },
  userItem: { durability: 10, imbuements: [] },
  ...overrides,
});

const renderDialog = (listing: object, user: object = {}, utils: object = {}) => {
  mockUserContextValue({
    data: { userId: "viewer", level: 20, bank: 1000, reputationPoints: 0, ...user },
    updateUser: vi.fn(),
    timeDiff: 0,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => utils,
    auction: {
      getAuctionListing: { useQuery: () => ({ data: listing, isLoading: false }) },
      placeBid: {
        useMutation: (options: UseMutationOptions<never, Error, Bid>) =>
          useMutation({ ...options, mutationFn: placeBid }),
      },
      cancelAuction: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  return render(
    <AppRouterContext.Provider value={{} as never}>
      <QueryClientProvider client={queryClient}>
        <AuctionDetailsDialog auctionId="listing" isOpen setIsOpen={vi.fn()} />
      </QueryClientProvider>
    </AppRouterContext.Provider>,
  );
};

const confirmation = () => screen.getByRole("alertdialog");

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.spyOn(ItemDetails, "default").mockImplementation((() => null) as never);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("bid and buyout confirmations", () => {
  it("confirms a raised bid with its per-unit price and the bid it replaces", async () => {
    renderDialog(listingFor());
    fireEvent.input(screen.getByPlaceholderText("Bid amount (whole numbers)"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise to" }));
    expect(within(confirmation()).getByRole("heading").textContent).toBe("Confirm Bid");
    expect(within(confirmation()).getByText(/Are you sure/).textContent).toBe(
      "Are you sure you want to place a bid of 200 ryo on this auction?50 ryo/unit · ×4Your current bid of 100 will be replaced.",
    );
    expect(
      within(confirmation()).getByRole("button", { name: "Cancel" }),
    ).toBeDefined();
    await act(async () => {
      fireEvent.click(
        within(confirmation()).getByRole("button", { name: "Confirm Bid" }),
      );
    });
    expect(placeBid.mock.calls.map((call) => call[0])).toEqual([
      { auctionId: "listing", amount: 200 },
    ]);
    await waitFor(() =>
      expect(within(confirmation()).getByRole("status").textContent).toBe("Submitting"),
    );
    const pending = within(confirmation()).getByRole("button", {
      name: "Submitting",
    }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(
      (
        within(confirmation()).getByRole("button", {
          name: "Cancel",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.keyDown(confirmation(), { key: "Escape" });
    expect(confirmation()).toBeDefined();
  });

  it("confirms a buyout at the listed price", async () => {
    renderDialog(listingFor({ bids: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Buy it now — 500 ryo" }));
    expect(within(confirmation()).getByRole("heading").textContent).toBe(
      "Confirm Buyout",
    );
    expect(within(confirmation()).getByText(/Are you sure/).textContent).toBe(
      "Are you sure you want to buyout this auction for 500 ryo? This will immediately complete the auction and transfer the item to you.125 ryo/unit · ×4",
    );
    await act(async () => {
      fireEvent.click(
        within(confirmation()).getByRole("button", { name: "Confirm Buyout" }),
      );
    });
    expect(placeBid.mock.calls.map((call) => call[0])).toEqual([
      { auctionId: "listing", amount: 500 },
    ]);
    await waitFor(() =>
      expect(within(confirmation()).getByRole("status").textContent).toBe("Purchasing"),
    );
    expect(
      (
        within(confirmation()).getByRole("button", {
          name: "Purchasing",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("closes the confirmation once the bid lands, without waiting for listings to refetch", async () => {
    const neverSettles = () => new Promise<void>(() => undefined);
    const listings = vi.fn(neverSettles);
    const details = vi.fn(neverSettles);
    const inventory = vi.fn(neverSettles);
    placeBid.mockImplementationOnce(
      () =>
        Promise.resolve({
          success: true,
          message: "Bid placed",
          amountToDeduct: 500,
        }) as never,
    );
    renderDialog(
      listingFor({ bids: [] }),
      {},
      {
        auction: {
          getAuctionListings: { invalidate: listings },
          getAuctionListing: { invalidate: details },
        },
        item: { getUserItems: { invalidate: inventory } },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Buy it now — 500 ryo" }));
    await act(async () => {
      fireEvent.click(
        within(confirmation()).getByRole("button", { name: "Confirm Buyout" }),
      );
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("success"),
    );
    expect(listings).toHaveBeenCalledTimes(1);
    expect(details).toHaveBeenCalledTimes(1);
    expect(inventory).toHaveBeenCalledTimes(1);
  });

  it("closes an idle confirmation on cancel", () => {
    renderDialog(listingFor({ currencyType: "REPUTATION" }), {
      reputationPoints: 1000,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Buy it now — 500 reputation" }),
    );
    expect(within(confirmation()).getByText(/Are you sure/).textContent).toContain(
      "for 500 reputation?",
    );
    fireEvent.click(within(confirmation()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(placeBid).not.toHaveBeenCalled();
  });
});

describe("viewer eligibility", () => {
  const notices = () => ({
    bidCard: screen.queryByText("Raise your bid") !== null,
    directLot: screen.queryByText(/You are not eligible to/) !== null,
    minLevel: screen.queryByText(auctionHouseLevelMessage) !== null,
    levelRange: screen.queryByText(/This auction only accepts/) !== null,
  });
  const none = { bidCard: false, directLot: false, minLevel: false, levelRange: false };

  it("lets an eligible viewer bid", () => {
    renderDialog(listingFor());
    expect(notices()).toEqual({ ...none, bidCard: true });
  });

  it("lets the targeted buyer of a direct lot bid", () => {
    renderDialog(
      listingFor({
        listingType: "DIRECT",
        targetUserId: "viewer",
        targetUser: { username: "Viewer", avatar: null },
      }),
    );
    expect(notices()).toEqual({ ...none, bidCard: true });
  });

  it("tells other viewers a direct lot is not theirs", () => {
    renderDialog(
      listingFor({
        listingType: "DIRECT",
        targetUserId: "other",
        targetUser: { username: "Other", avatar: null },
      }),
    );
    expect(notices()).toEqual({ ...none, directLot: true });
    expect(screen.getByText(/You are not eligible to/).textContent).toBe(
      "Direct lot for Other. You are not eligible to bid.",
    );
  });

  it("explains the auction house level requirement", () => {
    renderDialog(listingFor(), { level: 5 });
    expect(notices()).toEqual({ ...none, minLevel: true });
  });

  it("explains an auction's level range", () => {
    renderDialog(listingFor({ bidderMinLevel: 30, bidderMaxLevel: 40 }));
    expect(notices()).toEqual({ ...none, levelRange: true });
  });

  it("shows sellers, expired and closed lots no bidding controls", () => {
    renderDialog(listingFor({ sellerId: "viewer" }));
    expect(notices()).toEqual(none);
    cleanup();
    renderDialog(listingFor({ expiresAt: new Date(Date.now() - 1000) }));
    expect(notices()).toEqual(none);
    cleanup();
    renderDialog(listingFor({ status: "SOLD" }));
    expect(notices()).toEqual(none);
  });
});
