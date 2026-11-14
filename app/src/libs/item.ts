import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  COOKING_BASE_SLOTS,
  DURABILITY_POINT_PRICE_PERCENT,
  FED_COOKING_SLOTS,
  FED_EVENT_ITEMS,
  FED_INVENTORY_SLOTS,
  FED_MATERIALS_SLOTS,
  HOME_FURNITURE_STORAGE_CAPACITY,
  INVENTORY_BASE_SLOTS,
  ITEM_REPAIR_BASE_COST,
  ITEM_SELL_BASE_DISCOUNT_PERC,
  ITEM_SELL_MAX_DISCOUNT_PERC,
  type ItemSlot,
  ItemSlots,
  ItemSlotTypes,
  type ItemType,
  ItemTypes,
  MATERIALS_BASE_SLOTS,
} from "@/drizzle/constants";
import type {
  Item,
  ItemLoadout,
  ItemSlotType,
  UserData,
  UserItemWithItem,
  UserItemWithRelations,
  VillageStructure,
} from "@/drizzle/schema";
import type {
  MasteryBuffUser,
  MasteryRequirementFields,
  MasteryStatSource,
} from "@/libs/mastery";
import { gearMissingMastery, missingMasteryRequirement } from "@/libs/mastery";
import { healItemDiscountPerc } from "@/libs/shop";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { getUserFederalStatus } from "@/utils/paypal";
import { getStrucBoost } from "@/utils/village";
import type { FurnitureData, FurnitureVariantData } from "@/validators/itemFurniture";

/**
 * Checks if an item is consumable outside of combat.
 * `rollsagemode` counts only when the user has no equipped sage mode (same as the
 * consume endpoint, which skips the roll if a mode is already worn).
 * @param item - The item to check.
 * @param userData - The user data.
 * @returns True if the item is consumable outside of combat, false otherwise.
 */
export const nonCombatConsume = (item: Item, userData: UserData): boolean => {
  if (item.itemType === "MEAL") return true;
  if (item.itemType !== "CONSUMABLE") {
    return false;
  }
  return item.effects.some(
    ({ type }) =>
      NON_COMBAT_EFFECTS.has(type) ||
      (type === "rollsagemode" && !userData.sageModeId) ||
      (type === "removebloodline" && !!userData.bloodlineId),
  );
};

/** Consumable effects usable outside combat whatever the user's state. */
const NON_COMBAT_EFFECTS = new Set<string>([
  "rollbloodline",
  "heal",
  "marriageslotincrease",
  "noncombatincreasereskins",
  "increasejutsuslots",
  "noncombatconsumereward",
  "noncombatgainskill",
  "noncombatquest",
  "repair",
]);

/**
 * Calculates the maximum number of event items for a user.
 *
 * @param user - The user data.
 * @returns The maximum number of event items.
 */
export const calcMaxEventItems = (user: UserData) =>
  FED_EVENT_ITEMS[getUserFederalStatus(user)] + user.extraItemSlots;

/**
 * Calculates the maximum number of materials for a user.
 *
 * @param user - The user data.
 * @returns The maximum number of materials.
 */
export const calcMaxMaterials = (user: UserData) =>
  MATERIALS_BASE_SLOTS +
  FED_MATERIALS_SLOTS[getUserFederalStatus(user)] +
  user.extraItemSlots;

/** Home storage slots that do not extend the materials and cooking buckets. */
const HOUSE_SPECIAL_ITEMS_OFFSET = 10;

/**
 * Maximum number of materials, and separately of cooking items, a house can store:
 * home storage capacity minus a fixed offset, minimum 0.
 */
export const calcMaxHouseSpecialItems = (homeStorage: number) =>
  Math.max(0, homeStorage - HOUSE_SPECIAL_ITEMS_OFFSET);

/**
 * Calculates the maximum number of cooking items for a user:
 * base slots + federal bonus + purchased extra slots.
 */
export const calcMaxCookingItems = (user: UserData) =>
  COOKING_BASE_SLOTS +
  FED_COOKING_SLOTS[getUserFederalStatus(user)] +
  user.extraItemSlots;

/** Carried inventory backpack bucket. Dedicated types take priority over event. */
export type InventoryBucket = "normal" | "event" | "materials" | "cooking";

/** Home storage bucket. Event items share ordinary (normal) home capacity. */
export type HomeStorageBucket = "normal" | "materials" | "cooking" | "furniture";

type BucketItemFields = {
  itemType: string;
  isEventItem?: boolean | null;
};

