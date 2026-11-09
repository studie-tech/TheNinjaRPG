import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { MAX_BULK_SELL_ITEMS } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as bulkSell from "@/hooks/useBulkSellItems";
import * as homeMove from "@/hooks/useHomeStorageMove";
import * as itemActions from "@/hooks/useItemActions";
import * as contentImage from "@/layout/ContentImage";
import * as equipmentPreview from "@/layout/EquipmentPreview";
import * as hotkeyControls from "@/layout/HotkeyControls";
import * as image from "@/layout/Image";
import * as inspector from "@/layout/items/ItemInspector";
import { ItemsWorkspace } from "@/layout/items/ItemsWorkspace";
import * as mastery from "@/libs/mastery";
import * as skills from "@/libs/skillRequirements";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
let sellMany: ReturnType<typeof vi.fn>;
let isSelling = false;
let finish: (result: {
  soldUserItemIds: string[];
  refused: { userItemId: string }[];
}) => void;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  sellMany = vi.fn();
  isSelling = false;
  vi.spyOn(bulkSell, "useBulkSellItems").mockImplementation((({
    onSold,
    onSettled,
  }) => {
    finish = (result) => {
      onSold(result as never);
      onSettled();
    };
    return { sellMany, isSelling };
  }) as typeof bulkSell.useBulkSellItems);
  vi.spyOn(itemActions, "useItemActions").mockReturnValue({
    equip: vi.fn(),
    merge: vi.fn(),
    isEquipping: false,
    isPending: false,
  } as never);
  vi.spyOn(homeMove, "useHomeStorageMove").mockReturnValue({
    moveItems: vi.fn(),
    isMoving: false,
  });
  installBrowserGlobals({
    resizeObserver: class {
      constructor(
        private readonly callback: (
          entries: { contentRect: { width: number } }[],
        ) => void,
      ) {}
      observe() {
        this.callback([{ contentRect: { width: 1000 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  });
  vi.spyOn(hotkeyControls, "useHotkeyAssignment").mockReturnValue({
    hotkeys: { byAction: {} },
    assign: vi.fn(),
    dialog: null,
  } as never);
  vi.spyOn(equipmentPreview, "EquipmentPreview").mockImplementation(() => (
    <button type="button">Preview</button>
  ));
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
    <span>{alt} art</span>
  ));
  // biome-ignore lint/performance/noImgElement: isolated silhouette fixture
  vi.spyOn(image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(mastery, "gearMissingMastery").mockReturnValue(null as never);
  vi.spyOn(skills, "hasRequiredSkill").mockReturnValue(true);
  vi.spyOn(inspector, "ItemInspector").mockImplementation(({ userItem }) => (
    <section aria-label={`Inspecting ${userItem.item.name}`} />
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  window.localStorage.clear();
  if (originalMatchMedia)
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  restoreBrowserGlobals();
});

const stack = (
  name: string,
  rarity: string,
  extra: { cost?: number; quantity?: number; isEventItem?: boolean } = {},
) =>
  ({
    id: name,
    itemId: `item-${name}`,
    quantity: extra.quantity ?? 1,
    level: 1,
    durability: 0,
    equipped: "NONE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: {
      id: `item-${name}`,
      name,
      image: null,
      rarity,
      itemType: "CONSUMABLE",
      slot: "ITEM",
      maxDurability: 0,
      hidden: false,
      effects: [],
      inShop: true,
      cost: extra.cost ?? 100,
      isEventItem: extra.isEventItem ?? false,
      isFarmSeed: false,
      farmSellValue: 0,
    },
  }) as unknown as UserItemWithRelations;

const pill = stack("Chakra Pill", "COMMON", { quantity: 3 });
const scroll = stack("Old Scroll", "COMMON");
const token = stack("Festival Token", "COMMON", { isEventItem: true });
const blade = stack("Storm Blade", "RARE", { cost: 1_000 });
const player = {
  userId: "user-1",
  role: "USER",
  status: "AWAKE",
  battleId: null,
  items: [],
  anbuId: null,
  farmCurrency: 0,
  village: null,
} as never;

const renderWorkspace = (bagItems = [pill, scroll, token, blade]) => {
  const tree = (items: UserItemWithRelations[]) => (
    <ItemsWorkspace userData={player} userItems={items} bagItems={items} bag="normal" />
  );
  const view = render(tree(bagItems));
  return {
    view,
    rerender: (items: UserItemWithRelations[]) => view.rerender(tree(items)),
  };
};

const card = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });
const startSelecting = () =>
  act(() => fireEvent.click(screen.getByRole("button", { name: "Select" })));
const bar = () => screen.getByRole("region", { name: "Selected items" });
const openReview = () =>
  act(() =>
    fireEvent.click(within(bar()).getByRole("button", { name: "Sell / drop…" })),
  );

it("ticks cards instead of opening the inspector while selecting", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  expect(card("Chakra Pill").getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("region", { name: "Inspecting Chakra Pill" })).toBeNull();
  act(() => fireEvent.click(card("Chakra Pill")));
  expect(card("Chakra Pill").getAttribute("aria-pressed")).toBe("false");
});

it("picks every common item in the bag and clears them on a second press", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(screen.getByRole("button", { name: "All Common" })));
  for (const name of ["Chakra Pill", "Old Scroll", "Festival Token"]) {
    expect(card(name).getAttribute("aria-pressed")).toBe("true");
  }
  expect(card("Storm Blade").getAttribute("aria-pressed")).toBe("false");
  act(() => fireEvent.click(screen.getByRole("button", { name: "All Common" })));
  expect(card("Chakra Pill").getAttribute("aria-pressed")).toBe("false");
});

