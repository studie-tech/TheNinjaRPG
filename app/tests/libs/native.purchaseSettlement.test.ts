import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  fetchFreshStoreObservation,
  finalStoreRestoreResult,
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
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
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
    const observation = storeRestoreReconciliation([], {
      expectedProductIds: ["tnr_federal_gold"],
    });
    expect(observation).toBe("pending");
    expect(finalStoreRestoreResult(observation)).toBe("timed-out");
  });

  it("accepts only a live paid-through restored entitlement", () => {
    const settled = receipt({
      id: "restored",
      productId: "tnr_federal_gold",
      grantedAt: new Date(),
    });
    expect(
      storeRestoreReconciliation([settled], {
        expectedProductIds: ["tnr_federal_gold"],
      }),
    ).toBe("reconciled");
    expect(
      storeRestoreReconciliation(
        [
          settled,
          receipt({
            id: "obsolete",
            productId: "tnr_federal_gold",
            grantedAt: new Date(),
            revokedAt: new Date(),
          }),
        ],
        { expectedProductIds: ["tnr_federal_gold"] },
      ),
    ).toBe("reconciled");
    expect(
      storeRestoreReconciliation(
        [
          receipt({
            productId: "tnr_federal_gold",
            grantedAt: new Date(),
            revokedAt: new Date(),
          }),
        ],
        { expectedProductIds: ["tnr_federal_gold"] },
      ),
    ).toBe("rejected");
    expect(
      storeRestoreReconciliation(
        [
          settled,
          receipt({
            id: "expired",
            grantedAt: new Date(),
            expiresAt: new Date("2000-01-01"),
          }),
        ],
        { expectedProductIds: ["tnr_federal_gold", "tnr_reps_tier1"] },
      ),
    ).toBe("rejected");
  });

  it("invalidates before observing with an infinite-stale QueryClient", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    });
    const queryKey = ["purchases", "recent"];
    let serverValue = "old";
    const fetch = () =>
      client.fetchQuery({ queryKey, queryFn: () => Promise.resolve(serverValue) });
    expect(await fetch()).toBe("old");
    serverValue = "new";
    expect(await fetch()).toBe("old");
    await expect(
      fetchFreshStoreObservation(
        () => client.invalidateQueries({ queryKey }),
        fetch,
      ),
    ).resolves.toBe("new");
  });
});
