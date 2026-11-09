import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as contentImage from "@/layout/ContentImage";
import * as image from "@/layout/Image";
import { EquipmentFigure } from "@/layout/items/EquipmentFigure";
import { USER_ITEM_DRAG_TYPE } from "@/layout/items/ItemCard";

beforeEach(() => {
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
    <span>{alt} art</span>
  ));
  // biome-ignore lint/performance/noImgElement: isolated silhouette fixture
  vi.spyOn(image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const worn = (id: string, equipped: ItemSlot, extra: Record<string, unknown> = {}) =>
  ({
    id,
    itemId: `item-${id}`,
    quantity: 1,
    level: 1,
    durability: 40,
    equipped,
    imbuements: [],
    item: {
      id: `item-${id}`,
      name: id,
      image: null,
      rarity: "EPIC",
      itemType: "WEAPON",
      slot: "HAND",
      maxDurability: 50,
      hidden: false,
    },
    ...extra,
  }) as unknown as UserItemWithRelations;

const items = [worn("Shadowsteel Katana", "HAND_1"), worn("Jade Keystone", "KEYSTONE")];

const renderFigure = (props: Partial<Parameters<typeof EquipmentFigure>[0]> = {}) =>
  render(
    <EquipmentFigure
      userItems={items}
      activeSlot={undefined}
      dropTargets={undefined}
      masteryWarning={() => undefined}
      onSlotClick={vi.fn()}
      onDropItem={vi.fn()}
      {...props}
    />,
  );

const slotOf = (slot: ItemSlot) =>
  document.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!;

it("renders 15 labelled slots in reading order", () => {
  renderFigure();
  const order = [...document.querySelectorAll("[data-slot]")].map((el) =>
    el.getAttribute("data-slot"),
  );
  expect(order).toEqual([
    "KEYSTONE",
    "HEAD",
    "THROWN",
    "ITEM_1",
    "CHEST",
    "ITEM_2",
    "HAND_1",
    "WAIST",
    "HAND_2",
    "ITEM_3",
    "LEGS",
    "ITEM_4",
    "ITEM_5",
    "FEET",
    "ITEM_6",
  ]);
  expect(
    screen.getByRole("button", { name: "Hand: Shadowsteel Katana" }),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Head slot, empty" })).toBeDefined();
});

it("opens a slot on click, filled or empty", () => {
  const onSlotClick = vi.fn();
  renderFigure({ onSlotClick });
  fireEvent.click(slotOf("HAND_1"));
  fireEvent.click(slotOf("WAIST"));
  expect(onSlotClick.mock.calls).toEqual([["HAND_1"], ["WAIST"]]);
});

it("names equipped variant art and its slot with the displayed variant name", () => {
  const base = items[0]!;
  const sword = {
    ...base,
    activeVariantId: "blue",
    item: {
      ...base.item,
      variants: [{ id: "blue", image: "/blue.webp", name: "Blue Katana" }],
    },
  } as UserItemWithRelations;
  renderFigure({ userItems: [sword] });
  expect(screen.getByRole("button", { name: "Hand: Blue Katana" })).toBeDefined();
  expect(screen.getByText("Blue Katana art")).toBeDefined();
});

it("marks the active slot", () => {
  renderFigure({ activeSlot: "HAND_1" });
  expect(slotOf("HAND_1").getAttribute("aria-current")).toBe("true");
  expect(slotOf("HEAD").getAttribute("aria-current")).toBeNull();
});

it("shows the mastery warning on a blocked equipped item", () => {
  renderFigure({
    masteryWarning: (ui) =>
      ui.id === "Shadowsteel Katana"
        ? "Unusable in battle: requires 500 Taijutsu (you have 120)"
        : undefined,
  });
  expect(
    screen.getByTitle("Unusable in battle: requires 500 Taijutsu (you have 120)"),
  ).toBeDefined();
});

it("shows the hotkey of an equipped item", () => {
  renderFigure({ hotkeys: { "item-Shadowsteel Katana": "r" } });
  const key = slotOf("HAND_1").querySelector("kbd");
  expect(key?.textContent).toBe("R");
  expect(key?.className).toContain("not-any-pointer-fine:hidden");
});

it("dragover is accepted only on drop targets", () => {
  renderFigure({ dropTargets: ["HAND_1", "HAND_2"] });
  // fireEvent returns false when the handler accepted the drop by preventing the default.
  expect(fireEvent.dragOver(slotOf("HAND_2"))).toBe(false);
  expect(fireEvent.dragOver(slotOf("HEAD"))).toBe(true);
  expect(slotOf("HEAD").className).toContain("opacity-40");
  expect(slotOf("HAND_2").className).not.toContain("opacity-40");
});

it("drop calls onDropItem with the slot", () => {
  const onDropItem = vi.fn();
  renderFigure({ dropTargets: ["HAND_2"], onDropItem });
  fireEvent.drop(slotOf("HAND_2"), {
    dataTransfer: {
      getData: (type: string) => (type === USER_ITEM_DRAG_TYPE ? "Raijin Tanto" : ""),
    },
  });
  fireEvent.drop(slotOf("HEAD"), { dataTransfer: { getData: () => "Raijin Tanto" } });
  expect(onDropItem.mock.calls).toEqual([["Raijin Tanto", "HAND_2"]]);
});

it("does not offer equipped gear as a drag source", () => {
  renderFigure();
  expect(slotOf("HAND_1").getAttribute("draggable")).not.toBe("true");
});

it("shows stack size, level and wear the way the mockup does", () => {
  const shuriken = worn("Storm Shuriken", "THROWN", {
    quantity: 24,
    item: {
      ...worn("x", "THROWN").item,
      name: "Storm Shuriken",
      itemType: "CONSUMABLE",
      slot: "THROWN",
      maxDurability: 0,
    },
  });
  const sandals = worn("Wind Sandals", "FEET", {
    durability: 20,
    item: {
      ...worn("x", "FEET").item,
      name: "Wind Sandals",
      itemType: "ARMOR",
      slot: "FEET",
    },
  });
  renderFigure({ userItems: [...items, shuriken, sandals] });
  expect(slotOf("THROWN").textContent).toContain("×24");
  // Worn below half: an orange mark and a bottom bar at its share.
  expect(screen.getByTitle("Durability 40%: repair soon")).toBeDefined();
  expect(
    slotOf("FEET").querySelector<HTMLElement>("[data-durability]")?.style.width,
  ).toBe("40%");
  expect(slotOf("HAND_1").textContent).toContain("Lv 1");
});

it("draws equipped art inside the slot's padding instead of over its border", () => {
  renderFigure();
  // ContentImage positions its art against the nearest relative box; padding on that box would not inset it.
  const frame = screen.getByText("Shadowsteel Katana art").parentElement!;
  expect(frame.className).toContain("relative");
  expect(frame.className).not.toMatch(/(^|\s)p-\d/);
  expect(frame.parentElement!.className).toContain("p-1");
});