it("shows the count, the ryo and the drops in the selection bar", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(screen.getByRole("button", { name: "All Common" })));
  // 3 pills (60 ryo) and a scroll (20 ryo) sell; the event token drops.
  expect(bar().textContent).toContain("3 selected");
  expect(bar().textContent).toContain("Sell for 80 ryo");
  expect(bar().textContent).toContain("Drop 1");
});

it("lists art, name and quantity in the review window, where unticking updates the totals and the backpack", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Old Scroll")));
  openReview();
  const review = screen.getByRole("dialog", { name: "Sell or drop 2 items" });
  const row = within(review).getByRole("listitem", { name: "Chakra Pill" });
  expect(within(row).getByText("Chakra Pill art")).toBeDefined();
  expect(row.textContent).toContain("×3");
  expect(row.textContent).toContain("+60 ryo");
  act(() =>
    fireEvent.click(
      within(row).getByRole("checkbox", { name: "Keep selling Chakra Pill" }),
    ),
  );
  expect(within(review).getByRole("listitem", { name: "Chakra Pill" })).toBeDefined();
  expect(review.textContent).toContain("Sell for 20 ryo");
  expect(screen.getByRole("dialog", { name: "Sell or drop 1 item" })).toBe(review);
  act(() => fireEvent.keyDown(review, { key: "Escape" }));
  expect(card("Chakra Pill").getAttribute("aria-pressed")).toBe("false");
  expect(card("Old Scroll").getAttribute("aria-pressed")).toBe("true");
});

it("sells straight from the review window when nothing rare is ticked", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  openReview();
  act(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Sell / drop" }),
    ),
  );
  expect(sellMany).toHaveBeenCalledWith(["Chakra Pill"]);
});

it.each(["Back", "Close", "Escape"])(
  "returns focus to the sell opener after %s",
  async (action) => {
    renderWorkspace();
    startSelecting();
    act(() => fireEvent.click(card("Chakra Pill")));
    const opener = within(bar()).getByRole("button", { name: "Sell / drop…" });
    opener.focus();
    openReview();
    const review = screen.getByRole("dialog");
    act(() => {
      if (action === "Escape") fireEvent.keyDown(review, { key: "Escape" });
      else fireEvent.click(within(review).getByRole("button", { name: action }));
    });
    await waitFor(() => expect(document.activeElement === opener).toBe(true));
  },
);

it("returns focus to Select after a completed sale removes the opener", async () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  openReview();
  act(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Sell / drop" }),
    ),
  );
  act(() => finish({ soldUserItemIds: ["Chakra Pill"], refused: [] }));
  await waitFor(() =>
    expect(
      document.activeElement === screen.getByRole("button", { name: "Select" }),
    ).toBe(true),
  );
});

it("returns focus to Select after unticking every stack disables the opener", async () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  openReview();
  const review = screen.getByRole("dialog");
  act(() => fireEvent.click(within(review).getByRole("checkbox")));
  act(() => fireEvent.click(within(review).getByRole("button", { name: "Back" })));
  await waitFor(() =>
    expect(
      document.activeElement === screen.getByRole("button", { name: "Select" }),
    ).toBe(true),
  );
});

