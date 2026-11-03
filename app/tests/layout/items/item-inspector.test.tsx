import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as itemActions from "@/hooks/useItemActions";
import * as contentImage from "@/layout/ContentImage";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import { ItemInspector } from "@/layout/items/ItemInspector";
import * as itemLib from "@/libs/item";

let equip: ReturnType<typeof vi.fn>;

beforeEach(() => {
  equip = vi.fn();
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => <span>{alt} art</span>);
  vi.spyOn(itemWithEffects, "default").mockImplementation(() => <p>Item effects</p>);
  vi.spyOn(itemLib, "calcItemSellingPrice").mockReturnValue(120);
  vi.spyOn(itemActions, "useItemActions").mockReturnValue({
    merge: vi.fn(), consume: vi.fn(), sell: vi.fn(), equip, splitStack: vi.fn(),
    repairWithKit: vi.fn(), repairWithRyo: vi.fn(), evolve: vi.fn(), removeImbuement: vi.fn(),
    isPending: false, isMerging: false, isConsuming: false, isSelling: false, isEquipping: false,
    isEvolving: false, isSplitting: false, isUsingRepairItem: false, isRepairingWithRyo: false,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    item: { getEvolutions: { useQuery: () => ({ data: [] }) } },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type Fixture = { equipped?: ItemSlot; itemType?: string; quantity?: number; canStack?: boolean; isEventItem?: boolean; inShop?: boolean };

const userItem = ({ equipped = "NONE", itemType = "WEAPON", quantity = 1, canStack = false, isEventItem = false, inShop = true }: Fixture = {}) =>
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
      id: "item-1", name: "Twin Fang Blade", image: null, rarity: "EPIC", itemType, slot: itemType === "MEAL" ? "NONE" : "HAND",
      maxDurability: 50, canStack, isEventItem, inShop, canBeImbued: true, effects: [], mealDurationSeconds: 600, variants: [],
    },
  }) as unknown as UserItemWithRelations;

/** Confirm wraps its trigger in a second element with the button role; find the real one. */
const nativeButton = (name: string | RegExp) =>
  screen.getAllByRole("button", { name }).find((element) => element.tagName === "BUTTON");

const player = { userId: "user-1", status: "AWAKE", battleId: null, level: 30, village: null } as never;

const renderInspector = (props: Partial<Parameters<typeof ItemInspector>[0]> = {}) => {
  const onClose = vi.fn();
  render(<ItemInspector userItem={userItem()} allUserItems={[]} userData={player} onClose={onClose} {...props} />);
  return { onClose };
};

it("shows equip for backpack items and unequip for equipped ones", () => {
  const view = render(<ItemInspector userItem={userItem()} allUserItems={[]} userData={player} onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: /^Equip$/ })).toBeDefined();
  expect(screen.queryByRole("button", { name: /Unequip/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ equipped: "HAND_2" }) });
  expect(screen.getByText("Equipped in Hand 2")).toBeDefined();
  expect(screen.queryByRole("button", { name: /^Equip$/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Unequip/ }));
  expect(equip).toHaveBeenCalledWith({ userItemId: "ui-1", slot: "HAND_2" });
});

it("shows eat meal only for meals", () => {
  const view = render(<ItemInspector userItem={userItem()} allUserItems={[]} userData={player} onClose={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Eat meal/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ itemType: "MEAL", canStack: true }) });
  expect(nativeButton(/Eat meal/)).toBeDefined();
});

it("shows split only for stacks of 2+", () => {
  const view = render(<ItemInspector userItem={userItem({ canStack: true, quantity: 1 })} allUserItems={[]} userData={player} onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Merge Stacks/ })).toBeDefined();
  expect(screen.queryByRole("button", { name: /Split Stack/ })).toBeNull();
  view.unmount();
  renderInspector({ userItem: userItem({ canStack: true, quantity: 4 }) });
  expect(screen.getByRole("button", { name: /Split Stack/ })).toBeDefined();
});

it("shows drop for event or non-shop items and sell otherwise", () => {
  const view = render(<ItemInspector userItem={userItem()} allUserItems={[]} userData={player} onClose={vi.fn()} />);
  expect(nativeButton("Sell Item [120 ryo]")).toBeDefined();
  view.unmount();
  renderInspector({ userItem: userItem({ isEventItem: true }) });
  expect(nativeButton("Drop Item")).toBeDefined();
});

it("hides set hotkey on touch-only devices and without a handler", () => {
  const view = render(<ItemInspector userItem={userItem()} allUserItems={[]} userData={player} onClose={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Set hotkey" })).toBeNull();
  view.unmount();
  const onSetHotkey = vi.fn();
  renderInspector({ onSetHotkey });
  const button = screen.getByRole("button", { name: "Set hotkey" });
  expect(button.className).toContain("not-any-pointer-fine:hidden");
  fireEvent.click(button);
  expect(onSetHotkey).toHaveBeenCalledTimes(1);
});

it("shows the mastery warning of an equipped item", () => {
  renderInspector({ userItem: userItem({ equipped: "HAND_1" }), masteryWarning: "Unusable in battle: requires 500 Bukijutsu (you have 10)" });
  expect(screen.getByText("Unusable in battle: requires 500 Bukijutsu (you have 10)")).toBeDefined();
});

it("returns to the backpack on Escape and from the back link", () => {
  const { onClose } = renderInspector();
  fireEvent.keyDown(screen.getByRole("region", { name: "Twin Fang Blade" }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "← Backpack" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