/**
 * Whether a stack uses one backpack slot; equipped and home-stored stacks do not.
 * Availability is separate: unfinished crafts still reserve storage.
 */
export const countsTowardInventoryStorage = (userItem: {
  storedAtHome: boolean;
  equipped: ItemSlot;
}): boolean => !userItem.storedAtHome && userItem.equipped === "NONE";

/**
 * Classify a carried inventory item into its capacity bucket.
 * Priority: COOKING → Cooking, MATERIAL → Materials, event → Event, else Normal.
 */
export const getInventoryBucket = (item: BucketItemFields): InventoryBucket => {
  if (item.itemType === "COOKING" || item.itemType === "MEAL") return "cooking";
  if (item.itemType === "MATERIAL") return "materials";
  if (item.isEventItem) return "event";
  return "normal";
};

/**
 * Classify a home-stored item into its capacity bucket.
 * Event items use ordinary home capacity.
 */
export const getHomeStorageBucket = (
  item: Pick<BucketItemFields, "itemType">,
): HomeStorageBucket => {
  if (item.itemType === "FURNITURE") return "furniture";
  if (item.itemType === "COOKING" || item.itemType === "MEAL") return "cooking";
  if (item.itemType === "MATERIAL") return "materials";
  return "normal";
};

export const getInventoryBucketCapacity = (
  bucket: InventoryBucket,
  user: UserData,
): number => {
  switch (bucket) {
    case "cooking":
      return calcMaxCookingItems(user);
    case "materials":
      return calcMaxMaterials(user);
    case "event":
      return calcMaxEventItems(user);
    case "normal":
      return calcMaxItems(user);
  }
};

export const getInventoryBucketFullMessage = (bucket: InventoryBucket): string => {
  switch (bucket) {
    case "cooking":
      return "Cooking inventory is full";
    case "materials":
      return "Materials inventory is full";
    case "event":
      return "Event item inventory is full";
    case "normal":
      return "Inventory is full";
  }
};

/** Resolve a home's per-bucket capacity from its configured storage and bucket limits. */
export const getHomeStorageBucketCapacity = (
  bucket: HomeStorageBucket,
  homeStorage: number,
): number => {
  switch (bucket) {
    case "furniture":
      return HOME_FURNITURE_STORAGE_CAPACITY;
    case "cooking":
    case "materials":
      return calcMaxHouseSpecialItems(homeStorage);
    case "normal":
      return homeStorage;
  }
};

export const getHomeStorageBucketFullMessage = (bucket: HomeStorageBucket): string => {
  switch (bucket) {
    case "furniture":
      return "Your home furniture storage is full";
    case "cooking":
      return "Your home cooking storage is full";
    case "materials":
      return "Your home materials storage is full";
    case "normal":
      return "Your home storage is full";
  }
};

/**
 * Calculates the maximum number of items for a user.
 *
 * @param user - The user data.
 * @returns The maximum number of items.
 */
export const calcMaxItems = (user: UserData) =>
  INVENTORY_BASE_SLOTS +
  user.extraItemSlots +
  FED_INVENTORY_SLOTS[getUserFederalStatus(user)];

/**
 * Calculates the selling price of a user's item based on various discounts and factors.
 *
 * @param user - The user data containing information about the user.
 * @param useritem - The user's item data, including the item details.
 * @param structures - The list of village structures that may affect the discount.
 * @returns The calculated selling price of the item.
 */
export const calcItemSellingPrice = (
  user: UserData,
  useritem: UserItemWithItem | undefined,
  structures: VillageStructure[] | undefined,
) => {
  if (!useritem) return 0;
  const bDiscount = ITEM_SELL_BASE_DISCOUNT_PERC;
  const sDiscount = getStrucBoost("itemDiscountPerLvl", structures);
  const aDiscount = user.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
  const hDiscount = healItemDiscountPerc(useritem.item);
  const discount = Math.min(
    bDiscount + sDiscount + aDiscount + hDiscount,
    ITEM_SELL_MAX_DISCOUNT_PERC,
  );
  const factor = (100 - discount) / 100;
  const isEventItem = useritem.item.isEventItem;
  const cost = isEventItem ? 0 : useritem.item.cost * useritem.quantity * factor;
  return Math.floor(cost);
};

/**
 * Calculates the repair cost for an item based on its durability and cost.
 * @param useritem - The user's item data, including the item details.
 * @returns The calculated repair cost.
 */
