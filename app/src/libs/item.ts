import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  DURABILITY_POINT_PRICE_PERCENT,
  FED_EVENT_ITEMS_DEFAULT,
  FED_EVENT_ITEMS_GOLD,
  FED_EVENT_ITEMS_NORMAL,
  FED_EVENT_ITEMS_SILVER,
  FED_GOLD_INVENTORY_SLOTS,
  FED_MATERIALS_GOLD_SLOTS,
  FED_MATERIALS_NORMAL_SLOTS,
  FED_MATERIALS_SILVER_SLOTS,
  FED_NORMAL_INVENTORY_SLOTS,
  FED_SILVER_INVENTORY_SLOTS,
  type ItemSlot,
  ItemSlots,
  MATERIALS_BASE_SLOTS,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
} from "@/drizzle/constants";
import type {
  Item,
  UserData,
  UserItemWithItem,
  UserItemWithRelations,
  VillageStructure,
} from "@/drizzle/schema";
import { getUserFederalStatus } from "@/utils/paypal";
import { getStrucBoost } from "@/utils/village";

/**
 * Checks if an item is consumable outside of combat.
 * @param item - The item to check.
 * @param userData - The user data.
 * @returns True if the item is consumable outside of combat, false otherwise.
 */
export const nonCombatConsume = (item: Item, userData: UserData): boolean => {
  if (item.itemType !== "CONSUMABLE") {
    return false;
  }

  for (const effect of item.effects) {
    if (effect.type === "rollbloodline") {
      return true;
    } else if (effect.type === "rollsagemode" && !userData.sageModeId) {
      return true;
    } else if (effect.type === "removebloodline" && userData.bloodlineId) {
      return true;
    } else if (effect.type === "heal") {
      return true;
    } else if (effect.type === "marriageslotincrease") {
      return true;
    } else if (effect.type === "noncombatincreasereskins") {
      return true;
    } else if (effect.type === "noncombatconsumereward") {
      return true;
    } else if (effect.type === "noncombatgainskill") {
      return true;
    } else if (effect.type === "repair") {
      return true;
    }
  }

  return false;
};

/**
 * Calculates the maximum number of event items for a user.
 *
 * @param user - The user data.
 * @returns The maximum number of event items.
 */
export const calcMaxEventItems = (user: UserData) => {
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return FED_EVENT_ITEMS_NORMAL + user.extraItemSlots;
    case "SILVER":
      return FED_EVENT_ITEMS_SILVER + user.extraItemSlots;
    case "GOLD":
      return FED_EVENT_ITEMS_GOLD + user.extraItemSlots;
    default:
      return FED_EVENT_ITEMS_DEFAULT + user.extraItemSlots;
  }
};

/**
 * Calculates the maximum number of materials for a user.
 *
 * @param user - The user data.
 * @returns The maximum number of materials.
 */
export const calcMaxMaterials = (user: UserData) => {
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return MATERIALS_BASE_SLOTS + FED_MATERIALS_NORMAL_SLOTS + user.extraItemSlots;
    case "SILVER":
      return MATERIALS_BASE_SLOTS + FED_MATERIALS_SILVER_SLOTS + user.extraItemSlots;
    case "GOLD":
      return MATERIALS_BASE_SLOTS + FED_MATERIALS_GOLD_SLOTS + user.extraItemSlots;
    default:
      return MATERIALS_BASE_SLOTS + user.extraItemSlots;
  }
};

/**
 * Calculates the maximum number of materials that can be stored in a house.
 * Based on home storage capacity - 10, minimum 0.
 *
 * @param user - The user data.
 * @param homeStorage - The storage capacity of the home.
 * @returns The maximum number of materials that can be stored in house.
 */
export const calcMaxHouseMaterials = (_user: UserData, homeStorage: number) => {
  return Math.max(0, homeStorage - 10);
};

/**
 * Calculates the maximum number of items for a user.
 *
 * @param user - The user data.
 * @returns The maximum number of items.
 */