it.each([false, true])(
  "freezes the selection and controls while selling with rare step %s",
  (rare) => {
    const { rerender } = renderWorkspace();
    startSelecting();
    act(() => fireEvent.click(card("Chakra Pill")));
    if (rare) act(() => fireEvent.click(card("Storm Blade")));
    openReview();
    if (rare)
      act(() =>
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }),
        ),
      );
    const review = screen.getByRole("dialog");
    const submitName = rare ? "Confirm" : "Sell / drop";
    act(() =>
      fireEvent.click(within(review).getByRole("button", { name: submitName })),
    );
    isSelling = true;
    rerender([pill, scroll, token, blade]);
    const summary = review.textContent;
    for (const checkbox of within(review).getAllByRole("checkbox")) {
      expect((checkbox as HTMLButtonElement).disabled).toBe(true);
      act(() => fireEvent.click(checkbox));
      expect(checkbox.getAttribute("aria-checked")).toBe("true");
    }
    for (const name of ["Back", "Close", submitName]) {
      const button = within(review).getByRole("button", {
        name: new RegExp(`^${name}`),
      });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      act(() => fireEvent.click(button));
    }
    act(() => fireEvent.keyDown(review, { key: "Escape" }));
    expect(screen.getByRole("dialog") === review).toBe(true);
    expect(review.textContent).toBe(summary);
    expect(sellMany).toHaveBeenCalledTimes(1);
    isSelling = false;
    rerender([pill, scroll, token, blade]);
    expect(
      (within(review).getByRole("button", { name: "Back" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    const checkbox = within(review).getAllByRole("checkbox")[0]!;
    expect((checkbox as HTMLButtonElement).disabled).toBe(false);
    act(() => fireEvent.click(checkbox));
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  },
);

it("asks again for rare items, where unticking one keeps it", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Storm Blade")));
  openReview();
  act(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }),
    ),
  );
  const rare = screen.getByRole("dialog", { name: "These are Rare or better" });
  expect(within(rare).queryByRole("listitem", { name: "Chakra Pill" })).toBeNull();
  const bladeRow = within(rare).getByRole("listitem", { name: "Storm Blade" });
  expect(within(bladeRow).getByText("Storm Blade art")).toBeDefined();
  act(() =>
    fireEvent.click(
      within(bladeRow).getByRole("checkbox", { name: "Keep selling Storm Blade" }),
    ),
  );
  act(() => fireEvent.click(within(rare).getByRole("button", { name: "Confirm" })));
  expect(sellMany).toHaveBeenCalledWith(["Chakra Pill"]);
});

it("confirms exactly the ticked rare and common items", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Storm Blade")));
  openReview();
  act(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }),
    ),
  );
  act(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }),
    ),
  );
  expect(sellMany.mock.calls[0]?.[0].sort()).toEqual(["Chakra Pill", "Storm Blade"]);
});

it("drops ids that leave the bag from the selection", () => {
  const { rerender } = renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Old Scroll")));
  rerender([scroll, token, blade]);
  expect(bar().textContent).toContain("1 selected");
});

it("keeps refused items selected after a partial result", () => {
  const { rerender } = renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Old Scroll")));
  openReview();
  act(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Sell / drop" }),
    ),
  );
  act(() =>
    finish({
      soldUserItemIds: ["Chakra Pill"],
      refused: [{ userItemId: "Old Scroll" }],
    }),
  );
  rerender([scroll, token, blade]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(card("Old Scroll").getAttribute("aria-pressed")).toBe("true");
  expect(bar().textContent).toContain("1 selected");
});

it("lets a ticked stack that can no longer be sold be unticked", () => {
  const { rerender } = renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Old Scroll")));
  rerender([pill, { ...scroll, isInAuction: true }, token, blade]);
  expect((card("Old Scroll") as HTMLButtonElement).disabled).toBe(false);
  // The reason shows on the card, where touch screens have no tooltip.
  expect(card("Old Scroll").textContent).toContain("Is in auction");
  act(() => fireEvent.click(card("Old Scroll")));
  expect(card("Old Scroll").getAttribute("aria-pressed")).toBe("false");
  expect((card("Old Scroll") as HTMLButtonElement).disabled).toBe(true);
});

it("holds a selection larger than one request until it is trimmed", () => {
  const many = Array.from({ length: MAX_BULK_SELL_ITEMS + 1 }, (_, index) =>
    stack(`Pebble ${index}`, "COMMON"),
  );
  renderWorkspace(many);
  startSelecting();
  act(() => fireEvent.click(screen.getByRole("button", { name: "All Common" })));
  expect(bar().textContent).toContain(`Select up to ${MAX_BULK_SELL_ITEMS} at a time`);
  expect(
    (within(bar()).getByRole("button", { name: "Sell / drop…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  act(() => fireEvent.click(card("Pebble 0 ")));
  expect(
    (within(bar()).getByRole("button", { name: "Sell / drop…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
