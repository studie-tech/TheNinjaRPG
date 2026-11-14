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
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as itemActions from "@/hooks/useItemActions";
import * as contentImage from "@/layout/ContentImage";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import { ItemInspector } from "@/layout/items/ItemInspector";
import * as itemLib from "@/libs/item";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockCosmetics } from "../../setup/cosmetics";

let equip: ReturnType<typeof vi.fn>;

let cosmeticState: ReturnType<typeof mockCosmetics>;

beforeEach(() => {
  cosmeticState = mockCosmetics();
  installBrowserGlobals();
  equip = vi.fn();
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
  expect(screen.getByRole("button", { name: /Merge Stacks/ })).toBeDefined();
  expect(screen.queryByRole("button", { name: /Split Stack/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ canStack: true, quantity: 4 }) });
  expect(screen.getByRole("button", { name: /Split Stack/ })).toBeDefined();
});

it("hides split for equipped stacks while preserving merge", () => {
  renderInspector({
    userItem: userItem({ canStack: true, quantity: 4, equipped: "HAND_1" }),
  });
  expect(screen.queryByRole("button", { name: /Split Stack/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Merge Stacks/ })).toBeDefined();
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