export const calcItemRepairCost = (useritem: UserItemWithItem) => {
  const curDurability = useritem.durability;
  const maxDurability = useritem.item.maxDurability;
  const pointsToRepair = maxDurability - curDurability;
  const factor = pointsToRepair * DURABILITY_POINT_PRICE_PERCENT;
  const rarity = useritem.item.rarity;
  // Rarity is stored data; an unknown value costs nothing.
  if (!Object.hasOwn(ITEM_REPAIR_BASE_COST, rarity)) return 0;
  return Math.ceil(ITEM_REPAIR_BASE_COST[rarity] * factor);
};

/**
 * Inventory equip-availability for the inventory picker filter and the loadout
 * application path. Returns a reason string when a user item cannot be equipped
 * from the normal inventory (stored at home, in an auction, or mid-crafting),
 * otherwise null. The crafting boundary is strict (`> now`) so an item that
 * finishes crafting exactly now is available, matching toggleEquipItem and the
 * imbuement check.
 */
export const getEquipBlockReason = (
  ui: {
    storedAtHome: boolean;
    isInAuction: boolean;
    craftingFinishedAt: Date | null;
  },
  now: Date = new Date(),
): string | null => {
  if (ui.storedAtHome) return "is stored at home";
  if (ui.isInAuction) return "is in auction";
  if (ui.craftingFinishedAt && ui.craftingFinishedAt > now) return "is being crafted";
  return null;
};

/** Largest quantity one inventory row of this item holds. */
export const getEffectiveStackSize = (item: Pick<Item, "canStack" | "stackSize">) =>
  item.canStack ? Math.max(1, item.stackSize) : 1;

/** Row quantities that hold `quantity` items at `stackSize` per row. */
export const splitIntoStacks = (quantity: number, stackSize: number) => {
  const size = Math.max(1, stackSize);
  const stacks: number[] = [];
  for (let remaining = quantity; remaining > 0; remaining -= size) {
    stacks.push(Math.min(remaining, size));
  }
  return stacks;
};

/**
 * Whether a user item can be equipped from the normal inventory. Derived from
 * getEquipBlockReason so the inventory picker and loadout paths stay in sync.
 */
export const isEquippableUserItem = (
  ui: { storedAtHome: boolean; isInAuction: boolean; craftingFinishedAt: Date | null },
  now: Date = new Date(),
): boolean => getEquipBlockReason(ui, now) === null;

/**
 * Whether a stack is in the player's hands: holding units, carried rather than stored at home,
 * not listed or offered, and not being crafted. Quest deliveries and entry costs take only
 * these stacks, as `carriedUserItemWhere` does in SQL.
 */
export const isCarriedUserItem = (
  ui: {
    quantity: number;
    storedAtHome: boolean;
    isInAuction: boolean;
    craftingFinishedAt: Date | null;
  },
  now: Date = new Date(),
): boolean => ui.quantity > 0 && isEquippableUserItem(ui, now);

/**
 * Whether any of a user item's imbuements is still in progress at `now`.
 * Separate from getEquipBlockReason because the inventory picker reasons about
 * imbuements independently of home/auction/crafting availability.
 */
export const isImbuing = (
  ui: { imbuements: { craftingFinishedAt: Date | null }[] },
  now: Date = new Date(),
): boolean => ui.imbuements.some((im) => !isImbuementFinished(im, now));

/** A user item's imbuements that are no longer being crafted at `now`. */
export const finishedImbuements = <T extends { craftingFinishedAt: Date | null }>(
  ui: { imbuements: T[] },
  now: Date = new Date(),
): T[] => ui.imbuements.filter((im) => isImbuementFinished(im, now));

/** An imbuement finishing exactly at `now` counts as finished, as in getEquipBlockReason. */
const isImbuementFinished = (
  im: { craftingFinishedAt: Date | null },
  now: Date = new Date(),
) => !im.craftingFinishedAt || im.craftingFinishedAt <= now;

/**
 * Items of a user item's finished imbuements, in the shape item detail views pass
 * to ItemWithEffects. Imbuements still being crafted at `now` are left out.
 */
export const finishedImbuementItems = <T>(
  ui: { imbuements: { craftingFinishedAt: Date | null; item: T }[] },
  now: Date = new Date(),
): T[] => finishedImbuements(ui, now).map((im) => im.item);

/**
 * ItemWithEffects payload for an owned item: its current durability, level and experience
 * with only finished imbuements. Pass `base` to show a variant of the item instead.
 */
export const userItemDisplay = <T, I>(
  ui: {
    item: T;
    durability: number;
    level: number;
    experience: number;
    imbuements: { craftingFinishedAt: Date | null; item: I }[];
  },
  base: T = ui.item,
  now: Date = new Date(),
) => ({
  ...base,
  imbuements: finishedImbuementItems(ui, now),
  curDurability: ui.durability,
  level: ui.level,
  experience: ui.experience,
});

