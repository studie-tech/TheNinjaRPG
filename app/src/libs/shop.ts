import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  ItemRarities,
  ItemTypes,
  MAX_ITEM_SHOP_PURCHASE_QUANTITY,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
  MIN_ITEM_SHOP_DISCOUNT_FACTOR,
} from "@/drizzle/constants";
import type { Item, ItemType, UserData, VillageStructure } from "@/drizzle/schema";
import { byItemName } from "@/libs/item";
import { ITEM_TYPE_LABELS } from "@/libs/itemsPage";
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

export type ShopCurrency = "ryo" | "rep" | "silver";
export type ShopPrice = { currency: ShopCurrency; amount: number };
export type ShopSort = "rarity" | "price" | "name" | "type";

export const SHOP_SORTS: { value: ShopSort; label: string }[] = [
  { value: "rarity", label: "Rarity" },
  { value: "price", label: "Price" },
  { value: "name", label: "Name" },
  { value: "type", label: "Type" },
];

/** Unit prices of a shop item: ryo after the player's discounts, reputation and silver as listed. */
export const shopItemPrices = (
  item: Pick<Item, "cost" | "repsCost" | "seichiSilverCost">,
  ryoFactor: number,
): ShopPrice[] => [
  ...(item.cost > 0
    ? [{ currency: "ryo" as const, amount: Math.ceil(item.cost * ryoFactor) }]
    : []),
  ...(item.repsCost > 0
    ? [{ currency: "rep" as const, amount: Math.ceil(item.repsCost) }]
    : []),
  ...(item.seichiSilverCost > 0
    ? [{ currency: "silver" as const, amount: Math.ceil(item.seichiSilverCost) }]
    : []),
];

/** How much of each currency the player is short of to buy `quantity` at these prices. */
export const missingForPrices = (
  prices: ShopPrice[],
  wallet: Record<ShopCurrency, number>,
  quantity = 1,
): ShopPrice[] =>
  prices.flatMap(({ currency, amount }) => {
    const missing = amount * quantity - wallet[currency];
    return missing > 0 ? [{ currency, amount: missing }] : [];
  });

/** Rarest first, then the cheapest: the order gear is chosen in, as in the backpack. */
const shopComparators: Record<
  ShopSort,
  <T extends ShopSortable>(a: T, b: T, priceOf: (item: T) => number) => number
> = {
  rarity: (a, b, priceOf) =>
    ItemRarities.indexOf(b.rarity) - ItemRarities.indexOf(a.rarity) ||
    priceOf(a) - priceOf(b) ||
    byItemName(a, b),
  price: (a, b, priceOf) => priceOf(a) - priceOf(b) || byItemName(a, b),
  name: (a, b) => byItemName(a, b),
  type: (a, b) =>
    ItemTypes.indexOf(a.itemType) - ItemTypes.indexOf(b.itemType) || byItemName(a, b),
};

/** A sorted copy of the catalog; the input keeps its order. */
export const sortShopItems = <T extends ShopSortable>(
  items: T[],
  sort: ShopSort,
  priceOf: (item: T) => number,
): T[] => [...items].sort((a, b) => shopComparators[sort](a, b, priceOf));

/** "All" plus one chip per item type in stock, in the game's type order, with counts. */
export const shopTypeChips = (
  items: Pick<Item, "itemType">[],
): { value: ItemType | "ALL"; label: string; count: number }[] => [
  { value: "ALL", label: "All", count: items.length },
  ...ItemTypes.flatMap((type) => {
    const count = items.filter((item) => item.itemType === type).length;
    return count > 0 ? [{ value: type, label: ITEM_TYPE_LABELS[type], count }] : [];
  }),
];

type ShopSortable = Pick<Item, "name" | "rarity" | "itemType">;
