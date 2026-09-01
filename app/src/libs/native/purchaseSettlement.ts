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
}

export interface StoreRestoreAttempt {
  /** Subscription product ids the native SDK says the restored account owns. */
  expectedProductIds: readonly string[];
}

export type StoreRestoreObservation = "reconciled" | "rejected" | "pending";
export type StoreRestoreResult = "reconciled" | "rejected" | "timed-out";

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

/** Whether the receipt belonging to this exact checkout attempt reached a terminal state. */
export const hasSettledStorePurchase = (
  recent: StorePurchaseSettlement[],
  attempt: StorePurchaseAttempt,
): boolean => {
  const matching = attempt.transactionId
    ? recent.find((purchase) => purchase.transactionId === attempt.transactionId)
    : recent.find(
        (purchase) =>
          purchase.productId === attempt.productId &&
          !attempt.baselineReceiptIds.includes(purchase.id),
      );
  return Boolean(matching && !isPendingStorePurchase(matching));
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
    purchase.expiresAt !== null &&
    purchase.expiresAt.getTime() > now.getTime();
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
