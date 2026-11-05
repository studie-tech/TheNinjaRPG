import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { UserWithRelations } from "@/server/api/routers/profile";

type Purchase = { itemId: string; stack: number; villageId?: string | null };
type PurchaseResult = { success: boolean; message: string };
type PurchaseOptions = {
  onSuccess: (result: PurchaseResult, input: Purchase, revision: unknown) => void;
};
let purchaseOptions: PurchaseOptions;
let purchaseResult: PurchaseResult = { success: true, message: "Purchased" };
const furniture = {
  id: "custom-cabinet", name: "Painted Cabinet", image: "/cabinet.webp",
  itemType: "FURNITURE", rarity: "COMMON", slot: "NONE", effects: [], description: "",
  cost: 100, repsCost: 0, seichiSilverCost: 0,
  canStack: false, stackSize: 1, expireFromStoreAt: null,
};
const homeInvalidation = vi.fn(async () => undefined);
const invalidate = vi.fn(async () => undefined);
const updateUser = vi.fn(async () => undefined);
const catalogQuery = vi.fn(() => ({
  data: { pages: [{ data: [furniture, { ...furniture, id: "weapon", name: "Sword", itemType: "WEAPON" }] }] },
  isFetching: false, hasNextPage: false, fetchNextPage: vi.fn(),
}));
const purchase = vi.fn((input: Purchase) => purchaseOptions.onSuccess(purchaseResult, input, undefined));

import * as client from "@/app/_trpc/client";
import * as UserContext from "@/utils/UserContext";
import * as routing from "@/utils/routing";
import * as tutorial from "@/hooks/tutorial";
import * as toast from "@/libs/toast";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImage from "@/layout/ContentImage";
import * as Image from "@/layout/Image";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as Modal from "@/layout/Modal";
import * as ItemShopFiltering from "@/layout/ItemShopFiltering";
import Shop from "@/layout/Shop";

const user = {
  userId: "player", level: 50, money: 1_000, reputationPoints: 0, seichiSilver: 0,
  villageId: "village", village: { structures: [] },
} as unknown as NonNullable<UserWithRelations>;

const browserGlobals = ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "StorageEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  for (const key of browserGlobals) {
    if (key in window) Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof Window] });
  }
  vi.clearAllMocks();
  purchaseResult = { success: true, message: "Purchased" };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      item: {
        getUserItems: { invalidate },
        getPurchaseAllowance: { invalidate },
      },
      home: { getUserHome: { invalidate: homeInvalidation } },
    }),
    item: {
      get: { useQuery: () => ({ data: undefined }) },
      getAll: { useInfiniteQuery: catalogQuery },
      getBloodlineRollOdds: { useQuery: () => ({}) },
      getPurchaseAllowance: { useQuery: () => ({ data: { remaining: null, limit: null }, refetch: vi.fn() }) },
      buy: { useMutation: (options: PurchaseOptions) => {
        purchaseOptions = options;
        return { mutate: purchase, isPending: false };
      } },
    },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ prepareUserUpdate: vi.fn(), updateUser } as never);
  vi.spyOn(routing, "useAwake").mockReturnValue(true);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/home");
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({ currentStep: null, completeTutorialAction: vi.fn(async () => {}) } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(ContentImage, "default").mockImplementation(() => null);
  vi.spyOn(Image, "default").mockImplementation(() => null);
  vi.spyOn(ItemWithEffects, "default").mockImplementation(() => null);
  vi.spyOn(Modal, "default").mockImplementation(({ children, isOpen, onAccept, proceed_label }) =>
    isOpen ? <div role="dialog">{children}<button type="button" onClick={(event) => onAccept?.(event as never)}>{proceed_label}</button></div> : null,
  );
  vi.spyOn(ItemShopFiltering, "ItemShopFiltering").mockImplementation(() => null);
  vi.spyOn(ItemShopFiltering, "useShopFiltering").mockImplementation(() => ({ name: "", setName: vi.fn() }) as never);
  vi.spyOn(ItemShopFiltering, "getShopFilter").mockImplementation(() => ({}));
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

const buy = async (view: ReturnType<typeof render>) => {
  fireEvent.click(view.container.querySelector("#tutorial-itemshop-buy") as HTMLElement);
  await act(async () =>
    fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Buy for 100 ryo" })),
  );
};

describe("furniture catalog integration", () => {
  it("offers Furniture alongside ordinary item categories", () => {
    const view = render(<Shop userData={user} defaultType="WEAPON" />);
    expect(view.getByRole("button", { name: /^Weapons 1$/ })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /^Furniture 1$/ }));
    expect(view.getByRole("button", { name: /Painted Cabinet/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /Sword/ })).toBeNull();
  });

  it("purchases through item.buy and refreshes the residence after delivery", async () => {
    const view = render(<Shop userData={user} defaultType="FURNITURE" />);
    expect(catalogQuery).toHaveBeenCalledWith(expect.objectContaining({
      onlyInShop: true, excludeExpiredFromStore: true, hidden: false,
    }), expect.anything());
    fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
    expect(view.getByText("Furniture is delivered to your home storage.")).toBeTruthy();
    await buy(view);
    expect(purchase).toHaveBeenCalledWith({ itemId: "custom-cabinet", stack: 1, villageId: "village" });
    expect(homeInvalidation).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("retains a rejected purchase with an inline message and does not refresh ownership", async () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = render(<Shop userData={user} defaultType="FURNITURE" />);
    fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
    await buy(view);
    expect(within(view.getByRole("dialog")).getByRole("alert").textContent).toBe("Inventory is full");
    expect(homeInvalidation).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
