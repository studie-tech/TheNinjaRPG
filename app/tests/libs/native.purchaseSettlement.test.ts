import { describe, expect, it } from "vitest";
import {
  hasSettledStorePurchase,
  isPendingStorePurchase,
  type StorePurchaseSettlement,
} from "@/libs/native/purchaseSettlement";

const STARTED_AT = new Date("2026-09-01T12:00:00.000Z");

const receipt = (
  overrides: Partial<StorePurchaseSettlement> = {},
): StorePurchaseSettlement => ({
  id: "new",
  transactionId: "wanted-transaction",
  productId: "tnr_reps_tier1",
  acceptedAt: new Date(),
  grantedAt: null,
  revokedAt: null,
  createdAt: new Date(STARTED_AT.getTime() + 1),
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
        startedAt: STARTED_AT,
      }),
    ).toBe(false);
  });

  it("settles only after the new receipt is granted or retired", () => {
    expect(
      hasSettledStorePurchase([receipt({ grantedAt: new Date() })], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        startedAt: STARTED_AT,
      }),
    ).toBe(true);
    expect(
      hasSettledStorePurchase([receipt({ revokedAt: new Date() })], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        startedAt: STARTED_AT,
      }),
    ).toBe(true);
    expect(
      hasSettledStorePurchase([receipt({ acceptedAt: null })], {
        transactionId: "wanted-transaction",
        productId: "tnr_reps_tier1",
        startedAt: STARTED_AT,
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
          startedAt: STARTED_AT,
        },
      ),
    ).toBe(false);
  });

  it("falls back to the expected product and checkout-start time", () => {
    const attempt = { productId: "tnr_reps_tier1", startedAt: STARTED_AT };
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
            createdAt: new Date(STARTED_AT.getTime() - 1),
            grantedAt: new Date(),
          }),
        ],
        attempt,
      ),
    ).toBe(false);
    expect(
      hasSettledStorePurchase(
        [receipt({ transactionId: "new-same-product", grantedAt: new Date() })],
        attempt,
      ),
    ).toBe(true);
  });
});
