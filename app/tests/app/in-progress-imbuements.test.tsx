import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { AuctionDetailsDialog } from "@/app/[shell]/auctionhouse/ListingDetailsDialog";
import { AuctionOffers } from "@/app/[shell]/auctionhouse/Offers";
import Occupations from "@/app/[shell]/occupation/page";
import { CRAFTING_REQUIRED_EXP, CRAFTING_TIMES_MINS } from "@/drizzle/constants";
import * as CombatActions from "@/layout/CombatActions";
import * as ItemDetails from "@/layout/ItemWithEffects";
import * as Modal from "@/layout/Modal";
import * as pagination from "@/libs/pagination";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

const procedure = {
  useQuery: () => ({ data: undefined, isPending: false }),
  useInfiniteQuery: () => ({ data: undefined, isPending: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
};
/** Router whose procedures are idle unless a test overrides them. */
const router = (overrides: object = {}) =>
  new Proxy(overrides, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ?? procedure,
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
  item: {
    id: "sword",
    name: "Sword",
    image: "/sword.webp",
    itemType: "WEAPON",
    rarity: "COMMON",
    maxDurability: 100,
  },
  imbuements: [
    {
      id: "done",
      craftingFinishedAt: new Date(Date.now() - 60_000),
      item: { name: "Finished Crystal" },
    },
    {
      id: "busy",
      craftingFinishedAt: new Date(Date.now() + 60_000),
      item: { name: "Unfinished Crystal" },
    },
  ],
};

/** Install the tRPC stub with the auction procedures a surface reads. */
const stubApi = (
  auction: object = {},
  rows: object[] = [imbuedRow],
  occupation: object = {},
  item: object = {},
) =>
  Object.assign(vi.spyOn(client, "api" as never), {
    item: router({
      getUserItems: { useQuery: () => ({ data: rows, isPending: false }) },
      ...item,
    }),
    auction: router(auction),
    occupation: router(occupation),
    profile: router(),
    useUtils: () => router(),
  });

const stubCraftingUser = (data: object = {}) =>
  mockUserContextValue({
    data: {
      userId: "viewer",
      occupation: "CRAFTING",
      level: 1,
      bank: 0,
      reputationPoints: 0,
      money: 0,
      role: "USER",
      ...data,
    },
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
    timeDiff: 0,
  } as never);

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  stubCraftingUser();
  vi.spyOn(ItemDetails, "default").mockImplementation((({
    item,
  }: {
    item: { imbuements?: { name: string }[] };
  }) => (
    <p data-testid="imbuements">{item.imbuements?.map((entry) => entry.name).join()}</p>
  )) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const renderCrafting = () =>
  render(
    <AppRouterContext.Provider value={{} as never}>
      <Occupations />
    </AppRouterContext.Provider>,
  );

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
          item: imbuedRow.item,
          quantity: 1,
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
  renderCrafting();
  expect(screen.getByRole("heading", { name: "Crafting", level: 2 })).toBeTruthy();
  const repair = screen.getByRole("button", { name: "Repair Items" });
  expect(repair.getAttribute("aria-expanded")).toBe("true");
  const repairDetails = screen.getAllByTestId("imbuements").at(-1);
  expect(repairDetails?.textContent).toBe("Finished Crystal");

  fireEvent.click(repair);
  expect(repair.getAttribute("aria-expanded")).toBe("false");
  for (const name of ["Catalog / Queue", "Imbue"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  }
});

/** The details rendered inside the card with this heading. */
const cardDetails = (heading: string) =>
  within(
    screen.getByText(heading).closest(".rounded-xl") as HTMLElement,
  ).getAllByTestId("imbuements");

/** Render modals inline, with a proceed button, so a test can read and accept them. */
const stubModals = () =>
  vi.spyOn(Modal, "default").mockImplementation((({
    isOpen,
    title,
    proceed_label,
    onAccept,
    children,
  }: {
    isOpen: boolean;
    title: string;
    proceed_label?: string;
    onAccept?: () => void;
    children: ReactNode;
  }) =>
    isOpen ? (
      <section aria-label={title}>
        {children}
        <button
          type="button"
          onClick={() => onAccept?.()}
        >{`Confirm ${proceed_label}`}</button>
      </section>
    ) : null) as never);

/** A row with two finished imbuements and no craft running, so the imbue card is available. */
const settledRow = {
  ...imbuedRow,
  item: { ...imbuedRow.item, canBeImbued: true, maxImbueNumber: 3 },
  imbuements: [
    {
      id: "done",
      imbuementItemId: "a",
      craftingFinishedAt: null,
      item: { name: "Finished Crystal" },
    },
    {
      id: "second",
      imbuementItemId: "b",
      craftingFinishedAt: null,
      item: { name: "Second Crystal" },
    },
  ],
};

it("leaves an unfinished imbuement off the manage imbuements card", () => {
  stubApi();
  renderCrafting();
  expect(cardDetails("Manage Existing Imbuements")[0]?.textContent).toBe(
    "Finished Crystal",
  );
  expect(cardDetails("Currently Imbuing")[0]?.textContent).toBe(
    "Finished Crystal,Unfinished Crystal",
  );
});

it("refreshes the inventory when an imbuement finishes with Imbue closed", async () => {
  const invalidate = vi.fn();
  const trpc = stubApi({}, [
    {
      ...imbuedRow,
      imbuements: [
        { ...imbuedRow.imbuements[1], craftingFinishedAt: new Date(Date.now() + 750) },
      ],
    },
  ]);
  trpc.useUtils = () => ({ item: { getUserItems: { invalidate } } });
  renderCrafting();
  const imbue = screen.getByRole("button", { name: "Imbue" });
  fireEvent.click(imbue);
  expect(imbue.getAttribute("aria-expanded")).toBe("false");
  expect(imbue.textContent).toContain("Imbuing Sword");
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1), { timeout: 2000 });
});

