/**
 * Replace the saved Bloodright allocation and debit silver while increasing recorded
 * spending. Withhold balance deltas when the opening user needs a refresh.
 */
export const getPurchaseUserUpdate = ({
  updatedUserRequiresUserRefresh,
  optionSeichiSilverCost,
  bloodright,
}: {
  updatedUserRequiresUserRefresh: boolean;
  optionSeichiSilverCost: number;
  bloodright: {
    optionId: string;
    cost: number;
  }[];
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : {
        seichiSilver: -optionSeichiSilverCost,
        bloodrightSpent: optionSeichiSilverCost,
      },
  userPatch: { bloodright },
});

/**
 * Replace the retained Bloodright allocation and return the confirmed silver refund. Withhold
 * balance deltas when the opening user needs a refresh.
 */
export const getRefundUserUpdate = ({
  updatedUserRequiresUserRefresh,
  refund,
  bloodright,
}: {
  updatedUserRequiresUserRefresh: boolean;
  refund: number;
  bloodright: {
    optionId: string;
    cost: number;
  }[];
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : { seichiSilver: refund, bloodrightSpent: -refund },
  userPatch: { bloodright },
});

/**
 * Clear Bloodright allocation and spending, record the monthly reset and refund spent silver
 * and debit any reputation reset fee. Withhold balance deltas when the opening user needs a
 * refresh.
 */
export const getResetUserUpdate = ({
  updatedUserRequiresUserRefresh,
  userBloodrightSpent,
  cost,
  monthlySkillResets,
}: {
  updatedUserRequiresUserRefresh: boolean;
  userBloodrightSpent: number;
  cost: number;
  monthlySkillResets: {
    count: number;
    month: string;
  };
}) => ({
  userDelta: updatedUserRequiresUserRefresh
    ? undefined
    : {
        seichiSilver: userBloodrightSpent,
        ...(cost > 0 ? { reputationPoints: -cost } : {}),
      },
  userPatch: { bloodright: [], bloodrightSpent: 0, monthlySkillResets },
});

/** Replace the owner's allocation and recompute invested Silver from confirmed purchase prices. */
export const getConfirmedBloodright = <
  T extends { purchased: { optionId: string; cost: number }[]; spent: number },
>(
  current: T | undefined,
  purchased: { optionId: string; cost: number }[] | undefined,
): T | undefined =>
  current && purchased
    ? {
        ...current,
        purchased,
        spent: purchased.reduce((sum, entry) => sum + entry.cost, 0),
      }
    : undefined;
