import type { ItemRarity, ItemSlot, ItemType } from "@/drizzle/constants";
import {
  BULK_SELL_WARN_RARITIES,
  ItemRarities,
  ItemSlots,
  ItemSlotTypes,
  ItemTypes,
} from "@/drizzle/constants";
import type {
  Item,
  UserData,
  UserItemWithRelations,
  VillageStructure,
} from "@/drizzle/schema";
import { applyActiveVariant } from "@/libs/combat/util";
import { canDropFarmSeed } from "@/libs/farming";
import {
  byItemName,
  calcItemSellingPrice,
  getEquipBlockReason,
  isCompatibleEquipSlot,
} from "@/libs/item";
import { needsInventoryRepair } from "@/libs/repair";

/** Supported backpack sort choices and their player-facing labels. */
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

/** Higher for rarer items. */
const rarityRank = (rarity: ItemRarity) => ItemRarities.indexOf(rarity);

/** Remaining durability as a share of its maximum; items that never wear count as full. */
const durabilityRatio = (ui: SortableItem) =>
  ui.item.maxDurability > 0 ? ui.durability / ui.item.maxDurability : 1;

/** Compares active-variant names using the shared item-name sorting rules. */
const byName = (a: SortableItem, b: SortableItem) =>
  byItemName(applyActiveVariant(a), applyActiveVariant(b));

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

/** Backpack items matching the displayed or base name and the selected chip. */
export const filterBackpack = <T extends UserItemWithRelations>(
  items: T[],
  filter: BackpackFilter,
): T[] => {
  const query = filter.query.trim().toLowerCase();
  return items.filter(
    (ui) =>
      (!query ||
        ui.item.name.toLowerCase().includes(query) ||
        applyActiveVariant(ui).name.toLowerCase().includes(query)) &&
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
  if (item.itemType === "MEAL" || item.itemType === "FURNITURE") {
    return [];
  }
  return ItemSlots.filter((slot) => isCompatibleEquipSlot(slot, item.slot));
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

/** "Hand 2", "Item 3", "Head": a slot as players read it. */
export const slotName = (slot: ItemSlot) => {
  const [kind = slot, index] = slot.split("_");
  const name = kind.charAt(0) + kind.slice(1).toLowerCase();
  return index ? `${name} ${index}` : name;
};

/**
 * Why the server would refuse to equip this item anywhere: every equipped copy, this one
 * included, counts toward the item's equip limit, so worn gear cannot move slots directly.
 */
export const equipLimitReason = <T extends UserItemWithRelations>(
  userItem: T,
  allItems: T[],
): string | null => {
  const equipped = allItems.filter(
    (ui) => ui.itemId === userItem.itemId && ui.equipped !== "NONE",
  );
  if (equipped.length < userItem.item.maxEquips) return null;
  if (userItem.equipped !== "NONE")
    return `Unequip from ${slotName(userItem.equipped)} first`;
  const [first] = equipped;
  return first ? `Already equipped in ${slotName(first.equipped)}` : null;
};

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

type SortableItem = Pick<
  UserItemWithRelations,
  "durability" | "createdAt" | "activeVariantId" | "item"
>;

/**
 * Why a stack cannot be sold or dropped in bulk, as a phrase after its name ("is in
 * auction"), or null when it can. Farm market seeds stay while the player could not buy one
 * back, as with a single drop.
 */
export const bulkSellBlockReason = (
  userItem: Pick<
    UserItemWithRelations,
    "equipped" | "storedAtHome" | "isInAuction" | "craftingFinishedAt"
  > & { item: Pick<Item, "isFarmSeed" | "inShop" | "hidden" | "farmSellValue"> },
  farmCurrency: number,
  now: Date = new Date(),
): string | null => {
  if (userItem.equipped !== "NONE") return "is equipped";
  const blocked = getEquipBlockReason(userItem, now);
  if (blocked) return blocked;
  if (!canDropFarmSeed(userItem.item, farmCurrency)) {
    return `needs ${userItem.item.farmSellValue} farm coins to buy back`;
  }
  return null;
};

/**
 * Select every sellable shown stack of one rarity, or deselect them when all are already
 * selected. Stacks outside `shown` keep their selection.
 */
export const toggleRarityPick = (
  shown: UserItemWithRelations[],
  rarity: ItemRarity,
  selected: string[],
  farmCurrency: number,
): string[] => {
  const ids = shown
    .filter(
      (ui) =>
        ui.item.rarity === rarity && bulkSellBlockReason(ui, farmCurrency) === null,
    )
    .map((ui) => ui.id);
  const allPicked = ids.length > 0 && ids.every((id) => selected.includes(id));
  return allPicked
    ? selected.filter((id) => !ids.includes(id))
    : [...selected, ...ids.filter((id) => !selected.includes(id))];
};

/** Ryo a bulk sell pays and how many stacks sell or drop; a stack worth 0 ryo is dropped. */
export const bulkSellTotals = (
  items: UserItemWithRelations[],
  user: UserData,
  structures: VillageStructure[] | undefined,
) => {
  const totals = { ryo: 0, sellCount: 0, dropCount: 0 };
  for (const ui of items) {
    const price = calcItemSellingPrice(user, ui, structures);
    if (price > 0) {
      totals.ryo += price;
      totals.sellCount += 1;
    } else totals.dropCount += 1;
  }
  return totals;
};

/** Stacks rare enough that a bulk sell names them again before they go. */
export const warnedItems = (items: UserItemWithRelations[]) =>
  items.filter((ui) => BULK_SELL_WARN_RARITIES.includes(ui.item.rarity));

/** One line for a bulk sell's result: what sold for how much, what dropped, what stayed. */
export const bulkSellMessage = (
  prices: number[],
  refused: { name: string; reason: string }[],
) => {
  const plural = (count: number) => `${count} item${count === 1 ? "" : "s"}`;
  const sold = prices.filter((price) => price > 0);
  const dropped = prices.length - sold.length;
  const ryo = sold.reduce((sum, price) => sum + price, 0);
  const done =
    sold.length > 0
      ? `Sold ${plural(sold.length)} for ${ryo.toLocaleString()} ryo${dropped > 0 ? ` and dropped ${dropped}` : ""}.`
      : dropped > 0
        ? `Dropped ${plural(dropped)}.`
        : "Nothing was sold.";
  if (refused.length === 0) return done;
  const stayed = refused.map(({ name, reason }) => `${name} ${reason}`).join("; ");
  return `${done} ${refused.length} stayed: ${stayed}.`;
};
