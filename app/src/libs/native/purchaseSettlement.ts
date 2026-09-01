export interface StorePurchaseSettlement {
  id: string;
  acceptedAt: Date | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

/** An accepted receipt remains pending until it is granted or explicitly retired. */
export const isPendingStorePurchase = (purchase: StorePurchaseSettlement): boolean =>
  purchase.acceptedAt !== null &&
  purchase.grantedAt === null &&
  purchase.revokedAt === null;

/** Whether the newest receipt created by this purchase attempt reached a terminal state. */
export const hasSettledNewPurchase = (
  recent: StorePurchaseSettlement[],
  previousNewestId: string | undefined,
): boolean => {
  const newest = recent[0];
  return Boolean(
    newest && newest.id !== previousNewestId && !isPendingStorePurchase(newest),
  );
};
