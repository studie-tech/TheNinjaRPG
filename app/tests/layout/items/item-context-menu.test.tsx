import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import type { HotkeyTarget } from "@/layout/HotkeyControls";
import { HotkeyCaptureDialog } from "@/layout/HotkeyControls";
import { ItemContextMenu } from "@/layout/items/ItemContextMenu";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

const setFinePointer = (fine: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(any-pointer: fine)" && fine,
      addEventListener() {},
      removeEventListener() {},
    }),
  });

beforeEach(() => {
  installBrowserGlobals();
  setFinePointer(true);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  if (originalMatchMedia)
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  restoreBrowserGlobals();
});

type Fixture = {
  id: string;
  itemType?: string;
  slot?: string;
  equipped?: ItemSlot;
  quantity?: number;
  canStack?: boolean;
  durability?: number;
  variants?: unknown[];
  inShop?: boolean;
};

const userItem = ({
  id,
  itemType = "CONSUMABLE",
  slot = "ITEM",
  equipped = "NONE",
  quantity = 1,
  canStack = false,
  durability = 50,
  variants = [],
  inShop = true,
}: Fixture) =>
  ({
    id,
    itemId: `item-${id}`,
    quantity,
    level: 1,
    durability,
    equipped,
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: {
      id: `item-${id}`,
      name: id,
      rarity: "RARE",
      itemType,
      slot,
      maxDurability: 50,
      canStack,
      variants,
      effects: [],
      isEventItem: false,
      inShop,
    },
  }) as unknown as UserItemWithRelations;

const salve = userItem({
  id: "Healing Salve",
  quantity: 5,
  canStack: true,
  variants: [{ id: "v" }],
});
const worn = [userItem({ id: "Chakra Pill", equipped: "ITEM_1" })];
const player = { userId: "user-1", status: "AWAKE", battleId: null } as never;

const renderMenu = (
  target: UserItemWithRelations,
  props: Partial<Parameters<typeof ItemContextMenu>[0]> = {},
) => {
  const handlers = {
    onInspect: vi.fn(),
    onEquip: vi.fn(),
    onUnequip: vi.fn(),
    onMerge: vi.fn(),
    onSetHotkey: vi.fn(),
    onSelect: vi.fn(),
  };
  render(
    <ItemContextMenu
      userItem={target}
      allUserItems={[target, ...worn]}
      userData={player}
      getBlockedReason={() => null}
      onInspect={handlers.onInspect}
      onEquip={handlers.onEquip}
      onUnequip={handlers.onUnequip}
      onMerge={handlers.onMerge}
      onSetHotkey={handlers.onSetHotkey}
      {...props}
    >
      <button type="button" onClick={() => handlers.onSelect(target.id)}>
        {target.item.name} card
      </button>
    </ItemContextMenu>,
  );
  return handlers;
};

const openMenu = (name: string) =>
  act(() => {
    fireEvent.contextMenu(screen.getByRole("button", { name: `${name} card` }), {
      clientX: 10,
      clientY: 10,
    });
  });

const menuItems = () =>
  screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());

it("offers the backpack actions an item supports", () => {
  renderMenu(salve);
  openMenu("Healing Salve");
  expect(menuItems()).toEqual([
    "Inspect",
    "Item 1 · swap",
    "Item 2 · empty",
    "Item 3 · empty",
    "Item 4 · empty",
    "Item 5 · empty",
    "Item 6 · empty",
    "Merge stacks",
    "Split stack…",
    "Variants…",
    "Sell…",
  ]);
});

it.each(["NONE", "ITEM_2"] as const)(
  "names the %s item's menu with its displayed variant name",
  (equipped) => {
    const target = {
      ...userItem({
        id: "Base Salve",
        equipped,
        quantity: 5,
        variants: [{ id: "blue", image: "/blue.webp", name: "Blue Salve" }],
      }),
      activeVariantId: "blue",
    } as UserItemWithRelations;
    renderMenu(target);
    openMenu("Base Salve");
    expect(
      screen.getByText(equipped === "NONE" ? "Blue Salve ×5" : "Blue Salve"),
    ).toBeDefined();
  },
);

