import { getUserFederalStatus } from "@/utils/paypal";
import { FED_NORMAL_INVENTORY_SLOTS } from "@/drizzle/constants";
import { FED_SILVER_INVENTORY_SLOTS } from "@/drizzle/constants";
import { FED_GOLD_INVENTORY_SLOTS } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_NORMAL } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_SILVER } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_GOLD } from "@/drizzle/constants";
import { FED_EVENT_ITEMS_DEFAULT } from "@/drizzle/constants";
import { getStrucBoost } from "@/utils/village";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
} from "@/drizzle/constants";
import type {
  Item,
  UserItemWithItem,
  UserData,
  VillageStructure,
} from "@/drizzle/schema";

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
    } else if (effect.type === "removebloodline" && userData.bloodlineId) {
      return true;
    } else if (effect.type === "heal") {
      return true;
    } else if (effect.type === "marriageslotincrease") {
      return true;
    } else if (effect.type === "noncombatconsumereward") {
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
