import { describe, expect, it } from "vitest";
import {
  hasSettledNewPurchase,
  isPendingStorePurchase,
  type StorePurchaseSettlement,
} from "@/libs/native/purchaseSettlement";

const receipt = (
  overrides: Partial<StorePurchaseSettlement> = {},
): StorePurchaseSettlement => ({
  id: "new",
  acceptedAt: new Date(),
  grantedAt: null,
  revokedAt: null,
  ...overrides,
});

describe("native purchase settlement", () => {
  it("does not treat receipt insertion as a completed grant", () => {
    const pending = receipt();
    expect(isPendingStorePurchase(pending)).toBe(true);
    expect(hasSettledNewPurchase([pending], "old")).toBe(false);
  });

  it("settles only after the new receipt is granted or retired", () => {
    expect(
      hasSettledNewPurchase([receipt({ grantedAt: new Date() })], "old"),
    ).toBe(true);
    expect(
      hasSettledNewPurchase([receipt({ revokedAt: new Date() })], "old"),
    ).toBe(true);
    expect(
      hasSettledNewPurchase([receipt({ acceptedAt: null })], "old"),
    ).toBe(true);
  });

  it("does not mistake the receipt that predated checkout for this attempt", () => {
    expect(
      hasSettledNewPurchase([receipt({ id: "old", grantedAt: new Date() })], "old"),
    ).toBe(false);
  });
});