it("offers a confirmed bulk repair in the occupation header during the change-job cooldown", () => {
  const mutate = vi.fn();
  stubApi(
    {},
    [settledRow],
    {},
    {
      repairAll: { useMutation: () => ({ mutate, isPending: false }) },
    },
  );
  stubCraftingUser({ occupationSignupAt: new Date(), money: 1e9 });
  stubModals();
  renderCrafting();
  expect(screen.queryByRole("button", { name: "Change Job" })).toBeNull();
  const repair = screen.getByRole("button", { name: "Repair All" });
  expect(repair.closest("[data-content-box-header]")).toBeTruthy();
  fireEvent.click(repair);
  expect(mutate).not.toHaveBeenCalled();
  const dialog = within(screen.getByRole("region", { name: "Repair All Items" }));
  expect(dialog.getByText(/^Repair all 1 item for/)).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Confirm Repair All" }));
  expect(mutate).toHaveBeenCalledTimes(1);
});

it("drops a removed imbuement from the card before the inventory refreshes", async () => {
  const mutateAsync = vi.fn(async () => ({ success: true, message: "Removed" }));
  stubApi({}, [settledRow], {
    removeImbuement: { useMutation: () => ({ mutateAsync, isPending: false }) },
  });
  stubModals();
  renderCrafting();
  expect(cardDetails("Manage Existing Imbuements")[0]?.textContent).toBe(
    "Finished Crystal,Second Crystal",
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));
  await waitFor(() =>
    expect(mutateAsync).toHaveBeenCalledWith({ userItemImbuementId: "done" }),
  );
  await waitFor(() =>
    expect(cardDetails("Manage Existing Imbuements")[0]?.textContent).toBe(
      "Second Crystal",
    ),
  );
});