/**
 * Resolve a user item's active variant into a display-ready item: returns the base
 * item with image/name/description overridden by the active variant when one is
 * selected (and the variant defines that field), falling back to the base item.
 * Mirrors getReskinnedUserJutsu for the jutsu cosmetic system.
 *
 * Inventory and shop UI only. In combat, battle descriptions are pre-resolved into
 * BattleUserItem.variantBattleDescription at initiateBattle time — do not call this
 * during action processing.
 */
export const applyActiveVariant = <
  TItem extends {
    image: string;
    name: string;
    description: string;
    furnitureData?: FurnitureData | null;
    variants?: {
      id: string;
      image: string;
      name?: string | null;
      description?: string | null;
      furnitureData?: FurnitureVariantData | null;
    }[];
  },
>(userItem: {
  activeVariantId?: string | null;
  item: TItem;
}): TItem & { image: string; name: string; description: string } => {
  const variant = userItem.activeVariantId
    ? userItem.item.variants?.find((v) => v.id === userItem.activeVariantId)
    : undefined;
  return {
    ...userItem.item,
    image: variant?.image ?? userItem.item.image,
    name: variant?.name ?? userItem.item.name,
    description: variant?.description ?? userItem.item.description,
    // A skin's missing directions fall back to its own canonical image, never the base skin.
    ...(variant && userItem.item.furnitureData
      ? {
          furnitureData: {
            ...userItem.item.furnitureData,
            width: variant.furnitureData?.width ?? userItem.item.furnitureData.width,
            groundAnchor:
              variant.furnitureData?.groundAnchor ??
              userItem.item.furnitureData.groundAnchor,
            geometry: variant.furnitureData?.geometry,
            views: variant.furnitureData?.views ?? {},
          },
        }
      : {}),
  };
};

/**
 * Locale-aware comparator for displayed item names.
 * Prefers top-level `name` (e.g. after applyActiveVariant flatten) so variant
 * overrides match what ActionSelector renders; falls back to nested `item.name`.
 */
export const byItemName = (
  a: { name?: string; item?: { name: string } },
  b: { name?: string; item?: { name: string } },
) => (a.name ?? a.item?.name ?? "").localeCompare(b.name ?? b.item?.name ?? "");

/** The item fields equip limits read, from a user item row. */
const toEquipConstraintInfo = (ui: {
  itemId: string;
  item: Omit<EquipConstraintInfo, "itemId">;
}): EquipConstraintInfo => ({
  itemId: ui.itemId,
  bloodlineId: ui.item.bloodlineId,
  itemType: ui.item.itemType,
  slot: ui.item.slot,
  maxEquips: ui.item.maxEquips,
});

export interface EquipConstraintInfo {
  itemId: string;
  bloodlineId: string | null;
  itemType: string;
  slot: string;
  maxEquips: number;
}

export interface EquippedAssignment {
  slot: ItemSlot;
  info: EquipConstraintInfo;
}

/** Minimal equipped-item shape for category equip limits (bloodline / hand armor / accessory). */
export interface EquippedConstraintState {
  slot: string;
  itemType: string;
  bloodlineId: string | null;
}

/**
 * Category equip limits shared by loadout application, buyItem auto-equip,
 * autoEquipOptimal planning, and toggleEquipItem: at most one bloodline-gated
 * item, one hand armor, and one accessory. maxEquips is intentionally excluded
 * — callers count that against their own notion of already-equipped instances
 * (assignments built so far vs live equipped rows that may include the
 * candidate when re-slotting). Returns an error message if `candidate` cannot
 * be equipped given `equippedItems`, otherwise null.
 */
export const canEquipAdditional = (
  candidate: Pick<EquipConstraintInfo, "bloodlineId" | "itemType" | "slot">,
  equippedItems: EquippedConstraintState[],
): string | null => {
  if (candidate.itemType === "MEAL") return "Meals cannot be equipped";
  if (candidate.itemType === "FURNITURE") {
    return "Furniture belongs in your home and cannot be equipped";
  }
  if (candidate.bloodlineId) {
    if (equippedItems.some((a) => a.bloodlineId)) {
      return "You can only equip one item with a bloodline requirement";
    }
  }
  if (candidate.itemType === "ARMOR" && candidate.slot === "HAND") {
    const handArmor = equippedItems.some(
      (a) => (a.slot === "HAND_1" || a.slot === "HAND_2") && a.itemType === "ARMOR",
    );
    if (handArmor) {
      return "You can only equip one armor item in your hand slots";
    }
  }
  if (candidate.itemType === "ACCESSORY") {
    if (equippedItems.some((a) => a.itemType === "ACCESSORY")) {
      return "You can only equip one accessory";
    }
  }
  return null;
};

