import { afterEach, beforeAll, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import type { ItemsToolbar as ItemsToolbarComponent } from "@/layout/items/ItemsToolbar";
import * as mergeAll from "@/layout/MergeAllStacksButton";
import * as userContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const mutation = () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) });
let ItemsToolbar: typeof ItemsToolbarComponent;

const mockClient = () =>
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    item: {
      autoEquipOptimal: mutation(),
      useRepairAll: mutation(),
      repairAll: mutation(),
      unequipAllItems: mutation(),
    },
  });

beforeAll(async () => {
  // The toolbar binds its kit repair procedure when the module loads.
  mockClient();
  ({ ItemsToolbar } = await import("@/layout/items/ItemsToolbar"));
});

beforeEach(() => {
  installBrowserGlobals();
  mockClient();
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
  } as never);
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
