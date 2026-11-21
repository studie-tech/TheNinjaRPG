import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { type ItemSlot, KESSEN_FIRST_BUNDLE_ITEM_ID } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as itemActions from "@/hooks/useItemActions";
import * as mediaQuery from "@/hooks/useMediaQuery";
import * as splitBeforeSale from "@/hooks/useSplitBeforeSale";
import * as contentImage from "@/layout/ContentImage";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import { ItemInspector } from "@/layout/items/ItemInspector";
import * as itemLib from "@/libs/item";
import { DEFAULT_CARD_DATA } from "@/validators/itemCard";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockCosmetics } from "../../setup/cosmetics";

let equip: ReturnType<typeof vi.fn>;

let cosmeticState: ReturnType<typeof mockCosmetics>;

beforeEach(() => {
  cosmeticState = mockCosmetics();
  vi.spyOn(splitBeforeSale, "useSplitBeforeSale").mockReturnValue({
    keepOnStack: vi.fn(async () => ({ success: true, message: "" })),
    isSplitting: false,
    refreshInventory: vi.fn(async () => {}),
  } as never);
  installBrowserGlobals();
  equip = vi.fn();
  // The card face reads the reduced-motion preference once it has loaded.
  vi.spyOn(mediaQuery, "useMediaQuery").mockImplementation(() => false);
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
    <span>{alt} art</span>
  ));
  vi.spyOn(itemWithEffects, "default").mockImplementation(() => <p>Item effects</p>);
  vi.spyOn(itemLib, "calcItemSellingPrice").mockReturnValue(120);
  vi.spyOn(itemActions, "useItemActions").mockReturnValue({
    merge: vi.fn(),
    consume: vi.fn(),
    sell: vi.fn(),
    equip,
    splitStack: vi.fn(),
    repairWithKit: vi.fn(),
    repairWithRyo: vi.fn(),
    evolve: vi.fn(),
    removeImbuement: vi.fn(),
    isPending: false,
    isMerging: false,
    isConsuming: false,
    isSelling: false,
    isEquipping: false,
    isEvolving: false,
    isSplitting: false,
    isUsingRepairItem: false,
    isRepairingWithRyo: false,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    cosmetic: { get: { useQuery: () => cosmeticState.wardrobe } },
    item: { getEvolutions: { useQuery: () => ({ data: [] }) } },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

type Fixture = {
  equipped?: ItemSlot;
  itemType?: string;
  quantity?: number;
  canStack?: boolean;
  isEventItem?: boolean;
  inShop?: boolean;
};

const userItem = ({
  equipped = "NONE",
  itemType = "WEAPON",
  quantity = 1,
  canStack = false,
  isEventItem = false,
  inShop = true,
}: Fixture = {}) =>
  ({
    id: "ui-1",
    itemId: "item-1",
    quantity,
    level: 1,
    experience: 0,
    durability: 50,
    equipped,
    imbuements: [],
    isInAuction: false,
    craftingFinishedAt: null,
    item: {
      id: "item-1",
      name: "Twin Fang Blade",
      image: null,
      rarity: "EPIC",
      itemType,
      slot: itemType === "MEAL" || itemType === "MATERIAL" ? "NONE" : "HAND",
      maxDurability: 50,
      canStack,
      isEventItem,
      inShop,
      canBeImbued: true,
      effects: [],
      mealDurationSeconds: 600,
      variants: [],
    },
  }) as unknown as UserItemWithRelations;

/** Confirm wraps its trigger in a second element with the button role; find the real one. */
const nativeButton = (name: string | RegExp) =>
  screen
    .getAllByRole("button", { name })
    .find((element) => element.tagName === "BUTTON");

const player = {
  userId: "user-1",
  status: "AWAKE",
  battleId: null,
  level: 30,
  village: null,
} as never;

const renderInspector = (props: Partial<Parameters<typeof ItemInspector>[0]> = {}) => {
  const onClose = vi.fn();
  render(
    <ItemInspector
      userItem={userItem()}
      allUserItems={[]}
      userData={player}
      onClose={onClose}
      onEquip={equip}
      isEquipping={false}
      {...props}
    />,
  );
  return { onClose };
};

it("names the inspector and its art with the active variant's displayed heading", () => {
  const base = userItem();
  const sword = {
    ...base,
    activeVariantId: "blue",
    item: {
      ...base.item,
      variants: [{ id: "blue", image: "/blue.webp", name: "Blue Blade" }],
    },
  } as UserItemWithRelations;
  renderInspector({ userItem: sword });
  expect(screen.getByRole("region", { name: "Blue Blade" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Blue Blade" })).toBeDefined();
  expect(screen.getByText("Blue Blade art")).toBeDefined();
});

it("renders rich descriptions as formatted text in the inspector", () => {
  const item = userItem();
  item.item.description = "<p>A <strong>tempered</strong> blade &amp; guard.</p>";
  renderInspector({ userItem: item });
  const emphasis = screen.getByText("tempered");
  expect(emphasis.tagName).toBe("STRONG");
  expect(emphasis.parentElement?.tagName).toBe("P");
  expect(emphasis.parentElement?.textContent).toBe("A tempered blade & guard.");
  expect(emphasis.parentElement?.parentElement?.tagName).toBe("DIV");
});

it("offers no equip for items without an equipment slot", () => {
  renderInspector({ userItem: userItem({ itemType: "MATERIAL" }) });
  expect(screen.queryByRole("button", { name: /^Equip$/ })).toBeNull();
});

it("shows equip for backpack items and unequip for equipped ones", () => {
  const view = render(
    <ItemInspector
      userItem={userItem()}
      allUserItems={[]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  expect(screen.getByRole("button", { name: /^Equip$/ })).toBeDefined();
  expect(screen.queryByRole("button", { name: /Unequip/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ equipped: "HAND_2" }) });
  expect(screen.getByText("Equipped in Hand 2")).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Equip$/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Unequip/ }));
  expect(equip).toHaveBeenCalledWith(
    { userItemId: "ui-1", slot: "HAND_2" },
    expect.any(Function),
  );
});

it("shows eat meal only for meals", () => {
  const view = render(
    <ItemInspector
      userItem={userItem()}
      allUserItems={[]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  expect(screen.queryByRole("button", { name: /Eat meal/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ itemType: "MEAL", canStack: true }) });
  expect(nativeButton(/Eat meal/)).toBeDefined();
});

it("shows split only for stacks of 2+", () => {
  const view = render(
    <ItemInspector
      userItem={userItem({ canStack: true, quantity: 1 })}
      allUserItems={[]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  expect(screen.getByRole("button", { name: /Merge stacks/ })).toBeDefined();
  expect(screen.queryByRole("button", { name: /Split stack/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ canStack: true, quantity: 4 }) });
  expect(screen.getByRole("button", { name: /Split stack/ })).toBeDefined();
});

it("hides split for equipped stacks while preserving merge", () => {
  renderInspector({
    userItem: userItem({ canStack: true, quantity: 4, equipped: "HAND_1" }),
  });
  expect(screen.queryByRole("button", { name: /Split stack/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Merge stacks/ })).toBeDefined();
});

it("shows drop for event or non-shop items and sell otherwise", () => {
  const view = render(
    <ItemInspector
      userItem={userItem()}
      allUserItems={[]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  expect(nativeButton("Sell Item [120 ryo]")).toBeDefined();
  view.unmount();
  renderInspector({ userItem: userItem({ isEventItem: true }) });
  expect(nativeButton("Drop Item")).toBeDefined();
});

it("offers set hotkey for equipped items only, and hides it on touch-only devices", () => {
  const view = render(
    <ItemInspector
      userItem={userItem()}
      allUserItems={[]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  expect(screen.queryByRole("button", { name: "Set hotkey" })).toBeNull();
  view.unmount();
  const onSetHotkey = vi.fn();
  // Battle keys fire only for equipped items.
  renderInspector({ onSetHotkey });
  expect(screen.queryByRole("button", { name: "Set hotkey" })).toBeNull();
  cleanup();
  renderInspector({ onSetHotkey, userItem: userItem({ equipped: "HAND_1" }) });
  const button = screen.getByRole("button", { name: "Set hotkey" });
  expect(button.className).toContain("not-any-pointer-fine:hidden");
  fireEvent.click(button);
  expect(onSetHotkey).toHaveBeenCalledTimes(1);
});

it("shows the mastery warning of an equipped item", () => {
  renderInspector({
    userItem: userItem({ equipped: "HAND_1" }),
    masteryWarning: "Unusable in battle: requires 500 Bukijutsu (you have 10)",
  });
  expect(
    screen.getByText("Unusable in battle: requires 500 Bukijutsu (you have 10)"),
  ).toBeDefined();
});

it("closes the inspector on Escape and from the back link", () => {
  const { onClose } = renderInspector();
  fireEvent.keyDown(screen.getByRole("region", { name: "Twin Fang Blade" }), {
    key: "Escape",
  });
  fireEvent.click(screen.getByRole("button", { name: "← Back" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("keeps the inspector open when Escape cancels one of its confirmations", () => {
  const { onClose } = renderInspector();
  act(() => {
    fireEvent.click(nativeButton("Sell Item [120 ryo]")!);
  });
  const confirm = screen.getByRole("dialog");
  act(() => {
    fireEvent.keyDown(confirm, { key: "Escape" });
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("puts the actions before the long effects card", () => {
  renderInspector();
  const equipButton = screen.getByRole("button", { name: /^Equip$/ });
  const effects = screen.getByText("Item effects");
  // Keep the available actions ahead of the detailed stats.
  expect(
    equipButton.compareDocumentPosition(effects) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The header art sits in a positioned box so it cannot cover the controls above it.
  expect(screen.getByText("Twin Fang Blade art").parentElement?.className).toContain(
    "relative",
  );
});

it("shows the full stats straight away without repeating the header", () => {
  const spy = vi
    .spyOn(itemWithEffects, "default")
    .mockImplementation(() => <p>Item effects</p>);
  renderInspector();
  const details = screen.getByRole("region", { name: "Details" });
  expect(within(details).getByText("Item effects")).toBeDefined();
  expect(screen.getByText("Item effects").closest("details")).toBeNull();
  expect(screen.queryByText("All details")).toBeNull();
  expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({
    hideTitle: true,
    hideImage: true,
    hideDates: true,
    item: { description: "" },
  });
});

it("shows durability with its repair actions when the item wears", () => {
  renderInspector({ userItem: { ...userItem(), durability: 20 } as never });
  expect(screen.getByText("Durability 40%")).toBeDefined();
});

it("offers to store a carried item at home and explains when it does not fit", () => {
  const onMove = vi.fn();
  const view = render(
    <ItemInspector
      userItem={userItem()}
      allUserItems={[]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
      homeMove={{ blockedReason: null, isMoving: false, onMove }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Store at home" }));
  expect(onMove).toHaveBeenCalledTimes(1);
  view.unmount();
  renderInspector({
    homeMove: {
      blockedReason: "Does not fit: Your home storage is full",
      isMoving: false,
      onMove,
    },
  });
  expect(
    screen.getByRole("button", { name: "Store at home" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Does not fit: Your home storage is full")).toBeDefined();
});

it("shows a stored item's details with taking it out as the only action", () => {
  const onMove = vi.fn();
  const stored = { ...userItem(), storedAtHome: true } as UserItemWithRelations;
  renderInspector({
    userItem: stored,
    homeMove: { blockedReason: null, isMoving: false, onMove },
  });
  expect(screen.getByText("In your home storage")).toBeDefined();
  expect(screen.getByText("Item effects")).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Equip$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Sell Item|Drop Item/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Take out" }));
  expect(onMove).toHaveBeenCalledTimes(1);
});

it("offers dedicated cosmetics for appearance unlocking without a normal equip action", () => {
  renderInspector({ userItem: userItem({ itemType: "COSMETIC" }) });
  expect(screen.getByRole("button", { name: "Make Cosmetic" })).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Equip$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Set hotkey/ })).toBeNull();
});

const cardStack = (id: string, quantity: number, cardData = DEFAULT_CARD_DATA) =>
  ({
    ...userItem({ itemType: "CARD", quantity, canStack: true }),
    id,
    itemId: "kessen-moonprowler",
    item: {
      ...userItem().item,
      id: "kessen-moonprowler",
      name: "Moonprowler",
      itemType: "CARD",
      slot: "NONE",
      rarity: "COMMON",
      maxDurability: 0,
      canStack: true,
      description: "",
      cardData,
    },
  }) as unknown as UserItemWithRelations;

it("offers only a card's surplus copies for sale, never its deck copies", () => {
  const splitStack = vi.fn();
  vi.spyOn(itemActions, "useItemActions").mockReturnValue({
    ...itemActions.useItemActions({ useritem: undefined, onDone: () => {} }),
    splitStack,
  } as never);
  const single = cardStack("only", 2);
  const view = render(
    <ItemInspector
      userItem={single}
      allUserItems={[single]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  expect(screen.queryByRole("button", { name: /Sell/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Merge Stacks|Split Stack/ })).toBeNull();
  expect(screen.getByText(/No surplus copy to sell/)).toBeDefined();
  view.unmount();

  const mixed = cardStack("mixed", 5);
  const second = render(
    <ItemInspector
      userItem={mixed}
      allUserItems={[mixed]}
      userData={player}
      onClose={vi.fn()}
      onEquip={equip}
      isEquipping={false}
    />,
  );
  // Only the surplus is offered: selling it splits the deck copies off first.
  expect(nativeButton(/Sell 2 surplus copies · 120 ryo/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Separate surplus" }));
  expect(splitStack).toHaveBeenCalledWith({ userItemId: "mixed", quantityToKeep: 3 });
  second.unmount();

  const kept = cardStack("kept", 3);
  const surplus = cardStack("surplus", 2);
  renderInspector({ userItem: surplus, allUserItems: [kept, surplus] });
  expect(nativeButton(/Sell 2 surplus copies · 120 ryo/)).toBeDefined();
  // Separated surplus stays apart from the deck copies.
  expect(screen.queryByRole("button", { name: "Merge Stacks" })).toBeNull();
  cleanup();

  // The deck-copy stack offers no sale and points at its surplus instead.
  const onInspectStack = vi.fn();
  renderInspector({ userItem: kept, allUserItems: [kept, surplus], onInspectStack });
  expect(screen.queryByRole("button", { name: /^Sell/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open surplus stack" }));
  expect(onInspectStack).toHaveBeenCalledWith("surplus");
});

it("explains why leaders cannot be sold", () => {
  const leader = cardStack("leader", 1, {
    ...DEFAULT_CARD_DATA,
    kind: "LEADER",
    row: null,
  });
  renderInspector({ userItem: leader, allUserItems: [leader] });
  expect(screen.queryByRole("button", { name: /Sell/ })).toBeNull();
  expect(
    screen.getByText(
      "Moonprowler is a leader. Leaders are never sold and stay in your collection.",
    ),
  ).toBeDefined();
});

it("explains once that an earned pack is only opened", () => {
  const base = userItem({ itemType: "CONSUMABLE", inShop: false });
  const firstBundle = {
    ...base,
    itemId: KESSEN_FIRST_BUNDLE_ITEM_ID,
    item: {
      ...base.item,
      id: KESSEN_FIRST_BUNDLE_ITEM_ID,
      name: "First Bundle",
      canBeTraded: false,
    },
  } as UserItemWithRelations;
  renderInspector({ userItem: firstBundle, allUserItems: [firstBundle] });
  expect(screen.queryByRole("button", { name: /Sell|Drop/ })).toBeNull();
  expect(
    screen.getByText(
      "First Bundle cannot be sold, traded or dropped; open it for its cards.",
    ),
  ).toBeDefined();
  expect(screen.queryByText(/cannot be sold or traded/)).toBeNull();
});
