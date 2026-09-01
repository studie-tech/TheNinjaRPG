export interface StorePurchaseSettlement {
  id: string;
  transactionId: string;
  productId: string;
  acceptedAt: Date | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
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
  /** Receipt ownership visible to this account immediately before restore. */
  baselineReceiptIds: readonly string[];
  /** Subscription product ids the native SDK says the restored account owns. */
  expectedProductIds: readonly string[];
}

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
 * A restore is reconciled once every expected subscription has a terminal server receipt.
 * `changed` distinguishes a newly transferred receipt from an already-owned subscription;
 * an empty pending set alone is deliberately not a completion signal.
 */
export const storeRestoreReconciliation = (
  recent: StorePurchaseSettlement[],
  attempt: StoreRestoreAttempt,
): "changed" | "already-reconciled" | null => {
  if (attempt.expectedProductIds.length === 0) return "already-reconciled";
  const matching = attempt.expectedProductIds.map((productId) =>
    recent.find(
      (purchase) =>
        purchase.productId === productId && !isPendingStorePurchase(purchase),
    ),
  );
  if (matching.some((purchase) => !purchase)) return null;
  return matching.some(
    (purchase) => purchase && !attempt.baselineReceiptIds.includes(purchase.id),
  )
    ? "changed"
    : "already-reconciled";
};
