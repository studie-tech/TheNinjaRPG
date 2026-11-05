import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  MAX_ITEM_SHOP_PURCHASE_QUANTITY,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
  MIN_ITEM_SHOP_DISCOUNT_FACTOR,
} from "@/drizzle/constants";
import type { Item, UserData, VillageStructure } from "@/drizzle/schema";
import {
  getVillageLoyaltyBonuses,
  type VillageLoyaltyUser,
} from "@/libs/villageLoyalty";
import { getStrucBoost } from "@/utils/village";

export const getMaxItemShopPurchaseQuantity = (stackSize: number) =>
  Math.min(stackSize, MAX_ITEM_SHOP_PURCHASE_QUANTITY);

export const isItemAvailableInStore = (
  expireFromStoreAt: string | Date | null | undefined,
  now: Date = new Date(),
) => !expireFromStoreAt || new Date(expireFromStoreAt) > now;

/** Medic-nin discount in percent; healing items only. */
export const healItemDiscountPerc = (item: Pick<Item, "effects">) =>
  item.effects.some((e) => e.type === "heal") ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC : 0;

/**
 * Discounts in percent for buying `item`, shared by catalog previews and authoritative
 * purchases. Discounts that do not apply are left out.
 */
export const getShopDiscounts = (
  user: VillageLoyaltyUser & Pick<UserData, "anbuId">,
  structures: VillageStructure[] | undefined,
  item: Pick<Item, "effects"> | null | undefined,
) =>
  [
    {
      label: "village structures",
      value: getStrucBoost("itemDiscountPerLvl", structures),
    },
    {
      label: "ANBU membership",
      value: user.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0,
    },
    { label: "medic-nin item", value: item ? healItemDiscountPerc(item) : 0 },
    { label: "village loyalty", value: getVillageLoyaltyBonuses(user).shopDiscount },
  ].filter((discount) => discount.value > 0);

/** Ryo price factor: discounts add before the price floor is applied. */
export const shopItemDiscountFactor = (discounts: { value: number }[]) =>
  Math.max(
    MIN_ITEM_SHOP_DISCOUNT_FACTOR,
    discounts.reduce((remaining, discount) => remaining - discount.value, 100) / 100,
  );

/** Whole-stack price per currency; only ryo is discounted. */
export const getShopStackPrice = (
  item: Pick<Item, "cost" | "repsCost" | "seichiSilverCost"> | null | undefined,
  stack: number,
  ryoFactor: number,
) => ({
  ryoCost: Math.ceil((item?.cost ?? 0) * stack * ryoFactor),
  repsCost: Math.ceil((item?.repsCost ?? 0) * stack),
  seichiSilverCost: Math.ceil((item?.seichiSilverCost ?? 0) * stack),
});
