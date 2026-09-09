import { MAX_ITEM_SHOP_PURCHASE_QUANTITY } from "@/drizzle/constants";

export const getMaxItemShopPurchaseQuantity = (stackSize: number) =>
  Math.min(stackSize, MAX_ITEM_SHOP_PURCHASE_QUANTITY);

export const isItemAvailableInStore = (
  expireFromStoreAt: string | Date | null | undefined,
  now: Date = new Date(),
) => !expireFromStoreAt || new Date(expireFromStoreAt) > now;
