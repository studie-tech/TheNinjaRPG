import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import type { UserWithRelations } from "@/server/api/routers/profile";

type Purchase = { itemId: string; stack: number; villageId?: string | null };
type PurchaseResult = { success: boolean; message: string };
type PurchaseOptions = {
  onSuccess: (result: PurchaseResult, input: Purchase, revision: unknown) => void;
  onSettled?: () => void;
};

const item = (overrides: Record<string, unknown>) => ({
  id: "x", name: "X", image: "/x.webp", itemType: "WEAPON", rarity: "COMMON", slot: "HAND",
  effects: [], cost: 0, repsCost: 0, seichiSilverCost: 0, canStack: false, stackSize: 1,
  expireFromStoreAt: null, description: "", ...overrides,
});
const catalog = [
  item({ id: "bow", name: "Bow", rarity: "RARE", cost: 300 }),
  item({ id: "axe", name: "Axe", rarity: "LEGENDARY", cost: 9_000 }),
  item({ id: "pill", name: "Pill", itemType: "CONSUMABLE", slot: "ITEM", cost: 20, canStack: true, stackSize: 50, description: "Restores a little chakra." }),
  item({ id: "coat", name: "Coat", itemType: "ARMOR", slot: "CHEST", rarity: "RARE", cost: 200 }),
];

let pageItems = catalog;
let purchaseOptions: PurchaseOptions;
let purchaseResult: PurchaseResult;
let hasNextPage = false;
let isFetchNextPageError = false;
let tutorialStep: { id: string; page: string } | null = null;
const fetchNextPage = vi.fn();
const completeTutorialAction = vi.fn(async () => {});
const purchase = vi.fn((input: Purchase) => {
  purchaseOptions.onSuccess(purchaseResult, input, undefined);
  purchaseOptions.onSettled?.();
});

import * as client from "@/app/_trpc/client";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImage from "@/layout/ContentImage";
import * as Image from "@/layout/Image";
import * as ItemShopFiltering from "@/layout/ItemShopFiltering";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as Modal from "@/layout/Modal";
import Shop from "@/layout/Shop";
import * as shop from "@/libs/shop";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";

const user = {
  userId: "player", level: 50, money: 1_000, reputationPoints: 0, seichiSilver: 0,
  villageId: "village", village: { structures: [] },
} as unknown as NonNullable<UserWithRelations>;

const renderShop = (props: Partial<Parameters<typeof Shop>[0]> = {}) =>
  render(<Shop userData={user} defaultType="WEAPON" {...props} />);
const names = (view: ReturnType<typeof render>) =>
  within(view.getByRole("list", { name: "Shop items" }))
    .queryAllByRole("button")
    .map((button) => button.getAttribute("data-item-name"));
const chip = (view: ReturnType<typeof render>, name: RegExp) =>
  view.getByRole("button", { name });

