import { describe, expect, it } from "bun:test";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  MAX_ITEM_SHOP_PURCHASE_QUANTITY,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
  MIN_ITEM_SHOP_DISCOUNT_FACTOR,
} from "@/drizzle/constants";
import {
  canAffordShopPrice,
  getMaxItemShopPurchaseQuantity,
  getShopDiscounts,
  getShopStackPrice,
  healItemDiscountPerc,
  isItemAvailableInStore,
  missingForPrices,
  shopItemDiscountFactor,
  shopItemPrices,
  shopTypeChips,
  sortShopItems,
} from "@/libs/shop";

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

const heal = { effects: [{ type: "heal" }] } as Parameters<
  typeof healItemDiscountPerc
>[0];
const plain = { effects: [] };
const user = {
  anbuId: null,
  isOutlaw: false,
  joinedVillageAt: new Date(),
  villageId: null,
};

describe("getShopDiscounts", () => {
  it("leaves out discounts that do not apply", () => {
    expect(getShopDiscounts(user, undefined, plain)).toEqual([]);
    expect(getShopDiscounts(user, undefined, null)).toEqual([]);
  });

  it("labels the ANBU and medic-nin discounts", () => {
    expect(getShopDiscounts({ ...user, anbuId: "anbu" }, undefined, heal)).toEqual([
      { label: "ANBU membership", value: ANBU_ITEMSHOP_DISCOUNT_PERC },
      { label: "medic-nin item", value: MEDNIN_HEAL_ITEM_DISCOUNT_PERC },
    ]);
  });
});

describe("shopItemDiscountFactor", () => {
  it("adds discounts up", () => {
    expect(shopItemDiscountFactor([{ value: 10 }, { value: 15 }])).toBe(0.75);
    expect(shopItemDiscountFactor([])).toBe(1);
  });

  it("stops at the price floor", () => {
    expect(shopItemDiscountFactor([{ value: 100 }])).toBe(MIN_ITEM_SHOP_DISCOUNT_FACTOR);
  });
});

describe("canAffordShopPrice", () => {
  const price = { ryoCost: 10, repsCost: 2, seichiSilverCost: 1 };
  const balance = { money: 10, reputationPoints: 2, seichiSilver: 1 };

  it("accepts a balance that exactly covers every currency", () => {
    expect(canAffordShopPrice(balance, price)).toBe(true);
  });

  it.each(["money", "reputationPoints", "seichiSilver"] as const)("needs enough %s", (key) => {
    expect(canAffordShopPrice({ ...balance, [key]: balance[key] - 1 }, price)).toBe(false);
  });
});

describe("getShopStackPrice", () => {
  it("discounts ryo only and rounds each currency up", () => {
    expect(
      getShopStackPrice({ cost: 101, repsCost: 3, seichiSilverCost: 5 }, 2, 0.5),
    ).toEqual({ ryoCost: 101, repsCost: 6, seichiSilverCost: 10 });
  });

  it("prices a missing item at zero", () => {
    expect(getShopStackPrice(undefined, 3, 1)).toEqual({
      ryoCost: 0,
      repsCost: 0,
      seichiSilverCost: 0,
    });
  });
});

describe("shopItemPrices", () => {
  it("lists each currency the item costs, with ryo after discounts", () => {
    expect(shopItemPrices({ cost: 100, repsCost: 5, seichiSilverCost: 0 }, 0.9)).toEqual([
      { currency: "ryo", amount: 90 },
      { currency: "rep", amount: 5 },
    ]);
    expect(shopItemPrices({ cost: 0, repsCost: 0, seichiSilverCost: 3 }, 0.9)).toEqual([
      { currency: "silver", amount: 3 },
    ]);
  });

  it("rounds discounted ryo up, as the purchase does", () => {
    expect(shopItemPrices({ cost: 45, repsCost: 0, seichiSilverCost: 0 }, 0.9)).toEqual([
      { currency: "ryo", amount: 41 },
    ]);
  });
});

describe("missingForPrices", () => {
  const wallet = { ryo: 1_000, rep: 11, silver: 0 };
  it("is empty when the player can pay", () => {
    expect(missingForPrices([{ currency: "rep", amount: 5 }], wallet)).toEqual([]);
  });

  it("says how much of each currency is missing for the quantity", () => {
    expect(
      missingForPrices(
        [
          { currency: "ryo", amount: 600 },
          { currency: "rep", amount: 5 },
        ],
        wallet,
        3,
      ),
    ).toEqual([
      { currency: "ryo", amount: 800 },
      { currency: "rep", amount: 4 },
    ]);
  });
});

describe("sortShopItems", () => {
  const items = [
    { name: "Bow", rarity: "RARE", itemType: "WEAPON", price: 300 },
    { name: "Axe", rarity: "LEGENDARY", itemType: "WEAPON", price: 900 },
    { name: "Pill", rarity: "COMMON", itemType: "CONSUMABLE", price: 10 },
    { name: "Coat", rarity: "RARE", itemType: "ARMOR", price: 200 },
  ] as const;
  const priceOf = (item: (typeof items)[number]) => item.price;
  const names = (sorted: readonly { name: string }[]) => sorted.map((item) => item.name);

  it("puts the rarest first, then the cheapest", () => {
    expect(names(sortShopItems([...items], "rarity", priceOf))).toEqual(["Axe", "Coat", "Bow", "Pill"]);
  });

  it("sorts by price, name or type", () => {
    expect(names(sortShopItems([...items], "price", priceOf))).toEqual(["Pill", "Coat", "Bow", "Axe"]);
    expect(names(sortShopItems([...items], "name", priceOf))).toEqual(["Axe", "Bow", "Coat", "Pill"]);
    expect(names(sortShopItems([...items], "type", priceOf))).toEqual(["Axe", "Bow", "Pill", "Coat"]);
  });

  it("leaves the input order alone", () => {
    const input = [...items];
    sortShopItems(input, "name", priceOf);
    expect(names(input)).toEqual(["Bow", "Axe", "Pill", "Coat"]);
  });
});

describe("shopTypeChips", () => {
  it("counts everything, then each type in stock in the game's type order", () => {
    expect(
      shopTypeChips([
        { itemType: "ARMOR" },
        { itemType: "WEAPON" },
        { itemType: "WEAPON" },
      ]),
    ).toEqual([
      { value: "ALL", label: "All", count: 3 },
      { value: "WEAPON", label: "Weapons", count: 2 },
      { value: "ARMOR", label: "Armor", count: 1 },
    ]);
  });
});