/**
 * Equip-limit rules (per-item max + category limits from canEquipAdditional)
 * for the loadout and auto-equip planning paths. toggleEquipItem / buyItem call
 * canEquipAdditional directly and apply maxEquips against live equipped state
 * themselves. Returns an error message if `candidate` cannot be equipped given
 * `current`, otherwise null.
 */
export const checkEquipConstraints = (
  candidate: EquipConstraintInfo,
  current: EquippedAssignment[],
): string | null => {
  const sameItem = current.filter((a) => a.info.itemId === candidate.itemId).length;
  if (sameItem >= candidate.maxEquips) {
    return `No more than ${candidate.maxEquips} instances. Already have ${sameItem} equipped.`;
  }
  return canEquipAdditional(
    candidate,
    current.map((a) => ({
      slot: a.slot,
      itemType: a.info.itemType,
      bloodlineId: a.info.bloodlineId,
    })),
  );
};

/**
 * Whether an equip slot is compatible with an item's slot type. An item's slot
 * type (e.g. "ITEM", "HAND", "HEAD") is a substring of every concrete slot it
 * fits ("ITEM_1".."ITEM_7", "HAND_1"/"HAND_2", "HEAD"). Excludes the NONE
 * sentinel on both sides so neither a saved NONE entry nor a slot-less item
 * resolves to a real slot. Shared by the saved-slot and fallback resolver paths
 * so a stale/corrupt loadout cannot equip an item into an incompatible slot.
 */
export const isCompatibleEquipSlot = (
  candidate: ItemSlot,
  slotType: string | null | undefined,
): boolean =>
  candidate !== "NONE" &&
  !!slotType &&
  slotType !== "NONE" &&
  candidate.includes(slotType);

/** Concrete slots an item's slot type fits, in equip order. */
export const compatibleEquipSlots = (slotType: string | null | undefined): ItemSlot[] =>
  ItemSlots.filter((slot) => isCompatibleEquipSlot(slot, slotType));

/** Last compatible slot nothing occupies; purchases and manual equips fill from the back. */
export const findFreeEquipSlot = (
  slotType: string | null | undefined,
  useritems: { equipped: ItemSlot }[],
): ItemSlot | undefined =>
  compatibleEquipSlots(slotType)
    .filter((slot) => !useritems.some((ui) => ui.equipped === slot))
    .at(-1);

/**
 * Catalog slot and item type for an item-list filter. Equipped positions are
 * named `catalogSlot_n` (`HAND_1`, `ITEM_2`), the same rule `isCompatibleEquipSlot`
 * uses, so the catalog slot is the text before `_`. A value that is an item type
 * rather than a catalog slot (`ACCESSORY`) filters item type instead, and does
 * not replace an item type the caller already sent.
 */
export const readItemListFilterSlot = (
  slot: string | undefined,
  itemType: ItemType | undefined,
): {
  slot?: ItemSlotType;
  itemType?: ItemType;
} => {
  const slotName = slot?.split("_")[0];
  const catalogSlot = (ItemSlotTypes as readonly string[]).includes(slotName ?? "")
    ? (slotName as ItemSlotType)
    : undefined;
  return {
    slot: catalogSlot,
    itemType:
      itemType ??
      (slotName && !catalogSlot && (ItemTypes as readonly string[]).includes(slotName)
        ? (slotName as ItemType)
        : undefined),
  };
};

export interface LoadoutAssignment {
  userItemId: string;
  slot: ItemSlot;
}

export interface ComputedLoadout {
  assignments: LoadoutAssignment[];
  invalidItems: string[];
}

/**
 * Captures the equipped inventory rows for a loadout. `itemId` remains alongside
 * the unique row id so legacy entries and entries whose row was removed can
 * still fall back to another owned copy of the same item.
 */
export const buildItemLoadoutData = (
  useritems: Array<{ id: string; itemId: string; equipped: ItemSlot }>,
): Array<{ userItemId: string; itemId: string; slot: ItemSlot }> =>
  useritems
    .filter((ui) => ui.equipped !== "NONE")
    .map((ui) => ({ userItemId: ui.id, itemId: ui.itemId, slot: ui.equipped }));

