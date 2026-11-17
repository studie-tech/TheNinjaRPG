import { afterEach, beforeAll, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as inventoryCache from "@/hooks/useInventoryCacheUpdate";
import * as loadoutCache from "@/hooks/useItemLoadoutCacheUpdate";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import type { ItemsToolbar as ItemsToolbarComponent } from "@/layout/items/ItemsToolbar";
import * as mergeAll from "@/layout/MergeAllStacksButton";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

type Options = {
  onMutate: () => unknown;
  onSuccess: (data: unknown, variables: unknown, snapshot: unknown) => Promise<void>;
};
const captured: Record<string, Options> = {};
const mutation = (name?: string) => ({
  useMutation: (options: Options) => {
    if (name) captured[name] = options;
    return { mutate: vi.fn(), isPending: false };
  },
});
const updateInventory = vi.fn(async () => undefined);
const updateUser = vi.fn(async () => undefined);
const updateClearedLoadout = vi.fn(async () => undefined);
let ItemsToolbar: typeof ItemsToolbarComponent;

const mockClient = () =>
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    item: {
      autoEquipOptimal: mutation("autoEquipOptimal"),
      useRepairAll: mutation(),
      repairAll: mutation(),
      unequipAllItems: mutation("unequipAllItems"),
    },
  });

beforeAll(async () => {
  // The toolbar binds its kit repair procedure when the module loads.
  mockClient();
  ({ ItemsToolbar } = await import("@/layout/items/ItemsToolbar"));
});