it("equip in a chosen slot calls equip with that slot", () => {
  const { onEquip } = renderMenu(salve);
  openMenu("Healing Salve");
  act(() => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Item 2 · empty" }));
  });
  expect(onEquip).toHaveBeenCalledWith("Healing Salve", "ITEM_2");
});

it("disables slots the server would refuse", () => {
  renderMenu(salve, {
    getBlockedReason: (_ui, slot) => (slot === "ITEM_3" ? "Needs 500 Ninjutsu" : null),
  });
  openMenu("Healing Salve");
  expect(
    screen.getByRole("menuitem", { name: /Item 3/ }).getAttribute("aria-disabled"),
  ).toBe("true");
});

it("opens the inspector for actions with their own confirmation", async () => {
  const { onInspect } = renderMenu(salve);
  openMenu("Healing Salve");
  act(() => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Sell…" }));
  });
  await waitFor(() =>
    expect(onInspect).toHaveBeenCalledWith(
      "Healing Salve",
      screen.getByRole("button", { name: "Healing Salve card" }),
    ),
  );
});

it("returns focus to its card when Escape dismisses the menu", async () => {
  const { onInspect } = renderMenu(salve);
  const trigger = screen.getByRole("button", { name: "Healing Salve card" });
  act(() => trigger.focus());
  openMenu("Healing Salve");
  const inspect = screen.getByRole("menuitem", { name: "Inspect" });
  act(() => inspect.focus());
  act(() => fireEvent.keyDown(inspect, { key: "Escape" }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  expect(onInspect).not.toHaveBeenCalled();
});

it("offers set hotkey only for equipped items, and not on touch-only devices", () => {
  const worn = userItem({ id: "Smoke Bomb", equipped: "ITEM_1" });
  renderMenu(worn);
  openMenu("Smoke Bomb");
  expect(menuItems()).toContain("Set hotkey…");
  cleanup();
  setFinePointer(false);
  renderMenu(worn);
  openMenu("Smoke Bomb");
  expect(menuItems()).not.toContain("Set hotkey…");
});

it.each(["Escape", "k"])(
  "returns focus to the equipped item after closing its hotkey dialog with %s",
  async (key) => {
    const onAssign = vi.fn(() => true);
    const content = (target: HotkeyTarget | null) => (
      <HotkeyCaptureDialog
        target={target}
        currentKey="b"
        onAssign={onAssign}
        onClose={() => show(null)}
      />
    );
    const view = render(content(null));
    const show = (target: HotkeyTarget | null) => view.rerender(content(target));
    renderMenu(userItem({ id: "Smoke Bomb", equipped: "ITEM_1" }), {
      onSetHotkey: (target) =>
        show({ id: target.itemId, name: target.item.name, kind: "item" }),
    });
    const trigger = screen.getByRole("button", { name: "Smoke Bomb card" });
    act(() => trigger.focus());
    openMenu("Smoke Bomb");
    const hotkey = screen.getByRole("menuitem", { name: "Set hotkey…" });
    act(() => hotkey.focus());
    fireEvent.click(hotkey);

    await waitFor(() =>
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
    expect(onAssign).toHaveBeenCalledTimes(key === "Escape" ? 0 : 1);
    if (key !== "Escape") expect(onAssign).toHaveBeenCalledWith(key);
  },
);

it("offers unequip and inspect for equipped items", () => {
  const { onUnequip } = renderMenu(
    userItem({
      id: "Worn Vest",
      itemType: "ARMOR",
      slot: "CHEST",
      equipped: "CHEST",
      durability: 10,
    }),
  );
  openMenu("Worn Vest");
  expect(menuItems()).toEqual(["Unequip", "Inspect", "Repair…"]);
  act(() => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Unequip" }));
  });
  expect(onUnequip).toHaveBeenCalledWith("Worn Vest", "CHEST");
});

it("long press opens the menu without selecting", () => {
  const { onSelect } = renderMenu(salve);
  openMenu("Healing Salve");
  // The finger lifting after a long press is delivered as a click on the card.
  fireEvent.click(
    screen.getByRole("button", { name: "Healing Salve card", hidden: true }),
  );
  expect(onSelect).not.toHaveBeenCalled();
});
