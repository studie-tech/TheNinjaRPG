import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as itemActions from "@/hooks/useItemActions";
import * as contentImage from "@/layout/ContentImage";
import * as equipmentPreview from "@/layout/EquipmentPreview";
import * as hotkeyControls from "@/layout/HotkeyControls";
import * as image from "@/layout/Image";
import * as inspector from "@/layout/items/ItemInspector";
import { USER_ITEM_DRAG_TYPE } from "@/layout/items/ItemCard";
import { ItemsWorkspace } from "@/layout/items/ItemsWorkspace";
import * as mastery from "@/libs/mastery";
import * as skills from "@/libs/skillRequirements";

const browserGlobals = ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
let equip: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const key of browserGlobals) {
    if (key in window) Object.defineProperty(globalThis, key, { configurable: true, value: window[key as keyof Window] });
  }
  window.localStorage.clear();
  equip = vi.fn();
  vi.spyOn(itemActions, "useItemActions").mockReturnValue({ equip, merge: vi.fn() } as never);
  vi.spyOn(hotkeyControls, "useHotkeyAssignment").mockReturnValue({ hotkeys: { byAction: {} }, assign: vi.fn(), dialog: null } as never);
  vi.spyOn(equipmentPreview, "EquipmentPreview").mockImplementation(() => <button type="button">Preview</button>);
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => <span>{alt} art</span>);
  // biome-ignore lint/performance/noImgElement: isolated silhouette fixture
  vi.spyOn(image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(mastery, "gearMissingMastery").mockReturnValue(null as never);
  vi.spyOn(skills, "hasRequiredSkill").mockReturnValue(true);
  vi.spyOn(inspector, "ItemInspector").mockImplementation(({ userItem, onClose }) => (
    <section aria-label={`Inspecting ${userItem.item.name}`}>
      <button type="button" onClick={onClose}>
        Back
      </button>
    </section>
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  window.localStorage.clear();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

const gear = (id: string, slot: string, equipped: ItemSlot = "NONE") =>
  ({
    id,
    itemId: `item-${id}`,
    quantity: 1,
    level: 1,
    durability: 50,
    equipped,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: { id: `item-${id}`, name: id, image: null, rarity: "RARE", itemType: "WEAPON", slot, maxDurability: 50, hidden: false, effects: [], inShop: true },
  }) as unknown as UserItemWithRelations;

const katana = gear("Shadowsteel Katana", "HAND", "HAND_1");
const tanto = gear("Raijin Tanto", "HAND");
const pill = gear("Chakra Pill", "ITEM");
const player = { userId: "user-1", role: "USER", status: "AWAKE", battleId: null, items: [] } as never;

const renderWorkspace = (props: Partial<Parameters<typeof ItemsWorkspace>[0]> = {}) => {
  const all = props.userItems ?? [katana, tanto, pill];
  const tree = (next: Partial<Parameters<typeof ItemsWorkspace>[0]>) => (
    <ItemsWorkspace
      userData={player}
      userItems={all}
      bagItems={all.filter((ui) => ui.equipped === "NONE")}
      bag="normal"
      {...props}
      {...next}
    />
  );
  const view = render(tree({}));
  return { view, rerender: (next: Partial<Parameters<typeof ItemsWorkspace>[0]>) => view.rerender(tree(next)) };
};

const slotOf = (slot: ItemSlot) => document.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!;
const card = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

it("opens the slot picker for a slot and the inspector for an item", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HAND_1"));
  });
  expect(screen.getByRole("heading", { name: "Hand slot" })).toBeDefined();
  expect(slotOf("HAND_1").getAttribute("aria-current")).toBe("true");
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  });
  expect(screen.getByRole("region", { name: "Inspecting Shadowsteel Katana" })).toBeDefined();
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
  });
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  expect(screen.getByRole("region", { name: "Inspecting Raijin Tanto" })).toBeDefined();
});

it("equips from the slot picker into that slot", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HAND_2"));
  });
  fireEvent.click(screen.getByRole("button", { name: "Equip Raijin Tanto" }));
  expect(equip).toHaveBeenCalledWith({ userItemId: "Raijin Tanto", slot: "HAND_2" });
});

it("changing bag resets the right column", () => {
  const { rerender } = renderWorkspace();
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  expect(screen.getByRole("region", { name: "Inspecting Raijin Tanto" })).toBeDefined();
  rerender({ bag: "event", bagItems: [] });
  expect(screen.queryByRole("region", { name: /Inspecting/ })).toBeNull();
  expect(document.querySelector("[data-items-panel]")).toBeNull();
  expect(screen.getByRole("heading", { name: "Backpack" })).toBeDefined();
});

it("returns to backpack when the inspected item is gone", () => {
  const { rerender } = renderWorkspace();
  act(() => {
    fireEvent.click(card("Chakra Pill"));
  });
  expect(screen.getByRole("region", { name: "Inspecting Chakra Pill" })).toBeDefined();
  // Sold or used up: the item leaves the inventory while its panel is open.
  rerender({ userItems: [katana, tanto], bagItems: [tanto] });
  expect(screen.queryByRole("region", { name: /Inspecting/ })).toBeNull();
  expect(document.querySelector("[data-items-panel]")).toBeNull();
});

it("phone shows tabs and opens panels as sheets", () => {
  renderWorkspace();
  const [equipmentTab, backpackTab] = screen.getAllByRole("tab");
  expect(equipmentTab?.getAttribute("aria-selected")).toBe("true");
  expect(backpackTab?.textContent).toBe("Backpack · 2");
  act(() => {
    fireEvent.click(backpackTab!);
  });
  expect(backpackTab?.getAttribute("aria-selected")).toBe("true");
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  const panel = document.querySelector("[data-items-panel]");
  expect(panel?.className).toContain("@max-[600px]:fixed");
  expect(screen.getByRole("button", { name: "Close panel" })).toBeDefined();
});

it("show backpack from the picker switches the phone tab", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HEAD"));
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Show Backpack" }));
  });
  expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("heading", { name: "Head slot" })).toBeNull();
});

it("drags a backpack item onto a fitting slot only", () => {
  renderWorkspace();
  act(() => {
    fireEvent.dragStart(card("Raijin Tanto"), { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
  });
  expect(slotOf("HEAD").className).toContain("opacity-40");
  expect(slotOf("HAND_2").className).not.toContain("opacity-40");
  const getData = (type: string) => (type === USER_ITEM_DRAG_TYPE ? "Raijin Tanto" : "");
  act(() => {
    fireEvent.drop(slotOf("HEAD"), { dataTransfer: { getData } });
  });
  expect(equip).not.toHaveBeenCalled();
  act(() => {
    fireEvent.drop(slotOf("HAND_2"), { dataTransfer: { getData } });
  });
  expect(equip).toHaveBeenCalledWith({ userItemId: "Raijin Tanto", slot: "HAND_2" });
});

it("drags worn gear to the other hand", () => {
  renderWorkspace();
  act(() => {
    fireEvent.dragStart(slotOf("HAND_1"), { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
  });
  // Its own slot is not a target; the other hand is.
  expect(slotOf("HAND_1").className).toContain("opacity-40");
  act(() => {
    fireEvent.drop(slotOf("HAND_2"), { dataTransfer: { getData: () => "Shadowsteel Katana" } });
  });
  expect(equip).toHaveBeenCalledWith({ userItemId: "Shadowsteel Katana", slot: "HAND_2" });
});