/**
 * Pure decision logic for applying an item loadout. Validates every saved
 * entry against the user's current inventory and equip limits, assigning each
 * to a unique slot and a unique owned row. Mastery gates run last, against the
 * gear this loadout equips rather than the gear worn now. Skipped entries are
 * reported in `invalidItems`. No database access — fully unit-testable.
 */
export const computeLoadoutAssignments = (
  itemData: ItemLoadout["itemData"],
  useritems: UserItemWithRelations[],
  user: Omit<MasteryBuffUser, "items">,
  now: Date = new Date(),
): ComputedLoadout => {
  const assignments: LoadoutAssignment[] = [];
  const invalidItems: string[] = [];
  const usedSlots = new Set<ItemSlot>();
  const consumedRowIds = new Set<string>();
  const current: EquippedAssignment[] = [];
  const isFree = (it: UserItemWithRelations) => !consumedRowIds.has(it.id);

  for (const entry of itemData) {
    // Prefer the exact saved inventory row, then fall back to other copies of
    // the same catalog item if it was removed or is currently unavailable.
    // Entries saved before userItemId was introduced use only the catalog-id path.
    const savedUserItem = entry.userItemId
      ? useritems.find((it) => it.id === entry.userItemId && isFree(it))
      : undefined;
    const owned = [
      ...(savedUserItem ? [savedUserItem] : []),
      ...useritems.filter(
        (it) => it.itemId === entry.itemId && isFree(it) && it.id !== savedUserItem?.id,
      ),
    ];
    const useritem =
      owned.find(
        (it) => getEquipBlockReason(it, now) === null && !isImbuing(it, now),
      ) ?? owned[0];
    if (!useritem) {
      invalidItems.push(`Item not found`);
      continue;
    }
    const item = useritem.item;
    // Inventory availability (home / auction / crafting) via the shared rule.
    const blockReason = getEquipBlockReason(useritem, now);
    if (blockReason) {
      invalidItems.push(`${item.name} ${blockReason}`);
      continue;
    }
    if (item.hidden) {
      invalidItems.push(`${item.name} is hidden`);
      continue;
    }
    if (item.requiredLevel > user.level) {
      invalidItems.push(`${item.name} requires level ${item.requiredLevel}`);
      continue;
    }
    if (!hasRequiredSkill(item, user)) {
      invalidItems.push(`${item.name} requires an activated skill to equip`);
      continue;
    }
    if (item.bloodlineId && item.bloodlineId !== user.bloodlineId) {
      invalidItems.push(`${item.name} requires a specific bloodline to equip`);
      continue;
    }
    if (isImbuing(useritem, now)) {
      invalidItems.push(`${item.name} is being imbued`);
      continue;
    }
    // Resolve the slot (handles legacy values like ITEM_7). Prefer the saved
    // slot when it is a real, compatible ItemSlots member and still free;
    // otherwise — or when an earlier same-type assignment already took it — fall
    // back to any free compatible slot for the item's type. Never the NONE
    // sentinel and never for an item with no real slot type.
    const validSlots = ItemSlots as readonly string[];
    const slotType = item.slot;
    const findFreeSlot = () =>
      ItemSlots.find((s) => isCompatibleEquipSlot(s, slotType) && !usedSlots.has(s));
    // isCompatibleEquipSlot excludes the NONE sentinel (a saved NONE would
    // otherwise consume a row/slot while equipping nothing) and rejects a
    // stale/corrupt entry that points at an incompatible slot (e.g. a HEAD item
    // saved into CHEST). When the saved slot is usable but already taken (two
    // same-type items carrying the same stale slot), fall back rather than drop
    // the second item while another compatible slot is still free.
    const savedSlotUsable =
      validSlots.includes(entry.slot) && isCompatibleEquipSlot(entry.slot, item.slot);
    const resolvedSlot =
      savedSlotUsable && !usedSlots.has(entry.slot) ? entry.slot : findFreeSlot();
    if (!resolvedSlot) {
      // A real slot type with every compatible slot already taken is an
      // exhausted-slot case; no real slot type at all is a corrupt/invalid entry.
      invalidItems.push(
        slotType && slotType !== "NONE"
          ? `${item.name} slot already in use`
          : `${item.name} has invalid slot`,
      );
      continue;
    }
    // Equip limits via checkEquipConstraints (maxEquips + canEquipAdditional).
    const info = toEquipConstraintInfo(useritem);
    const constraintError = checkEquipConstraints(info, current);
    if (constraintError) {
      invalidItems.push(`${item.name}: ${constraintError}`);
      continue;
    }
    assignments.push({ userItemId: useritem.id, slot: resolvedSlot });
    usedSlots.add(resolvedSlot);
    consumedRowIds.add(useritem.id);
    current.push({ slot: resolvedSlot, info });
  }

  const wearer = {
    ...user,
    items: assignments.flatMap((a) => {
      const useritem = useritems.find((it) => it.id === a.userItemId);
      return useritem ? [{ ...useritem, equipped: a.slot }] : [];
    }),
  };
  const gatedIds = new Set<string>();
  for (const gear of wearer.items) {
    const missing = gearMissingMastery(gear, wearer);
    if (!missing) continue;
    gatedIds.add(gear.id);
    invalidItems.push(
      `${gear.item.name} requires ${missing.required.toLocaleString()} ${missing.label}`,
    );
  }

  return {
    assignments: assignments.filter((a) => !gatedIds.has(a.userItemId)),
    invalidItems,
  };
};

