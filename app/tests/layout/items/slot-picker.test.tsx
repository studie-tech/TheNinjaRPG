import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as contentImage from "@/layout/ContentImage";
import { SlotPicker } from "@/layout/items/SlotPicker";

beforeEach(() => {
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
    <span>{alt} art</span>
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const gear = (
  id: string,
  rarity: string,
  durability: number,
  equipped: ItemSlot = "NONE",
) =>
  ({
    id,
    itemId: `item-${id}`,
    quantity: 1,
    level: 1,
    durability,
    equipped,
    imbuements: [],
    item: {
      id: `item-${id}`,
      name: id,
      image: null,
      rarity,
      itemType: "WEAPON",
      slot: "HAND",
      maxDurability: 50,
      hidden: false,
    },
  }) as unknown as UserItemWithRelations;

const items = [
  gear("Shadowsteel Katana", "EPIC", 41, "HAND_1"),
  gear("Oak Staff", "COMMON", 15),
  gear("Twin Fang Blade", "EPIC", 32),
  gear("Raijin Tanto", "LEGENDARY", 50),
  gear("Storm Halberd", "LEGENDARY", 50),
  gear("Off Hand Kunai", "RARE", 50, "HAND_2"),
];

const renderPicker = (props: Partial<Parameters<typeof SlotPicker>[0]> = {}) => {
  const handlers = {
    onEquip: vi.fn(),
    onUnequip: vi.fn(),
    onInspect: vi.fn(),
    onShowInBackpack: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <SlotPicker
      slot="HAND_1"
      userItems={items}
      getBlockedReason={(ui) =>
        ui.id === "Storm Halberd" ? "Needs 500 Bukijutsu" : null
      }
      {...handlers}
      {...props}
    />,
  );
  return { view, ...handlers };
};

const rowNames = () =>
  within(screen.getByRole("list", { name: "Items that fit" }))
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("data-item-name"));

it("lists candidates in rarity then durability order", () => {
  renderPicker();
  expect(screen.getByRole("heading", { name: "Hand slot" })).toBeDefined();
  expect(screen.getByText("5 items fit")).toBeDefined();
  expect(rowNames()).toEqual([
    "Raijin Tanto",
    "Twin Fang Blade",
    "Off Hand Kunai",
    "Oak Staff",
    "Storm Halberd",
  ]);
  expect(screen.getByText(/Equipped in Hand 2/)).toBeDefined();
});

it("disables blocked rows with the mastery reason", () => {
  renderPicker();
  const blocked = screen.getByRole("button", {
    name: "Equip Storm Halberd",
  }) as HTMLButtonElement;
  expect(blocked.disabled).toBe(true);
  expect(screen.getByText("Needs 500 Bukijutsu")).toBeDefined();
  expect(
    (screen.getByRole("button", { name: "Equip Raijin Tanto" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("equips into the picked slot", () => {
  const { onEquip } = renderPicker();
  fireEvent.click(screen.getByRole("button", { name: "Equip Twin Fang Blade" }));
  expect(onEquip).toHaveBeenCalledWith("Twin Fang Blade", "HAND_1");
});

it("opens a fitting item's details from its row", () => {
  const { onInspect, onEquip } = renderPicker();
  fireEvent.click(screen.getByRole("button", { name: "Details of Twin Fang Blade" }));
  expect(onInspect).toHaveBeenCalledWith("Twin Fang Blade");
  expect(onEquip).not.toHaveBeenCalled();
});

it("unequips and inspects the current item", () => {
  const { onUnequip, onInspect } = renderPicker();
  const current = screen.getByRole("region", { name: "Equipped now" });
  expect(within(current).getByText("Shadowsteel Katana")).toBeDefined();
  fireEvent.click(within(current).getByRole("button", { name: "Unequip" }));
  fireEvent.click(within(current).getByRole("button", { name: "Inspect" }));
  expect(onUnequip).toHaveBeenCalledWith("Shadowsteel Katana", "HAND_1");
  expect(onInspect).toHaveBeenCalledWith("Shadowsteel Katana");
});

it("labels current and candidate gear with their active variant names while equipping by id", () => {
  const variantItems = [items[0]!, items[1]!].map((base, index) => ({
    ...base,
    activeVariantId: "blue",
    item: {
      ...base.item,
      variants: [
        {
          id: "blue",
          image: "/blue.webp",
          name: index === 0 ? "Blue Katana" : "Blue Staff",
        },
      ],
    },
  })) as UserItemWithRelations[];
  const { onEquip } = renderPicker({ userItems: variantItems });
  const current = screen.getByRole("region", { name: "Equipped now" });
  expect(within(current).getByText("Blue Katana")).toBeDefined();
  expect(within(current).getByText("Blue Katana art")).toBeDefined();
  expect(screen.getByText("Blue Staff")).toBeDefined();
  expect(screen.getByText("Blue Staff art")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Equip Blue Staff" }));
  expect(onEquip).toHaveBeenCalledWith("Oak Staff", "HAND_1");
});

it("shows an empty slot without an equipped card", () => {
  renderPicker({
    slot: "HAND_2",
    userItems: items.filter((ui) => ui.id !== "Off Hand Kunai"),
  });
  expect(screen.queryByRole("region", { name: "Equipped now" })).toBeNull();
});

it("says when nothing fits and offers the backpack", () => {
  const { onShowInBackpack } = renderPicker({ slot: "HEAD" });
  expect(screen.getByText("Nothing in your bags fits this slot")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Show Backpack" }));
  expect(onShowInBackpack).toHaveBeenCalledTimes(1);
});

it("closes on Escape and the close button", () => {
  const { onClose } = renderPicker();
  fireEvent.keyDown(screen.getByRole("region", { name: "Hand slot" }), {
    key: "Escape",
  });
  fireEvent.click(screen.getByRole("button", { name: "Close slot picker" }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("disables equip and unequip while a change is saving", () => {
  renderPicker({ isPending: true });
  expect(
    (screen.getByRole("button", { name: "Equip Raijin Tanto" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Unequip" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    screen.getByRole("region", { name: "Hand slot" }).getAttribute("aria-busy"),
  ).toBe("true");
});

it("keeps each row's art inside its box", () => {
  renderPicker();
  // Item art positions itself absolutely; its box must be the containing block.
  const art = screen.getByText("Raijin Tanto art").parentElement;
  expect(art?.className).toContain("relative");
});
