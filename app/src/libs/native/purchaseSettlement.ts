export interface StorePurchaseSettlement {
  id: string;
  transactionId: string;
  productId: string;
  acceptedAt: Date | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface StorePurchaseAttempt {
  /** The SDK transaction id is authoritative when the platform exposes it. */
  transactionId?: string;
  /** Fallback correlation for platforms which expose no transaction id. */
  productId: string;
  /** Receipt ids fetched from the server immediately before opening checkout. */
  baselineReceiptIds: readonly string[];
  /** Native transaction ids observed before the sheet opened. */
  baselineNativeTransactionIds: readonly string[];
  /** Distinguishes an interrupted sheet from a callback which may have charged. */
  phase: "sheet-open" | "charged-or-pending";
  /** Device time is only used to explain/recover local state, never to order receipts. */
  startedAt: string;
}

export interface StoreRestoreAttempt {
  /** Subscription product ids the native SDK says the restored account owns. */
  expectedProductIds: readonly string[];
}

export interface StorePurchaseLock {
  accountId: string;
  attempt: StorePurchaseAttempt;
}

export type StoreRestoreObservation = "reconciled" | "rejected" | "pending";
export type StoreRestoreResult = "reconciled" | "rejected" | "timed-out";
export type StorePurchaseObservation = "credited" | "rejected" | "pending";
export type StorePurchaseResult = "credited" | "rejected" | "timed-out";

export const finalStorePurchaseResult = (
  observation: StorePurchaseObservation,
): StorePurchaseResult => (observation === "pending" ? "timed-out" : observation);

export const retainStorePurchaseLock = (
  locks: readonly StorePurchaseLock[],
  lock: StorePurchaseLock,
): StorePurchaseLock[] => [
  ...locks.filter(
    (current) =>
      current.accountId !== lock.accountId ||
      current.attempt.productId !== lock.attempt.productId,
  ),
  lock,
];

export const releaseStorePurchaseLock = (
  locks: readonly StorePurchaseLock[],
  accountId: string,
  productId: string,
): StorePurchaseLock[] =>
  locks.filter(
    (current) =>
      current.accountId !== accountId || current.attempt.productId !== productId,
  );

export const finalStoreRestoreResult = (
  observation: StoreRestoreObservation,
): StoreRestoreResult => (observation === "pending" ? "timed-out" : observation);

/** Force a server observation even when the application's QueryClient uses staleTime Infinity. */
export const fetchFreshStoreObservation = async <T>(
  invalidate: () => Promise<unknown>,
  fetch: () => Promise<T>,
): Promise<T> => {
  await invalidate();
  return await fetch();
};

/** An accepted receipt remains pending until it is granted or explicitly retired. */
export const isPendingStorePurchase = (purchase: StorePurchaseSettlement): boolean =>
  purchase.acceptedAt !== null &&
  purchase.grantedAt === null &&
  purchase.revokedAt === null;

/** Classify only the receipt belonging to this exact checkout attempt. */
export const storePurchaseReconciliation = (
  recent: StorePurchaseSettlement[],
  attempt: StorePurchaseAttempt,
): StorePurchaseObservation => {
  const matching = attempt.transactionId
    ? recent.find((purchase) => purchase.transactionId === attempt.transactionId)
    : recent.find(
        (purchase) =>
          purchase.productId === attempt.productId &&
          !attempt.baselineReceiptIds.includes(purchase.id),
      );
  if (!matching || isPendingStorePurchase(matching)) return "pending";
  return matching.grantedAt !== null ? "credited" : "rejected";
};

/** Backwards-compatible predicate for callers which only need a terminal check. */
export const hasSettledStorePurchase = (
  recent: StorePurchaseSettlement[],
  attempt: StorePurchaseAttempt,
): boolean => storePurchaseReconciliation(recent, attempt) !== "pending";

export interface NativePurchaseHistory {
  transactionId: string;
  productId: string;
}

/**
 * Reconcile a callback-lost sheet with RevenueCat's synced purchase history.
 * A transaction absent from the pre-sheet snapshot proves that the sheet progressed past
 * the point where checkout can be safely abandoned; its id also restores exact server
 * correlation. No age-based timeout can make that decision safely.
 */
export const reconcileInterruptedStoreAttempt = (
  attempt: StorePurchaseAttempt,
  history: readonly NativePurchaseHistory[],
): StorePurchaseAttempt | null => {
  const transaction = history.find(
    (entry) =>
      entry.productId === attempt.productId &&
      !attempt.baselineNativeTransactionIds.includes(entry.transactionId),
  );
  if (transaction) {
    return {
      ...attempt,
      transactionId: transaction.transactionId,
      phase: "charged-or-pending",
    };
  }
  return attempt.phase === "sheet-open" ? null : attempt;
};

/**
 * A restore is reconciled only when every subscription the native SDK calls active has a
 * live server entitlement: accepted, granted, unrevoked, and still paid through. Obsolete
 * terminal receipts are evidence of rejection, never success.
 */
export const storeRestoreReconciliation = (
  recent: StorePurchaseSettlement[],
  attempt: StoreRestoreAttempt,
  now = new Date(),
): StoreRestoreObservation => {
  if (attempt.expectedProductIds.length === 0) return "reconciled";
  const receiptsByProduct = attempt.expectedProductIds.map((productId) =>
    recent.filter((purchase) => purchase.productId === productId),
  );
  const hasLiveEntitlement = (purchase: StorePurchaseSettlement) =>
    purchase.acceptedAt !== null &&
    purchase.grantedAt !== null &&
    purchase.revokedAt === null &&
    (purchase.expiresAt !== null
      ? purchase.expiresAt.getTime() > now.getTime()
      : purchase.createdAt.getTime() >= now.getTime() - 63 * 24 * 60 * 60 * 1000);
  if (receiptsByProduct.every((receipts) => receipts.some(hasLiveEntitlement))) {
    return "reconciled";
  }
  if (
    receiptsByProduct.every(
      (receipts) => receipts.length > 0 && !receipts.some(isPendingStorePurchase),
    )
  ) {
    return "rejected";
  }
  return "pending";
};
