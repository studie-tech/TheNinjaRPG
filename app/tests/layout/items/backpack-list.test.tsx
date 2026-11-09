import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as contentImage from "@/layout/ContentImage";
import { BackpackList } from "@/layout/items/BackpackList";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
  window.localStorage.clear();
  // Canvas-drawn art is irrelevant to the list's behaviour.
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
    <span>{alt} art</span>
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  window.localStorage.clear();
  restoreBrowserGlobals();
});

type Fixture = {
  id: string;
  itemType?: string;
  slot?: string;
  rarity?: string;
  hidden?: boolean;
  durability?: number;
  maxDurability?: number;
};

const userItem = ({
  id,
  itemType = "WEAPON",
  slot = "HAND",
  rarity = "COMMON",
  hidden = false,
  durability = 0,
  maxDurability = 0,
}: Fixture) =>
  ({
    id,
    itemId: `item-${id}`,
    quantity: 1,
    level: 1,
    durability,
    equipped: "NONE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: {
      id: `item-${id}`,
      name: id,
      image: null,
      rarity,
      itemType,
      slot,
      maxDurability,
      hidden,
    },
  }) as unknown as UserItemWithRelations;

const items = [
  userItem({ id: "Storm Shuriken", slot: "THROWN", rarity: "RARE" }),
  userItem({ id: "Healing Salve", itemType: "CONSUMABLE", slot: "ITEM" }),
  userItem({
    id: "Worn Vest",
    itemType: "ARMOR",
    slot: "CHEST",
    durability: 10,
    maxDurability: 50,
  }),
  userItem({ id: "Secret Blade", hidden: true }),
];

const player = { userId: "user-1", role: "USER" } as never;

const renderList = (props: Partial<Parameters<typeof BackpackList>[0]> = {}) =>
  render(
    <BackpackList
      items={items}
      userData={player}
      selectedId={undefined}
      onSelect={vi.fn()}
      {...props}
    />,
  );

const cardNames = () =>
  within(screen.getByRole("list", { name: "Backpack items" }))
    .queryAllByRole("button")
    .map((button) => button.getAttribute("data-item-name"));

it("searches by name", () => {
  renderList();
  fireEvent.change(screen.getByLabelText("Search items"), {
    target: { value: "salve" },
  });
  expect(cardNames()).toEqual(["Healing Salve"]);
});

it("filters by chip", () => {
  renderList();
  const weapons = screen.getByRole("button", { name: /^Weapons/ });
  fireEvent.click(weapons);
  expect(weapons.getAttribute("aria-pressed")).toBe("true");
  expect(cardNames()).toEqual(["Storm Shuriken"]);
  fireEvent.click(screen.getByRole("button", { name: /^Needs repair/ }));
  expect(cardNames()).toEqual(["Worn Vest"]);
});

it("remembers sort per player", () => {
  const first = renderList();
  fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "name" } });
  expect(cardNames()).toEqual(["Healing Salve", "Storm Shuriken", "Worn Vest"]);
  first.unmount();
  renderList();
  expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("name");
  expect(window.localStorage.getItem("items:sort:user-1")).toContain("name");
});

it("shows active variant names in Name order with matching art labels", () => {
  const swords = ["Alpha Blade", "Zebra Blade"].map((id, index) => {
    const base = userItem({ id });
    return {
      ...base,
      activeVariantId: "active",
      item: {
        ...base.item,
        variants: [
          {
            id: "active",
            image: "/blade.webp",
            name: index === 0 ? "Zebra Blade" : "Alpha Blade",
          },
        ],
      },
    } as UserItemWithRelations;
  });
  renderList({ items: swords });
  fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "name" } });
  const cards = within(
    screen.getByRole("list", { name: "Backpack items" }),
  ).getAllByRole("button");
  expect(cards.map((card) => card.querySelector(".truncate")?.textContent)).toEqual([
    "Alpha Blade",
    "Zebra Blade",
  ]);
  expect(within(cards[0]!).getByText("Alpha Blade art")).toBeDefined();
});

it("hides hidden items from players but not content staff", () => {
  const view = renderList();
  expect(cardNames()).not.toContain("Secret Blade");
  view.unmount();
  renderList({ userData: { userId: "user-2", role: "CONTENT" } as never });
  expect(cardNames()).toContain("Secret Blade");
});

it("shows an empty state for no matches", () => {
  renderList();
  fireEvent.change(screen.getByLabelText("Search items"), {
    target: { value: "kunai" },
  });
  expect(cardNames()).toEqual([]);
  expect(screen.getByText("No items match")).toBeDefined();
  // Filters stay usable so the player can widen the search again.
  expect(screen.getByRole("button", { name: /^All/ })).toBeDefined();
});

it("selects a card with a click, as a real button", () => {
  const onSelect = vi.fn();
  renderList({ onSelect });
  const card = screen.getByRole("button", { name: /Healing Salve/ });
  expect(card.tagName).toBe("BUTTON");
  fireEvent.click(card);
  expect(onSelect).toHaveBeenCalledWith("Healing Salve");
});

it("marks the selected card", () => {
  renderList({ selectedId: "Worn Vest" });
  expect(
    screen.getByRole("button", { name: /Worn Vest/ }).getAttribute("aria-current"),
  ).toBe("true");
});

it("shows gear level in the card text", () => {
  renderList();
  const card = screen.getByRole("button", { name: /^Worn Vest/ });
  expect(card.textContent).toContain("Common · Chest · Lv 1");
  // Items without levels keep the plain line.
  expect(
    screen.getByRole("button", { name: /^Healing Salve/ }).textContent,
  ).not.toContain("Lv");
});
