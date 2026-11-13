import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import type { UserWithRelations } from "@/server/api/routers/profile";

type Purchase = { itemId: string; stack: number; villageId?: string | null };
type PurchaseResult = { success: boolean; message: string };
type PurchaseOptions = {
  onSuccess: (result: PurchaseResult, input: Purchase, revision: unknown) => void;
};
let purchaseOptions: PurchaseOptions;
let purchaseResult: PurchaseResult = { success: true, message: "Purchased" };
const furniture = {
  id: "custom-cabinet",
  name: "Painted Cabinet",
  image: "/cabinet.webp",
  itemType: "FURNITURE",
  rarity: "COMMON",
  effects: [],
  cost: 100,
  repsCost: 0,
  seichiSilverCost: 0,
  canStack: false,
  stackSize: 1,
  expireFromStoreAt: null,
};
let tutorialItem: typeof furniture | undefined;
const homeInvalidation = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);
const updateUser = vi.fn(async () => undefined);
const setItemType = vi.fn();
const catalogQuery = vi.fn(() => ({
  data: {
    pages: [
      {
        data: [
          furniture,
          { ...furniture, id: "weapon", name: "Sword", itemType: "WEAPON" },
        ],
      },
    ],
  },
  isFetching: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
}));
const purchase = vi.fn((input: Purchase) =>
  purchaseOptions.onSuccess(purchaseResult, input, undefined),
);

import * as client from "@/app/_trpc/client";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImage from "@/layout/ContentImage";
import * as Image from "@/layout/Image";
import * as ItemShopFiltering from "@/layout/ItemShopFiltering";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as Modal from "@/layout/Modal";
import Shop from "@/layout/Shop";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import { mockUserContextValue } from "../setup/userContext";

const user = {
  level: 50,
  money: 1_000,
  reputationPoints: 0,
  seichiSilver: 0,
  villageId: "village",
  village: { structures: [] },
} as unknown as NonNullable<UserWithRelations>;

beforeEach(() => {
  vi.clearAllMocks();
  purchaseResult = { success: true, message: "Purchased" };
  tutorialItem = undefined;
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      item: {
        getUserItems: { invalidate },
        getPurchaseAllowance: { invalidate },
      },
      home: { getUserHome: { invalidate: homeInvalidation } },
    }),
    item: {
      get: { useQuery: () => ({ data: tutorialItem }) },
      getAll: { useInfiniteQuery: catalogQuery },
      getBloodlineRollOdds: { useQuery: () => ({}) },
      getPurchaseAllowance: {
        useQuery: () => ({ data: { remaining: null, limit: null }, refetch: vi.fn() }),
      },
      buy: {
        useMutation: (options: PurchaseOptions) => {
          purchaseOptions = options;
          return { mutate: purchase, isPending: false };
        },
      },
    },
  });
  mockUserContextValue({
    prepareUserUpdate: vi.fn(),
    updateUser,
  } as never);
  vi.spyOn(routing, "useAwake").mockReturnValue(true);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/home");
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: null,
    completeTutorialAction: vi.fn(async () => {}),
  } as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(ContentImage, "default").mockImplementation(() => null);
  vi.spyOn(Image, "default").mockImplementation(() => null);
  vi.spyOn(ItemWithEffects, "default").mockImplementation(() => null);
  vi.spyOn(Modal, "default").mockImplementation(
    ({ children, isOpen, onAccept, proceed_label }) =>
      isOpen ? (
        <div role="dialog">
          {children}
          <button type="button" onClick={onAccept}>
            {proceed_label}
          </button>
        </div>
      ) : null,
  );
  vi.spyOn(ItemShopFiltering, "ItemShopFiltering").mockImplementation(() => null);
  vi.spyOn(ItemShopFiltering, "useShopFiltering").mockImplementation((defaultType) => {
    const [itemType, updateItemType] = useState(defaultType);
    const [name, setName] = useState("");
    return {
      itemType,
      name,
      setName,
      setItemType: (value) => {
        setItemType(value);
        updateItemType(value);
      },
    } as ReturnType<typeof ItemShopFiltering.useShopFiltering>;
  });
  vi.spyOn(ItemShopFiltering, "getShopFilter").mockImplementation((state) => ({
    itemType: state.itemType,
    name: state.name,
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("furniture catalog integration", () => {
  it("offers Furniture alongside ordinary item categories", () => {
    const view = render(<Shop userData={user} defaultType="WEAPON" />);
    expect(view.getByRole("tab", { name: "Weapon" })).toBeTruthy();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Furniture" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(setItemType).toHaveBeenCalledWith("FURNITURE");
  });

  it("keeps search filters and clears the purchase dialog when changing categories", async () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = render(<Shop userData={user} defaultType="WEAPON" />);
    fireEvent.change(view.getByRole("textbox"), { target: { value: "Painted" } });
    fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Buy for 100 ryo" })),
    );
    expect(view.getByRole("alert").textContent).toBe("Inventory is full");

    fireEvent.mouseDown(view.getByRole("tab", { name: "Furniture" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(catalogQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemType: "FURNITURE", name: "Painted" }),
      expect.anything(),
    );
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByRole("tabpanel").querySelector("#tutorial-itemshop")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("keeps the tutorial item reachable after a category change and advances on purchase", async () => {
    tutorialItem = {
      ...furniture,
      id: TUTORIAL_ITEM_ID,
      name: "Shuriken",
      itemType: "WEAPON",
    };
    const completeTutorialAction = vi.fn(async () => {});
    vi.spyOn(routing, "usePublicPathname").mockReturnValue("/itemshop");
    vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
      currentStep: { id: "tools-buy-shuriken", page: "/itemshop" },
      completeTutorialAction,
    } as never);
    const view = render(<Shop userData={user} defaultType="WEAPON" />);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Furniture" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(view.container.querySelector("#tutorial-itemshop-item")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /Shuriken/ }));
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Buy for 100 ryo" })),
    );
    expect(completeTutorialAction).toHaveBeenCalledWith("buyItem");
  });

  it("purchases through item.buy and refreshes the residence after delivery", async () => {
    const view = render(<Shop userData={user} defaultType="FURNITURE" />);
    expect(catalogQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        itemType: "FURNITURE",
        onlyInShop: true,
        excludeExpiredFromStore: true,
        hidden: false,
      }),
      expect.anything(),
    );
    fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
    expect(view.getByText("Furniture is delivered to your home storage.")).toBeTruthy();
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Buy for 100 ryo" })),
    );
    expect(purchase).toHaveBeenCalledWith({
      itemId: "custom-cabinet",
      stack: 1,
      villageId: "village",
    });
    expect(homeInvalidation).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("retains a rejected purchase with an inline message and does not refresh ownership", async () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = render(<Shop userData={user} defaultType="FURNITURE" />);
    fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
    await act(async () =>
      fireEvent.click(view.getByRole("button", { name: "Buy for 100 ryo" })),
    );
    expect(view.getByRole("alert").textContent).toBe("Inventory is full");
    expect(view.getByRole("dialog")).toBeTruthy();
    expect(homeInvalidation).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
