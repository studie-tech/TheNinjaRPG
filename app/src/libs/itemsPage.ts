import {
  ItemRarities,
  type ItemRarity,
  type ItemSlot,
  ItemSlots,
  ItemSlotTypes,
  type ItemType,
  ItemTypes,
} from "@/drizzle/constants";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";
import { needsInventoryRepair } from "@/libs/repair";

/** Orders the backpack can be shown in. */
export type BackpackSort =
  | "rarity"
  | "type"
  | "slot"
  | "name"
  | "newest"
  | "durability";

/** What the backpack shows: a name search plus one type chip. */
export type BackpackFilter = {
  query: string;
  type: ItemType | "ALL" | "NEEDS_REPAIR";
};

/** A backpack item that fits a slot, with where it is worn and why it cannot be. */
export type SlotCandidate<T> = {
  userItem: T;
  equippedIn: ItemSlot | null;
  blockedReason: string | null;
};

export const BACKPACK_SORTS: { value: BackpackSort; label: string }[] = [
  { value: "rarity", label: "Rarity" },
  { value: "type", label: "Type" },
  { value: "slot", label: "Slot" },
  { value: "name", label: "Name" },
  { value: "newest", label: "Newest" },
  { value: "durability", label: "Durability" },
];

const TYPE_LABELS: Record<ItemType, string> = {
  WEAPON: "Weapons",
  CONSUMABLE: "Consumables",
  ARMOR: "Armor",
  ACCESSORY: "Accessories",
  MATERIAL: "Materials",
  COOKING: "Cooking",
  MEAL: "Meals",
  KEYSTONE: "Keystones",
  CRYSTAL: "Crystals",
  FURNITURE: "Furniture",
  OTHER: "Other",
};

type SortableItem = Pick<UserItemWithRelations, "durability" | "createdAt"> & {
  item: Pick<Item, "name" | "rarity" | "itemType" | "slot" | "maxDurability">;
};

/** Higher for rarer items. */
const rarityRank = (rarity: ItemRarity) => ItemRarities.indexOf(rarity);

/** Remaining durability as a share of its maximum; items that never wear count as full. */
const durabilityRatio = (ui: SortableItem) =>
  ui.item.maxDurability > 0 ? ui.durability / ui.item.maxDurability : 1;

const byName = (a: SortableItem, b: SortableItem) =>
  a.item.name.localeCompare(b.item.name);

/** Rarest first, then the least worn, then by name: the order gear is chosen in. */
const byRarityThenDurability = (a: SortableItem, b: SortableItem) =>
  rarityRank(b.item.rarity) - rarityRank(a.item.rarity) ||
  durabilityRatio(b) - durabilityRatio(a) ||
  byName(a, b);

const comparators: Record<BackpackSort, (a: SortableItem, b: SortableItem) => number> =
  {
    rarity: byRarityThenDurability,
    type: (a, b) =>
      ItemTypes.indexOf(a.item.itemType) - ItemTypes.indexOf(b.item.itemType) ||
      byName(a, b),
    slot: (a, b) =>
      ItemSlotTypes.indexOf(a.item.slot) - ItemSlotTypes.indexOf(b.item.slot) ||
      byName(a, b),
    name: byName,
    newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byName(a, b),
    // Most worn first so repairs are easy to find; items that never wear come last.
    durability: (a, b) => {
      const wearA = a.item.maxDurability > 0 ? durabilityRatio(a) : 2;
      const wearB = b.item.maxDurability > 0 ? durabilityRatio(b) : 2;
      return wearA - wearB || byName(a, b);
    },
  };

/** A sorted copy of the backpack; the input keeps its order. */
export const sortBackpack = <T extends SortableItem>(
  items: T[],
  sort: BackpackSort,
): T[] => [...items].sort(comparators[sort]);

/** Backpack items matching the name search and the selected chip. */
export const filterBackpack = <T extends UserItemWithRelations>(
  items: T[],
  filter: BackpackFilter,
): T[] => {
  const query = filter.query.trim().toLowerCase();
  return items.filter(
    (ui) =>
      (!query || ui.item.name.toLowerCase().includes(query)) &&
      (filter.type === "ALL" ||
        (filter.type === "NEEDS_REPAIR"
          ? needsInventoryRepair(ui)
          : ui.item.itemType === filter.type)),
  );
};

/** One chip per item type present, plus "Needs repair" when anything is worn. */
export const backpackFilterChips = (
  items: UserItemWithRelations[],
): { value: BackpackFilter["type"]; label: string; count: number }[] => {
  const types = ItemTypes.flatMap((type) => {
    const count = items.filter((ui) => ui.item.itemType === type).length;
    return count > 0 ? [{ value: type, label: TYPE_LABELS[type], count }] : [];
  });
  const worn = items.filter(needsInventoryRepair).length;
  return [
    { value: "ALL", label: "All", count: items.length },
    ...types,
    ...(worn > 0
      ? [{ value: "NEEDS_REPAIR" as const, label: "Needs repair", count: worn }]
      : []),
  ];
};

/** Equipment slots an item can go into; none for meals, furniture and unslotted items. */
export const fittingSlots = (item: Pick<Item, "slot" | "itemType">): ItemSlot[] => {
  if (
    item.slot === "NONE" ||
    item.itemType === "MEAL" ||
    item.itemType === "FURNITURE"
  ) {
    return [];
  }
  return ItemSlots.filter((slot) => slot !== "NONE" && slot.includes(item.slot));
};

/**
 * Backpack and worn items that fit `slot`, other than the one already in it: equippable
 * first, rarest and least worn on top; items the server would refuse come last.
 */
export const rankSlotCandidates = <T extends UserItemWithRelations>(
  items: T[],
  slot: ItemSlot,
  getBlockedReason: (userItem: T, slot: ItemSlot) => string | null,
): SlotCandidate<T>[] =>
  items
    .filter((ui) => ui.equipped !== slot && fittingSlots(ui.item).includes(slot))
    .map((ui) => ({
      userItem: ui,
      equippedIn: ui.equipped === "NONE" ? null : ui.equipped,
      blockedReason: getBlockedReason(ui, slot),
    }))
    .sort(
      (a, b) =>
        Number(!!a.blockedReason) - Number(!!b.blockedReason) ||
        byRarityThenDurability(a.userItem, b.userItem),
    );

/** Slots a dragged item can land on: where it fits, except its own slot and refused ones. */
export const dropTargetsFor = <T extends UserItemWithRelations>(
  userItem: T,
  getBlockedReason: (userItem: T, slot: ItemSlot) => string | null,
): ItemSlot[] =>
  fittingSlots(userItem.item).filter(
    (slot) => slot !== userItem.equipped && !getBlockedReason(userItem, slot),
  );
