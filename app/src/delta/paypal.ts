export const getCaptureStoreOrderUserUpdate = () => ({
  userPatch: {},
  userDelta: {},
});

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
