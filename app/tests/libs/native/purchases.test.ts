import { describe, expect, it } from "bun:test";
import { STORE_FEDERAL_PRODUCTS } from "@/drizzle/constants";
import {
  androidSubscriptionChange,
  productIdForPackage,
  purchaseErrorOutcome,
} from "@/libs/native/purchases";

describe("native purchase errors", () => {
  it("uses RevenueCat's code instead of ambiguous message matching", () => {
    expect(purchaseErrorOutcome({ code: "1", message: "Purchase cancelled" })).toEqual({
      status: "cancelled",
    });
    expect(
      purchaseErrorOutcome({
        code: "2",
        message: "StoreProblem after cancellation handshake",
      }),
    ).toEqual({
      status: "error",
      code: "2",
      message: "StoreProblem after cancellation handshake",
      mayHaveCharged: true,
    });
  });

  it("only calls explicit pre-charge failures safe to retry", () => {
    expect(
      purchaseErrorOutcome({ code: "5", message: "Product unavailable" }),
    ).toMatchObject({ status: "error", code: "5", mayHaveCharged: false });
    expect(
      purchaseErrorOutcome({ code: 6, message: "Product already purchased" }),
    ).toMatchObject({ status: "error", code: "6", mayHaveCharged: false });
    expect(purchaseErrorOutcome({ code: "20", message: "Payment pending" })).toEqual({
      status: "pending",
    });
    expect(purchaseErrorOutcome(new Error("Bridge disconnected"))).toMatchObject({
      status: "error",
      mayHaveCharged: true,
    });
  });
});

describe("Play store products", () => {
  it("maps a Play offering package to the selected base plan", () => {
    expect(
      productIdForPackage(
        {
          identifier: "gold-package",
          product: {
            identifier: "tnr_federal_gold",
            priceString: "$15.00",
            title: "Gold",
            description: "Gold tier",
            defaultOption: { basePlanId: "monthly" },
          },
        },
        "android",
      ),
    ).toBe("tnr_federal_gold:monthly");
  });

  it("uses Play's replacement flow for subscription tier changes", () => {
    expect(
      androidSubscriptionChange(
        ["tnr_federal_normal:monthly"],
        "tnr_federal_gold:monthly",
        STORE_FEDERAL_PRODUCTS,
      ),
    ).toEqual({
      status: "change",
      storeProductChangeInfo: {
        oldProductIdentifier: "tnr_federal_normal:monthly",
        replacementMode: "CHARGE_PRORATED_PRICE",
      },
    });
    expect(
      androidSubscriptionChange(
        ["tnr_federal_gold:monthly"],
        "tnr_federal_silver:monthly",
        STORE_FEDERAL_PRODUCTS,
      ),
    ).toEqual({
      status: "change",
      storeProductChangeInfo: {
        oldProductIdentifier: "tnr_federal_gold:monthly",
        replacementMode: "DEFERRED",
      },
    });
  });

  it("does not replace a new or already-active Play subscription", () => {
    expect(
      androidSubscriptionChange([], "tnr_federal_gold:monthly", STORE_FEDERAL_PRODUCTS),
    ).toEqual({ status: "new" });
    expect(
      androidSubscriptionChange(
        ["tnr_federal_gold:monthly"],
        "tnr_federal_gold:monthly",
        STORE_FEDERAL_PRODUCTS,
      ),
    ).toEqual({ status: "active" });
  });
});
