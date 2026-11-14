import type { ItemRarity, ItemSlot, ItemType, UserStatus } from "@/drizzle/constants";
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
import { canDropFarmSeed } from "@/libs/farming";
import {
  applyActiveVariant,
  byItemName,
  calcItemSellingPrice,
  countsTowardInventoryStorage,
  getEquipBlockReason,
  getHomeStorageBucket,
  getHomeStorageBucketCapacity,
  getHomeStorageBucketFullMessage,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  type InventoryBucket,
  isCompatibleEquipSlot,
} from "@/libs/item";
import { needsInventoryRepair } from "@/libs/repair";
import { capitalizeFirstLetter } from "@/utils/string";

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
  const name = capitalizeFirstLetter(kind);
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
 * Select every shown stack of one rarity that `blockReason` allows, or deselect them when
 * all are already selected. Stacks outside `shown` keep their selection.
 */
export const toggleRarityPick = (
  shown: UserItemWithRelations[],
  rarity: ItemRarity,
  selected: string[],
  blockReason: (userItem: UserItemWithRelations) => string | null,
): string[] => {
  const ids = shown
    .filter((ui) => ui.item.rarity === rarity && blockReason(ui) === null)
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

/** Describe confirmed sales, refused stacks and sales that need authoritative reconciliation. */
export const bulkSellMessage = (
  prices: number[],
  refused: { name: string; reason: string }[],
  unconfirmed: { name: string }[] = [],
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
        : unconfirmed.length > 0
          ? "No sales were confirmed."
          : "Nothing was sold.";
  const stayed = refused.map(({ name, reason }) => `${name} ${reason}`).join("; ");
  return [
    done,
    ...(refused.length > 0 ? [`${refused.length} stayed: ${stayed}.`] : []),
    ...(unconfirmed.length > 0
      ? [
          `Could not confirm ${unconfirmed.map(({ name }) => name).join(", ")}. Your inventory and ryo will be refreshed.`,
        ]
      : []),
  ].join(" ");
};

/** Statuses that may use home storage; sleeping at home is allowed. */
export const HOME_STORAGE_STATUSES = [
  "AWAKE",
  "ASLEEP",
] as const satisfies UserStatus[];

/**
 * Why the player cannot reach their home storage, or null when they can: awake or asleep
 * in their own village, as for furnishing the home.
 */
export const homeStorageBlockReason = (user: {
  sector: number;
  status: UserStatus;
  village?: { sector: number } | null;
}): string | null => {
  if (!user.village || user.sector !== user.village.sector) {
    return "Return to your own village to use your home storage";
  }
  if (!(HOME_STORAGE_STATUSES as readonly UserStatus[]).includes(user.status)) {
    return "You cannot use your home storage right now";
  }
  return null;
};

type HomeStorageRow = {
  id: string;
  equipped: ItemSlot;
  storedAtHome: boolean;
  isInAuction: boolean;
  craftingFinishedAt: Date | null;
  item: { name: string; itemType: ItemType; isEventItem: boolean };
};

/**
 * Split the requested stacks into those that move between backpack and home storage and
 * those that stay, in request order. Each accepted stack takes a slot in the destination
 * bucket, so a later stack of a filled bucket stays. Furniture is managed from the home.
 */
export const planHomeStorageMove = <T extends HomeStorageRow>({
  rows,
  userItemIds,
  toHome,
  user,
  homeStorage,
}: {
  rows: T[];
  userItemIds: string[];
  toHome: boolean;
  user: UserData;
  homeStorage: number;
}) => {
  const moving: T[] = [];
  const refused: { userItemId: string; name: string; reason: string }[] = [];
  const used = new Map<string, number>();
  const bucketOf = (ui: T) =>
    toHome ? getHomeStorageBucket(ui.item) : getInventoryBucket(ui.item);
  for (const ui of rows) {
    const counts = toHome ? ui.storedAtHome : countsTowardInventoryStorage(ui);
    if (counts) used.set(bucketOf(ui), (used.get(bucketOf(ui)) ?? 0) + 1);
  }
  for (const userItemId of userItemIds) {
    const ui = rows.find((row) => row.id === userItemId);
    const reason = ((): string | null => {
      if (!ui) return "is not in your inventory";
      if (ui.item.itemType === "FURNITURE") {
        return "is furniture; manage it from your home";
      }
      if (ui.equipped !== "NONE") return "is equipped";
      if (ui.storedAtHome === toHome) {
        return toHome
          ? "is already in your home storage"
          : "is already in your backpack";
      }
      if (toHome && ui.isInAuction) return "is reserved in an auction or trade offer";
      if (toHome) {
        const bucket = getHomeStorageBucket(ui.item);
        if (
          (used.get(bucket) ?? 0) >= getHomeStorageBucketCapacity(bucket, homeStorage)
        ) {
          return `does not fit: ${getHomeStorageBucketFullMessage(bucket)}`;
        }
      } else {
        const bucket = getInventoryBucket(ui.item);
        if ((used.get(bucket) ?? 0) >= getInventoryBucketCapacity(bucket, user)) {
          // Accepted withdrawals already occupy bag slots in this batch's projected inventory.
          const held = countHeldInventorySlots(
            [...rows, ...moving.map((row) => ({ ...row, storedAtHome: false }))],
            bucket,
          );
          return `does not fit: ${getInventoryBucketFullMessage(bucket, held)}`;
        }
      }
      return null;
    })();
    if (ui && !reason) {
      moving.push(ui);
      used.set(bucketOf(ui), (used.get(bucketOf(ui)) ?? 0) + 1);
    } else {
      refused.push({ userItemId, name: ui?.item.name ?? "Item", reason: reason ?? "" });
    }
  }
  return { moving, refused };
};

/** Why one stack cannot move to (`toHome`) or from home storage now, as a sentence. */
export const homeStorageMoveBlockReason = <T extends HomeStorageRow>({
  userItemId,
  ...plan
}: Omit<Parameters<typeof planHomeStorageMove<T>>[0], "userItemIds"> & {
  userItemId: string;
}) => {
  const reason = planHomeStorageMove({ ...plan, userItemIds: [userItemId] }).refused[0]
    ?.reason;
  return reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : null;
};

/** Summarize a home storage move: how many stacks moved and why the others stayed. */
export const homeStorageMoveMessage = (
  moved: number,
  toHome: boolean,
  refused: { name: string; reason: string }[],
) => {
  const items = `${moved} item${moved === 1 ? "" : "s"}`;
  const done =
    moved === 0
      ? "Nothing was moved."
      : toHome
        ? `Stored ${items} in your home.`
        : `Took ${items} out of your home.`;
  const stayed = refused.map(({ name, reason }) => `${name} ${reason}`).join("; ");
  return refused.length > 0 ? `${done} ${refused.length} stayed: ${stayed}.` : done;
};

/**
 * Carried stacks that use bag space but are left out of the backpack list: auction
 * escrow, then unfinished crafts (the same order as getEquipBlockReason).
 */
export const countUnlistedBagStacks = (
  rows: {
    storedAtHome: boolean;
    equipped: ItemSlot;
    isInAuction: boolean;
    craftingFinishedAt: Date | null;
  }[],
  now: Date,
) => {
  const counted = rows.filter(countsTowardInventoryStorage);
  const auction = counted.filter((ui) => ui.isInAuction).length;
  const crafting = counted.filter(
    (ui) => !ui.isInAuction && !!ui.craftingFinishedAt && ui.craftingFinishedAt > now,
  ).length;
  return { auction, crafting };
};

/** Stacks of one inventory bucket that use bag space without showing in the backpack. */
export const countHeldInventorySlots = (
  rows: (Parameters<typeof countUnlistedBagStacks>[0][number] & {
    item: Parameters<typeof getInventoryBucket>[0];
  })[],
  bucket: InventoryBucket,
  now: Date = new Date(),
) =>
  countUnlistedBagStacks(
    rows.filter((row) => getInventoryBucket(row.item) === bucket),
    now,
  );

/** Says which unlisted stacks still use bag space, or null when every counted stack is listed. */
export const unlistedBagStacksNote = ({
  auction,
  crafting,
}: ReturnType<typeof countUnlistedBagStacks>) => {
  const parts = [
    auction > 0 ? `${auction} in auction` : null,
    crafting > 0 ? `${crafting} being crafted` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `Also using space: ${parts.join(", ")}.` : null;
};