const browserGlobals = ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "StorageEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  for (const key of browserGlobals) {
    if (key in window) Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof Window] });
  }
  vi.clearAllMocks();
  purchaseResult = { success: true, message: "Purchased" };
  hasNextPage = false;
  isFetchNextPageError = false;
  tutorialStep = null;
  pageItems = catalog;
  localStorage.clear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      item: { getUserItems: { invalidate: vi.fn() }, getPurchaseAllowance: { invalidate: vi.fn() } },
      home: { getUserHome: { invalidate: vi.fn() } },
    }),
    item: {
      get: { useQuery: () => ({ data: tutorialStep ? item({ id: TUTORIAL_ITEM_ID, name: "Shuriken", cost: 45 }) : undefined }) },
      getAll: { useInfiniteQuery: () => ({ data: { pages: [{ data: pageItems }] }, isFetching: false, hasNextPage, isFetchNextPageError, fetchNextPage }) },
      getBloodlineRollOdds: { useQuery: () => ({}) },
      getPurchaseAllowance: { useQuery: () => ({ data: { remaining: null, limit: null }, refetch: vi.fn() }) },
      buy: { useMutation: (options: PurchaseOptions) => {
        purchaseOptions = options;
        return { mutate: purchase, isPending: false };
      } },
    },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ prepareUserUpdate: vi.fn(), updateUser: vi.fn() } as never);
  vi.spyOn(routing, "useAwake").mockReturnValue(true);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/itemshop");
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(() => ({ currentStep: tutorialStep, completeTutorialAction }) as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(ContentImage, "default").mockImplementation(() => null);
  vi.spyOn(Image, "default").mockImplementation(() => null);
  vi.spyOn(ItemWithEffects, "default").mockImplementation(() => null);
  vi.spyOn(Modal, "default").mockImplementation(({ children, isOpen, onAccept, proceed_label, id }) =>
    isOpen ? (
      <div role="dialog">
        {children}
        <button type="button" id={id ? `${id}-proceed` : undefined} onClick={(event) => onAccept?.(event as never)}>
          {proceed_label}
        </button>
      </div>
    ) : null,
  );
  vi.spyOn(ItemShopFiltering, "ItemShopFiltering").mockImplementation(() => null);
  vi.spyOn(ItemShopFiltering, "useShopFiltering").mockImplementation(() => ({ name: "", setName: vi.fn() }) as never);
  vi.spyOn(ItemShopFiltering, "getShopFilter").mockImplementation(() => ({}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "ResizeObserver");
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

describe("shop catalog", () => {
  it("counts every item and each type in stock, and opens on the shop's own type", () => {
    const view = renderShop();
    expect(chip(view, /^All 4$/)).toBeTruthy();
    expect(chip(view, /^Weapons 2$/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(view, /^Consumables 1$/)).toBeTruthy();
    expect(chip(view, /^Armor 1$/)).toBeTruthy();
    expect(names(view)).toEqual(["Axe", "Bow"]);
    fireEvent.click(chip(view, /^All 4$/));
    expect(names(view)).toEqual(["Axe", "Coat", "Bow", "Pill"]);
  });

  it("sorts by price, name or type, and remembers the choice", () => {
    const view = renderShop({ defaultType: "OTHER" });
    fireEvent.change(view.getByRole("combobox"), { target: { value: "price" } });
    expect(names(view)).toEqual(["Pill", "Coat", "Bow", "Axe"]);
    fireEvent.change(view.getByRole("combobox"), { target: { value: "name" } });
    expect(names(view)).toEqual(["Axe", "Bow", "Coat", "Pill"]);
    cleanup();
    expect(names(renderShop({ defaultType: "OTHER" }))).toEqual(["Axe", "Bow", "Coat", "Pill"]);
  });

  it("shows only what the player can pay for under Affordable", () => {
    const view = renderShop();
    fireEvent.click(chip(view, /^Affordable 3$/));
    expect(names(view)).toEqual(["Coat", "Bow", "Pill"]);
  });

  it("says what is missing and does not offer to buy it", () => {
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Axe/ }));
    const buy = view.container.querySelector<HTMLButtonElement>("#tutorial-itemshop-buy");
    expect(buy?.textContent).toBe("Need 8,000 ryo more");
    expect(buy?.disabled).toBe(true);
  });

  it("asks for confirmation, then buys and closes the item", async () => {
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    fireEvent.click(view.container.querySelector("#tutorial-itemshop-buy") as HTMLElement);
    const dialog = view.getByRole("dialog");
    expect(dialog.textContent).toContain("You will have 700 ryo left");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Buy for 300 ryo" })));
    expect(purchase).toHaveBeenCalledWith({ itemId: "bow", stack: 1, villageId: "village" });
    expect(view.queryByRole("region", { name: "Bow" })).toBeNull();
  });

  it("keeps the dialog open with the server's message when a purchase is refused", async () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    fireEvent.click(view.container.querySelector("#tutorial-itemshop-buy") as HTMLElement);
    await act(async () => fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Buy for 300 ryo" })));
    expect(within(view.getByRole("dialog")).getByRole("alert").textContent).toBe("Inventory is full");
  });

  it("buys several of a stackable item at once", async () => {
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(view.container.querySelector("#tutorial-itemshop-buy") as HTMLElement);
    await act(async () => fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Buy for 60 ryo" })));
    expect(purchase).toHaveBeenCalledWith({ itemId: "pill", stack: 3, villageId: "village" });
  });

  it("loads the rest of the catalog so the chips cover every item", () => {
    hasNextPage = true;
    renderShop();
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("stops loading after a failed page and offers to try again", () => {
    hasNextPage = true;
    isFetchNextPageError = true;
    const view = renderShop();
    expect(fetchNextPage).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("shows the picked item's full details straight away", () => {
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    const inspector = view.getByRole("region", { name: "Pill" });
    expect(within(inspector).getByRole("region", { name: "Details" })).toBeDefined();
    expect(within(inspector).queryByText("All details")).toBeNull();
    expect(within(inspector).getByText("Restores a little chakra.")).toBeDefined();
    // The header already shows the description, so the details start with the stats.
    const details = (ItemWithEffects.default as unknown as { mock: { calls: [{ item: { description: string } }][] } }).mock.calls.at(-1)?.[0];
    expect(details?.item.description).toBe("");
  });

  it("keeps a cleared quantity editable without breaking the price or stepper", () => {
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    const quantity = view.getByRole("spinbutton", { name: "How many to buy" }) as HTMLInputElement;
    fireEvent.input(quantity, { target: { value: "" } });
    expect(quantity.value).toBe("");
    const inspector = view.getByRole("region", { name: "Pill" });
    expect(inspector.textContent).not.toContain("NaN");
    expect((view.container.querySelector("#tutorial-itemshop-buy") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    expect(quantity.value).toBe("2");
    expect(inspector.textContent).toContain("Buy for 40 ryo");
  });

  it("leads with the tutorial's item and completes the step once it is bought", async () => {
    tutorialStep = { id: "tools-buy-shuriken", page: "/itemshop" };
    const view = renderShop();
    expect(names(view)[0]).toBe("Shuriken");
    expect(view.container.querySelector("#tutorial-itemshop-item")?.textContent).toContain("Shuriken");
    fireEvent.click(view.getByRole("button", { name: /Shuriken/ }));
    fireEvent.click(view.container.querySelector("#tutorial-itemshop-buy") as HTMLElement);
    await act(async () => fireEvent.click(view.container.querySelector("#tutorial-itemshop-confirmPurchase-proceed") as HTMLElement));
    expect(completeTutorialAction).toHaveBeenCalledWith("buyItem");
  });

  it("sorts the Black Market by price in the currency it sells for", () => {
    pageItems = [
      item({ id: "a", name: "A", cost: 100, repsCost: 50 }),
      item({ id: "b", name: "B", cost: 10, repsCost: 90 }),
      item({ id: "c", name: "C", cost: 50, repsCost: 10 }),
    ];
    const view = renderShop({ minRepsCost: 1 });
    fireEvent.change(view.getByRole("combobox"), { target: { value: "price" } });
    expect(names(view)).toEqual(["C", "A", "B"]);
  });

  it("shows the ryo discount the price actually gets", () => {
    vi.spyOn(shop, "getShopDiscounts").mockReturnValue([
      { label: "village structures", value: 60 },
      { label: "ANBU membership", value: 50 },
    ]);
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    const inspector = view.getByRole("region", { name: "Bow" });
    expect(inspector.textContent).toContain("Ryo discount −95%");
    expect(inspector.textContent).toContain("Buy for 15 ryo");
  });

  it("sends one purchase however often the confirmation is pressed", () => {
    purchase.mockImplementation(() => {});
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    fireEvent.click(view.container.querySelector("#tutorial-itemshop-buy") as HTMLElement);
    const confirm = within(view.getByRole("dialog")).getByRole("button", { name: "Buy for 300 ryo" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(purchase).toHaveBeenCalledTimes(1);
  });

  it("measures the shop once the player wakes up", () => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() {
          this.callback([{ contentRect: { width: 390 } } as never], this as never);
        }
        disconnect() {}
      },
    });
    const awake = vi.spyOn(routing, "useAwake").mockReturnValue(false);
    const view = renderShop();
    awake.mockReturnValue(true);
    view.rerender(<Shop userData={user} defaultType="WEAPON" />);
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    expect(within(document.body).getByRole("dialog", { name: "Bow" })).toBeTruthy();
  });

  it("opens the item in a bottom sheet on narrow screens", () => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() {
          this.callback([{ contentRect: { width: 390 } } as never], this as never);
        }
        disconnect() {}
      },
    });
    const view = renderShop();
    expect(view.queryByRole("complementary", { name: "Item" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    expect(within(document.body).getByRole("dialog", { name: "Bow" })).toBeTruthy();
  });
});
