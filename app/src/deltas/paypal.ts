/** Confirm that store-order capture has no additional profile patch or balance delta to apply. */
export const getCaptureStoreOrderUserUpdate = () => ({
  userPatch: {},
  userDelta: {},
});

/**
 * Debit subscription reputation and update federal status only when the caller is the
 * recipient.
 */
export const getSubscribeWithRepsUserUpdate = ({
  cost,
  inputUserId,
  ctxUserId,
  inputStatus,
}: {
  cost: number;
  inputUserId: string;
  ctxUserId: string;
  inputStatus: "NORMAL" | "SILVER" | "GOLD";
}) => ({
  userDelta: { reputationPoints: -cost },
  userPatch: inputUserId === ctxUserId ? { federalStatus: inputStatus } : {},
});

/**
 * Confirm an unchanged caller profile only when successful subscription reconciliation
 * affected another user. Missing identity, failure or caller-owned changes require a refresh.
 */
export const getReconcilePaypalSubscriptionUserUpdate = ({
  resultSuccess,
  inputCallerId,
  ownersAffectedUserId,
}: {
  resultSuccess: boolean;
  inputCallerId: string | undefined;
  ownersAffectedUserId: string;
}) => ({
  userPatch:
    resultSuccess && inputCallerId && inputCallerId !== ownersAffectedUserId
      ? {}
      : undefined,
});
