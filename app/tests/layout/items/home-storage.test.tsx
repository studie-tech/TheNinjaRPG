import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as bulkSell from "@/hooks/useBulkSellItems";
import * as homeMove from "@/hooks/useHomeStorageMove";
import * as itemActions from "@/hooks/useItemActions";
import * as contentImage from "@/layout/ContentImage";
import * as equipmentPreview from "@/layout/EquipmentPreview";
import * as hotkeyControls from "@/layout/HotkeyControls";
import * as image from "@/layout/Image";
import * as inspector from "@/layout/items/ItemInspector";
import { type ItemsPlace, ItemsWorkspace } from "@/layout/items/ItemsWorkspace";
import * as mastery from "@/libs/mastery";
import * as skills from "@/libs/skillRequirements";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockCosmetics } from "../../setup/cosmetics";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
let moveItems: ReturnType<typeof vi.fn>;
let finishMove: (result: {
  success: boolean;
  refused: { userItemId: string }[];
}) => void;
let inspectorProps: Parameters<typeof inspector.ItemInspector>[0] | undefined;

beforeEach(() => {
  mockCosmetics();
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  moveItems = vi.fn();
  inspectorProps = undefined;
  vi.spyOn(homeMove, "useHomeStorageMove").mockImplementation((({ onMoved } = {}) => {
    finishMove = (result) => onMoved?.(result as never);
    return { moveItems, isMoving: false };
  }) as typeof homeMove.useHomeStorageMove);
  vi.spyOn(bulkSell, "useBulkSellItems").mockReturnValue({
    sellMany: vi.fn(),
    isSelling: false,
  });
  vi.spyOn(itemActions, "useItemActions").mockReturnValue({
    equip: vi.fn(),
    merge: vi.fn(),
    isEquipping: false,
    isPending: false,
  } as never);
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
  vi.spyOn(inspector, "ItemInspector").mockImplementation((props) => {
    inspectorProps = props;
    return <section aria-label={`Inspecting ${props.userItem.item.name}`} />;
  });
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

const stack = (name: string, storedAtHome = false) =>
  ({
    id: name,
    itemId: `item-${name}`,
    quantity: 1,
    level: 1,
    durability: 0,
    equipped: "NONE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    storedAtHome,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: {
      id: `item-${name}`,
      name,
      image: null,
      rarity: "COMMON",
      itemType: "CONSUMABLE",
      slot: "ITEM",
      maxDurability: 0,
      hidden: false,
      effects: [],
      inShop: true,
      cost: 100,
      isEventItem: false,
      isFarmSeed: false,
      farmSellValue: 0,
    },
  }) as unknown as UserItemWithRelations;

const pill = stack("Chakra Pill");
const scroll = stack("Old Scroll");
const ore = stack("Iron Ore", true);
const herb = stack("Dried Herb", true);
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

const renderWorkspace = ({
  place = "backpack" as ItemsPlace,
  onPlaceChange = vi.fn(),
  blockReason = (_id: string, _toHome: boolean): string | null => null,
  withHome = true,
  carried = [pill, scroll],
  stored = [ore, herb],
} = {}) => {
  const tree = (carried: UserItemWithRelations[], stored: UserItemWithRelations[]) => (
    <ItemsWorkspace
      userData={player}
      userItems={carried}
      bagItems={carried.filter((ui) => ui.equipped === "NONE")}
      bag={place === "home" ? "home:all" : "all"}
      home={
        withHome
          ? {
              place,
              onPlaceChange,
              items: stored,
              count: 2,
              blockReason,
              status: <span>2 / 15</span>,
              bagTabs: <p>Home bags</p>,
            }
          : undefined
      }
    />
  );
  const view = render(tree(carried, stored));
  return {
    onPlaceChange,
    rerender: (carried: UserItemWithRelations[], stored: UserItemWithRelations[]) =>
      view.rerender(tree(carried, stored)),
  };
};

const card = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });
const bar = () => screen.getByRole("region", { name: "Selected items" });
const startSelecting = () =>
  act(() => fireEvent.click(screen.getByRole("button", { name: "Select" })));

it("keeps the plain Backpack heading when home storage is out of reach", () => {
  renderWorkspace({ withHome: false });
  expect(screen.getByRole("heading", { name: "Backpack" })).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Home/ })).toBeNull();
});

it("switches the backpack column to home storage", () => {
  const { onPlaceChange } = renderWorkspace();
  expect(
    screen.getByRole("button", { name: "Backpack" }).getAttribute("aria-pressed"),
  ).toBe("true");
  act(() => fireEvent.click(screen.getByRole("button", { name: "Home · 2" })));
  expect(onPlaceChange).toHaveBeenCalledWith("home");
});

it("lists stored stacks with their bucket capacity at home", () => {
  renderWorkspace({ place: "home" });
  expect(screen.getByRole("heading", { name: "Home storage" })).toBeDefined();
  expect(card("Iron Ore")).toBeDefined();
  expect(card("Dried Herb")).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Chakra Pill/ })).toBeNull();
  expect(screen.getByText("2 / 15")).toBeDefined();
  expect(screen.getByText("Home bags")).toBeDefined();
});

it("labels the compact inventory tab with the active storage and its count", () => {
  renderWorkspace({ place: "home", carried: [pill] });
  expect(screen.queryByRole("tab", { name: "Home · 2" })).not.toBeNull();
});

it("shows the backpack when leaving an equipment picker from home storage", () => {
  const { onPlaceChange } = renderWorkspace({ place: "home" });
  act(() =>
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-slot="HAND_1"]')!),
  );
  act(() => fireEvent.click(screen.getByRole("button", { name: "Show Backpack" })));
  expect(onPlaceChange).toHaveBeenCalledWith("backpack");
});

