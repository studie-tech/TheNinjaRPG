import { describe, expect, it } from "vitest";
import {
  hasSettledStorePurchase,
  isPendingStorePurchase,
  storeRestoreReconciliation,
  type StorePurchaseSettlement,
} from "@/libs/native/purchaseSettlement";

const receipt = (
  overrides: Partial<StorePurchaseSettlement> = {},
): StorePurchaseSettlement => ({
  id: "new",
  transactionId: "wanted-transaction",
  productId: "tnr_reps_tier1",
  acceptedAt: new Date(),
  grantedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-09-01T12:00:00.001Z"),
  ...overrides,
});

describe("native purchase settlement", () => {
  it("does not treat receipt insertion as a completed grant", () => {
    const pending = receipt();
    expect(isPendingStorePurchase(pending)).toBe(true);
    expect(
      hasSettledStorePurchase([pending], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        baselineReceiptIds: [],
      }),
    ).toBe(false);
  });

  it("settles only after the new receipt is granted or retired", () => {
    expect(
      hasSettledStorePurchase([receipt({ grantedAt: new Date() })], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        baselineReceiptIds: [],
      }),
    ).toBe(true);
    expect(
      hasSettledStorePurchase([receipt({ revokedAt: new Date() })], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        baselineReceiptIds: [],
      }),
    ).toBe(true);
    expect(
      hasSettledStorePurchase([receipt({ acceptedAt: null })], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        baselineReceiptIds: [],
      }),
    ).toBe(true);
  });

  it("does not let an unrelated concurrent receipt settle a transaction-id attempt", () => {
    expect(
      hasSettledStorePurchase(
        [
          receipt({
            id: "unrelated",
            transactionId: "other-transaction",
            productId: "tnr_reps_tier2",
            grantedAt: new Date(),
          }),
          receipt(),
        ],
        {
          transactionId: "wanted-transaction",
          productId: "tnr_reps_tier1",
          baselineReceiptIds: [],
        },
      ),
    ).toBe(false);
  });

  it("falls back to a same-product receipt absent from the fresh server baseline", () => {
    const attempt = {
      productId: "tnr_reps_tier1",
      baselineReceiptIds: ["old-same-product"],
    };
    expect(
      hasSettledStorePurchase(
        [
          receipt({
            transactionId: "other",
            productId: "tnr_reps_tier2",
            grantedAt: new Date(),
          }),
          receipt({
            transactionId: "old-same-product",
            id: "old-same-product",
            createdAt: new Date("2099-01-01T00:00:00.000Z"),
            grantedAt: new Date(),
          }),
        ],
        attempt,
      ),
    ).toBe(false);
    expect(
      hasSettledStorePurchase(
        [
          receipt({
            id: "new-same-product",
            transactionId: "new-same-product",
            // A skewed device clock is irrelevant: only server-issued ids are compared.
            createdAt: new Date("2000-01-01T00:00:00.000Z"),
            grantedAt: new Date(),
          }),
        ],
        attempt,
      ),
    ).toBe(true);
  });

  it("does not finish restore merely because no receipt is pending", () => {
    expect(
      storeRestoreReconciliation([], {
        baselineReceiptIds: [],
        expectedProductIds: ["tnr_federal_gold"],
      }),
    ).toBeNull();
  });

  it("recognizes transferred and already-owned restore receipts", () => {
    const settled = receipt({
      id: "restored",
      productId: "tnr_federal_gold",
      grantedAt: new Date(),
    });
    expect(
      storeRestoreReconciliation([settled], {
        baselineReceiptIds: [],
        expectedProductIds: ["tnr_federal_gold"],
      }),
    ).toBe("changed");
    expect(
      storeRestoreReconciliation([settled], {
        baselineReceiptIds: ["restored"],
        expectedProductIds: ["tnr_federal_gold"],
      }),
    ).toBe("already-reconciled");
  });
});
