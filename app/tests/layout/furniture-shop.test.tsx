import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import ItemShopPage from "@/app/[shell]/itemshop/page";
import { TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import * as navigation from "@/hooks/navigation";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImage from "@/layout/ContentImage";
import * as Image from "@/layout/Image";
import * as ItemShopFiltering from "@/layout/ItemShopFiltering";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import { ItemShopScreen } from "@/layout/itemshop/ItemShopScreen";
import * as Modal from "@/layout/Modal";
import Shop from "@/layout/Shop";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as routing from "@/utils/routing";
import { ScreenNavigationProvider } from "@/utils/ScreenNavigationContext";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { actualContentBox } from "../setup/preload";
import { mockUserContextValue } from "../setup/userContext";

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
const tutorialItemQuery = vi.fn(() => ({ data: tutorialItem }));
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

/** The Card Master's hub cache binding needs a query client; other shops ignore it. */
const renderShop = (ui: ReactNode) => {
  const client = new QueryClient();
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};

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
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: user,
    access: true,
  } as never);
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
    kessen: {
      getHub: {
        useQuery: () => ({ data: undefined }),
        _def: () => ({ path: ["kessen", "getHub"] }),
      },
    },
    item: {
      get: { useQuery: tutorialItemQuery },
      getAll: { useInfiniteQuery: catalogQuery },
      getBloodlineRollOdds: { useQuery: () => ({}) },
      getPurchaseAllowance: {
        useQuery: () => ({ data: { remaining: null, limit: null }, refetch: vi.fn() }),
      },
      getPurchaseAllowances: { useQuery: () => ({ data: undefined }) },
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
  restoreBrowserGlobals();
});

describe("furniture catalog integration", () => {
  it.each([
    ["route", ItemShopPage],
    ["screen", ItemShopScreen],
  ] as const)(
    "hosts the item shop %s with its own back action and retains purchase state",
    (_name, Screen) => {
      vi.spyOn(ContentBox, "default").mockImplementation(actualContentBox);
      const push = vi.fn();
      vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({ push } as never);
      const close = vi.fn();
      const nextClose = vi.fn();
      const view = renderShop(
        <ScreenNavigationProvider onBack={close}>
          <Screen />
        </ScreenNavigationProvider>,
      );
      expect(UserContext.useRequireInVillage).toHaveBeenCalledWith("/itemshop", {
        onAccessDenied: close,
      });
      expect(routing.useAwake).toHaveBeenCalledWith(user, { onUnavailable: close });
      fireEvent.click(view.getByRole("button", { name: /Painted Cabinet/ }));
      expect(view.getByRole("dialog")).toBeTruthy();
      view.rerender(
        <ScreenNavigationProvider onBack={nextClose}>
          <Screen />
        </ScreenNavigationProvider>,
      );
      expect(view.getByRole("dialog")).toBeTruthy();
      expect(routing.useAwake).toHaveBeenLastCalledWith(user, {
        onUnavailable: nextClose,
      });
      fireEvent.click(view.getByRole("button", { name: "Buy for 100 ryo" }));
      expect(view.queryByRole("dialog")).toBeNull();
      expect(close).not.toHaveBeenCalled();
      expect(nextClose).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole("button", { name: "Item Shop" }));
      expect(nextClose).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    },
  );

  it("offers Furniture alongside ordinary item categories", () => {
    const view = renderShop(<Shop userData={user} defaultType="WEAPON" />);
    expect(view.getByRole("tab", { name: "Weapon" })).toBeTruthy();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Furniture" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(setItemType).toHaveBeenCalledWith("FURNITURE");
  });

  it("leaves Kessen cards and packs to the Card Master stall", () => {
    const view = renderShop(<Shop userData={user} defaultType="CONSUMABLE" />);
    expect(view.queryByRole("tab", { name: "Cards" })).toBeNull();
    expect(catalogQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ onlyInShop: true, kessenGoods: "exclude" }),
      expect.anything(),
    );
    cleanup();
    renderShop(
      <Shop
        userData={user}
        defaultType="CARD"
        restrictTypes={["CARD", "CONSUMABLE"]}
        cardStall
      />,
    );
    expect(catalogQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ kessenGoods: "only" }),
      expect.anything(),
    );
  });

  it("keeps search filters and clears the purchase dialog when changing categories", async () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = renderShop(<Shop userData={user} defaultType="WEAPON" />);
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

  it.each([
    ["ordinary route", "/itemshop", false],
    ["hosted screen", "/travel", true],
  ] as const)(
    "keeps the tutorial item reachable in the %s and advances on purchase",
    async (_name, path, hosted) => {
      tutorialItem = {
        ...furniture,
        id: TUTORIAL_ITEM_ID,
        name: "Shuriken",
        itemType: "WEAPON",
      };
      const completeTutorialAction = vi.fn(async () => {});
      vi.spyOn(routing, "usePublicPathname").mockReturnValue(path);
      vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
        currentStep: { id: "tools-buy-shuriken", page: "/itemshop" },
        completeTutorialAction,
      } as never);
      const view = renderShop(
        hosted ? (
          <ScreenNavigationProvider onBack={vi.fn()}>
            <ItemShopScreen />
          </ScreenNavigationProvider>
        ) : (
          <ItemShopPage />
        ),
      );
      expect(tutorialItemQuery).toHaveBeenLastCalledWith(
        { id: TUTORIAL_ITEM_ID },
        { enabled: true },
      );
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
    },
  );

  it.each(["/souvenirs", "/blackmarket", "/kessen"])(
    "does not pin or advance the item-shop lesson in the %s catalog",
    (path) => {
      tutorialItem = { ...furniture, id: TUTORIAL_ITEM_ID, name: "Shuriken" };
      vi.spyOn(routing, "usePublicPathname").mockReturnValue(path);
      const completeTutorialAction = vi.fn(async () => {});
      vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
        currentStep: { id: "tools-buy-shuriken", page: "/itemshop" },
        completeTutorialAction,
      } as never);
      const view = renderShop(<Shop userData={user} defaultType="WEAPON" />);
      expect(tutorialItemQuery).toHaveBeenLastCalledWith(
        { id: TUTORIAL_ITEM_ID },
        { enabled: false },
      );
      expect(view.container.querySelector("#tutorial-itemshop-item")).toBeNull();
      purchaseOptions.onSuccess(
        purchaseResult,
        { itemId: TUTORIAL_ITEM_ID, stack: 1 },
        undefined,
      );
      expect(completeTutorialAction).not.toHaveBeenCalled();
    },
  );

  it("purchases through item.buy and refreshes the residence after delivery", async () => {
    const view = renderShop(<Shop userData={user} defaultType="FURNITURE" />);
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
    const view = renderShop(<Shop userData={user} defaultType="FURNITURE" />);
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