it("leaves a removed imbuement off the imbue confirmation of an item selected earlier", async () => {
  const mutateAsync = vi.fn(async () => ({ success: true, message: "Removed" }));
  const crystal = {
    id: "crystal-row",
    itemId: "crystal",
    quantity: 1,
    isInAuction: false,
    equipped: "NONE",
    imbuements: [],
    item: {
      id: "crystal",
      name: "Fresh Crystal",
      image: "/crystal.webp",
      itemType: "CRYSTAL",
    },
  };
  stubApi({}, [settledRow, crystal], {
    removeImbuement: { useMutation: () => ({ mutateAsync, isPending: false }) },
  });
  mockUserContextValue({
    data: {
      userId: "viewer",
      occupation: "CRAFTING",
      level: 1,
      bank: 0,
      reputationPoints: 0,
      money: 0,
      role: "USER",
      craftingExperience: 1e9,
    },
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
    timeDiff: 0,
  } as never);
  vi.spyOn(CombatActions, "ActionSelector").mockImplementation((({
    items,
    onClick,
  }: {
    items?: { id: string; name: string }[];
    onClick: (id: string) => void;
  }) =>
    items?.map((item) => (
      <button key={item.id} type="button" onClick={() => onClick(item.id)}>
        {item.name}
      </button>
    ))) as never);
  stubModals();
  renderCrafting();
  fireEvent.click(screen.getByRole("button", { name: "Sword (2/3 crystals)" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));
  await waitFor(() =>
    expect(cardDetails("Manage Existing Imbuements")[0]?.textContent).toBe(
      "Second Crystal",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Fresh Crystal" }));
  const dialog = within(screen.getByRole("region", { name: "Imbue Item" }));
  expect(dialog.getAllByTestId("imbuements")[0]?.textContent).toBe("Second Crystal");
});

it("lists each crafting rank's experience range and craftable rarity times", () => {
  stubApi();
  renderCrafting();
  const card = screen
    .getByText("Crafting Information")
    .closest(".rounded-xl") as HTMLElement;
  const ranks = [...card.querySelectorAll(".md\\:grid-cols-2 > div")].map((rank) => [
    rank.querySelector(".mb-2")?.textContent,
    [...rank.querySelectorAll("li")].map((item) => item.textContent),
  ]);
  const times = CRAFTING_TIMES_MINS;
  const exp = CRAFTING_REQUIRED_EXP;
  expect(ranks).toEqual([
    [
      `Novice (0-${(exp.APPRENTICE - 1).toLocaleString()} exp)`,
      [`• Common: ${times.NOVICE.COMMON} minutes`],
    ],
    [
      `Apprentice (${exp.APPRENTICE.toLocaleString()}-${(exp.MASTER - 1).toLocaleString()} exp)`,
      [
        `• Common: ${times.APPRENTICE.COMMON} minutes`,
        `• Rare: ${times.APPRENTICE.RARE} minutes`,
      ],
    ],
    [
      `Master (${exp.MASTER.toLocaleString()}-${(exp.FORGEMASTER - 1).toLocaleString()} exp)`,
      [
        `• Common: ${times.MASTER.COMMON} minutes`,
        `• Rare: ${times.MASTER.RARE} minutes`,
        `• Epic: ${times.MASTER.EPIC} minutes`,
      ],
    ],
    [
      `Forgemaster (${exp.FORGEMASTER.toLocaleString()}+ exp)`,
      [
        `• Common: ${times.FORGEMASTER.COMMON} minutes`,
        `• Rare: ${times.FORGEMASTER.RARE} minutes`,
        `• Epic: ${times.FORGEMASTER.EPIC} minutes`,
        `• Legendary: ${times.FORGEMASTER.LEGENDARY} minutes`,
      ],
    ],
  ]);
  for (const badge of card.querySelectorAll(".md\\:grid-cols-2 > div > .mb-2")) {
    expect(badge.className).toContain("mb-2");
  }
  for (const list of card.querySelectorAll(".md\\:grid-cols-2 ul")) {
    expect(list.className).toBe("space-y-1 text-muted-foreground");
  }
});