beforeEach(() => {
  installBrowserGlobals();
  for (const fn of [updateInventory, updateUser, updateClearedLoadout]) fn.mockClear();
  mockClient();
  mockUserContextValue({
    prepareUserUpdate: vi.fn(() => 7),
    updateUser,
  } as never);
  vi.spyOn(inventoryCache, "useInventoryCacheUpdate").mockImplementation(
    () => ({ prepareInventoryUpdate: () => "inventory", updateInventory }) as never,
  );
  vi.spyOn(loadoutCache, "useItemLoadoutCacheUpdate").mockImplementation(
    () => ({ prepareLoadoutUpdate: () => "loadouts", updateClearedLoadout }) as never,
  );
  vi.spyOn(itemLoadout, "default").mockImplementation((() => (
    <p>Item loadout</p>
  )) as never);
  vi.spyOn(mergeAll, "MergeAllStacksButton").mockImplementation(() => (
    <button type="button">Merge stacks</button>
  ));
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const sword = (durability: number) =>
  ({
    id: `sword-${durability}`,
    itemId: "sword",
    quantity: 1,
    durability,
    equipped: "HAND_1",
    storedAtHome: false,
    isInAuction: false,
    imbuements: [],
    item: {
      id: "sword",
      name: "Sword",
      itemType: "WEAPON",
      maxDurability: 100,
      cost: 1000,
      effects: [],
    },
  }) as unknown as UserItemWithRelations;

const player = (occupation: string) =>
  ({ userId: "user-1", occupation, money: 1_000_000, federalStatus: "NONE" }) as never;

/** Confirm wraps its trigger in a second element with the button role; keep the real ones. */
const buttons = (scope: Pick<typeof screen, "queryAllByRole">, name: string | RegExp) =>
  scope
    .queryAllByRole("button", { name })
    .filter((element) => element.tagName === "BUTTON");

/** The actions a phone shows only after pressing ⋯. */
const moreActions = () => {
  const toggle = screen.getByRole("button", { name: "More item actions" });
  const group = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  expect(group).not.toBeNull();
  return within(group!);
};

const kunai = (id: string, quantity: number) =>
  ({
    id,
    itemId: "kunai",
    quantity,
    durability: 100,
    level: 1,
    equipped: "NONE",
    activeVariantId: null,
    craftingFinishedAt: null,
    storedAtHome: false,
    isInAuction: false,
    imbuements: [],
    item: {
      id: "kunai",
      name: "Kunai",
      itemType: "CONSUMABLE",
      stackSize: 10,
      maxDurability: 100,
      cost: 100,
      effects: [],
    },
  }) as unknown as UserItemWithRelations;

it("keeps merge stacks in view while carried stacks can merge", () => {
  render(
    <ItemsToolbar
      userData={player("NONE")}
      userItems={[sword(100), kunai("kunai-1", 3), kunai("kunai-2", 4)]}
    />,
  );
  expect(buttons(screen, "Merge stacks")).toHaveLength(1);
  expect(buttons(moreActions(), "Merge stacks")).toHaveLength(0);
});

it("hides merge stacks while every stack is packed", () => {
  render(
    <ItemsToolbar
      userData={player("NONE")}
      userItems={[sword(100), kunai("kunai-1", 10), kunai("kunai-2", 4)]}
    />,
  );
  expect(buttons(screen, "Merge stacks")).toHaveLength(0);
});

it("keeps auto equip in view while nothing needs repair", () => {
  render(<ItemsToolbar userData={player("CRAFTING")} userItems={[sword(100)]} />);
  expect(buttons(moreActions(), /Auto equip/)).toHaveLength(0);
  expect(buttons(screen, /Auto equip/)).toHaveLength(1);
  expect(buttons(screen, /Repair all/)).toHaveLength(0);
});

it("puts repair in view and auto equip under more actions when gear is damaged", () => {
  render(<ItemsToolbar userData={player("CRAFTING")} userItems={[sword(40)]} />);
  const [repair] = buttons(screen, "Repair all items");
  expect(repair?.textContent).toContain("Repair all (1)");
  expect(buttons(moreActions(), "Repair all items")).toHaveLength(0);
  expect(buttons(moreActions(), /Auto equip/)).toHaveLength(1);
});

it("keeps auto equip in view when damaged gear cannot be repaired here", () => {
  // Without kits only crafters repair from the toolbar.
  render(<ItemsToolbar userData={player("NONE")} userItems={[sword(40)]} />);
  expect(buttons(screen, /Repair all/)).toHaveLength(0);
  expect(buttons(moreActions(), /Auto equip/)).toHaveLength(0);
  expect(buttons(screen, /Auto equip/)).toHaveLength(1);
});

it.each([
  { initialDurability: 100, updatedDurability: 40, action: /Auto equip/ },
  { initialDurability: 40, updatedDurability: 100, action: /Repair all items/ },
])(
  "closes the $action confirmation when inventory changes the leading action",
  ({ initialDurability, updatedDurability, action }) => {
    const view = render(
      <ItemsToolbar
        userData={player("CRAFTING")}
        userItems={[sword(initialDurability)]}
      />,
    );
    fireEvent.click(buttons(screen, action)[0]!);
    expect(screen.getByRole("dialog")).toBeDefined();

    view.rerender(
      <ItemsToolbar
        userData={player("CRAFTING")}
        userItems={[sword(updatedDurability)]}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("places auto-equipped gear from the confirmed slots without reading the inventory", async () => {
  render(<ItemsToolbar userData={player("NONE")} userItems={[]} />);
  const options = captured.autoEquipOptimal!;
  const changes = [{ id: "boots", equipped: "FEET", beforeEquipped: "NONE" }];
  await options.onSuccess(
    { success: true, message: "Equipped", equipmentChanges: changes },
    undefined,
    options.onMutate(),
  );
  const [update, snapshot] = updateInventory.mock.calls[0] as unknown as [
    (rows: { id: string; equipped: string }[]) => unknown,
    unknown,
  ];
  expect(snapshot).toBe("inventory");
  expect(update([{ id: "boots", equipped: "NONE" }])).toEqual([
    { id: "boots", equipped: "FEET" },
  ]);
});

it("applies a confirmed unequip-all to the inventory, profile and cleared loadout", async () => {
  render(<ItemsToolbar userData={player("NONE")} userItems={[]} />);
  const options = captured.unequipAllItems!;
  const data = {
    success: true,
    message: "Unequipped",
    equipmentChanges: [{ id: "helmet", equipped: "NONE", beforeEquipped: "HEAD" }],
    clearedLoadoutId: "main",
  };
  await options.onSuccess(data, undefined, options.onMutate());
  expect(updateInventory).toHaveBeenCalledWith(expect.any(Function), "inventory");
  expect(updateUser).toHaveBeenCalledWith(data, { revision: 7 });
  expect(updateClearedLoadout).toHaveBeenCalledWith("main", "loadouts");
});

it("reconciles the inventory and profile when a failed unequip-all saved some rows", async () => {
  render(<ItemsToolbar userData={player("NONE")} userItems={[]} />);
  const options = captured.unequipAllItems!;
  const data = { success: false, message: "Inventory changed", isPartiallySaved: true };
  await options.onSuccess(data, undefined, options.onMutate());
  expect(updateInventory).toHaveBeenCalledWith(undefined, "inventory");
  expect(updateUser).toHaveBeenCalledWith(data, { revision: 7 });
  expect(updateClearedLoadout).not.toHaveBeenCalled();
});

it("leaves the caches alone when a failed unequip-all saved nothing", async () => {
  render(<ItemsToolbar userData={player("NONE")} userItems={[]} />);
  const options = captured.unequipAllItems!;
  await options.onSuccess(
    { success: false, message: "Inventory changed", isPartiallySaved: false },
    undefined,
    options.onMutate(),
  );
  expect(updateInventory).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
});
