import { describe, expect, it } from "vitest";
import { MAX_ITEM_SHOP_PURCHASE_QUANTITY } from "@/drizzle/constants";
import { getMaxItemShopPurchaseQuantity, isItemAvailableInStore } from "@/libs/shop";

describe("getMaxItemShopPurchaseQuantity", () => {
  it("uses the item's smaller stack size", () => {
    expect(getMaxItemShopPurchaseQuantity(20)).toBe(20);
  });

  it("caps large item stacks at the server purchase limit", () => {
    expect(getMaxItemShopPurchaseQuantity(9_999)).toBe(MAX_ITEM_SHOP_PURCHASE_QUANTITY);
  });
});

describe("isItemAvailableInStore", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");

  it("keeps listings with no expiry", () => {
    expect(isItemAvailableInStore(null, now)).toBe(true);
    expect(isItemAvailableInStore(undefined, now)).toBe(true);
  });

  it("keeps listings that expire after now", () => {
    expect(isItemAvailableInStore("2026-09-10", now)).toBe(true);
  });

  it("hides listings that have already expired", () => {
    expect(isItemAvailableInStore("2026-09-08", now)).toBe(false);
  });
});