export const calcMaxItems = (user: UserData) => {
  const base = 20;
  const fedContrib = (user: UserData) => {
    const status = getUserFederalStatus(user);
    switch (status) {
      case "NORMAL":
        return FED_NORMAL_INVENTORY_SLOTS;
      case "SILVER":
        return FED_SILVER_INVENTORY_SLOTS;
      case "GOLD":
        return FED_GOLD_INVENTORY_SLOTS;
    }
    return 0;
  };
  return base + user.extraItemSlots + fedContrib(user);
};

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
  const bDiscount = 80;
  const sDiscount = getStrucBoost("itemDiscountPerLvl", structures);
  const aDiscount = user.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
  const hDiscount = useritem.item.effects.find((e) => e.type === "heal")
    ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC
    : 0;
  const discount = Math.min(bDiscount + sDiscount + aDiscount + hDiscount, 95);
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
  switch (useritem.item.rarity) {
    case "COMMON":
      return Math.ceil(50 * factor);
    case "RARE":
      return Math.ceil(200 * factor);
    case "EPIC":
      return Math.ceil(400 * factor);
    case "LEGENDARY":
      return Math.ceil(800 * factor);
    default:
      return 0;
  }
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
  ui: { storedAtHome: boolean; isInAuction: boolean; craftingFinishedAt: Date | null },
  now: Date = new Date(),
): string | null => {
  if (ui.storedAtHome) return "is stored at home";
  if (ui.isInAuction) return "is in auction";
  if (ui.craftingFinishedAt && ui.craftingFinishedAt > now) return "is being crafted";
  return null;
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
 * Whether any of a user item's imbuements is still in progress at `now`.
 * Separate from getEquipBlockReason because the inventory picker reasons about
 * imbuements independently of home/auction/crafting availability.
 */
export const isImbuing = (
  ui: { imbuements: { craftingFinishedAt: Date | null }[] },
  now: Date = new Date(),
): boolean =>
  ui.imbuements.some((im) => im.craftingFinishedAt && im.craftingFinishedAt > now);

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
 * Category equip limits shared by loadout application, buyItem auto-equip, and
 * toggleEquipItem: at most one bloodline-gated item, one hand armor, and one
 * accessory. maxEquips is intentionally excluded — callers count that against
 * their own notion of already-equipped instances (assignments built so far vs
 * live equipped rows that may include the candidate when re-slotting). Returns
 * an error message if `candidate` cannot be equipped given `equippedItems`,
 * otherwise null.
 */
export const canEquipAdditional = (
  candidate: Pick<EquipConstraintInfo, "bloodlineId" | "itemType" | "slot">,
  equippedItems: EquippedConstraintState[],
): string | null => {
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
 * for the loadout application path. toggleEquipItem / buyItem call
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

export interface LoadoutAssignment {
  userItemId: string;
  slot: ItemSlot;
}

export interface ComputedLoadout {
  assignments: LoadoutAssignment[];
  invalidItems: string[];
}

/**
 * Pure decision logic for applying an item loadout. Validates every saved
 * entry against the user's current inventory and equip limits, assigning each
 * to a unique slot and a unique owned row. Skipped entries are reported in
 * `invalidItems`. No database access — fully unit-testable.
 */
export const computeLoadoutAssignments = (
  itemData: Array<{ itemId: string; slot: ItemSlot }>,
  useritems: UserItemWithRelations[],
  user: { level: number; bloodlineId: string | null },
  now: Date = new Date(),
): ComputedLoadout => {
  const assignments: LoadoutAssignment[] = [];
  const invalidItems: string[] = [];
  const usedSlots = new Set<ItemSlot>();
  const consumedRowIds = new Set<string>();
  const current: EquippedAssignment[] = [];

  for (const entry of itemData) {
    // Prefer an unconsumed unit that is actually equippable (carried, not
    // auction/crafting/imbuing); fall back to any unconsumed unit so a
    // duplicated itemId still reports a precise reason instead of being
    // dropped silently.
    const owned = useritems.filter(
      (it) => it.itemId === entry.itemId && !consumedRowIds.has(it.id),
    );
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
    const findFreeSlot = (): ItemSlot | undefined =>
      slotType && slotType !== "NONE"
        ? ItemSlots.find((s) => isCompatibleEquipSlot(s, slotType) && !usedSlots.has(s))
        : undefined;
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
    const info: EquipConstraintInfo = {
      itemId: useritem.itemId,
      bloodlineId: item.bloodlineId,
      itemType: item.itemType,
      slot: item.slot,
      maxEquips: item.maxEquips,
    };
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

  return { assignments, invalidItems };
};
