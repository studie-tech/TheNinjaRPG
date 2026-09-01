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
  startedAt: Date;
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
          purchase.createdAt.getTime() >= attempt.startedAt.getTime(),
      );
  return Boolean(matching && !isPendingStorePurchase(matching));
};
