import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import { AuctionDetailsDialog } from "@/app/[shell]/auctionhouse/page";
import { AuctionOffers } from "@/app/[shell]/auctionhouse/Offers";
import * as ItemDetails from "@/layout/ItemWithEffects";
import OccupationCrafting from "@/layout/OccupationCrafting";
import * as UserContext from "@/utils/UserContext";

const procedure = {
  useQuery: () => ({ data: undefined, isPending: false }),
  useInfiniteQuery: () => ({ data: undefined, isPending: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
};
/** Router whose procedures are idle unless a test overrides them. */
const router = (overrides: object = {}) =>
  new Proxy(overrides, {
    get: (target, name) => (target as Record<string | symbol, unknown>)[name] ?? procedure,
  });

const imbuedRow = {
  id: "sword-row",
  itemId: "sword",
  quantity: 1,
  durability: 10,
  level: 3,
  experience: 40,
  equipped: "NONE",
  isInAuction: false,
  item: { id: "sword", name: "Sword", image: "/sword.webp", itemType: "WEAPON", maxDurability: 100 },
  imbuements: [
    { id: "done", craftingFinishedAt: new Date(Date.now() - 60_000), item: { name: "Finished Crystal" } },
    { id: "busy", craftingFinishedAt: new Date(Date.now() + 60_000), item: { name: "Unfinished Crystal" } },
  ],
};

const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const browserDescriptors = browserGlobals.map((key) =>
  Object.getOwnPropertyDescriptor(globalThis, key),
);
/** Install the tRPC stub with the auction procedures a surface reads. */
const stubApi = (auction: object = {}) =>
  Object.assign(vi.spyOn(client, "api" as never), {
    item: router({ getUserItems: { useQuery: () => ({ data: [imbuedRow], isPending: false }) } }),
    auction: router(auction),
    occupation: router(),
    profile: router(),
    useUtils: () => router(),
  });

beforeEach(() => {
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { userId: "viewer", occupation: "CRAFTING", level: 1, bank: 0, reputationPoints: 0, money: 0, role: "USER" },
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
    timeDiff: 0,
  } as never);
  vi.spyOn(ItemDetails, "default").mockImplementation((({ item }: {
    item: { imbuements?: { name: string }[] };
  }) => (
    <p data-testid="imbuements">{item.imbuements?.map((entry) => entry.name).join()}</p>
  )) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const expectOnlyFinishedCrystal = () =>
  expect(screen.getAllByTestId("imbuements")[0]?.textContent).toBe("Finished Crystal");

it("shows only finished imbuements on an auction listing", () => {
  stubApi({
    getAuctionListing: {
      useQuery: () => ({
        isLoading: false,
        data: {
          id: "listing",
          sellerId: "seller",
          status: "ACTIVE",
          listingType: "BUYOUT",
          currencyType: "MONEY",
          currentPrice: 10,
          expiresAt: new Date(Date.now() + 60_000),
          bids: [],
          seller: { userId: "seller", username: "Seller", avatar: "/seller.webp" },
          userItem: imbuedRow,
        },
      }),
    },
  });
  render(<AuctionDetailsDialog auctionId="listing" isOpen setIsOpen={vi.fn()} />);
  expectOnlyFinishedCrystal();
});

it("shows only finished imbuements on an offered item", () => {
  stubApi({
    getAuctionOffers: {
      useInfiniteQuery: () => ({
        isLoading: false,
        data: {
          pages: [
            {
              data: [
                {
                  id: "offer",
                  ownerId: "owner",
                  offerType: "TRADE",
                  status: "ACTIVE",
                  requestedQuantity: 1,
                  requestedItem: { name: "Ore", image: "/ore.webp" },
                  offeredQuantity: 1,
                  offeredUserItem: imbuedRow,
                  expiresAt: new Date(Date.now() + 60_000),
                  owner: { userId: "owner", username: "Owner", avatar: "/owner.webp" },
                },
              ],
            },
          ],
        },
      }),
    },
  });
  render(<AuctionOffers offerType="TRADE" status="ACTIVE" />);
  expectOnlyFinishedCrystal();
});

it("shows only finished imbuements on an item awaiting repair", () => {
  stubApi();
  render(
    <AppRouterContext.Provider value={{} as never}>
      <OccupationCrafting />
    </AppRouterContext.Provider>,
  );
  expect(screen.getByText("Repair Items")).toBeTruthy();
  const repairDetails = screen.getAllByTestId("imbuements").at(-1);
  expect(repairDetails?.textContent).toBe("Finished Crystal");
});
