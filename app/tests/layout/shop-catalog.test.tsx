import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import * as sheet from "@/components/ui/sheet";
import { TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import * as tutorial from "@/hooks/tutorial";
import * as mediaQuery from "@/hooks/useMediaQuery";
import * as ContentBox from "@/layout/ContentBox";
import * as ContentImage from "@/layout/ContentImage";
import * as Image from "@/layout/Image";
import * as ItemShopFiltering from "@/layout/ItemShopFiltering";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as Modal from "@/layout/Modal";
import Shop from "@/layout/Shop";
import { MobileShop } from "@/layout/shop/MobileShop";
import * as pagination from "@/libs/pagination";
import * as shop from "@/libs/shop";
import * as toast from "@/libs/toast";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as routing from "@/utils/routing";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { mockUserContextValue } from "../setup/userContext";

type Purchase = { itemId: string; stack: number; villageId?: string | null };
type PurchaseResult = { success: boolean; message: string };
type PurchaseOptions = {
  onSuccess: (result: PurchaseResult, input: Purchase, revision: unknown) => void;
  onSettled?: () => void;
};

const item = (overrides: Record<string, unknown>) => ({
  id: "x",
  name: "X",
  image: "/x.webp",
  itemType: "WEAPON",
  rarity: "COMMON",
  slot: "HAND",
  effects: [],
  cost: 0,
  repsCost: 0,
  seichiSilverCost: 0,
  canStack: false,
  stackSize: 1,
  expireFromStoreAt: null,
  description: "",
  ...overrides,
});
const catalog = [
  item({ id: "bow", name: "Bow", rarity: "RARE", cost: 300 }),
  item({ id: "axe", name: "Axe", rarity: "LEGENDARY", cost: 9_000 }),
  item({
    id: "pill",
    name: "Pill",
    itemType: "CONSUMABLE",
    slot: "ITEM",
    cost: 20,
    canStack: true,
    stackSize: 50,
    description: "Restores a little chakra.",
  }),
  item({
    id: "coat",
    name: "Coat",
    itemType: "ARMOR",
    slot: "CHEST",
    rarity: "RARE",
    cost: 200,
  }),
];

let pageItems = catalog;
let purchaseOptions: PurchaseOptions;
let purchaseResult: PurchaseResult;
let remaining: number | null = null;
let hasNextPage = false;
let isFetchNextPageError = false;
let tutorialStep: { id: string; page: string } | null = null;
const fetchNextPage = vi.fn();
const catalogQuery = vi.fn((_input: Record<string, unknown>, _options?: unknown) => ({
  data: { pages: [{ data: pageItems }] },
  isFetching: false,
  hasNextPage,
  isFetchNextPageError,
  fetchNextPage,
}));
const completeTutorialAction = vi.fn(async () => {});
const purchase = vi.fn((input: Purchase) => {
  purchaseOptions.onSuccess(purchaseResult, input, undefined);
  purchaseOptions.onSettled?.();
});

const user = {
  userId: "player",
  level: 50,
  money: 1_000,
  reputationPoints: 0,
  seichiSilver: 0,
  villageId: "village",
  village: { structures: [] },
} as unknown as NonNullable<UserWithRelations>;

const renderShop = (props: Partial<Parameters<typeof Shop>[0]> = {}) =>
  render(<MobileShop userData={user} defaultType="WEAPON" {...props} />);
const names = (view: ReturnType<typeof render>) =>
  within(view.getByRole("list", { name: "Shop items" }))
    .queryAllByRole("button")
    .map((button) => button.getAttribute("data-item-name"));
const chip = (view: ReturnType<typeof render>, name: RegExp) =>
  view.getByRole("button", { name });

beforeEach(() => {
  installBrowserGlobals();
  vi.clearAllMocks();
  purchaseResult = { success: true, message: "Purchased" };
  remaining = null;
  hasNextPage = false;
  isFetchNextPageError = false;
  tutorialStep = null;
  pageItems = catalog;
  localStorage.clear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      item: {
        getUserItems: { invalidate: vi.fn() },
        getPurchaseAllowance: { invalidate: vi.fn() },
      },
      home: { getUserHome: { invalidate: vi.fn() } },
    }),
    item: {
      get: {
        useQuery: () => ({
          data: tutorialStep
            ? item({ id: TUTORIAL_ITEM_ID, name: "Shuriken", cost: 45 })
            : undefined,
        }),
      },
      getAll: { useInfiniteQuery: catalogQuery },
      getBloodlineRollOdds: { useQuery: () => ({}) },
      getPurchaseAllowance: {
        useQuery: () => ({
          data: { remaining, limit: remaining === null ? null : 1 },
          refetch: vi.fn(),
        }),
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
    updateUser: vi.fn(),
  } as never);
  vi.spyOn(routing, "useAwake").mockReturnValue(true);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/itemshop");
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(
    () => ({ currentStep: tutorialStep, completeTutorialAction }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(ContentImage, "default").mockImplementation(() => null);
  vi.spyOn(Image, "default").mockImplementation(() => null);
  vi.spyOn(ItemWithEffects, "default").mockImplementation(() => null);
  vi.spyOn(Modal, "default").mockImplementation(
    ({
      children,
      isOpen,
      setIsOpen,
      onClose,
      onAccept,
      proceedDisabled,
      proceed_label,
      id,
    }) =>
      isOpen ? (
        <div role="dialog">
          {children}
          <button
            type="button"
            onClick={() => {
              onClose?.();
              setIsOpen(false);
            }}
          >
            Close
          </button>
          <button
            type="button"
            id={id ? `${id}-proceed` : undefined}
            disabled={proceedDisabled}
            onClick={(event) => onAccept?.(event as never)}
          >
            {proceed_label}
          </button>
        </div>
      ) : null,
  );
  vi.spyOn(ItemShopFiltering, "ItemShopFiltering").mockImplementation(() => null);
  vi.spyOn(ItemShopFiltering, "useShopFiltering").mockImplementation(() => {
    const [name, setName] = useState("");
    return { name, setName } as never;
  });
  vi.spyOn(ItemShopFiltering, "getShopFilter").mockImplementation((state) => ({
    name: state.name,
    itemType: "WEAPON",
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("shop catalog", () => {
  it("filters names locally without changing the catalog query", () => {
    const view = renderShop();
    fireEvent.change(view.getByRole("searchbox"), { target: { value: "bow" } });
    expect(names(view)).toEqual(["Bow"]);
    expect(
      catalogQuery.mock.calls.every(
        ([input]) =>
          !("name" in (input as object)) && !("itemType" in (input as object)),
      ),
    ).toBe(true);
    expect(chip(view, /^All 4$/)).toBeTruthy();
  });

  it("labels an exhausted purchase allowance", () => {
    remaining = 0;
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    const buy = view.getByRole("button", {
      name: "Limit reached",
    }) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
  });

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
    expect(names(renderShop({ defaultType: "OTHER" }))).toEqual([
      "Axe",
      "Bow",
      "Coat",
      "Pill",
    ]);
  });

  it("shows only what the player can pay for under Affordable", () => {
    const view = renderShop();
    fireEvent.click(chip(view, /^Affordable 3$/));
    expect(names(view)).toEqual(["Coat", "Bow", "Pill"]);
  });

  it("says what is missing and does not offer to buy it", () => {
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Axe/ }));
    const buy = view.baseElement.querySelector<HTMLButtonElement>(
      "#tutorial-itemshop-buy",
    );
    expect(buy?.textContent).toBe("Need 8,000 ryo more");
    expect(buy?.disabled).toBe(true);
  });

  it("asks for confirmation, then buys and closes the item", async () => {
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    const dialog = view.getByRole("dialog", { name: "" });
    expect(dialog.textContent).toContain("You will have 700 ryo left");
    await act(async () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Buy for 300 ryo" })),
    );
    expect(purchase).toHaveBeenCalledWith({
      itemId: "bow",
      stack: 1,
      villageId: "village",
    });
    expect(view.queryByRole("region", { name: "Bow" })).toBeNull();
  });

  it("keeps the dialog open with the server's message when a purchase is refused", async () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    await act(async () =>
      fireEvent.click(
        within(view.getByRole("dialog", { name: "" })).getByRole("button", {
          name: "Buy for 300 ryo",
        }),
      ),
    );
    expect(
      within(view.getByRole("dialog", { name: "" })).getByRole("alert").textContent,
    ).toBe("Inventory is full");
  });

  it("buys several of a stackable item at once", async () => {
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    await act(async () =>
      fireEvent.click(
        within(view.getByRole("dialog", { name: "" })).getByRole("button", {
          name: "Buy for 60 ryo",
        }),
      ),
    );
    expect(purchase).toHaveBeenCalledWith({
      itemId: "pill",
      stack: 3,
      villageId: "village",
    });
  });

  it("keeps the reviewed quantity and blocks buying when the allowance drops", () => {
    remaining = 3;
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );

    remaining = 1;
    view.rerender(<MobileShop userData={user} defaultType="CONSUMABLE" />);
    const dialog = view.getByRole("dialog", { name: "" });
    expect(dialog.textContent).toContain("3× Pill");
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "Quantity exceeds the current limit of 1.",
    );
    const confirm = within(dialog).getByRole("button", {
      name: "Buy for 60 ryo",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(purchase).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    const inspector = view.getByRole("region", { name: "Pill" });
    expect(within(inspector).getByRole("alert").textContent).toBe(
      "Quantity exceeds the current limit of 1.",
    );
    expect(
      (view.getByRole("spinbutton", { name: "How many to buy" }) as HTMLInputElement)
        .value,
    ).toBe("3");
    fireEvent.click(view.getByRole("button", { name: "One less" }));
    fireEvent.click(view.getByRole("button", { name: "One less" }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    fireEvent.click(
      within(view.getByRole("dialog", { name: "" })).getByRole("button", {
        name: "Buy for 20 ryo",
      }),
    );
    expect(purchase).toHaveBeenCalledWith({
      itemId: "pill",
      stack: 1,
      villageId: "village",
    });
  });

  it("keeps a blank quantity repairable when the allowance drops to one", () => {
    remaining = 2;
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    fireEvent.input(view.getByRole("spinbutton", { name: "How many to buy" }), {
      target: { value: "" },
    });

    remaining = 1;
    view.rerender(<MobileShop userData={user} defaultType="CONSUMABLE" />);
    const quantity = view.getByRole("spinbutton", {
      name: "How many to buy",
    }) as HTMLInputElement;
    const buy = view.baseElement.querySelector(
      "#tutorial-itemshop-buy",
    ) as HTMLButtonElement;
    expect(quantity.value).toBe("");
    expect(buy.disabled).toBe(true);
    expect(
      (view.getByRole("button", { name: "One more" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.input(quantity, { target: { value: "1" } });
    expect(quantity.value).toBe("1");
    expect(buy.disabled).toBe(false);
    fireEvent.click(buy);
    expect(view.getByRole("dialog", { name: "" }).textContent).toContain(
      "Buy Pill for 20 ryo?",
    );
  });

  it("clears a refused purchase when closing before reviewing a new quantity", () => {
    purchaseResult = { success: false, message: "Inventory is full" };
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    const dialog = view.getByRole("dialog", { name: "" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Buy for 20 ryo" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Inventory is full");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(view.queryByText("Inventory is full")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    const reopened = view.getByRole("dialog", { name: "" });
    expect(reopened.textContent).toContain("2× Pill");
    expect(within(reopened).queryByRole("alert")).toBeNull();
    expect(purchase).toHaveBeenCalledTimes(1);
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
    const details = (
      ItemWithEffects.default as unknown as {
        mock: { calls: [{ item: { description: string } }][] };
      }
    ).mock.calls.at(-1)?.[0];
    expect(details?.item.description).toBe("");
  });

  it("keeps every paragraph of a long description readable in the inspector", () => {
    pageItems = [
      item({
        id: "manual",
        name: "Manual",
        description:
          "<p>First instruction.</p><p>Second instruction.</p><p>Third instruction.</p><p>Final instruction.</p>",
      }),
    ];
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Manual/ }));
    const description = view
      .getByRole("region", { name: "Manual" })
      .querySelector("[data-reading-text]");
    expect(description?.querySelectorAll("p")).toHaveLength(4);
    expect(description?.className).not.toContain("line-clamp");
  });

  it("restores focus to the last selected card when the sheet finishes closing", () => {
    let closeAutoFocus: Parameters<typeof sheet.SheetContent>[0]["onCloseAutoFocus"];
    // Exercise the shop's opener and close handler independently of the sheet's focus scope.
    vi.spyOn(sheet, "SheetContent").mockImplementation(
      Object.assign(
        (props: Parameters<typeof sheet.SheetContent>[0]) => {
          closeAutoFocus = props.onCloseAutoFocus;
          return <div>{props.children}</div>;
        },
        { displayName: sheet.SheetContent.displayName },
      ),
    );
    const view = renderShop();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    fireEvent.click(view.getByRole("button", { name: "Close item" }));
    const card = view.getByRole("button", { name: /Axe/ });
    fireEvent.click(card);
    fireEvent.click(view.getByRole("button", { name: "Close item" }));
    const event = new Event("closeAutoFocus", { cancelable: true });
    act(() => closeAutoFocus?.(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(card);
  });

  it("keeps a cleared quantity editable without breaking the price or stepper", () => {
    const view = renderShop({ defaultType: "CONSUMABLE" });
    fireEvent.click(view.getByRole("button", { name: /Pill/ }));
    const quantity = view.getByRole("spinbutton", {
      name: "How many to buy",
    }) as HTMLInputElement;
    fireEvent.input(quantity, { target: { value: "" } });
    expect(quantity.value).toBe("");
    const inspector = view.getByRole("region", { name: "Pill" });
    expect(inspector.textContent).not.toContain("NaN");
    expect(
      (view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "One more" }));
    expect(quantity.value).toBe("2");
    expect(inspector.textContent).toContain("Buy for 40 ryo");
  });

  it("leads with the tutorial's item and completes the step once it is bought", async () => {
    tutorialStep = { id: "tools-buy-shuriken", page: "/itemshop" };
    const view = renderShop();
    expect(names(view)[0]).toBe("Shuriken");
    expect(
      view.baseElement.querySelector("#tutorial-itemshop-item")?.textContent,
    ).toContain("Shuriken");
    fireEvent.click(view.getByRole("button", { name: /Shuriken/ }));
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    await act(async () =>
      fireEvent.click(
        view.baseElement.querySelector(
          "#tutorial-itemshop-confirmPurchase-proceed",
        ) as HTMLElement,
      ),
    );
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
    fireEvent.click(
      view.baseElement.querySelector("#tutorial-itemshop-buy") as HTMLElement,
    );
    const confirm = within(view.getByRole("dialog", { name: "" })).getByRole("button", {
      name: "Buy for 300 ryo",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(purchase).toHaveBeenCalledTimes(1);
  });

  it("keeps the mobile purchase sheet accessible when the player wakes up", () => {
    const awake = vi.spyOn(routing, "useAwake").mockReturnValue(false);
    const view = renderShop();
    awake.mockReturnValue(true);
    view.rerender(<MobileShop userData={user} defaultType="WEAPON" />);
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    expect(view.getByRole("dialog", { name: "Bow" })).toBeTruthy();
  });

  it("uses the mobile catalog only below the phone breakpoint", () => {
    const isMobile = vi.spyOn(mediaQuery, "useMediaQuery").mockReturnValue(true);
    const view = render(<Shop userData={user} defaultType="WEAPON" />);
    expect(isMobile).toHaveBeenCalledWith("(max-width: 599px)");
    expect(view.getByRole("list", { name: "Shop items" })).toBeTruthy();
    vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
    isMobile.mockReturnValue(false);
    view.rerender(<Shop userData={user} defaultType="WEAPON" />);
    expect(view.queryByRole("list", { name: "Shop items" })).toBeNull();
  });

  it("opens the item in a bottom sheet", () => {
    const view = renderShop();
    expect(view.queryByRole("complementary", { name: "Item" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /Bow/ }));
    expect(view.getByRole("dialog", { name: "Bow" })).toBeTruthy();
  });
});