/** Inventory row shape read by auto-equip planning. */
export interface AutoEquipUserItem {
  id: string;
  itemId: string;
  equipped: ItemSlot;
  storedAtHome: boolean;
  isInAuction: boolean;
  craftingFinishedAt: Date | null;
  imbuements: { craftingFinishedAt: Date | null }[];
  item: MasteryRequirementFields & {
    requiredSkillId?: string | null;
    cost: number;
    slot: string;
    itemType: string;
    bloodlineId: string | null;
    requiredLevel: number;
    maxEquips: number;
  };
}

export interface ComputedAutoEquip {
  assignments: LoadoutAssignment[];
  hasUnequipped: boolean;
  hasAvailableSlots: boolean;
}

/**
 * Pure decision logic for auto-equipping unequipped inventory into empty slots,
 * highest catalog cost first. Slot exclusivity and equip limits are applied
 * against a single in-memory snapshot so two items never share a slot and
 * category / maxEquips checks see prior assignments in this batch. Does not
 * unequip occupied slots. No database access — fully unit-testable.
 * @param user - with effectiveMasteries over the gear worn now, so gear equipped in
 *   this batch does not unlock other candidates
 */
export const computeAutoEquipAssignments = (
  useritems: AutoEquipUserItem[],
  user: { level: number; bloodlineId: string | null } & MasteryStatSource &
    Pick<MasteryBuffUser, "userSkills">,
  now: Date = new Date(),
): ComputedAutoEquip => {
  const candidates = useritems.filter(
    (ui) => ui.equipped === "NONE" && isEquippableUserItem(ui, now),
  );
  const initialAvailableSlots = ItemSlots.filter(
    (slot) => slot !== "NONE" && !useritems.some((ui) => ui.equipped === slot),
  );
  let availableSlots = initialAvailableSlots;
  const current: EquippedAssignment[] = useritems
    .filter((ui) => ui.equipped !== "NONE")
    .map((ui) => ({
      slot: ui.equipped,
      info: toEquipConstraintInfo(ui),
    }));

  const assignments: LoadoutAssignment[] = [];
  const ranked = [...candidates].sort((a, b) => b.item.cost - a.item.cost);

  for (const useritem of ranked) {
    const slot = availableSlots.find((candidate) =>
      isCompatibleEquipSlot(candidate, useritem.item.slot),
    );
    if (!slot) continue;
    if (useritem.item.requiredLevel > user.level) continue;
    if (!hasRequiredSkill(useritem.item, user)) continue;
    if (useritem.item.bloodlineId && useritem.item.bloodlineId !== user.bloodlineId) {
      continue;
    }
    if (missingMasteryRequirement(user, useritem.item)) continue;
    if (isImbuing(useritem, now)) continue;

    const info = toEquipConstraintInfo(useritem);
    const constraintError = checkEquipConstraints(info, current);
    if (constraintError) continue;

    assignments.push({ userItemId: useritem.id, slot });
    availableSlots = availableSlots.filter((s) => s !== slot);
    current.push({ slot, info });
  }

  return {
    assignments,
    hasUnequipped: candidates.length > 0,
    hasAvailableSlots: initialAvailableSlots.length > 0,
  };
};

/** Gear that can meaningfully level — hide badges on inventory goods and thrown items. */
export const showsItemLevelBadge = (item: {
  itemType: string;
  slot: string;
}): boolean =>
  item.itemType !== "CONSUMABLE" &&
  item.itemType !== "MATERIAL" &&
  item.itemType !== "COOKING" &&
  item.itemType !== "MEAL" &&
  item.itemType !== "CRYSTAL" &&
  item.itemType !== "FURNITURE" &&
  item.slot !== "THROWN";

