import { describe, expect, it } from "vitest";
import { getMaxItemShopPurchaseQuantity } from "@/libs/shop";

describe("getMaxItemShopPurchaseQuantity", () => {
  it("uses the item's smaller stack size", () => {
    expect(getMaxItemShopPurchaseQuantity(20)).toBe(20);
  });

  it("caps large item stacks at the server purchase limit", () => {
    expect(getMaxItemShopPurchaseQuantity(9_999)).toBe(50);
  });
});
