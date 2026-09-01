import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  fetchFreshStoreObservation,
  finalStorePurchaseResult,
  finalStoreRestoreResult,
  hasSettledStorePurchase,
  isPendingStorePurchase,
  reconcileInterruptedStoreAttempt,
  releaseStorePurchaseLock,
  retainStorePurchaseLock,
  storeRestoreReconciliation,
  storePurchaseReconciliation,
  type StorePurchaseAttempt,
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

const attempt = (
  overrides: Partial<StorePurchaseAttempt> = {},
): StorePurchaseAttempt => ({
  productId: "tnr_reps_tier1",
  baselineReceiptIds: [],
  baselineNativeTransactionIds: [],
  phase: "charged-or-pending",
  startedAt: "2026-09-01T12:00:00.000Z",
  ...overrides,
});

describe("native purchase settlement", () => {
  it("does not treat receipt insertion as a completed grant", () => {
    const pending = receipt();
    expect(isPendingStorePurchase(pending)).toBe(true);
    expect(
      hasSettledStorePurchase([pending], attempt({
        transactionId: "wanted-transaction",
      })),
    ).toBe(false);
    expect(finalStorePurchaseResult("pending")).toBe("timed-out");
  });

  it("retains an attempt-specific lock after timeout until verification settles", () => {
    const purchaseAttempt = attempt({
      transactionId: "charged-transaction",
      baselineReceiptIds: ["before-charge"],
    });
    const locked = retainStorePurchaseLock([], {
      accountId: "player",
      attempt: purchaseAttempt,
    });
    expect(finalStorePurchaseResult("pending")).toBe("timed-out");
    expect(locked).toEqual([{ accountId: "player", attempt: purchaseAttempt }]);
    expect(
      releaseStorePurchaseLock(locked, "other-player", purchaseAttempt.productId),
    ).toEqual(locked);
    expect(
      releaseStorePurchaseLock(locked, "player", purchaseAttempt.productId),
    ).toEqual([]);
  });

  it("settles only after the new receipt is granted or retired", () => {
    expect(
      hasSettledStorePurchase([receipt({ grantedAt: new Date() })], attempt({
        transactionId: "wanted-transaction",
      })),
    ).toBe(true);
    expect(
      hasSettledStorePurchase([receipt({ revokedAt: new Date() })], attempt({
        transactionId: "wanted-transaction",
      })),
    ).toBe(true);
    expect(
      hasSettledStorePurchase([receipt({ acceptedAt: null })], attempt({
        transactionId: "wanted-transaction",
      })),
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
        attempt({
          transactionId: "wanted-transaction",
        }),
      ),
    ).toBe(false);
  });

  it("falls back to a same-product receipt absent from the fresh server baseline", () => {
    const purchaseAttempt = attempt({
      baselineReceiptIds: ["old-same-product"],
    });
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
        purchaseAttempt,
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
        purchaseAttempt,
      ),
    ).toBe(true);
  });

  it("distinguishes credited, rejected, and pending receipts", () => {
    const purchaseAttempt = attempt({ transactionId: "wanted-transaction" });
    expect(storePurchaseReconciliation([receipt()], purchaseAttempt)).toBe("pending");
    expect(
      storePurchaseReconciliation(
        [receipt({ grantedAt: new Date() })],
        purchaseAttempt,
      ),
    ).toBe("credited");
    expect(
      storePurchaseReconciliation(
        [receipt({ acceptedAt: null })],
        purchaseAttempt,
      ),
    ).toBe("rejected");
    expect(finalStorePurchaseResult("rejected")).toBe("rejected");
  });

  it("recovers a killed native sheet from synced transaction history", () => {
    const interrupted = attempt({
      phase: "sheet-open",
      baselineNativeTransactionIds: ["old-native"],
    });
    expect(
      reconcileInterruptedStoreAttempt(interrupted, [
        { transactionId: "old-native", productId: interrupted.productId },
      ]),
    ).toBeNull();
    expect(
      reconcileInterruptedStoreAttempt(interrupted, [
        { transactionId: "new-native", productId: interrupted.productId },
      ]),
    ).toMatchObject({
      transactionId: "new-native",
      phase: "charged-or-pending",
    });
    expect(
      reconcileInterruptedStoreAttempt(
        attempt({ phase: "charged-or-pending" }),
        [],
      ),
    ).not.toBeNull();
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

  it("uses the same 63-day fallback as the server for null expiry receipts", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const attempt = { expectedProductIds: ["tnr_federal_gold"] };
    expect(
      storeRestoreReconciliation(
        [
          receipt({
            productId: "tnr_federal_gold",
            grantedAt: new Date(),
            expiresAt: null,
            createdAt: new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000),
          }),
        ],
        attempt,
        now,
      ),
    ).toBe("reconciled");
    expect(
      storeRestoreReconciliation(
        [
          receipt({
            productId: "tnr_federal_gold",
            grantedAt: new Date(),
            expiresAt: null,
            createdAt: new Date(now.getTime() - 64 * 24 * 60 * 60 * 1000),
          }),
        ],
        attempt,
        now,
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