it("takes several selected stacks out of home storage at once", () => {
  renderWorkspace({ place: "home" });
  startSelecting();
  act(() => fireEvent.click(card("Iron Ore")));
  act(() => fireEvent.click(card("Dried Herb")));
  expect(within(bar()).queryByRole("button", { name: "Sell / drop…" })).toBeNull();
  act(() => fireEvent.click(within(bar()).getByRole("button", { name: "Take out" })));
  expect(moveItems).toHaveBeenCalledWith(["Iron Ore", "Dried Herb"], false);
});

it("stores selected backpack stacks and keeps the ones that stayed selected", () => {
  renderWorkspace();
  startSelecting();
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Old Scroll")));
  act(() =>
    fireEvent.click(within(bar()).getByRole("button", { name: "Store at home" })),
  );
  expect(moveItems).toHaveBeenCalledWith(["Chakra Pill", "Old Scroll"], true);
  // A refused request moves nothing, so the whole selection stays for a retry.
  act(() => finishMove({ success: false, refused: [] }));
  expect(card("Chakra Pill").getAttribute("aria-pressed")).toBe("true");
  expect(card("Old Scroll").getAttribute("aria-pressed")).toBe("true");
  act(() => finishMove({ success: true, refused: [{ userItemId: "Old Scroll" }] }));
  expect(card("Chakra Pill").getAttribute("aria-pressed")).toBe("false");
  expect(card("Old Scroll").getAttribute("aria-pressed")).toBe("true");
  act(() => finishMove({ success: true, refused: [] }));
  expect(screen.queryByRole("region", { name: "Selected items" })).toBeNull();
});

it("offers the inspector a move home with the reason a stack cannot go", () => {
  const blockReason = vi.fn((_id: string, toHome: boolean) =>
    toHome ? "Does not fit" : null,
  );
  renderWorkspace({ blockReason });
  act(() => fireEvent.click(card("Chakra Pill")));
  expect(inspectorProps?.homeMove?.blockedReason).toBe("Does not fit");
  expect(blockReason).toHaveBeenCalledWith("Chakra Pill", true);
  act(() => inspectorProps?.homeMove?.onMove());
  expect(moveItems).toHaveBeenCalledWith(["Chakra Pill"], true);
});

it("inspects a stored stack with taking it out as its move", () => {
  renderWorkspace({ place: "home" });
  act(() => fireEvent.click(card("Iron Ore")));
  expect(screen.getByRole("region", { name: "Inspecting Iron Ore" })).toBeDefined();
  act(() => inspectorProps?.homeMove?.onMove());
  expect(moveItems).toHaveBeenCalledWith(["Iron Ore"], false);
});

it("stores farm-market seeds without replacement coins while keeping sale restrictions", () => {
  const seed = {
    ...pill,
    id: "seed",
    item: {
      ...pill.item,
      name: "Market Seed",
      isFarmSeed: true,
      inShop: false,
      farmSellValue: 100,
    },
  };
  renderWorkspace({ carried: [seed, pill] });
  startSelecting();
  expect(card("Market Seed").hasAttribute("disabled")).toBe(false);
  act(() => fireEvent.click(card("Market Seed")));
  expect(
    within(bar())
      .getByRole("button", { name: "Sell / drop…" })
      .hasAttribute("disabled"),
  ).toBe(true);
  act(() =>
    fireEvent.click(within(bar()).getByRole("button", { name: "Store at home" })),
  );
  expect(moveItems).toHaveBeenCalledWith(["seed"], true);
  act(() => fireEvent.click(card("Chakra Pill")));
  act(() => fireEvent.click(card("Market Seed")));
  expect(
    within(bar())
      .getByRole("button", { name: "Sell / drop…" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("inspects carried gear from a slot picker while viewing home storage", () => {
  const worn = {
    ...pill,
    id: "worn",
    equipped: "HAND_1",
    item: {
      ...pill.item,
      name: "Worn Sword",
      slot: "HAND",
      itemType: "WEAPON",
      maxEquips: 1,
    },
  } as UserItemWithRelations;
  renderWorkspace({ place: "home", carried: [worn] });
  act(() => fireEvent.click(screen.getByRole("button", { name: /Worn Sword/ })));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Inspect" })));
  expect(
    screen.queryByRole("region", { name: "Inspecting Worn Sword" }),
  ).not.toBeNull();
});

it("closes a stored stack's inspector when it moves into the backpack", () => {
  const { rerender } = renderWorkspace({ place: "home" });
  act(() => fireEvent.click(card("Iron Ore")));
  expect(screen.queryByRole("region", { name: "Inspecting Iron Ore" })).not.toBeNull();
  act(() => rerender([pill, scroll, { ...ore, storedAtHome: false }], [herb]));
  expect(screen.queryByRole("region", { name: "Inspecting Iron Ore" })).toBeNull();
});

it("inspects a carried candidate at home and closes it when stored", () => {
  const sword = {
    ...pill,
    id: "sword",
    item: {
      ...pill.item,
      name: "Spare Sword",
      slot: "HAND",
      itemType: "WEAPON",
      maxEquips: 1,
    },
  } as UserItemWithRelations;
  const { rerender } = renderWorkspace({ place: "home", carried: [sword] });
  act(() =>
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-slot="HAND_1"]')!),
  );
  act(() =>
    fireEvent.click(screen.getByRole("button", { name: "Details of Spare Sword" })),
  );
  expect(
    screen.queryByRole("region", { name: "Inspecting Spare Sword" }),
  ).not.toBeNull();
  act(() => rerender([], [ore, herb, { ...sword, storedAtHome: true }]));
  expect(screen.queryByRole("region", { name: "Inspecting Spare Sword" })).toBeNull();
});