/** Consumables consolidate across ownership levels; gear keeps its progression. */
export const getItemStackMergeBucketKey = (
  item: Pick<Item, "itemType">,
  row: Pick<
    UserItemWithRelations,
    "storedAtHome" | "equipped" | "activeVariantId" | "level"
  >,
) =>
  `${row.storedAtHome ? "home" : "carry"}:${row.equipped}:${row.activeVariantId ?? "none"}:${item.itemType === "CONSUMABLE" ? "consumable" : row.level}`;

/**
 * Item types that `mergeAllStacks` would consolidate in carried inventory or home storage:
 * the same rows and buckets it merges, where the stacks are not already packed full.
 */
export const countMergeableStackTypes = (
  rows: readonly (Pick<
    UserItemWithRelations,
    | "itemId"
    | "quantity"
    | "storedAtHome"
    | "isInAuction"
    | "craftingFinishedAt"
    | "equipped"
    | "activeVariantId"
    | "level"
  > & {
    item?: Pick<Item, "itemType" | "stackSize"> | null;
    imbuements: readonly unknown[];
  })[],
  storedAtHome: boolean,
  now: Date,
) => {
  const buckets = new Map<
    string,
    { itemId: string; stackSize: number; rows: number[] }
  >();
  for (const row of rows) {
    const { item } = row;
    if (
      !item ||
      !(item.stackSize > 1) ||
      row.quantity <= 0 ||
      row.storedAtHome !== storedAtHome ||
      row.isInAuction ||
      row.imbuements.length > 0 ||
      (row.craftingFinishedAt && row.craftingFinishedAt >= now)
    ) {
      continue;
    }
    const key = `${row.itemId}:${getItemStackMergeBucketKey(item, row)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row.quantity);
    else
      buckets.set(key, {
        itemId: row.itemId,
        stackSize: item.stackSize,
        rows: [row.quantity],
      });
  }
  const mergeable = new Set<string>();
  for (const { itemId, stackSize, rows: quantities } of buckets.values()) {
    const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
    const packed = splitIntoStacks(total, stackSize);
    const sorted = [...quantities].sort((a, b) => b - a);
    // A merge cannot open rows, so a bucket needing more than it has stays as it is.
    if (packed.length > sorted.length) continue;
    if (sorted.length !== packed.length || sorted.some((q, i) => q !== packed[i])) {
      mergeable.add(itemId);
    }
  }
  return mergeable.size;
};

/**
 * ActionSelector badge lists for user items: amber stack quantity (bottom-right)
 * for every stack, red ownership level (bottom-left) for leveling gear.
 */
export const userItemActionBadges = <
  T extends {
    id: string;
    quantity: number;
    level: number;
    item: { itemType: string; slot: string };
  },
>(
  userItems: T[] | undefined,
): {
  counts: { id: string; quantity: number }[] | undefined;
  levels: { id: string; level: number }[] | undefined;
} => ({
  counts: userItems
    ?.filter((ui) => ui.quantity > 1)
    .map((ui) => ({ id: ui.id, quantity: ui.quantity })),
  levels: userItems
    ?.filter((ui) => showsItemLevelBadge(ui.item))
    .map((ui) => ({ id: ui.id, level: ui.level })),
});

/** Crystal fields needed to decide if an imbuement can move onto another item. */
export type ImbuementTransferCrystal = {
  name: string;
  crystalTargetTypes?: string | null;
};

export type ImbuementForTransfer = {
  id: string;
  item?: ImbuementTransferCrystal | null;
};

export type ImbuementTransferTarget = {
  canBeImbued: boolean;
  maxImbueNumber: number;
  itemType: string;
};

/**
 * Split imbuements into those that can stay on a target item vs those that must be removed
 * (target cannot be imbued, crystal type mismatch, or over maxImbueNumber).
 */
export const partitionImbuementsForItemTransfer = <T extends ImbuementForTransfer>(
  imbuements: T[],
  target: ImbuementTransferTarget,
): { keep: T[]; remove: T[] } => {
  if (!target.canBeImbued || target.maxImbueNumber <= 0) {
    return { keep: [], remove: [...imbuements] };
  }
  const keep: T[] = [];
  const remove: T[] = [];
  for (const imb of imbuements) {
    const restrictedType = imb.item?.crystalTargetTypes;
    const isCompatible =
      !!imb.item && (!restrictedType || restrictedType === target.itemType);
    if (isCompatible && keep.length < target.maxImbueNumber) {
      keep.push(imb);
    } else {
      remove.push(imb);
    }
  }
  return { keep, remove };
};
